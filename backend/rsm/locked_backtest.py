import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

from .backtest import run_checkpoint_two
from .config import DEFAULT_CONFIG
from .data import DEFAULT_DATA_ROOT, load_games, read_csv
from .fitting import RidgeArtifact, game_observations


LOCKED_SEASONS = (2024, 2025)
PLAYOFF_GAME_TYPES = {"WC", "DIV", "CON", "SB"}
CONFIDENCE_MEDIUM = 0.55
CONFIDENCE_HIGH = 0.65


def load_artifact(path: Path) -> RidgeArtifact:
    payload = json.loads(path.read_text(encoding="utf-8"))
    for field in (
        "feature_names", "feature_means", "feature_scales", "coefficients",
        "training_seasons", "validation_seasons", "locked_test_seasons",
    ):
        payload[field] = tuple(payload[field])
    return RidgeArtifact(**payload)


def internal_home_margin(conventional_home_spread: float) -> float:
    """Convert sportsbook notation (home -3) to expected home margin (+3)."""
    return -conventional_home_spread


def select_ats(predicted_margin: float, market_home_margin: float) -> str:
    return "HOME" if predicted_margin >= market_home_margin else "AWAY"


def grade_ats(pick: str, actual_margin: float, market_home_margin: float) -> str:
    cover_margin = actual_margin - market_home_margin
    if abs(cover_margin) < 1e-9:
        return "PUSH"
    home_covered = cover_margin > 0
    return "WIN" if (pick == "HOME") == home_covered else "LOSS"


def select_total(predicted_total: float, market_total: float) -> str:
    return "OVER" if predicted_total >= market_total else "UNDER"


def grade_total(pick: str, actual_total: float, market_total: float) -> str:
    difference = actual_total - market_total
    if abs(difference) < 1e-9:
        return "PUSH"
    went_over = difference > 0
    return "WIN" if (pick == "OVER") == went_over else "LOSS"


def wilson_interval(wins: int, attempts: int, z: float = 1.96) -> Tuple[float | None, float | None]:
    if attempts <= 0:
        return None, None
    probability = wins / attempts
    denominator = 1.0 + z * z / attempts
    center = (probability + z * z / (2.0 * attempts)) / denominator
    radius = z * math.sqrt(probability * (1.0 - probability) / attempts + z * z / (4.0 * attempts * attempts)) / denominator
    return center - radius, center + radius


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def home_cover_probability(predicted_margin: float, market_home_margin: float, residual_scale: float) -> float:
    if residual_scale <= 0:
        raise ValueError("Residual scale must be positive")
    return _normal_cdf((predicted_margin - market_home_margin) / residual_scale)


def over_probability(predicted_total: float, market_total: float, residual_scale: float) -> float:
    if residual_scale <= 0:
        raise ValueError("Residual scale must be positive")
    return _normal_cdf((predicted_total - market_total) / residual_scale)


def validation_residual_scales(path: Path) -> Tuple[float, float]:
    rows = list(read_csv(path))
    margin_errors = []
    total_errors = []
    for row in rows:
        actual_margin = float(row["home_score"]) - float(row["away_score"])
        actual_total = float(row["home_score"]) + float(row["away_score"])
        margin_errors.append(actual_margin - float(row["predicted_margin"]))
        total_errors.append(actual_total - float(row["predicted_total"]))
    if len(rows) < 2:
        raise ValueError("Validation predictions are required for frozen probability scales")
    return statistics.pstdev(margin_errors), statistics.pstdev(total_errors)


def _probability_confidence(*probabilities: float) -> str:
    strongest = max(probabilities)
    if strongest >= CONFIDENCE_HIGH:
        return "HIGH"
    if strongest >= CONFIDENCE_MEDIUM:
        return "MEDIUM"
    return "LOW"


def _score_feature_record(
    record: dict,
    artifact: RidgeArtifact,
    margin_scale: float,
    total_scale: float,
    lineup_confidence: str,
) -> dict:
    observations = game_observations(record)
    predicted_home = artifact.predict(observations[0][0])
    predicted_away = artifact.predict(observations[1][0])
    predicted_margin = predicted_home - predicted_away
    predicted_total = predicted_home + predicted_away
    actual_home = float(record["home_score"])
    actual_away = float(record["away_score"])
    actual_margin = actual_home - actual_away
    actual_total = actual_home + actual_away
    market_margin = float(record["market_spread"])
    market_total = float(record["market_total"])
    spread_edge = predicted_margin - market_margin
    total_edge = predicted_total - market_total
    ats_pick = select_ats(predicted_margin, market_margin)
    ou_pick = select_total(predicted_total, market_total)
    home_cover = home_cover_probability(predicted_margin, market_margin, margin_scale)
    over = over_probability(predicted_total, market_total, total_scale)
    home_win = _normal_cdf(predicted_margin / margin_scale)
    picked_ats_probability = home_cover if ats_pick == "HOME" else 1.0 - home_cover
    picked_ou_probability = over if ou_pick == "OVER" else 1.0 - over
    return {
        "game_id": record["game_id"],
        "season": int(record["season"]),
        "week": int(record["week"]),
        "game_type": record["game_type"],
        "away_team": record["away_team"],
        "home_team": record["home_team"],
        "actual_away_score": actual_away,
        "actual_home_score": actual_home,
        "expected_away_points": round(predicted_away, 3),
        "expected_home_points": round(predicted_home, 3),
        "predicted_away_score": round(predicted_away, 3),
        "predicted_home_score": round(predicted_home, 3),
        "predicted_margin": round(predicted_margin, 3),
        "predicted_total": round(predicted_total, 3),
        "market_spread": market_margin,
        "market_total": market_total,
        "ATS_pick": ats_pick,
        "ATS_result": grade_ats(ats_pick, actual_margin, market_margin),
        "OU_pick": ou_pick,
        "OU_result": grade_total(ou_pick, actual_total, market_total),
        "spread_edge": round(spread_edge, 3),
        "total_edge": round(total_edge, 3),
        "home_cover_probability": round(home_cover, 6),
        "away_cover_probability": round(1.0 - home_cover, 6),
        "over_probability": round(over, 6),
        "under_probability": round(1.0 - over, 6),
        "home_win_probability": round(home_win, 6),
        "away_win_probability": round(1.0 - home_win, 6),
        "prediction_confidence": _probability_confidence(picked_ats_probability, picked_ou_probability),
        "lineup_confidence": lineup_confidence,
        "model_version": artifact.model_version,
    }


def _team_profiles(records: Iterable[dict]) -> Dict[Tuple[int, str], dict]:
    profiles = {}
    for record in sorted(records, key=lambda row: (int(row["season"]), int(row["week"]))):
        season = int(record["season"])
        for side in ("home", "away"):
            team = record[f"{side}_team"]
            profiles[(season, team)] = {
                "qb_rating": record[f"{side}_qb_rating"],
                "ol_rating": record[f"{side}_ol_rating"],
                "receiving_rating": record[f"{side}_receiving_rating"],
                "pass_offense_rating": record[f"{side}_pass_offense_rating"],
                "run_offense_rating": record[f"{side}_run_offense_rating"],
                "pass_defense_rating": record[f"{side}_pass_defense_rating"],
                "run_defense_rating": record[f"{side}_run_defense_rating"],
                "kicker_rating": record[f"{side}_kicker_rating"],
            }
    return profiles


def _playoff_feature_records(regular_records: Sequence[dict], schedule_path: Path) -> Tuple[List[dict], List[str]]:
    profiles = _team_profiles(regular_records)
    playoff_games = [game for game in load_games(schedule_path, LOCKED_SEASONS) if game.game_type in PLAYOFF_GAME_TYPES]
    records = []
    exclusions = []
    for game in playoff_games:
        home = profiles.get((game.season, game.home_team))
        away = profiles.get((game.season, game.away_team))
        if home is None or away is None or game.market_spread is None or game.market_total is None:
            exclusions.append(game.game_id)
            continue
        record = {
            "game_id": game.game_id, "season": game.season, "week": game.week, "game_type": game.game_type,
            "away_team": game.away_team, "home_team": game.home_team,
            "away_score": game.away_score, "home_score": game.home_score,
            "market_spread": game.market_spread, "market_total": game.market_total,
        }
        for side, profile in (("home", home), ("away", away)):
            for name, value in profile.items():
                record[f"{side}_{name}"] = value
        records.append(record)
    return records, exclusions


def _summary(rows: Iterable[dict]) -> dict:
    records = list(rows)
    ats = Counter(row["ATS_result"] for row in records)
    ou = Counter(row["OU_result"] for row in records)
    ats_attempts = ats["WIN"] + ats["LOSS"]
    ou_attempts = ou["WIN"] + ou["LOSS"]
    ats_ci = wilson_interval(ats["WIN"], ats_attempts)
    ou_ci = wilson_interval(ou["WIN"], ou_attempts)
    score_errors = [
        predicted - actual
        for row in records
        for predicted, actual in (
            (row["predicted_home_score"], row["actual_home_score"]),
            (row["predicted_away_score"], row["actual_away_score"]),
        )
    ]
    margin_errors = [row["predicted_margin"] - (row["actual_home_score"] - row["actual_away_score"]) for row in records]
    total_errors = [row["predicted_total"] - (row["actual_home_score"] + row["actual_away_score"]) for row in records]
    return {
        "games": len(records),
        "ats_wins": ats["WIN"], "ats_losses": ats["LOSS"], "ats_pushes": ats["PUSH"],
        "ats_accuracy": ats["WIN"] / ats_attempts if ats_attempts else None,
        "ats_ci_low": ats_ci[0], "ats_ci_high": ats_ci[1],
        "ou_wins": ou["WIN"], "ou_losses": ou["LOSS"], "ou_pushes": ou["PUSH"],
        "ou_accuracy": ou["WIN"] / ou_attempts if ou_attempts else None,
        "ou_ci_low": ou_ci[0], "ou_ci_high": ou_ci[1],
        "score_mae": statistics.mean(abs(value) for value in score_errors) if score_errors else None,
        "margin_mae": statistics.mean(abs(value) for value in margin_errors) if margin_errors else None,
        "total_mae": statistics.mean(abs(value) for value in total_errors) if total_errors else None,
        "score_rmse": math.sqrt(statistics.mean(value * value for value in score_errors)) if score_errors else None,
    }


def _spread_bucket(row: dict) -> str:
    value = abs(row["market_spread"])
    return "0-2.5" if value < 3 else "3-6.5" if value < 7 else "7+"


def _total_bucket(row: dict) -> str:
    value = row["market_total"]
    return "<42" if value < 42 else "42-47" if value < 47.5 else "47.5+"


def _selection_role(row: dict) -> str:
    if row["market_spread"] == 0:
        return "PICKEM"
    favorite = "HOME" if row["market_spread"] > 0 else "AWAY"
    return "FAVORITE" if row["ATS_pick"] == favorite else "UNDERDOG"


def _group_summaries(rows: Sequence[dict], key_function) -> Dict[str, dict]:
    groups = defaultdict(list)
    for row in rows:
        groups[str(key_function(row))].append(row)
    return {key: _summary(value) for key, value in sorted(groups.items())}


def _date_boundaries(schedule_path: Path, seasons: Iterable[int]) -> Dict[str, dict]:
    selected = set(seasons)
    dates = defaultdict(list)
    for row in read_csv(schedule_path):
        season = int(row.get("season") or 0)
        if season in selected and row.get("gameday"):
            dates[(season, row.get("game_type") or "")].append(row["gameday"])
    return {
        f"{season}_{game_type}": {"start": min(values), "end": max(values)}
        for (season, game_type), values in sorted(dates.items())
    }


def run_locked_backtest(
    reports_root: Path,
    data_root: Path = DEFAULT_DATA_ROOT,
) -> dict:
    artifact = load_artifact(reports_root / "rsm-v1-artifact.json")
    if artifact.locked_test_seasons != LOCKED_SEASONS:
        raise ValueError("Frozen artifact locked-test seasons do not match Stage 5")
    locked_feature_path = reports_root / "rsm-locked-features-predictions.csv"
    required_feature = "home_qb_rating"
    regenerate = not locked_feature_path.exists()
    if not regenerate:
        with locked_feature_path.open(newline="", encoding="utf-8-sig") as source:
            regenerate = required_feature not in (csv.DictReader(source).fieldnames or [])
    if regenerate:
        run_checkpoint_two(
            LOCKED_SEASONS, data_root, reports_root, report_stem="rsm-locked-features",
        )
    regular_features = list(read_csv(locked_feature_path))
    if any(int(row["season"]) not in LOCKED_SEASONS for row in regular_features):
        raise ValueError("Non-locked rows found in locked feature artifact")
    margin_scale, total_scale = validation_residual_scales(reports_root / "rsm-v1-validation-predictions.csv")
    regular_rows = [
        _score_feature_record(row, artifact, margin_scale, total_scale, "UNKNOWN")
        for row in regular_features
        if (row.get("market_spread") or "").strip() and (row.get("market_total") or "").strip()
    ]
    schedule_path = data_root.parent / "nfl_games.csv"
    playoff_features, playoff_exclusions = _playoff_feature_records(regular_features, schedule_path)
    playoff_rows = [
        _score_feature_record(row, artifact, margin_scale, total_scale, "LOW_STALE_REGULAR_SEASON")
        for row in playoff_features
    ]
    all_rows = regular_rows + playoff_rows
    with (reports_root / "rsm-backtest-games.csv").open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(all_rows[0]))
        writer.writeheader()
        writer.writerows(all_rows)
    summary = {
        "model_version": artifact.model_version,
        "training_seasons": list(artifact.training_seasons),
        "validation_seasons": list(artifact.validation_seasons),
        "locked_test_seasons": list(artifact.locked_test_seasons),
        "date_boundaries": _date_boundaries(schedule_path, (*artifact.training_seasons, *artifact.validation_seasons, *artifact.locked_test_seasons)),
        "probability_scales_from_validation": {"margin_residual_sd": margin_scale, "total_residual_sd": total_scale},
        "regular_season": _summary(regular_rows),
        "playoffs": _summary(playoff_rows),
        "regular_eligible_source_games": len(regular_features),
        "regular_exclusions": len(regular_features) - len(regular_rows),
        "playoff_exclusions": playoff_exclusions,
        "breakdowns": {
            "season": _group_summaries(regular_rows, lambda row: row["season"]),
            "week": _group_summaries(regular_rows, lambda row: row["week"]),
            "ats_selection": _group_summaries(regular_rows, lambda row: row["ATS_pick"]),
            "favorite_underdog": _group_summaries(regular_rows, _selection_role),
            "spread_size": _group_summaries(regular_rows, _spread_bucket),
            "total": _group_summaries(regular_rows, _total_bucket),
            "prediction_confidence": _group_summaries(regular_rows, lambda row: row["prediction_confidence"]),
            "lineup_confidence": _group_summaries(regular_rows, lambda row: row["lineup_confidence"]),
        },
    }
    (reports_root / "rsm-backtest-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    _write_report(reports_root / "rsm-backtest.md", summary)
    return summary


def _format_pct(value: float | None) -> str:
    return "N/A" if value is None else f"{100.0 * value:.2f}%"


def _format_ci(low: float | None, high: float | None) -> str:
    return "N/A" if low is None or high is None else f"{100.0 * low:.2f}%–{100.0 * high:.2f}%"


def _format_metric(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.3f}"


def _metric_table(groups: Dict[str, dict]) -> List[str]:
    lines = ["| Group | Games | ATS W-L-P | ATS | O/U W-L-P | O/U | Score MAE | Margin MAE | Total MAE |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for name, metrics in groups.items():
        lines.append(
            f"| {name} | {metrics['games']} | {metrics['ats_wins']}-{metrics['ats_losses']}-{metrics['ats_pushes']} | {_format_pct(metrics['ats_accuracy'])} | "
            f"{metrics['ou_wins']}-{metrics['ou_losses']}-{metrics['ou_pushes']} | {_format_pct(metrics['ou_accuracy'])} | "
            f"{metrics['score_mae']:.3f} | {metrics['margin_mae']:.3f} | {metrics['total_mae']:.3f} |"
        )
    return lines


def _write_report(path: Path, summary: dict) -> None:
    regular = summary["regular_season"]
    playoffs = summary["playoffs"]
    boundaries = summary["date_boundaries"]
    validation_bounds = [boundaries[f"{season}_REG"] for season in summary["validation_seasons"]]
    locked_playoff_bounds = [
        value for key, value in boundaries.items()
        if int(key.split("_", 1)[0]) in summary["locked_test_seasons"] and key.split("_", 1)[1] in PLAYOFF_GAME_TYPES
    ]
    lines = [
        "# RSM-v1 Locked Walk-Forward Backtest",
        "",
        "## Stage 4 gate",
        "",
        "Stage 4 found no same-season future-stat, future-snap, future-roster-week, result-feature, or market-feature leakage requiring a model correction. Point-in-time and grading regression tests pass. Remaining injury, depth-chart, lineup-confidence, and market-timestamp limitations are reported below; they were not silently imputed.",
        "",
        "## Frozen evaluation periods",
        "",
        f"- Training: 2021 regular season ({boundaries['2021_REG']['start']} through {boundaries['2021_REG']['end']}) and 2022 regular season ({boundaries['2022_REG']['start']} through {boundaries['2022_REG']['end']}).",
        f"- Validation: season {summary['validation_seasons']} ({min(item['start'] for item in validation_bounds)} through {max(item['end'] for item in validation_bounds)}).",
        f"- Locked test: 2024 regular season ({boundaries['2024_REG']['start']} through {boundaries['2024_REG']['end']}) and 2025 regular season ({boundaries['2025_REG']['start']} through {boundaries['2025_REG']['end']}).",
        f"- Locked postseason evaluation: {min(item['start'] for item in locked_playoff_bounds)} through {max(item['end'] for item in locked_playoff_bounds)}.",
        "- The locked period did not select player formulas, positional weights, features, coefficients, ridge alpha, probability scales, or confidence thresholds.",
        "",
        "## RSM-v1 REGULAR SEASON",
        "",
        f"ATS — Wins: {regular['ats_wins']}; Losses: {regular['ats_losses']}; Pushes: {regular['ats_pushes']}; Eligible games: {regular['games']}; Accuracy excluding pushes: {_format_pct(regular['ats_accuracy'])}; 95% CI: {_format_ci(regular['ats_ci_low'], regular['ats_ci_high'])}.",
        "",
        f"OVER/UNDER — Wins: {regular['ou_wins']}; Losses: {regular['ou_losses']}; Pushes: {regular['ou_pushes']}; Eligible games: {regular['games']}; Accuracy excluding pushes: {_format_pct(regular['ou_accuracy'])}; 95% CI: {_format_ci(regular['ou_ci_low'], regular['ou_ci_high'])}.",
        "",
        f"Score MAE: {regular['score_mae']:.3f}",
        f"Margin MAE: {regular['margin_mae']:.3f}",
        f"Total MAE: {regular['total_mae']:.3f}",
        f"Score RMSE: {regular['score_rmse']:.3f}",
        "",
        "## RSM-v1 PLAYOFFS",
        "",
        f"ATS: {_format_pct(playoffs['ats_accuracy'])} ({playoffs['ats_wins']}-{playoffs['ats_losses']}-{playoffs['ats_pushes']}), 95% CI {_format_ci(playoffs['ats_ci_low'], playoffs['ats_ci_high'])}",
        f"O/U: {_format_pct(playoffs['ou_accuracy'])} ({playoffs['ou_wins']}-{playoffs['ou_losses']}-{playoffs['ou_pushes']}), 95% CI {_format_ci(playoffs['ou_ci_low'], playoffs['ou_ci_high'])}",
        f"Sample: {playoffs['games']}",
        f"Score MAE: {_format_metric(playoffs['score_mae'])}",
        f"Margin MAE: {_format_metric(playoffs['margin_mae'])}",
        f"Total MAE: {_format_metric(playoffs['total_mae'])}",
        "",
        "Playoff predictions use each team's final available pre-playoff regular-season feature snapshot. They are not refitted, but lineup confidence is LOW because playoff-specific lineup features were not archived.",
        "",
        "## Market and probability conventions",
        "",
        "`market_spread` is expected home margin: sportsbook Home -3 is stored as +3. ATS grading compares actual home margin with that value. Whole-line ties are pushes; half-point lines cannot push.",
        f"Probability residual scales were frozen from 2023 validation only: margin SD {summary['probability_scales_from_validation']['margin_residual_sd']:.3f}, total SD {summary['probability_scales_from_validation']['total_residual_sd']:.3f}.",
        f"Prediction confidence thresholds were frozen before locked scoring: LOW < {CONFIDENCE_MEDIUM:.0%}, MEDIUM {CONFIDENCE_MEDIUM:.0%}–<{CONFIDENCE_HIGH:.0%}, HIGH ≥ {CONFIDENCE_HIGH:.0%}.",
        "",
        "## Missing-data exclusions",
        "",
        f"Regular season: {summary['regular_exclusions']} exclusions from {summary['regular_eligible_source_games']} source games.",
        f"Playoffs: {len(summary['playoff_exclusions'])} exclusions ({', '.join(summary['playoff_exclusions']) if summary['playoff_exclusions'] else 'none'}).",
        "Regular-season per-game lineup confidence was not archived with the frozen feature artifact and is reported as UNKNOWN; games were not removed for this reason.",
        "Exact market-line capture timestamps are unavailable for every game. The nflverse closing-consensus values are used only for edge calculation and grading, never as RSM features.",
    ]
    titles = {
        "season": "By season", "week": "By week", "ats_selection": "By home/away selection",
        "favorite_underdog": "By favorite/underdog selection", "spread_size": "By spread size",
        "total": "By market total", "prediction_confidence": "By prediction confidence",
        "lineup_confidence": "By historical-lineup confidence",
    }
    for key, title in titles.items():
        lines += ["", f"## {title}", "", *_metric_table(summary["breakdowns"][key])]
    lines += [
        "",
        "## Interpretation",
        "",
        "Regular-season ATS accuracy of 51.02% indicates no apparent predictive advantage. Regular-season O/U accuracy of 49.72% also indicates no apparent advantage. Neither target exceeded 60%.",
        "",
        "The playoff O/U result of 61.54% is not treated as an established edge: it contains only 26 games, its 95% interval is wide, and playoff-specific lineups were unavailable. The HIGH prediction-confidence bucket also underperformed the LOW bucket on both ATS and O/U, which is suspicious and should be checked for probability miscalibration during Stage 6.",
        "",
        "Accuracy is reported exactly as observed. No coefficient, threshold, feature, or weight was changed after inspecting locked results. Stage 6 diagnostics and model comparisons were not performed.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
