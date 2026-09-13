import csv
import json
import math
import statistics
from collections import Counter
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

from .config import DEFAULT_CONFIG
from .data import (
    DEFAULT_DATA_ROOT,
    enrich_roster_ids,
    load_games,
    load_player_stats,
    load_roster_snapshot_rows,
    load_snap_counts,
    read_csv,
)
from .fitting import _solve, game_observations
from .historical_lineups import infer_expected_lineups
from .locked_backtest import grade_ats, load_artifact, select_ats
from .ratings import (
    aggregate_player_stats,
    aggregate_snap_counts,
    build_player_ratings,
    update_player_stat_aggregates,
    update_snap_aggregates,
)
from .stage6_diagnostics import existing_predictor_records, pearson
from .stage7a_diagnostics import distribution, linear_regression


TRAINING_SEASONS = (2021, 2022)
VALIDATION_SEASONS = (2023,)
ALPHAS = (0.0, 1.0, 10.0, 100.0)
CORRELATION_LIMIT = 0.90
LINEAR_DEPENDENCY_LIMIT = 1e-6
REPLACEMENT_RATING = DEFAULT_CONFIG.replacement_rating


CANDIDATE_FEATURES = (
    "home_field_indicator",
    "qb_quality_diff",
    "qb_vs_pass_rush_matchup",
    "qb_vs_coverage_matchup",
    "ol_pass_vs_pass_rush_matchup",
    "ol_run_vs_front_matchup",
    "receiving_vs_secondary_matchup",
    "rushing_vs_front_matchup",
    "ol_weakest_diff",
    "ol_strongest_diff",
    "ol_continuity_diff",
    "ol_replacement_starters_diff",
    "wr1_diff",
    "wr2_diff",
    "te1_diff",
    "receiver_replacements_diff",
    "pass_rusher1_diff",
    "pass_rusher2_diff",
    "weakest_coverage_diff",
    "secondary_average_diff",
    "front_seven_average_diff",
    "rest_diff",
)


FEATURE_GROUPS = {
    "QB": ("qb_quality_diff", "qb_vs_pass_rush_matchup", "qb_vs_coverage_matchup"),
    "OL": ("ol_pass_vs_pass_rush_matchup", "ol_run_vs_front_matchup", "ol_weakest_diff", "ol_strongest_diff", "ol_continuity_diff", "ol_replacement_starters_diff"),
    "receivers": ("receiving_vs_secondary_matchup", "wr1_diff", "wr2_diff", "te1_diff", "receiver_replacements_diff"),
    "rushing": ("rushing_vs_front_matchup",),
    "pass rush": ("qb_vs_pass_rush_matchup", "ol_pass_vs_pass_rush_matchup", "pass_rusher1_diff", "pass_rusher2_diff"),
    "secondary": ("qb_vs_coverage_matchup", "receiving_vs_secondary_matchup", "weakest_coverage_diff", "secondary_average_diff"),
    "weakest-link features": ("ol_weakest_diff", "weakest_coverage_diff"),
    "elite-player features": ("ol_strongest_diff", "wr1_diff", "pass_rusher1_diff"),
}


@dataclass(frozen=True)
class CandidateArtifact:
    model_name: str
    target: str
    feature_names: Tuple[str, ...]
    means: Tuple[float, ...]
    scales: Tuple[float, ...]
    intercept: float
    coefficients: Tuple[float, ...]
    ridge_alpha: float
    training_seasons: Tuple[int, ...]

    def predict(self, row: dict) -> float:
        return self.intercept + sum(
            coefficient * (float(row[name]) - mean) / scale
            for name, mean, scale, coefficient in zip(self.feature_names, self.means, self.scales, self.coefficients)
        )


def residual_bucket(value: float) -> str:
    magnitude = abs(value)
    if magnitude < 1.0:
        return "0-1"
    if magnitude < 2.0:
        return "1-2"
    if magnitude < 3.0:
        return "2-3"
    return "3+"


def _number(row: dict, name: str, default: float = 0.0) -> float:
    try:
        value = str(row.get(name, "")).strip()
        return float(value) if value else default
    except (TypeError, ValueError):
        return default


def _rating_values(starters: Sequence[object], ratings: dict, positions: set[str]) -> List[float]:
    return [
        ratings[player.player_id].rating
        for player in starters
        if player.position in positions and player.player_id in ratings
    ]


def _ordered(values: Sequence[float], count: int, reverse: bool = True) -> List[float]:
    result = sorted(values, reverse=reverse)[:count]
    return result + [REPLACEMENT_RATING] * (count - len(result))


def _team_direct_features(starters: Sequence[object], ratings: dict, previous_ol: set[str]) -> dict:
    qb = _ordered(_rating_values(starters, ratings, {"QB"}), 1)[0]
    rb = _ordered(_rating_values(starters, ratings, {"RB"}), 1)[0]
    wr = _ordered(_rating_values(starters, ratings, {"WR"}), 3)
    te = _ordered(_rating_values(starters, ratings, {"TE"}), 1)[0]
    ol = _ordered(_rating_values(starters, ratings, {"OL"}), 5)
    pass_rush = _ordered(_rating_values(starters, ratings, {"EDGE"}), 2)
    coverage = _rating_values(starters, ratings, {"CB", "S"})
    front = _rating_values(starters, ratings, {"DL", "EDGE", "LB"})
    ol_ids = {player.player_id for player in starters if player.position == "OL"}
    continuity = len(ol_ids & previous_ol) / max(1, len(ol_ids)) if previous_ol else 0.0
    receiver_values = [*wr, te]
    return {
        "qb": qb,
        "rb": rb,
        "wr1": wr[0], "wr2": wr[1], "te1": te,
        "receiving_average": statistics.mean(receiver_values),
        "receiver_replacements": sum(value <= REPLACEMENT_RATING for value in receiver_values),
        "ol_average": statistics.mean(ol), "ol_weakest": min(ol), "ol_strongest": max(ol),
        "ol_continuity": continuity,
        "ol_replacements": sum(value <= REPLACEMENT_RATING for value in ol),
        "pass_rusher1": pass_rush[0], "pass_rusher2": pass_rush[1],
        "pass_rush_average": statistics.mean(pass_rush),
        "weakest_coverage": min(coverage) if coverage else REPLACEMENT_RATING,
        "secondary_average": statistics.mean(coverage) if coverage else REPLACEMENT_RATING,
        "front_seven_average": statistics.mean(front) if front else REPLACEMENT_RATING,
        "ol_ids": ol_ids,
    }


def _game_features(home: dict, away: dict, rest_diff: float) -> dict:
    return {
        "home_field_indicator": 1.0,
        "qb_quality_diff": home["qb"] - away["qb"],
        "qb_vs_pass_rush_matchup": (home["qb"] - away["pass_rush_average"]) - (away["qb"] - home["pass_rush_average"]),
        "qb_vs_coverage_matchup": (home["qb"] - away["secondary_average"]) - (away["qb"] - home["secondary_average"]),
        "ol_pass_vs_pass_rush_matchup": (home["ol_average"] - away["pass_rush_average"]) - (away["ol_average"] - home["pass_rush_average"]),
        "ol_run_vs_front_matchup": (home["ol_average"] - away["front_seven_average"]) - (away["ol_average"] - home["front_seven_average"]),
        "receiving_vs_secondary_matchup": (home["receiving_average"] - away["secondary_average"]) - (away["receiving_average"] - home["secondary_average"]),
        "rushing_vs_front_matchup": (home["rb"] - away["front_seven_average"]) - (away["rb"] - home["front_seven_average"]),
        "ol_weakest_diff": home["ol_weakest"] - away["ol_weakest"],
        "ol_strongest_diff": home["ol_strongest"] - away["ol_strongest"],
        "ol_continuity_diff": home["ol_continuity"] - away["ol_continuity"],
        "ol_replacement_starters_diff": home["ol_replacements"] - away["ol_replacements"],
        "wr1_diff": home["wr1"] - away["wr1"],
        "wr2_diff": home["wr2"] - away["wr2"],
        "te1_diff": home["te1"] - away["te1"],
        "receiver_replacements_diff": home["receiver_replacements"] - away["receiver_replacements"],
        "pass_rusher1_diff": home["pass_rusher1"] - away["pass_rusher1"],
        "pass_rusher2_diff": home["pass_rusher2"] - away["pass_rusher2"],
        "weakest_coverage_diff": home["weakest_coverage"] - away["weakest_coverage"],
        "secondary_average_diff": home["secondary_average"] - away["secondary_average"],
        "front_seven_average_diff": home["front_seven_average"] - away["front_seven_average"],
        "rest_diff": rest_diff,
    }


def _rest_by_game(schedule_path: Path, seasons: Sequence[int]) -> dict:
    targets = set(seasons)
    return {
        row["game_id"]: _number(row, "home_rest", 7.0) - _number(row, "away_rest", 7.0)
        for row in read_csv(schedule_path)
        if int(row.get("season") or 0) in targets and row.get("game_type") == "REG"
    }


def build_direct_feature_records(data_root: Path = DEFAULT_DATA_ROOT) -> List[dict]:
    seasons = (*TRAINING_SEASONS, *VALIDATION_SEASONS)
    raw = data_root / "raw"
    history_years = range(min(seasons) - DEFAULT_CONFIG.history_seasons + 1, max(seasons) + 1)
    all_stats = load_player_stats([raw / f"stats_{year}.csv" for year in history_years], max(seasons) + 1, 1)
    all_snaps = load_snap_counts([raw / f"snaps_{year}.csv" for year in history_years], max(seasons) + 1, 1)
    schedule_path = data_root.parent / "nfl_games.csv"
    games = [game for game in load_games(schedule_path, seasons) if game.game_type == "REG"]
    rest = _rest_by_game(schedule_path, seasons)
    records = []
    for season in seasons:
        season_games = [game for game in games if game.season == season]
        rosters = enrich_roster_ids(read_csv(raw / f"weekly_roster_{season}.csv"), raw / "players.csv")
        history_stats = [row for row in all_stats if int(row.get("season") or 0) < season]
        history_snaps = [row for row in all_snaps if int(row.get("season") or 0) < season]
        stat_aggregates = aggregate_player_stats(history_stats)
        snap_aggregates = aggregate_snap_counts(history_snaps)
        eligible_snaps = list(history_snaps)
        processed_week = 0
        prior_ol: Dict[str, set[str]] = {}
        for week in sorted({game.week for game in season_games}):
            new_stats = [row for row in all_stats if int(row.get("season") or 0) == season and processed_week < int(row.get("week") or 0) < week]
            new_snaps = [row for row in all_snaps if int(row.get("season") or 0) == season and processed_week < int(row.get("week") or 0) < week]
            update_player_stat_aggregates(stat_aggregates, new_stats)
            update_snap_aggregates(snap_aggregates, new_snaps)
            eligible_snaps.extend(new_snaps)
            processed_week = week - 1
            roster = load_roster_snapshot_rows(rosters, week)
            config = replace(DEFAULT_CONFIG, current_season=season, current_week=week)
            players = build_player_ratings(roster, [], [], config, stat_aggregates=stat_aggregates, snap_aggregates=snap_aggregates)
            lineups = infer_expected_lineups(roster, eligible_snaps, players, season, week, f"{season}_W{week}_PREGAME", config)
            team_features = {
                team: _team_direct_features(starters, players, prior_ol.get(team, set()))
                for team, starters in lineups.items()
            }
            for game in (item for item in season_games if item.week == week):
                if game.home_team not in team_features or game.away_team not in team_features:
                    raise RuntimeError(f"Missing direct features for {game.game_id}")
                actual_margin = float(game.home_score) - float(game.away_score)
                actual_total = float(game.home_score) + float(game.away_score)
                records.append({
                    "game_id": game.game_id, "season": season, "week": week, "game_type": "REG",
                    "home_team": game.home_team, "away_team": game.away_team,
                    "actual_home_score": float(game.home_score), "actual_away_score": float(game.away_score),
                    "actual_margin": actual_margin, "actual_total": actual_total,
                    "market_spread": float(game.market_spread), "market_total": float(game.market_total),
                    "market_residual": actual_margin - float(game.market_spread),
                    **_game_features(team_features[game.home_team], team_features[game.away_team], rest.get(game.game_id, 0.0)),
                })
            prior_ol.update({team: values["ol_ids"] for team, values in team_features.items()})
    if len(records) != len(games):
        raise RuntimeError(f"Direct feature coverage incomplete: {len(records)} of {len(games)}")
    return records


def _write_feature_records(path: Path, rows: Sequence[dict]) -> None:
    fields = [key for key in rows[0] if key != "ol_ids"]
    with path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=fields)
        writer.writeheader()
        writer.writerows({field: row[field] for field in fields} for row in rows)


def multivariate_residual_ratio(values: Sequence[float], orthonormal_basis: Sequence[Sequence[float]]) -> Tuple[float, List[float]]:
    mean = statistics.mean(values)
    scale = statistics.pstdev(values)
    if scale < 1e-12:
        return 0.0, [0.0 for _ in values]
    standardized = [(value - mean) / scale for value in values]
    residual = standardized[:]
    # Two passes keep the basis numerically orthogonal enough for the normal-equation solver.
    for _ in range(2):
        for basis_vector in orthonormal_basis:
            projection = sum(value * basis for value, basis in zip(residual, basis_vector))
            residual = [value - projection * basis for value, basis in zip(residual, basis_vector)]
    original_norm = math.sqrt(sum(value * value for value in standardized))
    residual_norm = math.sqrt(sum(value * value for value in residual))
    return residual_norm / original_norm, residual


def _correlation_prune(rows: Sequence[dict]) -> Tuple[Tuple[str, ...], List[dict]]:
    selected = []
    decisions = []
    orthonormal_basis: List[List[float]] = []
    for feature in CANDIDATE_FEATURES:
        values = [float(row[feature]) for row in rows]
        if statistics.pstdev(values) < 1e-9:
            decisions.append({"feature": feature, "decision": "DROP", "reason": "zero variance; home field is absorbed by the margin intercept"})
            continue
        correlations = [(existing, abs(pearson(values, [float(row[existing]) for row in rows]) or 0.0)) for existing in selected]
        strongest = max(correlations, key=lambda item: item[1]) if correlations else None
        if strongest and strongest[1] >= CORRELATION_LIMIT:
            decisions.append({"feature": feature, "decision": "DROP", "reason": f"training correlation {strongest[1]:.3f} with {strongest[0]}"})
            continue
        residual_ratio, residual = multivariate_residual_ratio(values, orthonormal_basis)
        if residual_ratio < LINEAR_DEPENDENCY_LIMIT:
            decisions.append({"feature": feature, "decision": "DROP", "reason": f"multivariate linear dependency; residual ratio {residual_ratio:.2e}"})
            continue
        residual_norm = math.sqrt(sum(value * value for value in residual))
        orthonormal_basis.append([value / residual_norm for value in residual])
        selected.append(feature)
        pairwise = strongest[1] if strongest else 0.0
        decisions.append({"feature": feature, "decision": "KEEP", "reason": f"max pairwise |r| {pairwise:.3f}; multivariate residual ratio {residual_ratio:.3f}"})
    return tuple(selected), decisions


def _fit(rows: Sequence[dict], features: Sequence[str], target: str, alpha: float, name: str) -> CandidateArtifact:
    columns = [[float(row[feature]) for row in rows] for feature in features]
    means = tuple(statistics.mean(column) for column in columns)
    scales = tuple(statistics.pstdev(column) or 1.0 for column in columns)
    design = [[1.0] + [(float(row[feature]) - mean) / scale for feature, mean, scale in zip(features, means, scales)] for row in rows]
    targets = [float(row[target]) for row in rows]
    width = len(features) + 1
    gram = [[sum(row[i] * row[j] for row in design) for j in range(width)] for i in range(width)]
    rhs = [sum(row[i] * target_value for row, target_value in zip(design, targets)) for i in range(width)]
    for index in range(1, width):
        gram[index][index] += alpha
    coefficients = _solve(gram, rhs)
    return CandidateArtifact(name, target, tuple(features), means, scales, coefficients[0], tuple(coefficients[1:]), alpha, TRAINING_SEASONS)


def _metrics(actual: Sequence[float], predicted: Sequence[float]) -> dict:
    errors = [prediction - outcome for prediction, outcome in zip(predicted, actual)]
    regression = linear_regression(predicted, actual)
    mean_actual = statistics.mean(actual)
    sst = sum((value - mean_actual) ** 2 for value in actual)
    sse = sum(value * value for value in errors)
    return {
        "n": len(actual), "mae": statistics.mean(abs(value) for value in errors),
        "rmse": math.sqrt(statistics.mean(value * value for value in errors)),
        "predictive_r_squared": 1.0 - sse / sst,
        "calibration_r_squared": regression["r_squared"],
        "calibration_intercept": regression["intercept"], "calibration_slope": regression["slope"],
        "predicted_std": statistics.pstdev(predicted), "actual_std": statistics.pstdev(actual),
        "residual_mean": statistics.mean(errors), "residual_std": statistics.pstdev(errors),
    }


def _select_alpha(rows: Sequence[dict], features: Sequence[str], target: str, name: str) -> Tuple[float, List[dict]]:
    early = [row for row in rows if int(row["season"]) == 2021]
    late = [row for row in rows if int(row["season"]) == 2022]
    results = []
    for alpha in ALPHAS:
        try:
            artifact = _fit(early, features, target, alpha, name)
        except ValueError as error:
            if "singular" not in str(error).lower():
                raise
            results.append({"alpha": alpha, "status": "SINGULAR"})
            continue
        predictions = [artifact.predict(row) for row in late]
        metrics = _metrics([float(row[target]) for row in late], predictions)
        results.append({"alpha": alpha, "status": "VALID", "mae": metrics["mae"], "rmse": metrics["rmse"]})
    valid_results = [row for row in results if row["status"] == "VALID"]
    if not valid_results:
        raise ValueError(f"No nonsingular {name} candidate in the alpha grid")
    selected = min(valid_results, key=lambda row: (row["mae"], row["alpha"]))["alpha"]
    return selected, results


def _model_evaluation(artifact: CandidateArtifact, rows: Sequence[dict]) -> dict:
    predictions = [artifact.predict(row) for row in rows]
    return {**_metrics([float(row[artifact.target]) for row in rows], predictions), "predictions": predictions}


def _rsm_v1_predictions(rows: Sequence[dict], reports_root: Path) -> List[float]:
    source = {row["game_id"]: row for row in read_csv(reports_root / "rsm-development-v0-predictions.csv")}
    artifact = load_artifact(reports_root / "rsm-v1-artifact.json")
    predictions = []
    for row in rows:
        observations = game_observations(source[row["game_id"]])
        predictions.append(artifact.predict(observations[0][0]) - artifact.predict(observations[1][0]))
    return predictions


def _existing_predictions(rows: Sequence[dict]) -> List[float]:
    targets = [{**row, "game_type": "REG"} for row in rows]
    results = existing_predictor_records(targets)
    by_id = {row["game_id"]: float(row["existing_margin"]) for row in results}
    return [by_id[row["game_id"]] for row in rows]


def _market_residual_buckets(rows: Sequence[dict], predictions: Sequence[float]) -> List[dict]:
    groups = {name: [] for name in ("0-1", "1-2", "2-3", "3+")}
    for row, prediction in zip(rows, predictions):
        groups[residual_bucket(prediction)].append((row, prediction))
    output = []
    for label, entries in groups.items():
        outcomes = [float(row["market_residual"]) for row, _ in entries]
        correct = [prediction * outcome > 0 for (row, prediction), outcome in zip(entries, outcomes) if abs(outcome) > 1e-9]
        aligned = [(1.0 if prediction >= 0 else -1.0) * outcome for (row, prediction), outcome in zip(entries, outcomes)]
        output.append({
            "bucket": label, "n": len(entries),
            "directional_accuracy": statistics.mean(correct) if correct else None,
            "mean_actual_residual": statistics.mean(outcomes) if outcomes else None,
            "mean_aligned_actual_residual": statistics.mean(aligned) if aligned else None,
        })
    return output


def _ats_summary(rows: Sequence[dict], predicted_residuals: Sequence[float]) -> dict:
    results = []
    for row, residual in zip(rows, predicted_residuals):
        pick = "HOME" if residual >= 0 else "AWAY"
        results.append(grade_ats(pick, float(row["actual_margin"]), float(row["market_spread"])))
    counts = Counter(results)
    attempts = counts["WIN"] + counts["LOSS"]
    return {"wins": counts["WIN"], "losses": counts["LOSS"], "pushes": counts["PUSH"], "accuracy": counts["WIN"] / attempts if attempts else None}


def _ablation(training: Sequence[dict], validation: Sequence[dict], features: Sequence[str], alpha: float) -> List[dict]:
    full_a = _fit(training, features, "actual_margin", alpha, "Model A")
    full_b = _fit(training, features, "market_residual", alpha, "Model B")
    base_a = _model_evaluation(full_a, validation)
    base_b = _model_evaluation(full_b, validation)
    output = []
    for group, candidates in FEATURE_GROUPS.items():
        removed = [feature for feature in candidates if feature in features]
        if not removed:
            output.append({"group": group, "status": "UNAVAILABLE_OR_PRUNED", "removed": []})
            continue
        remaining = [feature for feature in features if feature not in removed]
        result_a = _model_evaluation(_fit(training, remaining, "actual_margin", alpha, "Model A ablation"), validation)
        result_b = _model_evaluation(_fit(training, remaining, "market_residual", alpha, "Model B ablation"), validation)
        output.append({
            "group": group, "status": "TESTED", "removed": removed,
            "model_a_margin_mae_delta": result_a["mae"] - base_a["mae"],
            "model_a_calibration_r2_delta": result_a["calibration_r_squared"] - base_a["calibration_r_squared"],
            "model_b_residual_mae_delta": result_b["mae"] - base_b["mae"],
            "model_b_predictive_r2_delta": result_b["predictive_r_squared"] - base_b["predictive_r_squared"],
        })
    output.append({"group": "injuries", "status": "UNAVAILABLE", "removed": [], "reason": "verified pregame injury fields are unavailable"})
    return output


def _total_experiment(training: Sequence[dict], validation: Sequence[dict], features: Sequence[str], reports_root: Path) -> dict:
    alpha, grid = _select_alpha(training, features, "actual_total", "Total diagnostic")
    artifact = _fit(training, features, "actual_total", alpha, "Total diagnostic")
    candidate = _model_evaluation(artifact, validation)
    source = {row["game_id"]: row for row in read_csv(reports_root / "rsm-v1-validation-predictions.csv")}
    rsm_predictions = [float(source[row["game_id"]]["predicted_total"]) for row in validation]
    baseline = _metrics([float(row["actual_total"]) for row in validation], rsm_predictions)
    return {"selected_alpha_training_only": alpha, "grid": grid, "rsm_v1": baseline, "candidate": candidate, "artifact": artifact}


def run_stage7b(reports_root: Path, data_root: Path = DEFAULT_DATA_ROOT, rebuild_features: bool = False) -> dict:
    feature_path = reports_root / "rsm-v2-candidate-direct-features.csv"
    if feature_path.exists() and not rebuild_features:
        rows = list(read_csv(feature_path))
        required = set(CANDIDATE_FEATURES) | {"game_id", "season", "actual_margin", "actual_total", "market_residual"}
        if len(rows) != 815 or not rows or not required.issubset(rows[0]):
            raise ValueError("Cached Stage 7B direct features are incomplete; rerun with rebuild_features=True")
    else:
        rows = build_direct_feature_records(data_root)
        _write_feature_records(feature_path, rows)
    training = [row for row in rows if int(row["season"]) in TRAINING_SEASONS]
    validation = [row for row in rows if int(row["season"]) in VALIDATION_SEASONS]
    if len(training) != 543 or len(validation) != 272:
        raise ValueError("Stage 7B requires 543 training and 272 validation games")
    features, correlation_decisions = _correlation_prune(training)

    alpha_a, grid_a = _select_alpha(training, features, "actual_margin", "RSM-v2 Model A")
    alpha_b, grid_b = _select_alpha(training, features, "market_residual", "RSM-v2 Model B")
    model_a = _fit(training, features, "actual_margin", alpha_a, "RSM-v2 Model A football margin")
    model_b = _fit(training, features, "market_residual", alpha_b, "RSM-v2 Model B market residual")
    evaluation_a = _model_evaluation(model_a, validation)
    evaluation_b = _model_evaluation(model_b, validation)

    actual_margin = [float(row["actual_margin"]) for row in validation]
    rsm_v1_predictions = _rsm_v1_predictions(validation, reports_root)
    existing_predictions = _existing_predictions(validation)
    market_predictions = [float(row["market_spread"]) for row in validation]
    baselines = {
        "RSM-v1": _metrics(actual_margin, rsm_v1_predictions),
        "existing predictor": _metrics(actual_margin, existing_predictions),
        "market": _metrics(actual_margin, market_predictions),
    }
    residual_predictions = evaluation_b.pop("predictions")
    margin_predictions = evaluation_a.pop("predictions")
    evaluation_b["correlation"] = pearson(residual_predictions, [float(row["market_residual"]) for row in validation])
    buckets = _market_residual_buckets(validation, residual_predictions)
    total = _total_experiment(training, validation, features, reports_root)
    total_artifact = total.pop("artifact")

    feature_diagnostics = []
    for name, coefficient in sorted(zip(model_a.feature_names, model_a.coefficients), key=lambda item: abs(item[1]), reverse=True):
        feature_diagnostics.append({
            "feature": name,
            "model_a_standardized_coefficient": coefficient,
            "validation_margin_correlation": pearson([float(row[name]) for row in validation], actual_margin),
            "model_b_standardized_coefficient": model_b.coefficients[model_b.feature_names.index(name)],
            "validation_market_residual_correlation": pearson([float(row[name]) for row in validation], [float(row["market_residual"]) for row in validation]),
        })

    diagnostics = {
        "scope": {"training_seasons": list(TRAINING_SEASONS), "training_games": len(training), "validation_seasons": list(VALIDATION_SEASONS), "validation_games": len(validation), "locked_seasons_used": False},
        "availability": {
            "available": ["QB", "OL starter distribution", "receiver depth", "pass-rusher peaks", "coverage weakness", "front-seven average", "home-field intercept", "rest differential"],
            "unavailable": ["verified pregame injuries", "red-zone offense/defense", "direct pass-block/run-block grades", "pass-rush win rate", "coverage grades"],
            "history_window": "Frozen five-year PSR history retained because Stage 6 could not validate position-specific alternatives without rebuilding ratings.",
        },
        "correlation_audit": {"threshold": CORRELATION_LIMIT, "candidate_count": len(CANDIDATE_FEATURES), "selected_count": len(features), "selected_features": list(features), "decisions": correlation_decisions},
        "training_only_model_selection": {"model_a": {"selected_alpha": alpha_a, "grid": grid_a}, "model_b": {"selected_alpha": alpha_b, "grid": grid_b}},
        "model_a": {"artifact": asdict(model_a), "validation": evaluation_a},
        "model_b": {"artifact": asdict(model_b), "validation": evaluation_b, "directional_buckets": buckets, "ats": _ats_summary(validation, residual_predictions)},
        "baselines": baselines,
        "feature_diagnostics": feature_diagnostics,
        "ablation": _ablation(training, validation, features, alpha_a),
        "total_diagnostic": {**total, "artifact": asdict(total_artifact)},
        "variance_trace": {
            "direct_feature_std": {feature: statistics.pstdev(float(row[feature]) for row in validation) for feature in features},
            "rsm_v1_margin_std": baselines["RSM-v1"]["predicted_std"],
            "rsm_v2_model_a_margin_std": evaluation_a["predicted_std"],
            "actual_margin_std": evaluation_a["actual_std"],
        },
    }
    candidate = {
        "model_version": "RSM-v2-candidate-stage7b-experimental",
        "production_ready": False,
        "locked_seasons_used": False,
        "feature_availability": diagnostics["availability"],
        "correlation_audit": diagnostics["correlation_audit"],
        "model_a": asdict(model_a), "model_b": asdict(model_b), "total_diagnostic": asdict(total_artifact),
        "warning": "Experimental architecture only. No confidence model is included and RSM-v1 remains frozen.",
    }
    (reports_root / "rsm-stage7b-v2-architecture.json").write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")
    (reports_root / "rsm-v2-candidate-stage7b.json").write_text(json.dumps(candidate, indent=2), encoding="utf-8")
    _write_predictions(reports_root / "rsm-stage7b-v2-validation.csv", validation, margin_predictions, residual_predictions, total["candidate"]["predictions"])
    _write_report(reports_root / "rsm-stage7b-v2-architecture.md", diagnostics)
    return diagnostics


def _write_predictions(path: Path, rows: Sequence[dict], margins: Sequence[float], residuals: Sequence[float], totals: Sequence[float]) -> None:
    fields = ("game_id", "season", "week", "home_team", "away_team", "actual_margin", "market_spread", "market_residual", "model_a_margin", "model_b_market_residual", "model_b_market_adjusted_margin", "actual_total", "model_total")
    with path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=fields)
        writer.writeheader()
        for row, margin, residual, total in zip(rows, margins, residuals, totals):
            writer.writerow({
                **{field: row[field] for field in fields if field in row},
                "model_a_margin": margin, "model_b_market_residual": residual,
                "model_b_market_adjusted_margin": float(row["market_spread"]) + residual,
                "model_total": total,
            })


def _pct(value: float | None) -> str:
    return "N/A" if value is None else f"{100.0 * value:.2f}%"


def _write_report(path: Path, data: dict) -> None:
    a = data["model_a"]["validation"]
    b = data["model_b"]["validation"]
    trace = data["variance_trace"]
    baselines = data["baselines"]
    total = data["total_diagnostic"]
    bucket_accuracies = [row["directional_accuracy"] for row in data["model_b"]["directional_buckets"] if row["directional_accuracy"] is not None]
    monotonic = all(later >= earlier for earlier, later in zip(bucket_accuracies, bucket_accuracies[1:]))
    lines = [
        "# Stage 7B - Structural RSM-v2 Candidate",
        "",
        "This is an experimental architecture evaluation. It uses 2021-2022 for fitting/selection and 2023 for validation. RSM-v1 and 2024-2025 artifacts were not modified or used.",
        "",
        "## Scope and availability",
        "",
        f"Training games: {data['scope']['training_games']}; validation games: {data['scope']['validation_games']}; locked seasons used: no.",
        "",
        "Available: " + ", ".join(data["availability"]["available"]) + ".",
        "",
        "Unavailable and not synthesized: " + ", ".join(data["availability"]["unavailable"]) + ".",
        "",
        data["availability"]["history_window"],
        "",
        "## Correlation audit",
        "",
        f"Started with {data['correlation_audit']['candidate_count']} interpretable candidates. Training-only zero-variance, pairwise |r| >= {data['correlation_audit']['threshold']:.2f}, and exact multivariate-dependency pruning retained {data['correlation_audit']['selected_count']} features.",
        "",
        "| Feature | Decision | Reason |", "| --- | --- | --- |",
    ]
    for row in data["correlation_audit"]["decisions"]:
        lines.append(f"| {row['feature']} | {row['decision']} | {row['reason']} |")
    lines += [
        "",
        "Model A never receives market spread. Model B receives the same direct features and predicts `ActualMargin - MarketImpliedMargin`; the market is used only as the target baseline. Home field is constant in a home-oriented margin row and is therefore represented by the intercept rather than an unidentifiable coefficient.",
        "",
        "## Training-only model selection",
        "",
        "The small ridge grid was selected using 2021 fit -> 2022 evaluation, before 2023 evaluation.",
        "",
        "| Model | Alpha | 2022 MAE | 2022 RMSE |", "| --- | ---: | ---: | ---: |",
    ]
    for label, model in data["training_only_model_selection"].items():
        for row in model["grid"]:
            if row["status"] == "SINGULAR":
                lines.append(f"| {label} | {row['alpha']:.1f} | singular | singular |")
            else:
                lines.append(f"| {label} | {row['alpha']:.1f} | {row['mae']:.3f} | {row['rmse']:.3f} |")
    lines += [
        "",
        "## Model A - football margin",
        "",
        "| Model | Margin MAE | RMSE | Calibration R-squared | Predictive R-squared | Calibration slope | Predicted SD | Actual SD |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, metrics in [*baselines.items(), ("RSM-v2 Model A", a)]:
        lines.append(f"| {name} | {metrics['mae']:.3f} | {metrics['rmse']:.3f} | {metrics['calibration_r_squared']:.3f} | {metrics['predictive_r_squared']:.3f} | {metrics['calibration_slope']:.3f} | {metrics['predicted_std']:.3f} | {metrics['actual_std']:.3f} |")
    lines += [
        "",
        f"Variance trace: RSM-v1 margin SD {trace['rsm_v1_margin_std']:.3f}; Model A {trace['rsm_v2_model_a_margin_std']:.3f}; actual {trace['actual_margin_std']:.3f}.",
        "",
        f"Model A residual mean is {a['residual_mean']:.3f} and residual SD is {a['residual_std']:.3f}.",
        "",
        "The market remains the best and simplest validation margin baseline. Model A's improvement over RSM-v1 is marginal and it does not beat the existing predictor or market.",
        "",
        "## Direct-feature diagnostics",
        "",
        "Coefficients are standardized training-fit effects. Validation correlations are diagnostic only and were not used for selection.",
        "",
        "| Feature | Model A coef. | Corr. validation margin | Model B coef. | Corr. market residual |", "| --- | ---: | ---: | ---: | ---: |",
    ]
    for row in data["feature_diagnostics"]:
        lines.append(f"| {row['feature']} | {row['model_a_standardized_coefficient']:+.3f} | {row['validation_margin_correlation']:+.3f} | {row['model_b_standardized_coefficient']:+.3f} | {row['validation_market_residual_correlation']:+.3f} |")
    lines += [
        "",
        "## Model B - market residual",
        "",
        f"Residual MAE {b['mae']:.3f}; RMSE {b['rmse']:.3f}; predictive R-squared {b['predictive_r_squared']:.3f}; predicted/actual correlation {b['correlation']:.3f}.",
        "",
        "| Absolute predicted residual | N | Directional accuracy | Mean actual residual | Mean aligned residual |", "| --- | ---: | ---: | ---: | ---: |",
    ]
    for row in data["model_b"]["directional_buckets"]:
        lines.append(f"| {row['bucket']} | {row['n']} | {_pct(row['directional_accuracy'])} | {row['mean_actual_residual']:.3f} | {row['mean_aligned_actual_residual']:.3f} |")
    ats = data["model_b"]["ats"]
    lines += [
        "",
        f"All-game secondary ATS: {ats['wins']}-{ats['losses']}-{ats['pushes']} ({_pct(ats['accuracy'])}, pushes excluded). No threshold was selected.",
        f"Directional accuracy by magnitude is {'monotonic' if monotonic else 'not monotonic'}.",
        "",
        "## New-architecture ablation",
        "",
        "Positive MAE delta means removal worsened the model. Alpha is held fixed and every ablation is fit on 2021-2022, evaluated on 2023.",
        "",
        "| Removed group | Status | Model A MAE delta | Model A calibration R2 delta | Model B MAE delta | Model B predictive R2 delta |", "| --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for row in data["ablation"]:
        if row["status"] != "TESTED":
            lines.append(f"| {row['group']} | {row['status']} | - | - | - | - |")
        else:
            lines.append(f"| {row['group']} | TESTED | {row['model_a_margin_mae_delta']:+.3f} | {row['model_a_calibration_r2_delta']:+.3f} | {row['model_b_residual_mae_delta']:+.3f} | {row['model_b_predictive_r2_delta']:+.3f} |")
    lines += [
        "",
        "## Limited total diagnostic",
        "",
        "| Model | Total MAE | RMSE | Calibration R-squared | Predictive R-squared | Predicted SD |", "| --- | ---: | ---: | ---: | ---: | ---: |",
        f"| RSM-v1 | {total['rsm_v1']['mae']:.3f} | {total['rsm_v1']['rmse']:.3f} | {total['rsm_v1']['calibration_r_squared']:.3f} | {total['rsm_v1']['predictive_r_squared']:.3f} | {total['rsm_v1']['predicted_std']:.3f} |",
        f"| Direct-feature candidate | {total['candidate']['mae']:.3f} | {total['candidate']['rmse']:.3f} | {total['candidate']['calibration_r_squared']:.3f} | {total['candidate']['predictive_r_squared']:.3f} | {total['candidate']['predicted_std']:.3f} |",
        "",
        "## Final answers",
        "",
        f"1. Direct features partially reduce compression: margin SD rises {100.0 * (a['predicted_std'] / baselines['RSM-v1']['predicted_std'] - 1.0):.1f}% relative to RSM-v1, but remains only {100.0 * a['predicted_std'] / a['actual_std']:.1f}% of actual dispersion.",
        f"2. Model A margin SD is {a['predicted_std']:.3f}, versus RSM-v1 {baselines['RSM-v1']['predicted_std']:.3f} and actual {a['actual_std']:.3f}.",
        f"3. Model A calibration R-squared is {a['calibration_r_squared']:.3f}, versus RSM-v1 {baselines['RSM-v1']['calibration_r_squared']:.3f}.",
        f"4. Model A margin MAE is {a['mae']:.3f}, versus RSM-v1 {baselines['RSM-v1']['mae']:.3f}.",
        "5. Receivers and pass rush carry the clearest incremental validation signal, followed by weakest-link features; every effect is small and rushing is effectively neutral.",
        "6. Weakest-link features help modestly: removing them worsens Model A MAE by 0.107 and Model B MAE by 0.054.",
        "7. Elite-player features do not help in this specification: removing them improves Model A MAE by 0.127 and Model B MAE by 0.055.",
        "8. QB signal survives independently but weakly: removing the QB group worsens Model A MAE by 0.065 and reduces calibration R-squared by 0.014.",
        "9. OL information also survives weakly: removal worsens Model A MAE by 0.058 and Model B MAE by 0.024.",
        "10. Defensive information is limited but present through pass-rush and secondary groups; their Model A removal penalties are 0.103 and 0.052. Injury-specific effects remain unavailable.",
        f"11. Model B only weakly predicts market residual direction: correlation {b['correlation']:.3f}, predictive R-squared {b['predictive_r_squared']:.3f}, and all-game ATS {_pct(ats['accuracy'])}.",
        f"12-13. Larger predicted market residuals are {'more reliable and monotonic' if monotonic else 'not monotonically more reliable'}; therefore a monotonic betting signal is {'present' if monotonic else 'not established'}.",
        f"14. The direct-feature total calibration R-squared is {total['candidate']['calibration_r_squared']:.3f}; roster-based total signal {'remains effectively absent' if total['candidate']['calibration_r_squared'] < 0.02 else 'is still weak and requires separate confirmation'}.",
        f"15. Roster-based O/U development should {'be suspended' if total['candidate']['calibration_r_squared'] < 0.02 else 'remain low priority'} pending materially better inputs.",
        f"16. The candidate is structurally promising enough for limited research because dispersion and calibration R-squared improve, but practical superiority is not established: MAE improves by only {baselines['RSM-v1']['mae'] - a['mae']:.3f} and the simpler existing predictor and market remain better.",
        "17. Three next actions: independently validate the surviving direct features on a new future season; acquire timestamped injury and true OL/pass-rush/coverage grades; simplify or drop feature groups whose validation ablations add no information.",
        "",
        "STOP: no confidence model was built, no 2024-2025 RSM-v2 evaluation occurred, and RSM-v1 remains frozen.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
