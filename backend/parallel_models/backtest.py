from __future__ import annotations

import csv
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Mapping, Optional, Sequence

from .drive_models import DriveSuccessModel, EPAPointsModel
from .evaluation import DEFAULT_PARALLEL_MODEL_PERIODS, FrozenEvaluationPeriods
from .interface import NFLGameContext, NFLPrediction
from .nflverse_pbp import DriveSummary, drive_summary_path
from .pbp_features import load_drive_summaries
from .rsm_wrapper import RSMParallelModel


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GAMES_PATH = Path(__file__).resolve().parents[1] / "data" / "nfl_games.csv"
DEFAULT_REPORTS_DIR = REPO_ROOT / "reports" / "parallel_models"
PREDICTION_FIELDNAMES = (
    "model_name",
    "model_version",
    "period",
    "season",
    "week",
    "game_id",
    "game_type",
    "away_team",
    "home_team",
    "actual_away_score",
    "actual_home_score",
    "actual_margin",
    "actual_total",
    "predicted_away_score",
    "predicted_home_score",
    "predicted_margin",
    "predicted_total",
    "margin_error",
    "total_error",
    "sample_drives",
    "sample_weight",
)


@dataclass(frozen=True)
class ModelMetrics:
    model_name: str
    period: str
    games: int
    margin_mae: Optional[float]
    total_score_mae: Optional[float]
    margin_rmse: Optional[float]
    total_score_rmse: Optional[float]
    avg_sample_drives: Optional[float]


def load_game_rows(path: Path = DEFAULT_GAMES_PATH) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        return list(csv.DictReader(source))


def build_game_order(games: Iterable[Mapping[str, object]]) -> dict[str, tuple]:
    return {
        str(game.get("game_id")): (
            _int(game.get("season")),
            _int(game.get("week")),
            str(game.get("gameday") or ""),
            str(game.get("gametime") or ""),
            str(game.get("game_id") or ""),
        )
        for game in games
        if game.get("game_id")
    }


def eligible_completed_games(
    games: Iterable[Mapping[str, object]],
    seasons: Sequence[int],
    *,
    game_type: str = "REG",
) -> list[dict]:
    selected = {int(season) for season in seasons}
    output = []
    for game in games:
        if _int(game.get("season")) not in selected:
            continue
        if str(game.get("game_type") or "").upper() != game_type.upper():
            continue
        if _optional_float(game.get("home_score")) is None or _optional_float(game.get("away_score")) is None:
            continue
        output.append(dict(game))
    return sorted(output, key=lambda row: build_game_order([row])[str(row["game_id"])])


def evaluate_drive_models(
    *,
    games_path: Path = DEFAULT_GAMES_PATH,
    drive_summaries_path: Path = drive_summary_path(),
    periods: FrozenEvaluationPeriods = DEFAULT_PARALLEL_MODEL_PERIODS,
    period: str = "validation",
    game_type: str = "REG",
    include_rsm: bool = True,
    include_market_baseline: bool = True,
) -> dict:
    games = load_game_rows(games_path)
    drives = load_drive_summaries(drive_summaries_path)
    game_order = build_game_order(games)
    seasons = getattr(periods, f"{period}_seasons")
    eligible_games = eligible_completed_games(games, seasons, game_type=game_type)
    models = _prediction_models(drives, game_order, include_rsm=include_rsm)
    records = []
    for game in eligible_games:
        context = _context_from_game(game)
        for model in models:
            prediction = model.predict(context)
            records.append(_record_prediction(prediction, game, period))
        if include_market_baseline and _has_market_baseline(game):
            records.append(_record_prediction(_market_baseline_prediction(context), game, period))
    metrics = [
        asdict(_metrics_for_model(model_name, period, records))
        for model_name in _ordered_model_names(records)
    ]
    return {
        "schema_version": 1,
        "period": period,
        "game_type": game_type.upper(),
        "periods": asdict(periods),
        "games_evaluated": len(eligible_games),
        "prediction_rows": len(records),
        "models": _ordered_model_names(records),
        "metrics": metrics,
        "records": records,
    }


def write_drive_model_backtest(
    *,
    output_dir: Path = DEFAULT_REPORTS_DIR,
    games_path: Path = DEFAULT_GAMES_PATH,
    drive_summaries_path: Path = drive_summary_path(),
    period: str = "validation",
) -> dict:
    result = evaluate_drive_models(
        games_path=games_path,
        drive_summaries_path=drive_summaries_path,
        period=period,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"rsm-dsm-prm-{period}-predictions.csv"
    json_path = output_dir / f"rsm-dsm-prm-{period}-metrics.json"
    md_path = output_dir / f"rsm-dsm-prm-{period}-summary.md"
    with csv_path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=list(PREDICTION_FIELDNAMES))
        writer.writeheader()
        writer.writerows(result["records"])
    json_payload = {key: value for key, value in result.items() if key != "records"}
    json_payload["prediction_csv"] = _repo_relative(csv_path)
    json_path.write_text(json.dumps(json_payload, indent=2), encoding="utf-8")
    md_path.write_text(_render_summary_markdown(json_payload), encoding="utf-8")
    return {
        **json_payload,
        "prediction_csv": _repo_relative(csv_path),
        "metrics_json": _repo_relative(json_path),
        "summary_markdown": _repo_relative(md_path),
    }


def _prediction_models(
    drives: Sequence[DriveSummary],
    game_order: Mapping[str, Sequence[object]],
    *,
    include_rsm: bool,
) -> list:
    models = []
    if include_rsm:
        models.append(RSMParallelModel())
    models.extend([
        DriveSuccessModel(drives, game_order=game_order),
        EPAPointsModel(drives, game_order=game_order),
    ])
    return models


def _has_market_baseline(game: Mapping[str, object]) -> bool:
    return _optional_float(game.get("spread_line")) is not None and _optional_float(game.get("total_line")) is not None


def _market_baseline_prediction(game_context: NFLGameContext) -> NFLPrediction:
    predicted_margin = float(game_context.market_home_margin)
    predicted_total = float(game_context.market_total)
    home_score = (predicted_total + predicted_margin) / 2.0
    away_score = (predicted_total - predicted_margin) / 2.0
    return NFLPrediction(
        model_name="market_baseline",
        model_version="market_spread_total_baseline_not_model",
        home_team=game_context.home_team,
        away_team=game_context.away_team,
        kickoff=game_context.kickoff,
        expected_home_score=home_score,
        expected_away_score=away_score,
        expected_margin=predicted_margin,
        expected_total=predicted_total,
        home_win_probability=None,
        uncertainty={"baseline": "market", "research_only": True},
        metadata={"baseline_note": "Market spread_line and total_line baseline; not an algorithmic model."},
    )


def _ordered_model_names(records: Iterable[Mapping[str, object]]) -> list[str]:
    preferred = ["RSM", "dsm", "prm", "market_baseline"]
    seen = {str(record["model_name"]) for record in records}
    ordered = [name for name in preferred if name in seen]
    ordered.extend(sorted(seen - set(ordered)))
    return ordered


def _context_from_game(game: Mapping[str, object]) -> NFLGameContext:
    return NFLGameContext(
        home_team=str(game["home_team"]),
        away_team=str(game["away_team"]),
        season=_int(game.get("season")),
        week=_int(game.get("week")),
        home_rest=_optional_float(game.get("home_rest")) or 7.0,
        away_rest=_optional_float(game.get("away_rest")) or 7.0,
        market_home_margin=_optional_float(game.get("spread_line")),
        market_total=_optional_float(game.get("total_line")),
        metadata={"game_id": str(game.get("game_id") or "")},
    )


def _record_prediction(prediction: NFLPrediction, game: Mapping[str, object], period: str) -> dict:
    actual_home = float(game["home_score"])
    actual_away = float(game["away_score"])
    actual_margin = actual_home - actual_away
    actual_total = actual_home + actual_away
    predicted_total = prediction.expected_total
    return {
        "model_name": prediction.model_name,
        "model_version": prediction.model_version,
        "period": period,
        "season": _int(game.get("season")),
        "week": _int(game.get("week")),
        "game_id": str(game.get("game_id") or ""),
        "game_type": str(game.get("game_type") or ""),
        "away_team": str(game.get("away_team") or ""),
        "home_team": str(game.get("home_team") or ""),
        "actual_away_score": actual_away,
        "actual_home_score": actual_home,
        "actual_margin": actual_margin,
        "actual_total": actual_total,
        "predicted_away_score": prediction.expected_away_score,
        "predicted_home_score": prediction.expected_home_score,
        "predicted_margin": prediction.expected_margin,
        "predicted_total": predicted_total,
        "margin_error": prediction.expected_margin - actual_margin,
        "total_error": (predicted_total - actual_total) if predicted_total is not None else None,
        "sample_drives": prediction.uncertainty.get("sample_drives"),
        "sample_weight": prediction.uncertainty.get("sample_weight"),
    }


def _metrics_for_model(model_name: str, period: str, records: Iterable[Mapping[str, object]]) -> ModelMetrics:
    selected = [record for record in records if record["model_name"] == model_name]
    margin_errors = [float(record["margin_error"]) for record in selected if record.get("margin_error") is not None]
    total_errors = [float(record["total_error"]) for record in selected if record.get("total_error") is not None]
    sample_drives = [float(record["sample_drives"]) for record in selected if record.get("sample_drives") is not None]
    return ModelMetrics(
        model_name=model_name,
        period=period,
        games=len(selected),
        margin_mae=_mae(margin_errors),
        total_score_mae=_mae(total_errors),
        margin_rmse=_rmse(margin_errors),
        total_score_rmse=_rmse(total_errors),
        avg_sample_drives=_mean(sample_drives),
    )


def _render_summary_markdown(payload: Mapping[str, object]) -> str:
    metrics = payload["metrics"]
    lines = [
        "# RSM / DSM / PRM Research Backtest",
        "",
        "Research-only validation artifact. DSM/PRM are not production recommendations. RSM is evaluated through the existing wrapper without changing production behavior.",
        "",
        f"Period: `{payload['period']}`",
        f"Game type: `{payload['game_type']}`",
        f"Games evaluated: {payload['games_evaluated']}",
        f"Prediction rows: {payload['prediction_rows']}",
        "",
        "| Row | Games | Spread MAE | Total Score MAE | Spread RMSE | Total Score RMSE | Avg sample drives |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in metrics:
        lines.append(
            "| {model_name} | {games} | {margin_mae} | {total_score_mae} | {margin_rmse} | {total_score_rmse} | {avg_sample_drives} |".format(
                model_name=item["model_name"],
                games=item["games"],
                margin_mae=_fmt(item["margin_mae"]),
                total_score_mae=_fmt(item["total_score_mae"]),
                margin_rmse=_fmt(item["margin_rmse"]),
                total_score_rmse=_fmt(item["total_score_rmse"]),
                avg_sample_drives=_fmt(item["avg_sample_drives"]),
            )
        )
    lines.extend([
        "",
        "Frozen periods:",
        "",
        "- Training: 2024",
        "- Validation: 2025",
        "- Prospective/current observation: 2026",
        "",
        "Important boundaries:",
        "",
        "- Market spread and market total are not model inputs for DSM/PRM.",
        "- `market_baseline` is a line baseline, not an algorithmic model.",
        "- RSM rows are generated through `RSMParallelModel`; production RSM behavior is not changed.",
    ])
    return "\n".join(lines) + "\n"


def _fmt(value: Optional[float]) -> str:
    return "-" if value is None else f"{value:.3f}"


def _repo_relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def _mae(errors: Sequence[float]) -> Optional[float]:
    if not errors:
        return None
    return sum(abs(error) for error in errors) / len(errors)


def _rmse(errors: Sequence[float]) -> Optional[float]:
    if not errors:
        return None
    return math.sqrt(sum(error * error for error in errors) / len(errors))


def _mean(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def _int(value: object) -> int:
    try:
        text = str(value or "").strip()
        return int(float(text)) if text else 0
    except (TypeError, ValueError):
        return 0


def _optional_float(value: object) -> Optional[float]:
    try:
        text = str(value or "").strip()
        return float(text) if text else None
    except (TypeError, ValueError):
        return None
