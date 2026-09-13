from dataclasses import asdict, dataclass, field
import hashlib
import json
from typing import Dict, Tuple


@dataclass(frozen=True)
class RSMConfig:
    model_version: str = "RSM-v0.1-checkpoint1"
    season_weights: Tuple[float, ...] = (0.35, 0.27, 0.18, 0.12, 0.08)
    replacement_rating: float = 50.0
    starter_rating: float = 60.0
    rating_z_scale: float = 12.0
    minimum_opportunities: Dict[str, float] = field(default_factory=lambda: {
        "QB": 100.0,
        "RB": 60.0,
        "WR": 35.0,
        "TE": 25.0,
        "OL": 230.0,
        "DL": 170.0,
        "EDGE": 150.0,
        "LB": 170.0,
        "CB": 180.0,
        "S": 180.0,
        "K": 10.0,
        "OTHER": 100.0,
    })
    offense_weights: Dict[str, float] = field(default_factory=lambda: {
        "QB": 0.35,
        "OL": 0.25,
        "WR": 0.14,
        "TE": 0.08,
        "RB": 0.10,
        "OTHER": 0.08,
    })
    defense_weights: Dict[str, float] = field(default_factory=lambda: {
        "DL": 0.20,
        "EDGE": 0.22,
        "LB": 0.18,
        "CB": 0.24,
        "S": 0.16,
    })
    roster_weights: Dict[str, float] = field(default_factory=lambda: {
        "offense": 0.46,
        "defense": 0.46,
        "kicking": 0.08,
    })
    ol_position_weights: Dict[str, float] = field(default_factory=lambda: {
        "LT": 0.24,
        "LG": 0.17,
        "C": 0.18,
        "RG": 0.17,
        "RT": 0.24,
    })
    ol_weakest_link_weight: float = 0.20
    pass_offense_weights: Dict[str, float] = field(default_factory=lambda: {
        "QB": 0.45, "WR": 0.25, "TE": 0.10, "OL": 0.20,
    })
    run_offense_weights: Dict[str, float] = field(default_factory=lambda: {
        "OL": 0.45, "RB": 0.35, "TE": 0.20,
    })
    pass_defense_weights: Dict[str, float] = field(default_factory=lambda: {
        "EDGE": 0.30, "CB": 0.40, "S": 0.20, "LB": 0.10,
    })
    run_defense_weights: Dict[str, float] = field(default_factory=lambda: {
        "DL": 0.35, "EDGE": 0.20, "LB": 0.35, "S": 0.10,
    })
    historical_starter_counts: Dict[str, int] = field(default_factory=lambda: {
        "QB": 1, "RB": 1, "WR": 3, "TE": 1, "OL": 5,
        "DL": 2, "EDGE": 2, "LB": 3, "CB": 2, "S": 2, "K": 1,
    })
    lineup_lookback_games: int = 4
    lineup_recency_decay: float = 0.75
    league_points_per_team: float = 22.5
    home_field_points: float = 1.5
    pass_matchup_weight: float = 0.58
    rating_advantage_to_points: float = 0.18
    kicker_rating_to_points: float = 0.04
    ridge_alphas: Tuple[float, ...] = (0.1, 1.0, 10.0, 50.0, 100.0)
    metric_weights: Dict[str, Dict[str, float]] = field(default_factory=lambda: {
        "QB": {"epa": 0.45, "yards": 0.15, "td": 0.12, "int": -0.12, "sack": -0.08, "rush_epa": 0.08},
        "RB": {"rush_epa": 0.35, "yards": 0.20, "first_down": 0.15, "receive_epa": 0.20, "fumble": -0.10},
        "WR": {"receive_epa": 0.35, "yards": 0.25, "first_down": 0.15, "explosive": 0.15, "td": 0.10},
        "TE": {"receive_epa": 0.30, "yards": 0.22, "first_down": 0.18, "explosive": 0.10, "td": 0.10, "snap": 0.10},
        "DEF": {"sack": 0.24, "hit": 0.16, "tfl": 0.14, "coverage": 0.18, "turnover": 0.18, "tackle": 0.10},
        "K": {"fg": 0.55, "long": 0.20, "pat": 0.20, "volume": 0.05},
        "OL": {"snap_share": 0.75, "experience": 0.25},
    })
    current_season: int = 2026
    current_week: int = 2
    history_seasons: int = 5

    def digest(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


DEFAULT_CONFIG = RSMConfig()


POSITION_ALIASES = {
    "HB": "RB", "FB": "RB",
    "T": "OL", "OT": "OL", "G": "OL", "OG": "OL", "C": "OL",
    "LT": "OL", "LG": "OL", "RG": "OL", "RT": "OL",
    "DE": "EDGE", "LDE": "EDGE", "RDE": "EDGE", "OLB": "EDGE",
    "LOLB": "EDGE", "ROLB": "EDGE",
    "DT": "DL", "LDT": "DL", "RDT": "DL", "NT": "DL",
    "ILB": "LB", "LILB": "LB", "RILB": "LB", "MLB": "LB",
    "WLB": "LB", "SLB": "LB",
    "DB": "CB", "NB": "CB", "LCB": "CB", "RCB": "CB",
    "FS": "S", "SS": "S",
    "PK": "K",
}


TEAM_ALIASES = {
    "JAX": "JAX", "LA": "LA", "LAR": "LA", "STL": "LA",
    "LV": "LV", "OAK": "LV", "LAC": "LAC", "SD": "LAC",
    "WSH": "WAS", "WAS": "WAS",
}


def normalize_position(position: str) -> str:
    value = (position or "OTHER").strip().upper()
    return POSITION_ALIASES.get(value, value if value in {
        "QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "CB", "S", "K"
    } else "OTHER")


def normalize_team(team: str) -> str:
    value = (team or "").strip().upper()
    return TEAM_ALIASES.get(value, value)
