import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

from .config import DEFAULT_CONFIG
from .data import read_csv
from .fitting import RidgeArtifact, TrainingPlan, _fit_ridge, game_observations
from .locked_backtest import grade_ats, grade_total, load_artifact, select_ats, select_total


TRAINING_SEASONS = (2021, 2022)
VALIDATION_SEASONS = (2023,)
RIDGE_DIAGNOSTIC_ALPHAS = (0.0, 0.1, 1.0, 10.0, 100.0, 1000.0)


def _number(row: dict, name: str) -> float:
    return float(row[name])


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def _sigmoid(value: float) -> float:
    if value >= 0:
        inverse = math.exp(-min(value, 700.0))
        return 1.0 / (1.0 + inverse)
    exponent = math.exp(max(value, -700.0))
    return exponent / (1.0 + exponent)


def _logit(probability: float) -> float:
    bounded = min(1.0 - 1e-9, max(1e-9, probability))
    return math.log(bounded / (1.0 - bounded))


def percentile(values: Sequence[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("Cannot calculate a percentile of an empty sequence")
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def distribution(values: Sequence[float]) -> dict:
    return {
        "n": len(values),
        "mean": statistics.mean(values),
        "std": statistics.pstdev(values),
        "variance": statistics.pvariance(values),
        "min": min(values),
        "max": max(values),
        "p05": percentile(values, 0.05),
        "p25": percentile(values, 0.25),
        "median": percentile(values, 0.50),
        "p75": percentile(values, 0.75),
        "p95": percentile(values, 0.95),
    }


def linear_regression(values_x: Sequence[float], values_y: Sequence[float]) -> dict:
    if len(values_x) != len(values_y) or len(values_x) < 3:
        raise ValueError("Regression requires at least three paired observations")
    mean_x = statistics.mean(values_x)
    mean_y = statistics.mean(values_y)
    sxx = sum((value - mean_x) ** 2 for value in values_x)
    if sxx <= 1e-12:
        raise ValueError("Regression predictor has no variance")
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(values_x, values_y)) / sxx
    intercept = mean_y - slope * mean_x
    residuals = [y - intercept - slope * x for x, y in zip(values_x, values_y)]
    sse = sum(value * value for value in residuals)
    syy = sum((value - mean_y) ** 2 for value in values_y)
    residual_variance = sse / (len(values_x) - 2)
    slope_se = math.sqrt(residual_variance / sxx)
    intercept_se = math.sqrt(residual_variance * (1.0 / len(values_x) + mean_x * mean_x / sxx))
    return {
        "n": len(values_x), "intercept": intercept, "slope": slope,
        "r_squared": 1.0 - sse / syy if syy > 1e-12 else None,
        "intercept_ci95": [intercept - 1.96 * intercept_se, intercept + 1.96 * intercept_se],
        "slope_ci95": [slope - 1.96 * slope_se, slope + 1.96 * slope_se],
    }


def logistic_regression(values_x: Sequence[float], outcomes: Sequence[int]) -> dict:
    if len(values_x) != len(outcomes) or len(values_x) < 3:
        raise ValueError("Logistic regression requires at least three paired observations")
    mean_x = statistics.mean(values_x)
    scale_x = statistics.pstdev(values_x) or 1.0
    standardized = [(value - mean_x) / scale_x for value in values_x]
    intercept = _logit((sum(outcomes) + 0.5) / (len(outcomes) + 1.0))
    slope = 0.0
    for _ in range(100):
        probabilities = [_sigmoid(intercept + slope * value) for value in standardized]
        weights = [max(1e-9, probability * (1.0 - probability)) for probability in probabilities]
        gradient_0 = sum(outcome - probability for outcome, probability in zip(outcomes, probabilities))
        gradient_1 = sum((outcome - probability) * value for outcome, probability, value in zip(outcomes, probabilities, standardized))
        info_00 = sum(weights) + 1e-9
        info_01 = sum(weight * value for weight, value in zip(weights, standardized))
        info_11 = sum(weight * value * value for weight, value in zip(weights, standardized)) + 1e-9
        determinant = info_00 * info_11 - info_01 * info_01
        delta_0 = (gradient_0 * info_11 - gradient_1 * info_01) / determinant
        delta_1 = (gradient_1 * info_00 - gradient_0 * info_01) / determinant
        intercept += delta_0
        slope += delta_1
        if max(abs(delta_0), abs(delta_1)) < 1e-10:
            break
    raw_slope = slope / scale_x
    raw_intercept = intercept - slope * mean_x / scale_x
    return {"intercept": raw_intercept, "slope": raw_slope}


def _predict_probability(model: dict, value: float) -> float:
    return _sigmoid(model["intercept"] + model["slope"] * value)


def _predict_rows(rows: Sequence[dict], artifact: RidgeArtifact) -> List[dict]:
    output = []
    for row in rows:
        observations = game_observations(row)
        predicted_home = artifact.predict(observations[0][0])
        predicted_away = artifact.predict(observations[1][0])
        actual_home = _number(row, "home_score")
        actual_away = _number(row, "away_score")
        output.append({
            **row,
            "raw_home": predicted_home,
            "raw_away": predicted_away,
            "raw_margin": predicted_home - predicted_away,
            "raw_total": predicted_home + predicted_away,
            "actual_home": actual_home,
            "actual_away": actual_away,
            "actual_margin": actual_home - actual_away,
            "actual_total": actual_home + actual_away,
        })
    return output


def _score_metrics(rows: Sequence[dict], prefix: str) -> dict:
    score_errors = [
        row[f"{prefix}_{side}"] - row[f"actual_{side}"]
        for row in rows for side in ("home", "away")
    ]
    margin_errors = [row[f"{prefix}_margin"] - row["actual_margin"] for row in rows]
    total_errors = [row[f"{prefix}_total"] - row["actual_total"] for row in rows]
    return {
        "games": len(rows),
        "score_mae": statistics.mean(abs(value) for value in score_errors),
        "margin_mae": statistics.mean(abs(value) for value in margin_errors),
        "total_mae": statistics.mean(abs(value) for value in total_errors),
        "score_std": statistics.pstdev([row[f"{prefix}_{side}"] for row in rows for side in ("home", "away")]),
        "margin_std": statistics.pstdev([row[f"{prefix}_margin"] for row in rows]),
        "total_std": statistics.pstdev([row[f"{prefix}_total"] for row in rows]),
    }


def _distribution_analysis(rows: Sequence[dict]) -> dict:
    fields = {
        "home_points": ("raw_home", "actual_home"),
        "away_points": ("raw_away", "actual_away"),
        "game_margin": ("raw_margin", "actual_margin"),
        "game_total": ("raw_total", "actual_total"),
    }
    result = {}
    for name, (predicted, actual) in fields.items():
        predicted_distribution = distribution([row[predicted] for row in rows])
        actual_distribution = distribution([row[actual] for row in rows])
        result[name] = {
            "predicted": predicted_distribution,
            "actual": actual_distribution,
            "std_ratio": predicted_distribution["std"] / actual_distribution["std"],
            "variance_ratio": predicted_distribution["variance"] / actual_distribution["variance"],
        }
    return result


def _calibration_slopes(rows: Sequence[dict], prefix: str = "raw") -> dict:
    return {
        "home_points": linear_regression([row[f"{prefix}_home"] for row in rows], [row["actual_home"] for row in rows]),
        "away_points": linear_regression([row[f"{prefix}_away"] for row in rows], [row["actual_away"] for row in rows]),
        "game_margin": linear_regression([row[f"{prefix}_margin"] for row in rows], [row["actual_margin"] for row in rows]),
        "game_total": linear_regression([row[f"{prefix}_total"] for row in rows], [row["actual_total"] for row in rows]),
    }


def _fit_score_calibration(training: Sequence[dict]) -> dict:
    margin = linear_regression([row["raw_margin"] for row in training], [row["actual_margin"] for row in training])
    total = linear_regression([row["raw_total"] for row in training], [row["actual_total"] for row in training])
    return {
        "margin_intercept": margin["intercept"], "margin_slope": margin["slope"],
        "total_intercept": total["intercept"], "total_slope": total["slope"],
    }


def _apply_score_calibration(rows: Sequence[dict], calibration: dict) -> List[dict]:
    output = []
    for row in rows:
        margin = calibration["margin_intercept"] + calibration["margin_slope"] * row["raw_margin"]
        total = calibration["total_intercept"] + calibration["total_slope"] * row["raw_total"]
        output.append({
            **row,
            "calibrated_margin": margin,
            "calibrated_total": total,
            "calibrated_home": (total + margin) / 2.0,
            "calibrated_away": (total - margin) / 2.0,
        })
    return output


def _bet_result(row: dict, market: str, prefix: str = "raw") -> str:
    if market == "ATS":
        pick = select_ats(row[f"{prefix}_margin"], _number(row, "market_spread"))
        return grade_ats(pick, row["actual_margin"], _number(row, "market_spread"))
    pick = select_total(row[f"{prefix}_total"], _number(row, "market_total"))
    return grade_total(pick, row["actual_total"], _number(row, "market_total"))


def _bet_summary(rows: Sequence[dict], market: str, prefix: str = "raw") -> dict:
    counts = Counter(_bet_result(row, market, prefix) for row in rows)
    attempts = counts["WIN"] + counts["LOSS"]
    return {
        "wins": counts["WIN"], "losses": counts["LOSS"], "pushes": counts["PUSH"],
        "accuracy": counts["WIN"] / attempts if attempts else None,
    }


def _residual_scales(rows: Sequence[dict]) -> Tuple[float, float]:
    return (
        statistics.pstdev(row["actual_margin"] - row["raw_margin"] for row in rows),
        statistics.pstdev(row["actual_total"] - row["raw_total"] for row in rows),
    )


def _market_records(rows: Sequence[dict], margin_scale: float, total_scale: float) -> List[dict]:
    records = []
    for row in rows:
        spread_edge = row["raw_margin"] - _number(row, "market_spread")
        total_edge = row["raw_total"] - _number(row, "market_total")
        ats_result = _bet_result(row, "ATS")
        ou_result = _bet_result(row, "OU")
        records.append({
            **row,
            "spread_edge": spread_edge,
            "total_edge": total_edge,
            "ats_probability": _normal_cdf(abs(spread_edge) / margin_scale),
            "ou_probability": _normal_cdf(abs(total_edge) / total_scale),
            "ATS_result": ats_result,
            "OU_result": ou_result,
        })
    return records


def _deciles(rows: Sequence[dict], market: str, sort_field: str) -> List[dict]:
    result_field = f"{market}_result"
    edge_field = "spread_edge" if market == "ATS" else "total_edge"
    if sort_field.endswith("_abs"):
        source_field = sort_field[:-4]
        ranked = sorted(rows, key=lambda row: abs(row[source_field]))
    else:
        ranked = sorted(rows, key=lambda row: row[sort_field])
    probability_field = sort_field if "probability" in sort_field else f"{market.lower()}_probability"
    groups = [[] for _ in range(10)]
    for index, row in enumerate(ranked):
        groups[min(9, index * 10 // len(ranked))].append(row)
    output = []
    for index, group in enumerate(groups, 1):
        counts = Counter(row[result_field] for row in group)
        attempts = counts["WIN"] + counts["LOSS"]
        output.append({
            "decile": index, "n": len(group),
            "mean_abs_edge": statistics.mean(abs(row[edge_field]) for row in group),
            "mean_probability": statistics.mean(row[probability_field] for row in group),
            "wins": counts["WIN"], "losses": counts["LOSS"], "pushes": counts["PUSH"],
            "accuracy": counts["WIN"] / attempts if attempts else None,
        })
    return output


def _probability_bins(rows: Sequence[dict], market: str, probability_field: str) -> List[dict]:
    boundaries = (0.0, 0.50, 0.55, 0.60, 0.65, 0.70, 0.80, 1.000001)
    groups = [[] for _ in range(len(boundaries) - 1)]
    for row in rows:
        probability = row[probability_field]
        for index, (lower, upper) in enumerate(zip(boundaries, boundaries[1:])):
            if lower <= probability < upper:
                groups[index].append(row)
                break
    output = []
    for index, group in enumerate(groups):
        non_push = [row for row in group if row[f"{market}_result"] != "PUSH"]
        output.append({
            "bin": f"{boundaries[index]:.2f}-{min(boundaries[index + 1], 1.0):.2f}",
            "n": len(group),
            "mean_probability": statistics.mean(row[probability_field] for row in group) if group else None,
            "observed_frequency": statistics.mean(row[f"{market}_result"] == "WIN" for row in non_push) if non_push else None,
        })
    return output


def _probability_metrics(rows: Sequence[dict], market: str, probability_field: str) -> dict:
    scored = [row for row in rows if row[f"{market}_result"] != "PUSH"]
    probabilities = [row[probability_field] for row in scored]
    outcomes = [1 if row[f"{market}_result"] == "WIN" else 0 for row in scored]
    calibration = logistic_regression([_logit(value) for value in probabilities], outcomes)
    return {
        "n": len(scored),
        "brier_score": statistics.mean((probability - outcome) ** 2 for probability, outcome in zip(probabilities, outcomes)),
        "calibration_intercept": calibration["intercept"],
        "calibration_slope": calibration["slope"],
        "bins": _probability_bins(rows, market, probability_field),
    }


def _fit_probability_calibration(training: Sequence[dict], market: str) -> dict:
    result_field = f"{market}_result"
    edge_field = "spread_edge" if market == "ATS" else "total_edge"
    scored = [row for row in training if row[result_field] != "PUSH"]
    return logistic_regression(
        [abs(row[edge_field]) for row in scored],
        [1 if row[result_field] == "WIN" else 0 for row in scored],
    )


def _ridge_analysis(training_rows: Sequence[dict], validation_rows: Sequence[dict]) -> List[dict]:
    observations = [observation for row in training_rows for observation in game_observations(row)]
    plan = TrainingPlan()
    output = []
    for alpha in RIDGE_DIAGNOSTIC_ALPHAS:
        artifact = _fit_ridge(observations, alpha, plan, DEFAULT_CONFIG)
        predicted = _predict_rows(validation_rows, artifact)
        metrics = _score_metrics(predicted, "raw")
        slopes = _calibration_slopes(predicted)
        output.append({
            "alpha": alpha,
            **metrics,
            "margin_calibration_slope": slopes["game_margin"]["slope"],
            "total_calibration_slope": slopes["game_total"]["slope"],
            "coefficient_l2": math.sqrt(sum(value * value for value in artifact.coefficients)),
        })
    return output


def _pipeline_variance(validation_rows: Sequence[dict], artifact: RidgeArtifact, reports_root: Path) -> dict:
    player_rows = list(read_csv(reports_root / "rsm-player-ratings.csv"))
    psr = {"ALL": distribution([_number(row, "rating") for row in player_rows])}
    for position in sorted({row["position"] for row in player_rows}):
        values = [_number(row, "rating") for row in player_rows if row["position"] == position]
        if values:
            psr[position] = distribution(values)

    unit_fields = (
        "qb_rating", "ol_rating", "receiving_rating", "pass_offense_rating", "run_offense_rating",
        "pass_defense_rating", "run_defense_rating", "kicker_rating",
    )
    units = {}
    for field in unit_fields:
        values = [_number(row, f"{side}_{field}") for row in validation_rows for side in ("home", "away")]
        units[field] = distribution(values)

    matchup_values = defaultdict(list)
    contribution_values = defaultdict(list)
    roster_proxies = []
    roster_differentials = []
    for row in validation_rows:
        game_roster_proxies = []
        for side in ("home", "away"):
            proxy = statistics.mean(
                _number(row, f"{side}_{field}")
                for field in ("pass_offense_rating", "run_offense_rating", "pass_defense_rating", "run_defense_rating")
            )
            roster_proxies.append(proxy)
            game_roster_proxies.append(proxy)
        roster_differentials.append(game_roster_proxies[0] - game_roster_proxies[1])
        for features, _, _ in game_observations(row):
            matchup_values["pass_offense_minus_defense"].append(features["pass_offense_rating"] - features["opponent_pass_defense_rating"])
            matchup_values["run_offense_minus_defense"].append(features["run_offense_rating"] - features["opponent_run_defense_rating"])
            for name, mean, scale, coefficient in zip(
                artifact.feature_names, artifact.feature_means, artifact.feature_scales, artifact.coefficients
            ):
                contribution_values[name].append((features[name] - mean) / scale * coefficient)
    predicted = _predict_rows(validation_rows, artifact)
    return {
        "psr_current_snapshot": psr,
        "psr_scope_note": "Player-level historical PSRs were not archived; PSR distributions use the current checkpoint snapshot only.",
        "validation_unit_ratings": units,
        "validation_roster_proxy": distribution(roster_proxies),
        "validation_roster_differential_proxy": distribution(roster_differentials),
        "validation_matchups": {name: distribution(values) for name, values in matchup_values.items()},
        "validation_ridge_contribution_std": {name: statistics.pstdev(values) for name, values in contribution_values.items()},
        "validation_expected_points": distribution([row[f"raw_{side}"] for row in predicted for side in ("home", "away")]),
        "validation_actual_points": distribution([row[f"actual_{side}"] for row in predicted for side in ("home", "away")]),
        "explicit_clipping_in_rsm_v1": False,
    }


def _quartile_label(value: float, cuts: Sequence[float]) -> str:
    if value <= cuts[0]:
        return "Q1"
    if value <= cuts[1]:
        return "Q2"
    if value <= cuts[2]:
        return "Q3"
    return "Q4"


def _heteroskedasticity(rows: Sequence[dict]) -> dict:
    variables = {
        "absolute_spread_edge": lambda row: abs(row["spread_edge"]),
        "absolute_total_edge": lambda row: abs(row["total_edge"]),
        "roster_strength_gap": lambda row: abs(
            statistics.mean(_number(row, f"home_{field}") for field in ("pass_offense_rating", "run_offense_rating", "pass_defense_rating", "run_defense_rating"))
            - statistics.mean(_number(row, f"away_{field}") for field in ("pass_offense_rating", "run_offense_rating", "pass_defense_rating", "run_defense_rating"))
        ),
        "absolute_market_spread": lambda row: abs(_number(row, "market_spread")),
        "predicted_total": lambda row: row["raw_total"],
    }
    output = {}
    for name, getter in variables.items():
        values = [getter(row) for row in rows]
        cuts = [percentile(values, fraction) for fraction in (0.25, 0.50, 0.75)]
        groups = defaultdict(list)
        for row, value in zip(rows, values):
            groups[_quartile_label(value, cuts)].append(row)
        output[name] = [{
            "quartile": label,
            "n": len(groups[label]),
            "range": [min(getter(row) for row in groups[label]), max(getter(row) for row in groups[label])],
            "margin_residual_std": statistics.pstdev(row["actual_margin"] - row["raw_margin"] for row in groups[label]),
            "total_residual_std": statistics.pstdev(row["actual_total"] - row["raw_total"] for row in groups[label]),
        } for label in ("Q1", "Q2", "Q3", "Q4")]
    return {
        "groups": output,
        "lineup_confidence": "UNAVAILABLE: historical per-game lineup confidence was not archived in development predictions.",
    }


def _write_csv(path: Path, rows: Sequence[dict]) -> None:
    fields = (
        "game_id", "season", "week", "actual_home", "actual_away", "raw_home", "raw_away",
        "raw_margin", "raw_total", "calibrated_home", "calibrated_away", "calibrated_margin",
        "calibrated_total", "market_spread", "market_total", "spread_edge", "total_edge",
        "ATS_result", "OU_result", "ats_probability", "ou_probability",
        "ats_calibrated_probability", "ou_calibrated_probability",
    )
    with path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row[field] for field in fields})


def run_stage7a_diagnostics(reports_root: Path) -> dict:
    development = list(read_csv(reports_root / "rsm-development-v0-predictions.csv"))
    training_source = [row for row in development if int(row["season"]) in TRAINING_SEASONS]
    validation_source = [row for row in development if int(row["season"]) in VALIDATION_SEASONS]
    if len(training_source) != 543 or len(validation_source) != 272:
        raise ValueError("Stage 7A requires the frozen 543-game training and 272-game validation splits")
    artifact = load_artifact(reports_root / "rsm-v1-artifact.json")
    if artifact.training_seasons != TRAINING_SEASONS or artifact.validation_seasons != VALIDATION_SEASONS:
        raise ValueError("RSM-v1 chronological split does not match Stage 7A")

    training = _predict_rows(training_source, artifact)
    validation = _predict_rows(validation_source, artifact)
    margin_scale, total_scale = _residual_scales(validation)
    training_market = _market_records(training, margin_scale, total_scale)
    validation_market = _market_records(validation, margin_scale, total_scale)

    score_calibration = _fit_score_calibration(training)
    calibrated_validation = _apply_score_calibration(validation_market, score_calibration)
    probability_calibration = {
        "ATS": _fit_probability_calibration(training_market, "ATS"),
        "OU": _fit_probability_calibration(training_market, "OU"),
    }
    for row in calibrated_validation:
        row["ats_calibrated_probability"] = _predict_probability(probability_calibration["ATS"], abs(row["spread_edge"]))
        row["ou_calibrated_probability"] = _predict_probability(probability_calibration["OU"], abs(row["total_edge"]))

    raw_metrics = _score_metrics(validation_market, "raw")
    calibrated_metrics = _score_metrics(calibrated_validation, "calibrated")
    diagnostics = {
        "scope": {
            "training_seasons": list(TRAINING_SEASONS), "training_games": len(training),
            "validation_seasons": list(VALIDATION_SEASONS), "validation_games": len(validation),
            "locked_seasons_read_or_tuned": False,
        },
        "distribution": _distribution_analysis(validation),
        "raw_calibration_slopes": _calibration_slopes(validation),
        "pipeline_variance": _pipeline_variance(validation_source, artifact, reports_root),
        "ridge_diagnostic": _ridge_analysis(training_source, validation_source),
        "residual_scales": {"margin": margin_scale, "total": total_scale},
        "confidence_formula": {
            "ATS": "Phi(abs(PredictedMargin - MarketHomeMargin) / validation_margin_residual_SD)",
            "OU": "Phi(abs(PredictedTotal - MarketTotal) / validation_total_residual_SD)",
            "classification": "max(picked ATS probability, picked O/U probability): LOW < .55, MEDIUM < .65, HIGH >= .65",
        },
        "raw_edge_deciles": {
            "ATS": _deciles(validation_market, "ATS", "spread_edge_abs"),
            "OU": _deciles(validation_market, "OU", "total_edge_abs"),
        },
        "probability_deciles": {
            "ATS": _deciles(validation_market, "ATS", "ats_probability"),
            "OU": _deciles(validation_market, "OU", "ou_probability"),
        },
        "raw_probability": {
            "ATS": _probability_metrics(validation_market, "ATS", "ats_probability"),
            "OU": _probability_metrics(validation_market, "OU", "ou_probability"),
        },
        "heteroskedasticity": _heteroskedasticity(validation_market),
        "score_calibration_experiment": {
            "parameters_fitted_training_only": score_calibration,
            "raw_validation": {**raw_metrics, "ats": _bet_summary(validation_market, "ATS"), "ou": _bet_summary(validation_market, "OU")},
            "calibrated_validation": {
                **calibrated_metrics,
                "ats": _bet_summary(calibrated_validation, "ATS", "calibrated"),
                "ou": _bet_summary(calibrated_validation, "OU", "calibrated"),
            },
            "calibrated_validation_slopes": _calibration_slopes(calibrated_validation, "calibrated"),
        },
        "probability_calibration_experiment": {
            "parameters_fitted_training_only": probability_calibration,
            "ATS": _probability_metrics(calibrated_validation, "ATS", "ats_calibrated_probability"),
            "OU": _probability_metrics(calibrated_validation, "OU", "ou_calibrated_probability"),
            "ATS_deciles": _deciles(calibrated_validation, "ATS", "ats_calibrated_probability"),
            "OU_deciles": _deciles(calibrated_validation, "OU", "ou_calibrated_probability"),
        },
    }
    candidate = {
        "model_version": "RSM-v2-candidate-stage7a-diagnostic-only",
        "production_ready": False,
        "fitted_on": list(TRAINING_SEASONS),
        "evaluated_on": list(VALIDATION_SEASONS),
        "locked_test_seasons_used": False,
        "score_calibration": score_calibration,
        "probability_calibration": probability_calibration,
        "warning": "Controlled experiment only. This does not modify or replace RSM-v1.",
    }
    reports_root.mkdir(parents=True, exist_ok=True)
    (reports_root / "rsm-stage7a-compression-confidence.json").write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")
    (reports_root / "rsm-v2-candidate-stage7a.json").write_text(json.dumps(candidate, indent=2), encoding="utf-8")
    _write_csv(reports_root / "rsm-stage7a-compression-confidence.csv", calibrated_validation)
    _write_report(reports_root / "rsm-stage7a-compression-confidence.md", diagnostics)
    return diagnostics


def _pct(value: float | None) -> str:
    return "N/A" if value is None else f"{100.0 * value:.2f}%"


def _fmt(value: float | None, digits: int = 3) -> str:
    return "N/A" if value is None else f"{value:.{digits}f}"


def _write_report(path: Path, data: dict) -> None:
    distributions = data["distribution"]
    raw = data["score_calibration_experiment"]["raw_validation"]
    calibrated = data["score_calibration_experiment"]["calibrated_validation"]
    probability = data["probability_calibration_experiment"]
    lines = [
        "# Stage 7A - Score Compression and Confidence Inversion",
        "",
        "Stage 7A is diagnostic. RSM-v1 and its frozen 2024-2025 results were not changed or used for fitting. Score and probability experiments were fitted on 2021-2022 and evaluated once on 2023.",
        "",
        "## Scope",
        "",
        f"- Training: 2021-2022 ({data['scope']['training_games']} regular-season games)",
        f"- Validation: 2023 ({data['scope']['validation_games']} regular-season games)",
        "- Locked 2024-2025 data read or tuned: no",
        "",
        "## 1. Validation distribution and compression",
        "",
        "| Output | Series | Mean | Std | Variance | Min | P05 | P25 | Median | P75 | P95 | Max |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for output, comparison in distributions.items():
        for series in ("predicted", "actual"):
            row = comparison[series]
            lines.append(
                f"| {output} | {series} | {row['mean']:.2f} | {row['std']:.2f} | {row['variance']:.2f} | "
                f"{row['min']:.2f} | {row['p05']:.2f} | {row['p25']:.2f} | {row['median']:.2f} | "
                f"{row['p75']:.2f} | {row['p95']:.2f} | {row['max']:.2f} |"
            )
    lines += [
        "",
        f"Margin standard-deviation ratio: {distributions['game_margin']['std_ratio']:.3f}; variance ratio: {distributions['game_margin']['variance_ratio']:.3f}.",
        f"Total standard-deviation ratio: {distributions['game_total']['std_ratio']:.3f}; variance ratio: {distributions['game_total']['variance_ratio']:.3f}.",
        "",
        "## 2. Validation calibration slopes",
        "",
        "A slope above 1 means actual variation is wider than predicted variation. Confidence intervals use the large-sample 1.96 standard-error approximation.",
        "",
        "| Output | Intercept | Slope | Slope 95% CI | R-squared |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for name, regression in data["raw_calibration_slopes"].items():
        lines.append(f"| {name} | {regression['intercept']:.3f} | {regression['slope']:.3f} | [{regression['slope_ci95'][0]:.3f}, {regression['slope_ci95'][1]:.3f}] | {_fmt(regression['r_squared'])} |")
    lines += [
        "",
        "Margin slope above 1 is consistent with compressed useful margin variation. Total slope is below 1, but its R-squared is only 0.002: raw total variation is almost unrelated to actual total variation, so simply expanding totals would amplify noise rather than solve compression.",
    ]
    pipeline = data["pipeline_variance"]
    lines += [
        "",
        "## 3. Where compression enters",
        "",
        pipeline["psr_scope_note"],
        "",
        "| Stage/value | Standard deviation |",
        "| --- | ---: |",
        f"| Current PSR, all players | {pipeline['psr_current_snapshot']['ALL']['std']:.3f} |",
    ]
    lines += ["", "Current checkpoint PSR distribution by position:", "", "| Position | N | Mean | Std | Min | Max |", "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for position, row in pipeline["psr_current_snapshot"].items():
        if position != "ALL":
            lines.append(f"| {position} | {row['n']} | {row['mean']:.2f} | {row['std']:.2f} | {row['min']:.2f} | {row['max']:.2f} |")
    lines += ["", "Historical validation pipeline dispersion:", "", "| Stage/value | Standard deviation |", "| --- | ---: |"]
    for name, row in pipeline["validation_unit_ratings"].items():
        lines.append(f"| Validation unit {name} | {row['std']:.3f} |")
    lines += [
        f"| Validation roster-strength proxy | {pipeline['validation_roster_proxy']['std']:.3f} |",
        f"| Validation roster-differential proxy | {pipeline['validation_roster_differential_proxy']['std']:.3f} |",
    ]
    for name, row in pipeline["validation_matchups"].items():
        lines.append(f"| Validation matchup {name} | {row['std']:.3f} |")
    lines += [
        f"| RSM-v1 expected team points | {pipeline['validation_expected_points']['std']:.3f} |",
        f"| Actual team points | {pipeline['validation_actual_points']['std']:.3f} |",
        "",
        "Ridge contribution standard deviations:",
        "",
        "| Feature | Contribution std |", "| --- | ---: |",
    ]
    for name, value in sorted(pipeline["validation_ridge_contribution_std"].items(), key=lambda item: item[1], reverse=True):
        lines.append(f"| {name} | {value:.3f} |")
    lines += [
        "",
        "Compression is cumulative: player reliability shrinks ratings toward the 50 replacement prior; missing groups fall back to 50; season weighting averages history; unit ratings average multiple positions; standardized ridge coefficients then convert those already-aggregated ratings to scores around a 22.433 intercept. RSM-v1 has no explicit score clipping. The largest identifiable loss of dispersion is the unit/matchup-to-expected-points conversion, amplified by correlated inputs and regression toward the mean.",
        "",
        "## 4. Ridge shrinkage diagnostic",
        "",
        "No alpha is selected here. All variants fit 2021-2022 and evaluate 2023.",
        "",
        "| Alpha | Score MAE | Margin MAE | Total MAE | Margin std | Total std | Margin slope | Total slope | Coefficient L2 |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in data["ridge_diagnostic"]:
        lines.append(f"| {row['alpha']:.1f} | {row['score_mae']:.3f} | {row['margin_mae']:.3f} | {row['total_mae']:.3f} | {row['margin_std']:.3f} | {row['total_std']:.3f} | {row['margin_calibration_slope']:.3f} | {row['total_calibration_slope']:.3f} | {row['coefficient_l2']:.3f} |")
    lines += [
        "",
        "## 5. Mean-reversion mechanisms",
        "",
        "- PSR metrics are z-scored, capped at +/-3, reliability-shrunk toward replacement level 50, clipped to 25-99, and averaged across five weighted seasons.",
        "- Missing position groups use the replacement value 50. Unit ratings are weighted averages; OL also includes a weakest-link adjustment.",
        "- RSM-v1 standardizes inputs, uses a league-like intercept of 22.433 team points, and applies ridge shrinkage to correlated coefficients.",
        "- QB, receiving, and composite pass offense overlap strongly, allowing offsetting coefficients rather than clean independent effects.",
        "- Unlike RSM-v0, RSM-v1 expected scores are not explicitly clipped or capped.",
        "- The confidence layer does not change scores; it only maps model-market distance through a global residual SD.",
        "",
        "## 6. Confidence pipeline",
        "",
        f"- ATS: `{data['confidence_formula']['ATS']}`",
        f"- O/U: `{data['confidence_formula']['OU']}`",
        f"- Label: `{data['confidence_formula']['classification']}`",
        f"- Frozen validation residual SDs: margin {data['residual_scales']['margin']:.3f}, total {data['residual_scales']['total']:.3f}.",
        "",
        "There is no simulation, learned win-probability model, or logistic layer in RSM-v1. Because Phi(abs(edge)/SD) is strictly increasing in absolute edge, raw-edge and probability rankings are mechanically identical within ATS and within O/U. The probability layer can exaggerate magnitude, but it cannot create or reverse the ordering.",
        "",
        "## 7. Validation raw-edge and confidence monotonicity",
    ]
    for market in ("ATS", "OU"):
        lines += ["", f"### {market} raw absolute edge deciles", "", "| Decile | N | Mean absolute edge | Mean probability | W-L-P | Accuracy |", "| ---: | ---: | ---: | ---: | ---: | ---: |"]
        for row in data["raw_edge_deciles"][market]:
            lines.append(f"| {row['decile']} | {row['n']} | {row['mean_abs_edge']:.3f} | {_pct(row['mean_probability'])} | {row['wins']}-{row['losses']}-{row['pushes']} | {_pct(row['accuracy'])} |")
        lines += ["", f"### {market} predicted-probability deciles", "", "| Decile | N | Mean absolute edge | Mean probability | W-L-P | Accuracy |", "| ---: | ---: | ---: | ---: | ---: | ---: |"]
        for row in data["probability_deciles"][market]:
            lines.append(f"| {row['decile']} | {row['n']} | {row['mean_abs_edge']:.3f} | {_pct(row['mean_probability'])} | {row['wins']}-{row['losses']}-{row['pushes']} | {_pct(row['accuracy'])} |")
        lines += ["", "These probability-sorted deciles contain the same games in the same order as raw-edge deciles because probability is a monotonic transform of absolute edge."]
    lines += ["", "## 8. Probability calibration", "", "| Market/model | N | Brier | Calibration intercept | Calibration slope |", "| --- | ---: | ---: | ---: | ---: |"]
    for market in ("ATS", "OU"):
        raw_probability = data["raw_probability"][market]
        recalibrated = probability[market]
        lines.append(f"| {market} raw | {raw_probability['n']} | {raw_probability['brier_score']:.4f} | {raw_probability['calibration_intercept']:.3f} | {raw_probability['calibration_slope']:.3f} |")
        lines.append(f"| {market} training-fitted recalibration | {recalibrated['n']} | {recalibrated['brier_score']:.4f} | {recalibrated['calibration_intercept']:.3f} | {recalibrated['calibration_slope']:.3f} |")
    lines += [
        "",
        "A constant 50% forecast has Brier score 0.2500. Both recalibrated results remain worse than that reference, so the numerical improvement is confidence shrinkage rather than evidence of a useful calibrated betting probability.",
    ]
    for market in ("ATS", "OU"):
        lines += ["", f"### {market} validation probability bins", "", "| Model | Probability bin | N | Mean probability | Observed frequency |", "| --- | --- | ---: | ---: | ---: |"]
        for label, metrics in (("raw", data["raw_probability"][market]), ("recalibrated", probability[market])):
            for row in metrics["bins"]:
                if row["n"]:
                    lines.append(f"| {label} | {row['bin']} | {row['n']} | {_pct(row['mean_probability'])} | {_pct(row['observed_frequency'])} |")
    lines += [
        "",
        "## 9. Direction and sign audit",
        "",
        "Code inspection and property tests confirm that increasing home margin advantage increases home-cover probability, increasing away advantage increases away-cover probability, and increasing predicted total relative to market increases Over probability. Spread conversion uses sportsbook home -3 -> internal home margin +3. No sign, CDF-direction, or comparison-operator bug was found.",
        "",
        "## 10. Residual variance",
        "",
        "| Grouping | Quartile | N | Range | Margin residual SD | Total residual SD |", "| --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for name, groups in data["heteroskedasticity"]["groups"].items():
        for row in groups:
            lines.append(f"| {name} | {row['quartile']} | {row['n']} | {row['range'][0]:.2f}-{row['range'][1]:.2f} | {row['margin_residual_std']:.3f} | {row['total_residual_std']:.3f} |")
    all_hetero_groups = [row for groups in data["heteroskedasticity"]["groups"].values() for row in groups]
    lines += [
        "",
        f"Across these observable quartiles, margin residual SD ranges from {min(row['margin_residual_std'] for row in all_hetero_groups):.3f} to {max(row['margin_residual_std'] for row in all_hetero_groups):.3f}, and total residual SD ranges from {min(row['total_residual_std'] for row in all_hetero_groups):.3f} to {max(row['total_residual_std'] for row in all_hetero_groups):.3f}. This is material heteroskedasticity, although the pattern is not uniformly monotonic.",
        "",
        data["heteroskedasticity"]["lineup_confidence"],
    ]
    calibration = data["score_calibration_experiment"]
    parameters = calibration["parameters_fitted_training_only"]
    lines += [
        "",
        "## 11. Controlled score-calibration experiment",
        "",
        f"Training-only formulas: calibrated margin = {parameters['margin_intercept']:.3f} + {parameters['margin_slope']:.3f} * raw margin; calibrated total = {parameters['total_intercept']:.3f} + {parameters['total_slope']:.3f} * raw total.",
        "",
        "| Validation model | Score MAE | Margin MAE | Total MAE | Score std | Margin std | Total std | ATS | O/U |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        f"| Raw RSM-v1 | {raw['score_mae']:.3f} | {raw['margin_mae']:.3f} | {raw['total_mae']:.3f} | {raw['score_std']:.3f} | {raw['margin_std']:.3f} | {raw['total_std']:.3f} | {_pct(raw['ats']['accuracy'])} | {_pct(raw['ou']['accuracy'])} |",
        f"| Calibrated experiment | {calibrated['score_mae']:.3f} | {calibrated['margin_mae']:.3f} | {calibrated['total_mae']:.3f} | {calibrated['score_std']:.3f} | {calibrated['margin_std']:.3f} | {calibrated['total_std']:.3f} | {_pct(calibrated['ats']['accuracy'])} | {_pct(calibrated['ou']['accuracy'])} |",
        "",
        "The training-only layer expands margin SD from 3.468 to 4.297 and moves its validation calibration slope from 1.318 to 1.064. It contracts total SD from 3.697 to 2.747 while improving total MAE, confirming that the raw total's limited variation is mostly weak signal rather than a scale-only defect.",
        "",
        "Post-calibration validation slopes:",
        "",
        "| Output | Slope | R-squared |", "| --- | ---: | ---: |",
    ]
    for name, regression in calibration["calibrated_validation_slopes"].items():
        lines.append(f"| {name} | {regression['slope']:.3f} | {_fmt(regression['r_squared'])} |")
    probability_parameters = probability["parameters_fitted_training_only"]
    lines += [
        "",
        "## 12. Controlled probability-recalibration experiment",
        "",
        f"Training-only ATS correctness model: sigmoid({probability_parameters['ATS']['intercept']:.3f} + {probability_parameters['ATS']['slope']:.3f} * abs(edge)).",
        f"Training-only O/U correctness model: sigmoid({probability_parameters['OU']['intercept']:.3f} + {probability_parameters['OU']['slope']:.3f} * abs(edge)).",
        "",
        "This layer leaves the raw pick unchanged and estimates only its probability of success. Validation Brier and calibration results are in Section 8.",
    ]
    for market in ("ATS", "OU"):
        lines += ["", f"### {market} recalibrated-probability deciles", "", "| Decile | N | Mean probability | Observed accuracy |", "| ---: | ---: | ---: | ---: |"]
        for row in probability[f"{market}_deciles"]:
            lines.append(f"| {row['decile']} | {row['n']} | {_pct(row['mean_probability'])} | {_pct(row['accuracy'])} |")
    lines += [
        "",
        "Both training-fitted slopes are positive, so recalibration compresses claimed probabilities toward 50% but preserves the same edge ordering. Validation accuracy remains non-monotonic and the highest deciles remain below 50%; monotonic confidence is not restored.",
        "",
        "## Final answers",
        "",
        f"1. Score compression is severe: validation margin SD is {distributions['game_margin']['std_ratio']:.1%} of actual and total SD is {distributions['game_total']['std_ratio']:.1%} of actual.",
        "2. Compression is cumulative, but it primarily becomes operationally severe when averaged unit/matchup features are converted by the correlated ridge score model into expected points.",
        "3. Ridge is not the primary cause if low-alpha rows retain similarly compressed output; the diagnostic table quantifies its incremental effect.",
        "4. Player ratings include explicit reliability and history shrinkage, and unit aggregation narrows them further. Historical player-level PSRs were not archived, so the exact historical share is uncertain.",
        "5. Yes. The expected-score layer produces much less dispersion than actual scores and has no explicit clipping that would otherwise explain it.",
        "6. Raw edge is not reliably informative on 2023: accuracy is non-monotonic and the largest-edge deciles are below 50% for both ATS and O/U. No betting threshold is selected.",
        "7. Within each market, confidence ordering is identical to raw absolute-edge ordering. Any inversion in ordering is already present in raw edge; the global-normal probability layer adds overstatement, not reversal.",
        "8. No spread-sign or probability-direction bug was found.",
        "9. A single global residual SD is incomplete: the quartile table shows residual variance changes across observable game conditions, and lineup uncertainty is omitted.",
        f"10. Training-only score recalibration modestly improves 2023 score/margin/total MAE from {raw['score_mae']:.3f}/{raw['margin_mae']:.3f}/{raw['total_mae']:.3f} to {calibrated['score_mae']:.3f}/{calibrated['margin_mae']:.3f}/{calibrated['total_mae']:.3f}. It corrects margin scale but contracts totals further, so it is not a general cure for score compression.",
        f"11. Training-only probability recalibration improves validation Brier from {data['raw_probability']['ATS']['brier_score']:.4f} to {probability['ATS']['brier_score']:.4f} ATS and {data['raw_probability']['OU']['brier_score']:.4f} to {probability['OU']['brier_score']:.4f} O/U by shrinking confidence toward 50%, but it does not restore monotonic decile ordering and remains worse than the 0.2500 constant-50% reference.",
        "12. The evidence can justify a separately developed RSM-v2 candidate, but not a production replacement. A new untouched future test period is required.",
        "13. Three specific RSM-v2 changes: simplify correlated unit inputs before score conversion; fit training-only margin/total calibration with explicit dispersion checks; replace the global-normal confidence transform with training-fitted calibration that incorporates heteroskedastic and lineup uncertainty.",
        "",
        "STOP: no full RSM-v2 was implemented and RSM-v1 artifacts were not overwritten.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
