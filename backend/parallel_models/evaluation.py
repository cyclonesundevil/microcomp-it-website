from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class FrozenEvaluationPeriods:
    training_seasons: tuple[int, ...]
    validation_seasons: tuple[int, ...]
    prospective_seasons: tuple[int, ...]
    notes: str

    def contains_season(self, season: int, bucket: str) -> bool:
        seasons = getattr(self, f"{bucket}_seasons")
        return int(season) in seasons


DEFAULT_PARALLEL_MODEL_PERIODS = FrozenEvaluationPeriods(
    training_seasons=(2024,),
    validation_seasons=(2025,),
    prospective_seasons=(2026,),
    notes=(
        "Research-only split for DSM/PRM candidate development after nflverse "
        "PBP source approval. Current/prospective 2026 games are not used for "
        "coefficient or threshold selection."
    ),
)


def assign_period(season: int, periods: FrozenEvaluationPeriods = DEFAULT_PARALLEL_MODEL_PERIODS) -> str:
    if int(season) in periods.training_seasons:
        return "train"
    if int(season) in periods.validation_seasons:
        return "validation"
    if int(season) in periods.prospective_seasons:
        return "prospective"
    return "excluded"


def seasons_for_period(period: str, periods: FrozenEvaluationPeriods = DEFAULT_PARALLEL_MODEL_PERIODS) -> tuple[int, ...]:
    return getattr(periods, f"{period}_seasons")


def eligible_seasons(periods: FrozenEvaluationPeriods = DEFAULT_PARALLEL_MODEL_PERIODS) -> tuple[int, ...]:
    combined: list[int] = []
    for group in (periods.training_seasons, periods.validation_seasons, periods.prospective_seasons):
        combined.extend(group)
    return tuple(sorted(set(combined)))


def filter_rows_by_period(rows: Iterable[dict], period: str, periods: FrozenEvaluationPeriods = DEFAULT_PARALLEL_MODEL_PERIODS) -> list[dict]:
    selected = set(seasons_for_period(period, periods))
    return [row for row in rows if int(row.get("season", 0) or 0) in selected]
