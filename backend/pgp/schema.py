from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum
from typing import Mapping, Optional


class InformationTier(IntEnum):
    LEAGUE_BASELINE = 0
    TEAM_STRENGTH = 1


@dataclass(frozen=True)
class PGPGame:
    game_id: str
    season: int
    week: int
    game_type: str
    away_team: str
    home_team: str
    away_score: Optional[int] = None
    home_score: Optional[int] = None
    gameday: str = ""
    gametime: str = ""

    @property
    def actual_total(self) -> Optional[int]:
        if self.home_score is None or self.away_score is None:
            return None
        return self.home_score + self.away_score

    @property
    def actual_margin(self) -> Optional[int]:
        if self.home_score is None or self.away_score is None:
            return None
        return self.home_score - self.away_score


@dataclass(frozen=True)
class PGPSimulationConfig:
    simulations: int = 25_000
    seed: int = 12345
    possessions_per_team: int = 11
    max_score: int = 80
    prior_source: str = "score"

    def __post_init__(self) -> None:
        if self.simulations <= 0:
            raise ValueError("simulations must be positive")
        if self.possessions_per_team <= 0:
            raise ValueError("possessions_per_team must be positive")
        if self.max_score <= 0:
            raise ValueError("max_score must be positive")
        if self.prior_source not in {"score", "drive"}:
            raise ValueError("prior_source must be 'score' or 'drive'")


@dataclass(frozen=True)
class DriveOutcomeProfile:
    touchdown: float
    field_goal: float
    safety: float
    no_score: float
    sample_team_games: int
    label: str = ""

    def normalized(self) -> "DriveOutcomeProfile":
        values = {
            "touchdown": max(0.0, float(self.touchdown)),
            "field_goal": max(0.0, float(self.field_goal)),
            "safety": max(0.0, float(self.safety)),
            "no_score": max(0.0, float(self.no_score)),
        }
        total = sum(values.values())
        if total <= 0:
            values = {"touchdown": 0.2, "field_goal": 0.15, "safety": 0.005, "no_score": 0.645}
            total = 1.0
        return DriveOutcomeProfile(
            touchdown=values["touchdown"] / total,
            field_goal=values["field_goal"] / total,
            safety=values["safety"] / total,
            no_score=values["no_score"] / total,
            sample_team_games=self.sample_team_games,
            label=self.label,
        )


@dataclass(frozen=True)
class PGPTeamContext:
    home_profile: DriveOutcomeProfile
    away_profile: DriveOutcomeProfile
    tier: InformationTier
    feature_metadata: Mapping[str, object] = field(default_factory=dict)
