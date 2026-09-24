from __future__ import annotations

import math
import time
from dataclasses import asdict, dataclass
from typing import Iterable, Sequence

from parallel_models.nflverse_pbp import DriveSummary

from .data import completed_games
from .schema import InformationTier, PGPGame, PGPSimulationConfig
from .simulator import simulate_game


@dataclass(frozen=True)
class PGPMetrics:
    tier: int
    games: int
    home_score_mae: float | None
    away_score_mae: float | None
    score_mae: float | None
    margin_mae: float | None
    total_mae: float | None
    home_score_rmse: float | None
    away_score_rmse: float | None
    margin_rmse: float | None
    total_rmse: float | None
    home_win_brier: float | None
    total_interval_80_coverage: float | None
    margin_interval_80_coverage: float | None


def evaluate(
    games: Sequence[PGPGame],
    *,
    train_through: int,
    test_season: int,
    tiers: Iterable[InformationTier],
    config: PGPSimulationConfig,
    drive_summaries: Sequence[DriveSummary] | None = None,
    game_type: str = "REG",
) -> dict:
    started = time.perf_counter()
    eligible = [
        game
        for game in completed_games(games, game_type=game_type)
        if game.season == int(test_season)
        and game.home_score is not None
        and game.away_score is not None
    ]
    records = []
    for tier in tiers:
        for game in eligible:
            history = [candidate for candidate in games if candidate.season <= int(train_through) or candidate.season <= game.season]
            distribution = simulate_game(game, history, tier=tier, config=config, drive_summaries=list(drive_summaries) if drive_summaries is not None else None)
            summary = distribution.summary()
            records.append(_record(game, tier, summary, config))
    metrics = [asdict(_metrics_for_tier(int(tier), records)) for tier in tiers]
    return {
        "schema_version": 1,
        "model": "PGP",
        "train_through": int(train_through),
        "test_season": int(test_season),
        "game_type": game_type.upper(),
        "tiers": [int(tier) for tier in tiers],
        "configuration": asdict(config),
        "prior_source": config.prior_source,
        "games_evaluated": len(eligible),
        "prediction_rows": len(records),
        "runtime_seconds": time.perf_counter() - started,
        "metrics": metrics,
        "records": records,
    }


def _record(game: PGPGame, tier: InformationTier, summary: dict, config: PGPSimulationConfig) -> dict:
    home_mean = float(summary["home_score"]["mean"])
    away_mean = float(summary["away_score"]["mean"])
    total_mean = float(summary["total"]["mean"])
    margin_mean = float(summary["margin"]["mean"])
    actual_home = int(game.home_score)
    actual_away = int(game.away_score)
    actual_total = actual_home + actual_away
    actual_margin = actual_home - actual_away
    home_win_actual = 1.0 if actual_margin > 0 else 0.5 if actual_margin == 0 else 0.0
    return {
        "model": "PGP",
        "tier": int(tier),
        "tier_label": tier.name,
        "game_id": game.game_id,
        "season": game.season,
        "week": game.week,
        "game_type": game.game_type,
        "away_team": game.away_team,
        "home_team": game.home_team,
        "actual_away_score": actual_away,
        "actual_home_score": actual_home,
        "actual_total": actual_total,
        "actual_margin": actual_margin,
        "predicted_away_score": away_mean,
        "predicted_home_score": home_mean,
        "predicted_total": total_mean,
        "predicted_margin": margin_mean,
        "home_win_probability": summary["home_win_probability"],
        "home_score_error": home_mean - actual_home,
        "away_score_error": away_mean - actual_away,
        "total_error": total_mean - actual_total,
        "margin_error": margin_mean - actual_margin,
        "home_win_brier": (summary["home_win_probability"] - home_win_actual) ** 2,
        "total_inside_80": _inside(actual_total, summary["total"]["interval_80"]),
        "margin_inside_80": _inside(actual_margin, summary["margin"]["interval_80"]),
        "simulations": config.simulations,
        "seed": config.seed,
    }


def _metrics_for_tier(tier: int, records: Sequence[dict]) -> PGPMetrics:
    selected = [record for record in records if record["tier"] == tier]
    return PGPMetrics(
        tier=tier,
        games=len(selected),
        home_score_mae=_mae([record["home_score_error"] for record in selected]),
        away_score_mae=_mae([record["away_score_error"] for record in selected]),
        score_mae=_mae([record["home_score_error"] for record in selected] + [record["away_score_error"] for record in selected]),
        margin_mae=_mae([record["margin_error"] for record in selected]),
        total_mae=_mae([record["total_error"] for record in selected]),
        home_score_rmse=_rmse([record["home_score_error"] for record in selected]),
        away_score_rmse=_rmse([record["away_score_error"] for record in selected]),
        margin_rmse=_rmse([record["margin_error"] for record in selected]),
        total_rmse=_rmse([record["total_error"] for record in selected]),
        home_win_brier=_mean([record["home_win_brier"] for record in selected]),
        total_interval_80_coverage=_mean([record["total_inside_80"] for record in selected]),
        margin_interval_80_coverage=_mean([record["margin_inside_80"] for record in selected]),
    )


def _inside(value: float, bounds: Sequence[float]) -> float:
    return 1.0 if float(bounds[0]) <= float(value) <= float(bounds[1]) else 0.0


def _mae(errors: Sequence[float]) -> float | None:
    if not errors:
        return None
    return sum(abs(error) for error in errors) / len(errors)


def _rmse(errors: Sequence[float]) -> float | None:
    if not errors:
        return None
    return math.sqrt(sum(error * error for error in errors) / len(errors))


def _mean(values: Sequence[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)
