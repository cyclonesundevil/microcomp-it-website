from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping, Optional, Protocol


@dataclass(frozen=True)
class NFLGameContext:
    """Pregame context passed to independent research models.

    Global convention for all parallel-model work:
    `expected_margin = expected_home_score - expected_away_score`.
    Positive margins favor the home team; negative margins favor the away team.
    """

    home_team: str
    away_team: str
    kickoff: Optional[datetime] = None
    season: Optional[int] = None
    week: Optional[int] = None
    home_rest: float = 7.0
    away_rest: float = 7.0
    market_home_margin: Optional[float] = None
    market_total: Optional[float] = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_predictor_game(self) -> dict:
        game = {
            "home_team": self.home_team,
            "away_team": self.away_team,
            "home_rest": self.home_rest,
            "away_rest": self.away_rest,
        }
        if self.season is not None:
            game["season"] = self.season
        if self.week is not None:
            game["week"] = self.week
        if self.market_home_margin is not None:
            game["spread_line"] = self.market_home_margin
        if self.market_total is not None:
            game["total_line"] = self.market_total
        game.update(dict(self.metadata))
        return game


@dataclass(frozen=True)
class NFLPrediction:
    model_name: str
    model_version: str
    home_team: str
    away_team: str
    kickoff: Optional[datetime]
    expected_home_score: Optional[float]
    expected_away_score: Optional[float]
    expected_margin: float
    expected_total: Optional[float]
    home_win_probability: Optional[float]
    uncertainty: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def margin(self) -> float:
        return self.expected_margin

    @property
    def total(self) -> Optional[float]:
        return self.expected_total


class NFLPredictionModel(Protocol):
    model_name: str
    model_version: str

    def predict(self, game_context: NFLGameContext) -> NFLPrediction:
        ...
