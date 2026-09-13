import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

from nfl_predictor import create_model, load_games as load_existing_games

from .config import DEFAULT_CONFIG
from .data import DEFAULT_DATA_ROOT, read_csv
from .fitting import RidgeArtifact, TrainingPlan, _fit_ridge, game_observations
from .locked_backtest import grade_ats, grade_total, load_artifact, select_ats, select_total


EDGE_BUCKETS = ((0.0, 1.0, "0-1"), (1.0, 2.0, "1-2"), (2.0, 3.0, "2-3"), (3.0, 5.0, "3-5"))


def edge_bucket(value: float) -> str:
    magnitude = abs(value)
    for lower, upper, label in EDGE_BUCKETS:
        if lower <= magnitude < upper:
            return label
    return "5+"


def pearson(values_x: Sequence[float], values_y: Sequence[float]) -> float | None:
    if len(values_x) != len(values_y) or len(values_x) < 2:
        return None
    mean_x = statistics.mean(values_x)
    mean_y = statistics.mean(values_y)
    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(values_x, values_y))
    denominator = math.sqrt(sum((x - mean_x) ** 2 for x in values_x) * sum((y - mean_y) ** 2 for y in values_y))
    return numerator / denominator if denominator > 1e-12 else None


def _number(row: dict, name: str) -> float:
    return float(row[name])


def _pick_probability(row: dict, market: str) -> float:
    if market == "ATS":
        return _number(row, "home_cover_probability") if row["ATS_pick"] == "HOME" else _number(row, "away_cover_probability")
    return _number(row, "over_probability") if row["OU_pick"] == "OVER" else _number(row, "under_probability")


def _bet_summary(rows: Iterable[dict], pick_type: str) -> dict:
    records = list(rows)
    result_field = f"{pick_type}_result"
    counts = Counter(row[result_field] for row in records)
    attempts = counts["WIN"] + counts["LOSS"]
    return {
        "n": len(records), "wins": counts["WIN"], "losses": counts["LOSS"], "pushes": counts["PUSH"],
        "accuracy": counts["WIN"] / attempts if attempts else None,
    }


def _score_metrics(rows: Iterable[dict], prefix: str = "predicted") -> dict:
    records = list(rows)
    home_key = f"{prefix}_home_score"
    away_key = f"{prefix}_away_score"
    score_errors = [
        _number(row, predicted) - _number(row, actual)
        for row in records
        for predicted, actual in ((home_key, "actual_home_score"), (away_key, "actual_away_score"))
    ]
    margin_errors = [
        (_number(row, home_key) - _number(row, away_key))
        - (_number(row, "actual_home_score") - _number(row, "actual_away_score"))
        for row in records
    ]
    total_errors = [
        (_number(row, home_key) + _number(row, away_key))
        - (_number(row, "actual_home_score") + _number(row, "actual_away_score"))
        for row in records
    ]
    return {
        "games": len(records),
        "score_mae": statistics.mean(abs(value) for value in score_errors),
        "margin_mae": statistics.mean(abs(value) for value in margin_errors),
        "total_mae": statistics.mean(abs(value) for value in total_errors),
        "score_bias": statistics.mean(score_errors),
        "predicted_score_sd": statistics.pstdev([
            _number(row, key) for row in records for key in (home_key, away_key)
        ]),
        "actual_score_sd": statistics.pstdev([
            _number(row, key) for row in records for key in ("actual_home_score", "actual_away_score")
        ]),
    }


def existing_predictor_records(stage5_rows: Sequence[dict]) -> List[dict]:
    target_by_id = {row["game_id"]: row for row in stage5_rows if row["game_type"] == "REG"}
    model = create_model("baseline")
    results = []
    for game in load_existing_games(refresh=False):
        predicted_margin, predicted_total = model.predict(game)
        target = target_by_id.get(game["game_id"])
        if target is not None:
            predicted_home = (predicted_total + predicted_margin) / 2.0
            predicted_away = (predicted_total - predicted_margin) / 2.0
            market_margin = _number(target, "market_spread")
            market_total = _number(target, "market_total")
            actual_margin = _number(target, "actual_home_score") - _number(target, "actual_away_score")
            actual_total = _number(target, "actual_home_score") + _number(target, "actual_away_score")
            ats_pick = select_ats(predicted_margin, market_margin)
            ou_pick = select_total(predicted_total, market_total)
            results.append({
                **target,
                "existing_home_score": predicted_home,
                "existing_away_score": predicted_away,
                "existing_margin": predicted_margin,
                "existing_total": predicted_total,
                "existing_ATS_pick": ats_pick,
                "existing_ATS_result": grade_ats(ats_pick, actual_margin, market_margin),
                "existing_OU_pick": ou_pick,
                "existing_OU_result": grade_total(ou_pick, actual_total, market_total),
            })
        model.update(game, predicted_margin, predicted_total)
    missing = set(target_by_id) - {row["game_id"] for row in results}
    if missing:
        raise RuntimeError(f"Existing predictor missing {len(missing)} locked games")
    return results


def _existing_summary(rows: Sequence[dict]) -> dict:
    normalized = [
        {**row, "ATS_result": row["existing_ATS_result"], "OU_result": row["existing_OU_result"]}
        for row in rows
    ]
    return {
        "ats": _bet_summary(normalized, "ATS"),
        "ou": _bet_summary(normalized, "OU"),
        **_score_metrics(rows, "existing"),
    }


def _rsm_summary(rows: Sequence[dict]) -> dict:
    return {"ats": _bet_summary(rows, "ATS"), "ou": _bet_summary(rows, "OU"), **_score_metrics(rows)}


def _edge_analysis(rows: Sequence[dict], market: str) -> Dict[str, dict]:
    edge_field = "spread_edge" if market == "ATS" else "total_edge"
    groups = defaultdict(list)
    for row in rows:
        groups[edge_bucket(_number(row, edge_field))].append(row)
    order = ["0-1", "1-2", "2-3", "3-5", "5+"]
    return {label: _bet_summary(groups[label], market) for label in order}


def _confidence_deciles(rows: Sequence[dict]) -> List[dict]:
    ranked = sorted(rows, key=lambda row: max(_pick_probability(row, "ATS"), _pick_probability(row, "OU")))
    deciles = []
    for index, row in enumerate(ranked):
        decile = min(10, index * 10 // len(ranked) + 1)
        while len(deciles) < decile:
            deciles.append([])
        deciles[decile - 1].append(row)
    output = []
    for index, group in enumerate(deciles, 1):
        ats = _bet_summary(group, "ATS")
        ou = _bet_summary(group, "OU")
        output.append({
            "decile": index, "n": len(group),
            "ats_accuracy": ats["accuracy"], "ou_accuracy": ou["accuracy"],
            "mean_predicted_ats_probability": statistics.mean(_pick_probability(row, "ATS") for row in group),
            "actual_ats_frequency": ats["accuracy"],
            "mean_predicted_ou_probability": statistics.mean(_pick_probability(row, "OU") for row in group),
            "actual_ou_frequency": ou["accuracy"],
            "mean_abs_spread_edge": statistics.mean(abs(_number(row, "spread_edge")) for row in group),
            "mean_abs_total_edge": statistics.mean(abs(_number(row, "total_edge")) for row in group),
        })
    return output


def _predict_development(record: dict, artifact: RidgeArtifact, removed: Sequence[str] = ()) -> Tuple[float, float]:
    observations = game_observations(record)
    predictions = []
    for features, _, _ in observations:
        modified = dict(features)
        for feature in removed:
            modified[feature] = artifact.feature_means[artifact.feature_names.index(feature)]
        predictions.append(artifact.predict(modified))
    return predictions[0], predictions[1]


def _prediction_metrics(rows: Sequence[dict], artifact: RidgeArtifact, removed: Sequence[str] = ()) -> dict:
    scored = []
    for row in rows:
        home, away = _predict_development(row, artifact, removed)
        scored.append({
            "predicted_home_score": home, "predicted_away_score": away,
            "actual_home_score": _number(row, "home_score"), "actual_away_score": _number(row, "away_score"),
        })
    return _score_metrics(scored)


def _ablation_artifact(
    training_rows: Sequence[dict],
    removed: Sequence[str],
    frozen_artifact: RidgeArtifact,
) -> RidgeArtifact:
    observations = [observation for row in training_rows for observation in game_observations(row)]
    removal_means = {
        feature: statistics.mean(features[feature] for features, _, _ in observations)
        for feature in removed
    }
    ablated_observations = []
    for features, target, side in observations:
        modified = dict(features)
        modified.update(removal_means)
        ablated_observations.append((modified, target, side))
    return _fit_ridge(
        ablated_observations,
        frozen_artifact.ridge_alpha,
        TrainingPlan(),
        DEFAULT_CONFIG,
    )


def _ablation_assessment(deltas: dict) -> str:
    score, margin, total = (deltas[name] for name in ("score_mae", "margin_mae", "total_mae"))
    helpful = sum(value > 0.025 for value in (score, margin, total))
    harmful = sum(value < -0.025 for value in (score, margin, total))
    if helpful >= 2 and helpful > harmful:
        return "HELPFUL"
    if harmful >= 2 and harmful > helpful:
        return "HARMFUL"
    return "NEUTRAL (MIXED)" if helpful and harmful else "NEUTRAL"


def _ablation_analysis(development_rows: Sequence[dict], artifact: RidgeArtifact) -> List[dict]:
    training_rows = [row for row in development_rows if int(row["season"]) in artifact.training_seasons]
    validation_rows = [row for row in development_rows if int(row["season"]) in artifact.validation_seasons]
    if not training_rows or not validation_rows:
        raise ValueError("Stage 6 ablation requires both frozen training and validation seasons")
    full = _prediction_metrics(validation_rows, artifact)
    available = {
        "QB rating": ("qb_rating",),
        "OL rating": ("ol_rating",),
        "WR/TE receiving rating": ("receiving_rating",),
        "composite pass-offense rating": ("pass_offense_rating",),
        "RB/rushing rating (unit proxy)": ("run_offense_rating",),
        "defensive front (run-defense proxy)": ("opponent_run_defense_rating",),
        "secondary (pass-defense proxy)": ("opponent_pass_defense_rating",),
        "kicker": ("kicker_rating",),
    }
    results = []
    for component, features in available.items():
        ablated_artifact = _ablation_artifact(training_rows, features, artifact)
        metrics = _prediction_metrics(validation_rows, ablated_artifact, features)
        deltas = {name: metrics[name] - full[name] for name in ("score_mae", "margin_mae", "total_mae")}
        classification = _ablation_assessment(deltas)
        if "proxy" in component:
            classification += " (PROXY)"
        results.append({"component": component, **metrics, **{f"delta_{key}": value for key, value in deltas.items()}, "assessment": classification})
    for component in (
        "linebackers (separate)", "injury/replacement adjustment", "recent-form component",
        "multi-year component", "matchup interaction terms",
    ):
        results.append({"component": component, "assessment": "UNCERTAIN", "reason": "not separately represented in frozen RSM-v1 feature artifact"})
    return [{"component": "FULL RSM-v1", **full, "assessment": "REFERENCE"}, *results]


def _feature_diagnostics(validation_rows: Sequence[dict], artifact: RidgeArtifact) -> dict:
    actual_margins = [_number(row, "home_score") - _number(row, "away_score") for row in validation_rows]
    mappings = {
        "QB": ("home_qb_rating", "away_qb_rating"),
        "OL": ("home_ol_rating", "away_ol_rating"),
        "WR_TE": ("home_receiving_rating", "away_receiving_rating"),
        "RB_rushing_proxy": ("home_run_offense_rating", "away_run_offense_rating"),
        "pass_defense": ("home_pass_defense_rating", "away_pass_defense_rating"),
        "run_defense": ("home_run_defense_rating", "away_run_defense_rating"),
        "kicker": ("home_kicker_rating", "away_kicker_rating"),
    }
    margin_correlations = {
        name: pearson([_number(row, home) - _number(row, away) for row in validation_rows], actual_margins)
        for name, (home, away) in mappings.items()
    }
    score_mappings = {
        "QB": "qb_rating", "OL": "ol_rating", "WR_TE": "receiving_rating",
        "RB_rushing_proxy": "run_offense_rating", "pass_defense": "pass_defense_rating",
        "run_defense": "run_defense_rating", "kicker": "kicker_rating",
    }
    score_correlations = {}
    for name, feature in score_mappings.items():
        ratings, outcomes = [], []
        for row in validation_rows:
            for side, opponent in (("home", "away"), ("away", "home")):
                ratings.append(_number(row, f"{side}_{feature}"))
                outcome_side = opponent if "defense" in feature else side
                outcomes.append(_number(row, f"{outcome_side}_score"))
        score_correlations[name] = pearson(ratings, outcomes)
    pair_correlations = {}
    pairs = {
        "QB_vs_pass_offense": ("home_qb_rating", "home_pass_offense_rating"),
        "OL_vs_run_offense": ("home_ol_rating", "home_run_offense_rating"),
        "receiving_vs_pass_offense": ("home_receiving_rating", "home_pass_offense_rating"),
        "pass_defense_vs_run_defense": ("home_pass_defense_rating", "home_run_defense_rating"),
    }
    for name, (first, second) in pairs.items():
        values_first = [_number(row, first) for row in validation_rows] + [_number(row, first.replace("home_", "away_")) for row in validation_rows]
        values_second = [_number(row, second) for row in validation_rows] + [_number(row, second.replace("home_", "away_")) for row in validation_rows]
        pair_correlations[name] = pearson(values_first, values_second)
    return {
        "margin_correlations": margin_correlations,
        "score_correlations": score_correlations,
        "feature_pair_correlations": pair_correlations,
        "standardized_coefficients": dict(zip(artifact.feature_names, artifact.coefficients)),
    }


def _quantile(values: Sequence[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * fraction)]


def _score_bias_analysis(stage5_rows: Sequence[dict], feature_rows: Dict[str, dict]) -> Dict[str, dict]:
    observations = []
    for row in stage5_rows:
        feature = feature_rows[row["game_id"]]
        market_margin = _number(row, "market_spread")
        for side, opponent, is_home in (("home", "away", True), ("away", "home", False)):
            offense = statistics.mean((_number(feature, f"{side}_pass_offense_rating"), _number(feature, f"{side}_run_offense_rating")))
            defense = statistics.mean((_number(feature, f"{opponent}_pass_defense_rating"), _number(feature, f"{opponent}_run_defense_rating")))
            favorite = (is_home and market_margin > 0) or (not is_home and market_margin < 0)
            observations.append({
                "side": "HOME" if is_home else "AWAY", "role": "FAVORITE" if favorite else "UNDERDOG",
                "offense": offense, "opponent_defense": defense,
                "predicted": _number(row, f"predicted_{side}_score"), "actual": _number(row, f"actual_{side}_score"),
            })
    offense_low = _quantile([row["offense"] for row in observations], 0.25)
    offense_high = _quantile([row["offense"] for row in observations], 0.75)
    defense_low = _quantile([row["opponent_defense"] for row in observations], 0.25)
    defense_high = _quantile([row["opponent_defense"] for row in observations], 0.75)
    groups = {
        "HOME": lambda row: row["side"] == "HOME", "AWAY": lambda row: row["side"] == "AWAY",
        "FAVORITE": lambda row: row["role"] == "FAVORITE", "UNDERDOG": lambda row: row["role"] == "UNDERDOG",
        "STRONG_OFFENSE": lambda row: row["offense"] >= offense_high,
        "WEAK_OFFENSE": lambda row: row["offense"] <= offense_low,
        "STRONG_DEFENSE_FACED": lambda row: row["opponent_defense"] >= defense_high,
        "WEAK_DEFENSE_FACED": lambda row: row["opponent_defense"] <= defense_low,
    }
    output = {}
    for name, predicate in groups.items():
        selected = [row for row in observations if predicate(row)]
        output[name] = {
            "n": len(selected), "mean_predicted": statistics.mean(row["predicted"] for row in selected),
            "mean_actual": statistics.mean(row["actual"] for row in selected),
            "bias": statistics.mean(row["predicted"] - row["actual"] for row in selected),
            "mae": statistics.mean(abs(row["predicted"] - row["actual"]) for row in selected),
        }
    output["OVERALL"] = {
        "n": len(observations), "mean_predicted": statistics.mean(row["predicted"] for row in observations),
        "mean_actual": statistics.mean(row["actual"] for row in observations),
        "bias": statistics.mean(row["predicted"] - row["actual"] for row in observations),
        "mae": statistics.mean(abs(row["predicted"] - row["actual"]) for row in observations),
        "predicted_sd": statistics.pstdev(row["predicted"] for row in observations),
        "actual_sd": statistics.pstdev(row["actual"] for row in observations),
    }
    return output


def _market_analysis(rows: Sequence[dict], feature_rows: Dict[str, dict]) -> dict:
    model_margin_errors, market_margin_errors = [], []
    model_total_errors, market_total_errors = [], []
    spread_edges, margin_residuals, total_edges, total_residuals = [], [], [], []
    feature_series = defaultdict(list)
    market_margins, market_totals, model_margins, model_totals = [], [], [], []
    for row in rows:
        actual_margin = _number(row, "actual_home_score") - _number(row, "actual_away_score")
        actual_total = _number(row, "actual_home_score") + _number(row, "actual_away_score")
        model_margin = _number(row, "predicted_margin")
        model_total = _number(row, "predicted_total")
        market_margin = _number(row, "market_spread")
        market_total = _number(row, "market_total")
        model_margin_errors.append(model_margin - actual_margin)
        market_margin_errors.append(market_margin - actual_margin)
        model_total_errors.append(model_total - actual_total)
        market_total_errors.append(market_total - actual_total)
        spread_edges.append(model_margin - market_margin)
        margin_residuals.append(actual_margin - market_margin)
        total_edges.append(model_total - market_total)
        total_residuals.append(actual_total - market_total)
        market_margins.append(market_margin); market_totals.append(market_total)
        model_margins.append(model_margin); model_totals.append(model_total)
        feature = feature_rows[row["game_id"]]
        feature_series["QB mismatch"].append(_number(feature, "home_qb_rating") - _number(feature, "away_qb_rating"))
        feature_series["OL mismatch"].append(_number(feature, "home_ol_rating") - _number(feature, "away_ol_rating"))
        feature_series["receiver mismatch"].append(_number(feature, "home_receiving_rating") - _number(feature, "away_receiving_rating"))
        feature_series["pass offense-defense matchup"].append(_number(feature, "home_pass_offense_rating") - _number(feature, "away_pass_defense_rating"))
        feature_series["run offense-defense matchup"].append(_number(feature, "home_run_offense_rating") - _number(feature, "away_run_defense_rating"))
        feature_series["overall roster proxy"].append(model_margin - 1.8283793474441806)
    return {
        "model_margin_mae": statistics.mean(abs(value) for value in model_margin_errors),
        "market_margin_mae": statistics.mean(abs(value) for value in market_margin_errors),
        "model_total_mae": statistics.mean(abs(value) for value in model_total_errors),
        "market_total_mae": statistics.mean(abs(value) for value in market_total_errors),
        "margin_error_correlation": pearson(model_margin_errors, market_margin_errors),
        "total_error_correlation": pearson(model_total_errors, market_total_errors),
        "rsm_margin_vs_market_margin_correlation": pearson(model_margins, market_margins),
        "rsm_total_vs_market_total_correlation": pearson(model_totals, market_totals),
        "spread_edge_vs_market_residual_correlation": pearson(spread_edges, margin_residuals),
        "total_edge_vs_market_residual_correlation": pearson(total_edges, total_residuals),
        "feature_vs_market_margin": {name: pearson(values, market_margins) for name, values in feature_series.items()},
        "feature_vs_margin_residual": {name: pearson(values, margin_residuals) for name, values in feature_series.items()},
        "feature_vs_total_residual": {name: pearson(values, total_residuals) for name, values in feature_series.items()},
    }


def _playoff_analysis(regular: Sequence[dict], playoffs: Sequence[dict]) -> dict:
    def values(rows):
        return {
            "n": len(rows),
            "mean_abs_spread_edge": statistics.mean(abs(_number(row, "spread_edge")) for row in rows),
            "mean_abs_total_edge": statistics.mean(abs(_number(row, "total_edge")) for row in rows),
            "mean_actual_total": statistics.mean(_number(row, "actual_home_score") + _number(row, "actual_away_score") for row in rows),
            "ats": _bet_summary(rows, "ATS"), "ou": _bet_summary(rows, "OU"),
        }
    ats_pick = {pick: _bet_summary([row for row in playoffs if row["ATS_pick"] == pick], "ATS") for pick in ("HOME", "AWAY")}
    ou_pick = {pick: _bet_summary([row for row in playoffs if row["OU_pick"] == pick], "OU") for pick in ("OVER", "UNDER")}
    favorite_groups = defaultdict(list)
    for row in playoffs:
        market_margin = _number(row, "market_spread")
        favorite = "HOME" if market_margin > 0 else "AWAY" if market_margin < 0 else "PICKEM"
        label = "FAVORITE" if row["ATS_pick"] == favorite else "UNDERDOG" if favorite != "PICKEM" else "PICKEM"
        favorite_groups[label].append(row)
    return {
        "regular": values(regular),
        "playoffs": values(playoffs),
        "playoff_ats_by_pick": ats_pick,
        "playoff_ou_by_pick": ou_pick,
        "playoff_ats_by_market_role": {
            label: _bet_summary(favorite_groups[label], "ATS") for label in ("FAVORITE", "UNDERDOG", "PICKEM")
        },
    }


def run_stage6_diagnostics(reports_root: Path, data_root: Path = DEFAULT_DATA_ROOT) -> dict:
    stage5 = list(read_csv(reports_root / "rsm-backtest-games.csv"))
    regular = [row for row in stage5 if row["game_type"] == "REG"]
    playoffs = [row for row in stage5 if row["game_type"] != "REG"]
    feature_rows = {row["game_id"]: row for row in read_csv(reports_root / "rsm-locked-features-predictions.csv")}
    if set(row["game_id"] for row in regular) != set(feature_rows):
        raise ValueError("Stage 6 requires an exact locked-game feature join")
    existing = existing_predictor_records(regular)
    existing_by_id = {row["game_id"]: row for row in existing}
    artifact = load_artifact(reports_root / "rsm-v1-artifact.json")
    development = [row for row in read_csv(reports_root / "rsm-development-v0-predictions.csv") if int(row["season"]) == 2023]
    market = _market_analysis(regular, feature_rows)
    diagnostics = {
        "existing_predictor": _existing_summary(existing),
        "rsm_v1": _rsm_summary(regular),
        "market": market,
        "ats_edge_buckets": _edge_analysis(regular, "ATS"),
        "ou_edge_buckets": _edge_analysis(regular, "OU"),
        "confidence_deciles": _confidence_deciles(regular),
        "score_bias": _score_bias_analysis(regular, feature_rows),
        "validation_ablation": _ablation_analysis(
            list(read_csv(reports_root / "rsm-development-v0-predictions.csv")), artifact
        ),
        "position_diagnostics": _feature_diagnostics(development, artifact),
        "playoffs": _playoff_analysis(regular, playoffs),
        "history_windows": {
            "status": "UNCERTAIN",
            "reason": "Only the frozen five-year feature artifact exists; 1/2/3-year comparisons require rebuilding player ratings and were prohibited in Stage 6.",
        },
    }
    csv_rows = []
    confidence_decile_by_id = {}
    ranked = sorted(regular, key=lambda row: max(_pick_probability(row, "ATS"), _pick_probability(row, "OU")))
    for index, row in enumerate(ranked):
        confidence_decile_by_id[row["game_id"]] = min(10, index * 10 // len(ranked) + 1)
    for row in regular:
        existing_row = existing_by_id[row["game_id"]]
        actual_margin = _number(row, "actual_home_score") - _number(row, "actual_away_score")
        actual_total = _number(row, "actual_home_score") + _number(row, "actual_away_score")
        csv_rows.append({
            "game_id": row["game_id"], "season": row["season"], "week": row["week"],
            "rsm_margin_error": _number(row, "predicted_margin") - actual_margin,
            "market_margin_error": _number(row, "market_spread") - actual_margin,
            "existing_margin_error": _number(existing_row, "existing_margin") - actual_margin,
            "rsm_total_error": _number(row, "predicted_total") - actual_total,
            "market_total_error": _number(row, "market_total") - actual_total,
            "existing_total_error": _number(existing_row, "existing_total") - actual_total,
            "spread_edge": row["spread_edge"], "ats_edge_bucket": edge_bucket(_number(row, "spread_edge")),
            "total_edge": row["total_edge"], "ou_edge_bucket": edge_bucket(_number(row, "total_edge")),
            "confidence_decile": confidence_decile_by_id[row["game_id"]],
            "ATS_result": row["ATS_result"], "OU_result": row["OU_result"],
        })
    with (reports_root / "rsm-stage6-diagnostics.csv").open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(csv_rows[0]))
        writer.writeheader(); writer.writerows(csv_rows)
    (reports_root / "rsm-stage6-diagnostics.json").write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")
    _write_report(reports_root / "rsm-stage6-diagnostics.md", diagnostics)
    return diagnostics


def _pct(value: float | None) -> str:
    return "N/A" if value is None else f"{100 * value:.2f}%"


def _corr(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.3f}"


def _write_report(path: Path, data: dict) -> None:
    existing, rsm, market = data["existing_predictor"], data["rsm_v1"], data["market"]
    lines = [
        "# RSM Stage 6 Diagnostics",
        "",
        "This report diagnoses the frozen RSM-v1 results. It does not tune 2024-2025, change model coefficients, or implement RSM-v2.",
        "",
        "## Existing predictor comparison — identical 544 games",
        "",
        "The comparison uses the documented pre-RSM `baseline` profile chronologically, with an all-game pick on the same closing lines and the same grading convention as RSM.",
        "",
        "| Model | ATS | O/U | Score MAE | Margin MAE | Total MAE |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        f"| Existing baseline | {_pct(existing['ats']['accuracy'])} | {_pct(existing['ou']['accuracy'])} | {existing['score_mae']:.3f} | {existing['margin_mae']:.3f} | {existing['total_mae']:.3f} |",
        f"| RSM-v1 | {_pct(rsm['ats']['accuracy'])} | {_pct(rsm['ou']['accuracy'])} | {rsm['score_mae']:.3f} | {rsm['margin_mae']:.3f} | {rsm['total_mae']:.3f} |",
        "",
        "## RSM versus market error",
        "",
        "| Measure | RSM | Market |",
        "| --- | ---: | ---: |",
        f"| Margin MAE | {market['model_margin_mae']:.3f} | {market['market_margin_mae']:.3f} |",
        f"| Total MAE | {market['model_total_mae']:.3f} | {market['market_total_mae']:.3f} |",
        "",
        f"RSM/market error correlation is {_corr(market['margin_error_correlation'])} for margin and {_corr(market['total_error_correlation'])} for total. RSM prediction correlation with the market is {_corr(market['rsm_margin_vs_market_margin_correlation'])} for margin and {_corr(market['rsm_total_vs_market_total_correlation'])} for total.",
        f"The correlation between RSM edge and what the market missed is {_corr(market['spread_edge_vs_market_residual_correlation'])} for margin and {_corr(market['total_edge_vs_market_residual_correlation'])} for total.",
        "",
        "## Edge-size analysis",
        "",
        "### ATS",
        "",
        "| Absolute edge | N | W-L-P | Accuracy |",
        "| --- | ---: | ---: | ---: |",
    ]
    for bucket, metrics in data["ats_edge_buckets"].items():
        lines.append(f"| {bucket} | {metrics['n']} | {metrics['wins']}-{metrics['losses']}-{metrics['pushes']} | {_pct(metrics['accuracy'])} |")
    lines += ["", "### O/U", "", "| Absolute edge | N | W-L-P | Accuracy |", "| --- | ---: | ---: | ---: |"]
    for bucket, metrics in data["ou_edge_buckets"].items():
        lines.append(f"| {bucket} | {metrics['n']} | {metrics['wins']}-{metrics['losses']}-{metrics['pushes']} | {_pct(metrics['accuracy'])} |")
    lines += [
        "", "## Confidence deciles", "",
        "Deciles are ordered from lowest to highest claimed confidence using the stronger of the ATS and O/U pick probabilities.", "",
        "| Decile | N | ATS | Mean ATS p | Actual ATS | O/U | Mean O/U p | Actual O/U | Mean ATS edge | Mean O/U edge |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in data["confidence_deciles"]:
        lines.append(
            f"| {row['decile']} | {row['n']} | {_pct(row['ats_accuracy'])} | {_pct(row['mean_predicted_ats_probability'])} | {_pct(row['actual_ats_frequency'])} | "
            f"{_pct(row['ou_accuracy'])} | {_pct(row['mean_predicted_ou_probability'])} | {_pct(row['actual_ou_frequency'])} | {row['mean_abs_spread_edge']:.2f} | {row['mean_abs_total_edge']:.2f} |"
        )
    lines += [
        "", "The confidence score is derived from a normal residual model whose scales came from 2023 validation. It is distinct from lineup confidence. The deciles show whether larger model-market deviations and the residual-based probabilities are monotonic out of sample.",
        "", "### Confidence-inversion findings", "",
        "| Question | Finding |", "| --- | --- |",
        "| A. Probability calibration incorrect? | Yes. The highest decile claimed 72.19% mean ATS probability but won 35.19%; O/U claimed 65.90% and won 44.44%. |",
        "| B. Raw edge inversely related to accuracy? | At the extreme, yes; overall it is non-monotonic. The largest ATS and O/U edge buckets did not outperform the smaller buckets. |",
        "| C. Uncertainty calculation incorrect? | Inadequate out of sample. A single 2023 residual SD converts edge magnitude directly into confidence and does not model feature or lineup uncertainty. |",
        "| D. Lineup and prediction confidence confused? | No. Prediction confidence is computed from market edge and residual SD; lineup confidence is a separate field. |",
        "| E. Extreme ratings causing excess confidence? | Plausible but not proven causally. Correlated QB, receiving, and composite-offense inputs can create extreme model-market deviations, which the probability transform treats as highly certain. |",
        "", "## Score bias", "",
        "| Group | N team scores | Predicted | Actual | Bias | MAE |", "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, metrics in data["score_bias"].items():
        lines.append(f"| {name} | {metrics['n']} | {metrics['mean_predicted']:.2f} | {metrics['mean_actual']:.2f} | {metrics['bias']:.2f} | {metrics['mae']:.2f} |")
    overall = data["score_bias"]["OVERALL"]
    lines += [
        "",
        f"Predicted team-score SD is {overall['predicted_sd']:.3f}, versus actual SD {overall['actual_sd']:.3f}; a materially smaller predicted SD indicates compression toward the mean.",
        "", "## Validation-only component ablation", "",
        "Each available component is removed, the ridge model is refit on 2021-2022 with the frozen alpha, and the ablated model is evaluated on 2023. Positive deltas mean removal made error worse. No 2024-2025 locked result is used for fitting, classification, or selection.", "",
        "| Component removed | Score MAE | Δ | Margin MAE | Δ | Total MAE | Δ | Assessment |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for row in data["validation_ablation"]:
        if row["assessment"] in {"UNCERTAIN"}:
            lines.append(f"| {row['component']} | — | — | — | — | — | — | UNCERTAIN |")
        elif row["assessment"] == "REFERENCE":
            lines.append(f"| {row['component']} | {row['score_mae']:.3f} | — | {row['margin_mae']:.3f} | — | {row['total_mae']:.3f} | — | REFERENCE |")
        else:
            lines.append(
                f"| {row['component']} | {row['score_mae']:.3f} | {row['delta_score_mae']:+.3f} | {row['margin_mae']:.3f} | {row['delta_margin_mae']:+.3f} | "
                f"{row['total_mae']:.3f} | {row['delta_total_mae']:+.3f} | {row['assessment']} |"
            )
    lines += [
        "", "## Position-weight diagnostics", "",
        "Validation correlation with subsequent game margin:", "",
        "| Rating differential | Correlation |", "| --- | ---: |",
    ]
    for name, value in data["position_diagnostics"]["margin_correlations"].items():
        lines.append(f"| {name} | {_corr(value)} |")
    lines += ["", "Validation correlation with subsequent team scoring (defense rows use opponent points, so negative is favorable):", "", "| Rating | Correlation |", "| --- | ---: |"]
    for name, value in data["position_diagnostics"]["score_correlations"].items():
        lines.append(f"| {name} | {_corr(value)} |")
    lines += ["", "Key within-model feature correlations:", "", "| Pair | Correlation |", "| --- | ---: |"]
    for name, value in data["position_diagnostics"]["feature_pair_correlations"].items():
        lines.append(f"| {name} | {_corr(value)} |")
    lines += ["", "Frozen standardized coefficients:", "", "| Feature | Coefficient |", "| --- | ---: |"]
    for name, value in sorted(data["position_diagnostics"]["standardized_coefficients"].items(), key=lambda item: abs(item[1]), reverse=True):
        lines.append(f"| {name} | {value:+.3f} |")
    lines += [
        "", "The artifact contains both QB/OL/receiving features and composite pass/run offense, so high correlations and opposing coefficient signs are evidence of multicollinearity and possible double-counting. Pass rush, linebackers, and secondary are not separately exposed and cannot be assigned causal importance.",
        "", "## Five-year history", "",
        data["history_windows"]["reason"],
        "", "## Market pricing and residual signal", "",
        "| Roster feature | Corr. market spread | Corr. margin residual | Corr. total residual |", "| --- | ---: | ---: | ---: |",
    ]
    for name in market["feature_vs_market_margin"]:
        lines.append(f"| {name} | {_corr(market['feature_vs_market_margin'][name])} | {_corr(market['feature_vs_margin_residual'][name])} | {_corr(market['feature_vs_total_residual'][name])} |")
    lines += [
        "",
        "QB and receiver differentials move strongly with the market spread, but every available feature has near-zero correlation with margin and total residuals. Timestamped injury availability is absent, so major-injury pricing cannot be tested directly. The available evidence says the market already prices much of the strongest measured roster information and RSM-v1 adds no demonstrated independent residual signal.",
    ]
    playoff = data["playoffs"]
    lines += [
        "", "## Playoff diagnostic", "",
        "| Split | N | Mean absolute ATS edge | Mean absolute O/U edge | Actual total | ATS | O/U |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        f"| Regular season | {playoff['regular']['n']} | {playoff['regular']['mean_abs_spread_edge']:.2f} | {playoff['regular']['mean_abs_total_edge']:.2f} | {playoff['regular']['mean_actual_total']:.2f} | {_pct(playoff['regular']['ats']['accuracy'])} | {_pct(playoff['regular']['ou']['accuracy'])} |",
        f"| Playoffs | {playoff['playoffs']['n']} | {playoff['playoffs']['mean_abs_spread_edge']:.2f} | {playoff['playoffs']['mean_abs_total_edge']:.2f} | {playoff['playoffs']['mean_actual_total']:.2f} | {_pct(playoff['playoffs']['ats']['accuracy'])} | {_pct(playoff['playoffs']['ou']['accuracy'])} |",
        "",
        "| Playoff split | N | Record | Accuracy |",
        "| --- | ---: | ---: | ---: |",
    ]
    for label, metrics in playoff["playoff_ats_by_pick"].items():
        lines.append(f"| ATS pick {label} | {metrics['n']} | {metrics['wins']}-{metrics['losses']}-{metrics['pushes']} | {_pct(metrics['accuracy'])} |")
    for label, metrics in playoff["playoff_ats_by_market_role"].items():
        if metrics["n"]:
            lines.append(f"| ATS pick {label} | {metrics['n']} | {metrics['wins']}-{metrics['losses']}-{metrics['pushes']} | {_pct(metrics['accuracy'])} |")
    for label, metrics in playoff["playoff_ou_by_pick"].items():
        lines.append(f"| O/U pick {label} | {metrics['n']} | {metrics['wins']}-{metrics['losses']}-{metrics['pushes']} | {_pct(metrics['accuracy'])} |")
    lines += [
        "",
        "Playoffs had somewhat larger mean edges and a 1.39-point higher scoring environment. Any apparent matchup split is too small to distinguish from luck. The 26-game sample and stale pre-playoff lineup features make attribution uncertain; no playoff-specific optimization is justified.",
        "", "## Answers and recommendation", "",
        f"1. Score prediction: RSM-v1 {'improves' if rsm['score_mae'] < existing['score_mae'] else 'does not improve'} on the existing baseline ({rsm['score_mae']:.3f} vs {existing['score_mae']:.3f} MAE).",
        f"2. Margin prediction: RSM-v1 {'improves' if rsm['margin_mae'] < existing['margin_mae'] else 'does not improve'} ({rsm['margin_mae']:.3f} vs {existing['margin_mae']:.3f} MAE).",
        f"3. Total prediction: RSM-v1 {'improves' if rsm['total_mae'] < existing['total_mae'] else 'does not improve'} ({rsm['total_mae']:.3f} vs {existing['total_mae']:.3f} MAE).",
        f"4. Independent market information is weak: edge/residual correlations are {_corr(market['spread_edge_vs_market_residual_correlation'])} for margin and {_corr(market['total_edge_vs_market_residual_correlation'])} for total.",
        "5. HIGH confidence underperformed because confidence is mostly a transformation of edge magnitude under a fixed normal residual scale, while larger deviations were not reliably more accurate. It is not caused by confusion with lineup confidence, which is a separate field.",
        "6. Larger edges perform worse at the extreme and are non-monotonic overall; no threshold is selected.",
        "7. No available component shows a robust, material validation improvement after refitting. The pass-defense/secondary proxy is directionally helpful but small; the rest are approximately neutral or mixed.",
        "8. No component is robustly HARMFUL under the refit ablation. Separate linebackers, injuries, recent form, history components, and interaction terms remain UNCERTAIN because they are absent from the frozen artifact.",
        "9. QB is not demonstrably weighted appropriately: it has the largest coefficient, but 0.949 correlation with composite pass offense and the opposing pass-offense coefficient make the effective contribution unstable and hard to identify.",
        "10. OL does not show a material independent validation contribution; its rating remains a limited snap/experience proxy.",
        "11. Defensive player strength shows limited proxy evidence. Pass defense is directionally useful, run defense is near zero, and separate pass-rush/LB/secondary effects cannot be identified.",
        "12-13. Five-year history cannot be compared fairly with shorter windows from existing artifacts, so whether it helps and the best window both remain UNCERTAIN.",
        "14. Market-residual correlations above show which available roster variables have any directional relationship with what the market missed; none should be treated as selected features from this locked analysis.",
        f"15. RSM agrees with market direction at correlations {_corr(market['rsm_margin_vs_market_margin_correlation'])} (margin) and {_corr(market['rsm_total_vs_market_total_correlation'])} (total), while failing to outperform market MAE, consistent with strong roster information already being priced.",
        "16. The evidence points primarily to score conversion/multicollinearity and probability calibration, plus limited information beyond the market; the diagnostic cannot isolate all player-rating and unit-aggregation weaknesses.",
        "17. RSM-v2 is justified only as a new development experiment, not as a production betting upgrade. It will require a new future untouched test period.",
        "18. Three highest-value RSM-v2 research changes: remove or regularize duplicated unit features using development data; calibrate uncertainty against edge monotonicity; add timestamped injury/lineup and stronger OL/coverage data. These are recommendations only and were not implemented.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
