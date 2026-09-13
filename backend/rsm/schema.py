from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional


@dataclass(frozen=True)
class Player:
    player_id: str
    name: str
    team: str
    position: str
    season: int
    age: Optional[float] = None
    experience: Optional[int] = None
    games_played: int = 0
    games_started: int = 0
    snaps: int = 0
    offensive_snaps: int = 0
    defensive_snaps: int = 0
    special_team_snaps: int = 0
    injury_status: str = "UNKNOWN"
    source_ids: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PlayerGame:
    player_id: str
    game_id: str
    week: int
    season: int
    opponent: str
    home_away: str
    starter: Optional[bool]
    snap_percentage: Optional[float]
    available_before_game: Optional[bool]
    statistics: Dict[str, float]


@dataclass(frozen=True)
class Game:
    game_id: str
    season: int
    week: int
    game_type: str
    home_team: str
    away_team: str
    home_score: Optional[float]
    away_score: Optional[float]
    market_spread: Optional[float]
    market_total: Optional[float]
    spread_source: str
    total_source: str
    spread_timestamp: Optional[datetime]


@dataclass(frozen=True)
class LineupPlayer:
    game_id: str
    team: str
    player_id: str
    name: str
    position: str
    slot: str
    starter: bool
    expected_starter: bool
    actual_starter: Optional[bool]
    availability: float


@dataclass(frozen=True)
class PlayerRating:
    player_id: str
    name: str
    team: str
    position: str
    rating: float
    uncertainty: float
    seasons_used: int
    opportunities: float
    data_confidence: str
    as_of_season: int
    as_of_week: int
    explanation: Dict[str, float]


@dataclass(frozen=True)
class TeamRating:
    team: str
    season: int
    week: int
    roster_timestamp: str
    qb_rating: float
    rb_rating: float
    wr_rating: float
    te_rating: float
    ol_pass_rating: float
    ol_run_rating: float
    ol_overall_rating: float
    dl_rating: float
    edge_rating: float
    lb_rating: float
    cb_rating: float
    safety_rating: float
    pass_offense_rating: float
    run_offense_rating: float
    offense_rating: float
    pass_defense_rating: float
    run_defense_rating: float
    defense_rating: float
    kicker_rating: float
    roster_rating: float
    lineup_confidence: str
    starters: List[LineupPlayer]
