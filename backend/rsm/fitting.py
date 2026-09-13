import csv
import json
import math
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

from .config import DEFAULT_CONFIG, RSMConfig


FEATURE_NAMES = (
    "home_field",
    "qb_rating",
    "ol_rating",
    "receiving_rating",
    "pass_offense_rating",
    "run_offense_rating",
    "opponent_pass_defense_rating",
    "opponent_run_defense_rating",
    "kicker_rating",
)


@dataclass(frozen=True)
class TrainingPlan:
    training_seasons: Tuple[int, ...] = (2021, 2022)
    validation_seasons: Tuple[int, ...] = (2023,)
    locked_test_seasons: Tuple[int, ...] = (2024, 2025)

    def validate(self) -> None:
        groups = [set(self.training_seasons), set(self.validation_seasons), set(self.locked_test_seasons)]
        if any(groups[index] & groups[other] for index in range(3) for other in range(index + 1, 3)):
            raise ValueError("Training, validation, and locked-test seasons must be disjoint")
        if not all(groups):
            raise ValueError("Every chronological split must contain at least one season")
        if max(self.training_seasons) >= min(self.validation_seasons):
            raise ValueError("Training seasons must precede validation seasons")
        if max(self.validation_seasons) >= min(self.locked_test_seasons):
            raise ValueError("Validation seasons must precede locked-test seasons")


@dataclass(frozen=True)
class RidgeArtifact:
    model_version: str
    feature_names: Tuple[str, ...]
    feature_means: Tuple[float, ...]
    feature_scales: Tuple[float, ...]
    intercept: float
    coefficients: Tuple[float, ...]
    ridge_alpha: float
    training_seasons: Tuple[int, ...]
    validation_seasons: Tuple[int, ...]
    locked_test_seasons: Tuple[int, ...]
    config_digest: str

    def predict(self, features: Dict[str, float]) -> float:
        standardized = [
            (features[name] - mean) / scale
            for name, mean, scale in zip(self.feature_names, self.feature_means, self.feature_scales)
        ]
        return self.intercept + sum(value * coefficient for value, coefficient in zip(standardized, self.coefficients))


def game_observations(record: dict) -> List[Tuple[Dict[str, float], float, str]]:
    """Create two team-score observations without reading any market columns."""
    observations = []
    for side, opponent, home_field in (("home", "away", 1.0), ("away", "home", 0.0)):
        features = {
            "home_field": home_field,
            "qb_rating": float(record[f"{side}_qb_rating"]),
            "ol_rating": float(record[f"{side}_ol_rating"]),
            "receiving_rating": float(record[f"{side}_receiving_rating"]),
            "pass_offense_rating": float(record[f"{side}_pass_offense_rating"]),
            "run_offense_rating": float(record[f"{side}_run_offense_rating"]),
            "opponent_pass_defense_rating": float(record[f"{opponent}_pass_defense_rating"]),
            "opponent_run_defense_rating": float(record[f"{opponent}_run_defense_rating"]),
            "kicker_rating": float(record[f"{side}_kicker_rating"]),
        }
        observations.append((features, float(record[f"{side}_score"]), side))
    return observations


def _solve(matrix: List[List[float]], vector: List[float]) -> List[float]:
    size = len(vector)
    augmented = [row[:] + [value] for row, value in zip(matrix, vector)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise ValueError("Ridge system is singular")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            if factor:
                augmented[row] = [
                    value - factor * pivot_value
                    for value, pivot_value in zip(augmented[row], augmented[column])
                ]
    return [augmented[index][-1] for index in range(size)]


def _fit_ridge(
    observations: Sequence[Tuple[Dict[str, float], float, str]],
    alpha: float,
    plan: TrainingPlan,
    config: RSMConfig,
) -> RidgeArtifact:
    columns = [[features[name] for features, _, _ in observations] for name in FEATURE_NAMES]
    means = tuple(statistics.mean(column) for column in columns)
    scales = tuple(statistics.pstdev(column) or 1.0 for column in columns)
    design = [
        [1.0] + [(features[name] - mean) / scale for name, mean, scale in zip(FEATURE_NAMES, means, scales)]
        for features, _, _ in observations
    ]
    targets = [target for _, target, _ in observations]
    width = len(FEATURE_NAMES) + 1
    gram = [[sum(row[i] * row[j] for row in design) for j in range(width)] for i in range(width)]
    rhs = [sum(row[i] * target for row, target in zip(design, targets)) for i in range(width)]
    for index in range(1, width):
        gram[index][index] += alpha
    coefficients = _solve(gram, rhs)
    return RidgeArtifact(
        model_version="RSM-v1-validation",
        feature_names=FEATURE_NAMES,
        feature_means=means,
        feature_scales=scales,
        intercept=coefficients[0],
        coefficients=tuple(coefficients[1:]),
        ridge_alpha=alpha,
        training_seasons=plan.training_seasons,
        validation_seasons=plan.validation_seasons,
        locked_test_seasons=plan.locked_test_seasons,
        config_digest=config.digest(),
    )


def _score_records(records: Iterable[dict], artifact: RidgeArtifact) -> Tuple[List[dict], dict]:
    predictions = []
    score_errors = []
    margin_errors = []
    total_errors = []
    for record in records:
        observations = game_observations(record)
        home_points = artifact.predict(observations[0][0])
        away_points = artifact.predict(observations[1][0])
        actual_home = float(record["home_score"])
        actual_away = float(record["away_score"])
        score_errors.extend((home_points - actual_home, away_points - actual_away))
        margin_errors.append((home_points - away_points) - (actual_home - actual_away))
        total_errors.append((home_points + away_points) - (actual_home + actual_away))
        predictions.append({
            "game_id": record["game_id"], "season": int(record["season"]), "week": int(record["week"]),
            "expected_home_points": round(home_points, 3), "expected_away_points": round(away_points, 3),
            "home_score": actual_home, "away_score": actual_away,
            "predicted_margin": round(home_points - away_points, 3),
            "predicted_total": round(home_points + away_points, 3),
        })
    metrics = {
        "games": len(predictions),
        "score_mae": round(statistics.mean(abs(value) for value in score_errors), 3),
        "margin_mae": round(statistics.mean(abs(value) for value in margin_errors), 3),
        "total_mae": round(statistics.mean(abs(value) for value in total_errors), 3),
        "score_rmse": round(math.sqrt(statistics.mean(value * value for value in score_errors)), 3),
    }
    return predictions, metrics


def fit_rsm_v1(
    records: Sequence[dict],
    plan: TrainingPlan = TrainingPlan(),
    config: RSMConfig = DEFAULT_CONFIG,
) -> Tuple[RidgeArtifact, dict, List[dict]]:
    plan.validate()
    train_rows = [row for row in records if int(row["season"]) in plan.training_seasons]
    validation_rows = [row for row in records if int(row["season"]) in plan.validation_seasons]
    if not train_rows or not validation_rows:
        raise ValueError("Both training and validation records are required")
    if any(int(row["season"]) in plan.locked_test_seasons for row in train_rows + validation_rows):
        raise ValueError("Locked-test rows cannot enter model fitting")
    observations = [observation for row in train_rows for observation in game_observations(row)]
    candidates = []
    for alpha in config.ridge_alphas:
        artifact = _fit_ridge(observations, alpha, plan, config)
        _, metrics = _score_records(validation_rows, artifact)
        candidates.append((metrics["score_mae"], alpha, artifact, metrics))
    _, _, best_artifact, validation_metrics = min(candidates, key=lambda item: (item[0], item[1]))
    _, training_metrics = _score_records(train_rows, best_artifact)
    predictions, _ = _score_records(validation_rows, best_artifact)
    summary = {
        "model_version": best_artifact.model_version,
        "training_seasons": list(plan.training_seasons),
        "validation_seasons": list(plan.validation_seasons),
        "locked_test_seasons": list(plan.locked_test_seasons),
        "selected_ridge_alpha": best_artifact.ridge_alpha,
        "training": training_metrics,
        "validation": validation_metrics,
        "candidate_validation_score_mae": {str(alpha): metrics["score_mae"] for _, alpha, _, metrics in candidates},
        "locked_test_evaluated": False,
    }
    return best_artifact, summary, predictions


def write_v1_artifacts(
    reports_root: Path,
    artifact: RidgeArtifact,
    summary: dict,
    predictions: List[dict],
) -> None:
    reports_root.mkdir(parents=True, exist_ok=True)
    payload = asdict(artifact)
    (reports_root / "rsm-v1-artifact.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (reports_root / "rsm-v1-validation-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    with (reports_root / "rsm-v1-validation-predictions.csv").open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(predictions[0]))
        writer.writeheader()
        writer.writerows(predictions)
    coefficient_rows = sorted(zip(artifact.feature_names, artifact.coefficients), key=lambda item: abs(item[1]), reverse=True)
    lines = [
        "# RSM-v1 Validation",
        "",
        f"Training seasons: {', '.join(map(str, artifact.training_seasons))}",
        f"Validation seasons: {', '.join(map(str, artifact.validation_seasons))}",
        f"Locked test seasons: {', '.join(map(str, artifact.locked_test_seasons))} (not evaluated)",
        f"Selected ridge alpha: {artifact.ridge_alpha}",
        "",
        "| Split | Games | Score MAE | Margin MAE | Total MAE | Score RMSE |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for label in ("training", "validation"):
        metrics = summary[label]
        lines.append(
            f"| {label.title()} | {metrics['games']} | {metrics['score_mae']} | {metrics['margin_mae']} | "
            f"{metrics['total_mae']} | {metrics['score_rmse']} |"
        )
    lines += ["", "## Standardized coefficients", "", "| Feature | Coefficient |", "| --- | ---: |"]
    lines += [f"| {name} | {coefficient:.4f} |" for name, coefficient in coefficient_rows]
    lines += [
        "",
        "Market spread and total are not model features. Coefficients describe association, not causation.",
    ]
    (reports_root / "rsm-v1-validation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
