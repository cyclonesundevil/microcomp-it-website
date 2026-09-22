from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Optional

from .interface import NFLGameContext
from .nflverse_pbp import DriveSummary, drive_summary_path


DEFAULT_LEAGUE_EPA_PER_DRIVE = 0.0
DEFAULT_LEAGUE_POINTS_PER_DRIVE = 1.9


@dataclass(frozen=True)
class TeamDriveStats:
    team: str
    offensive_drives: int
    defensive_drives: int
    offensive_epa_per_drive: float
    defensive_epa_allowed_per_drive: float
    offensive_points_per_drive: float
    defensive_points_allowed_per_drive: float
    offensive_red_zone_entry_rate: float
    defensive_red_zone_entry_rate_allowed: float


@dataclass(frozen=True)
class MatchupPBPFeatures:
    home_team: str
    away_team: str
    sample_drives: int
    home_offensive_epa_per_drive: float
    away_offensive_epa_per_drive: float
    home_defensive_epa_allowed_per_drive: float
    away_defensive_epa_allowed_per_drive: float
    home_offensive_points_per_drive: float
    away_offensive_points_per_drive: float
    home_defensive_points_allowed_per_drive: float
    away_defensive_points_allowed_per_drive: float
    home_red_zone_entry_rate: float
    away_red_zone_entry_rate: float
    home_red_zone_entry_rate_allowed: float
    away_red_zone_entry_rate_allowed: float

    @property
    def dsm_margin_signal(self) -> float:
        """Drive-success margin signal, positive for home team."""
        offensive_edge = self.home_offensive_epa_per_drive - self.away_offensive_epa_per_drive
        defensive_edge = self.away_defensive_epa_allowed_per_drive - self.home_defensive_epa_allowed_per_drive
        return offensive_edge + defensive_edge

    @property
    def prm_total_signal(self) -> float:
        """EPA/drive total signal before any future model calibration."""
        home_expected = (self.home_offensive_points_per_drive + self.away_defensive_points_allowed_per_drive) / 2
        away_expected = (self.away_offensive_points_per_drive + self.home_defensive_points_allowed_per_drive) / 2
        return home_expected + away_expected


def load_drive_summaries(path: Path = drive_summary_path()) -> list[DriveSummary]:
    with path.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    return [drive_summary_from_row(row) for row in rows]


def drive_summary_from_row(row: Mapping[str, object]) -> DriveSummary:
    return DriveSummary(
        game_id=str(row.get("game_id") or ""),
        season=_int(row.get("season")),
        season_type=str(row.get("season_type") or "").upper(),
        week=_int(row.get("week")),
        drive=str(row.get("drive") or ""),
        offense=str(row.get("offense") or "").upper(),
        defense=str(row.get("defense") or "").upper(),
        plays=_int(row.get("plays")),
        epa=_float(row.get("epa")),
        points=_float(row.get("points")),
        result=str(row.get("result") or "").upper(),
        start_yardline_100=_optional_float(row.get("start_yardline_100")),
        red_zone_entry=_bool(row.get("red_zone_entry")),
    )


def filter_drives_before_game(
    summaries: Iterable[DriveSummary],
    game_context: NFLGameContext,
    *,
    include_prior_seasons: bool = True,
    season_type: str = "REG",
) -> list[DriveSummary]:
    """Return drive summaries available before the target game.

    The conservative default excludes all games in the target week because the
    common app context does not always include kickoff ordering within a week.
    If a caller needs same-week Thursday-to-Sunday ordering later, it should
    pass a richer schedule-aware filter instead of loosening this function.
    """
    if game_context.season is None or game_context.week is None:
        raise ValueError("game_context.season and game_context.week are required for pregame PBP features")
    target_season = int(game_context.season)
    target_week = int(game_context.week)
    desired_type = season_type.upper()
    result = []
    for summary in summaries:
        if desired_type and summary.season_type and summary.season_type != desired_type:
            continue
        if summary.season < target_season and include_prior_seasons:
            result.append(summary)
        elif summary.season == target_season and summary.week < target_week:
            result.append(summary)
    return result


def aggregate_team_drive_stats(
    summaries: Iterable[DriveSummary],
    *,
    teams: Optional[Iterable[str]] = None,
) -> dict[str, TeamDriveStats]:
    selected = {team.upper() for team in teams} if teams is not None else None
    raw: dict[str, dict[str, float]] = {}
    league_off_epa = []
    league_off_points = []

    for summary in summaries:
        offense = summary.offense.upper()
        defense = summary.defense.upper()
        if offense:
            league_off_epa.append(summary.epa)
            league_off_points.append(summary.points)
        for team in (offense, defense):
            if team and (selected is None or team in selected):
                raw.setdefault(team, _empty_raw_stats())
        if offense and (selected is None or offense in selected):
            item = raw.setdefault(offense, _empty_raw_stats())
            item["offensive_drives"] += 1
            item["offensive_epa"] += summary.epa
            item["offensive_points"] += summary.points
            item["offensive_red_zone_entries"] += 1 if summary.red_zone_entry else 0
        if defense and (selected is None or defense in selected):
            item = raw.setdefault(defense, _empty_raw_stats())
            item["defensive_drives"] += 1
            item["defensive_epa_allowed"] += summary.epa
            item["defensive_points_allowed"] += summary.points
            item["defensive_red_zone_entries_allowed"] += 1 if summary.red_zone_entry else 0

    league_epa = _mean(league_off_epa, DEFAULT_LEAGUE_EPA_PER_DRIVE)
    league_points = _mean(league_off_points, DEFAULT_LEAGUE_POINTS_PER_DRIVE)
    output = {}
    for team, item in raw.items():
        output[team] = TeamDriveStats(
            team=team,
            offensive_drives=int(item["offensive_drives"]),
            defensive_drives=int(item["defensive_drives"]),
            offensive_epa_per_drive=_safe_rate(item["offensive_epa"], item["offensive_drives"], league_epa),
            defensive_epa_allowed_per_drive=_safe_rate(item["defensive_epa_allowed"], item["defensive_drives"], league_epa),
            offensive_points_per_drive=_safe_rate(item["offensive_points"], item["offensive_drives"], league_points),
            defensive_points_allowed_per_drive=_safe_rate(item["defensive_points_allowed"], item["defensive_drives"], league_points),
            offensive_red_zone_entry_rate=_safe_rate(item["offensive_red_zone_entries"], item["offensive_drives"], 0.0),
            defensive_red_zone_entry_rate_allowed=_safe_rate(item["defensive_red_zone_entries_allowed"], item["defensive_drives"], 0.0),
        )
    return output


def build_matchup_pbp_features(
    game_context: NFLGameContext,
    summaries: Iterable[DriveSummary],
    *,
    season_type: str = "REG",
) -> MatchupPBPFeatures:
    history = filter_drives_before_game(summaries, game_context, season_type=season_type)
    home = game_context.home_team.upper()
    away = game_context.away_team.upper()
    stats = aggregate_team_drive_stats(history, teams=[home, away])
    league = aggregate_team_drive_stats(history)
    fallback = _league_fallback(league)
    home_stats = stats.get(home) or fallback
    away_stats = stats.get(away) or fallback
    return MatchupPBPFeatures(
        home_team=home,
        away_team=away,
        sample_drives=sum(item.offensive_drives for item in stats.values()),
        home_offensive_epa_per_drive=home_stats.offensive_epa_per_drive,
        away_offensive_epa_per_drive=away_stats.offensive_epa_per_drive,
        home_defensive_epa_allowed_per_drive=home_stats.defensive_epa_allowed_per_drive,
        away_defensive_epa_allowed_per_drive=away_stats.defensive_epa_allowed_per_drive,
        home_offensive_points_per_drive=home_stats.offensive_points_per_drive,
        away_offensive_points_per_drive=away_stats.offensive_points_per_drive,
        home_defensive_points_allowed_per_drive=home_stats.defensive_points_allowed_per_drive,
        away_defensive_points_allowed_per_drive=away_stats.defensive_points_allowed_per_drive,
        home_red_zone_entry_rate=home_stats.offensive_red_zone_entry_rate,
        away_red_zone_entry_rate=away_stats.offensive_red_zone_entry_rate,
        home_red_zone_entry_rate_allowed=home_stats.defensive_red_zone_entry_rate_allowed,
        away_red_zone_entry_rate_allowed=away_stats.defensive_red_zone_entry_rate_allowed,
    )


def _empty_raw_stats() -> dict[str, float]:
    return {
        "offensive_drives": 0.0,
        "defensive_drives": 0.0,
        "offensive_epa": 0.0,
        "defensive_epa_allowed": 0.0,
        "offensive_points": 0.0,
        "defensive_points_allowed": 0.0,
        "offensive_red_zone_entries": 0.0,
        "defensive_red_zone_entries_allowed": 0.0,
    }


def _league_fallback(league: Mapping[str, TeamDriveStats]) -> TeamDriveStats:
    if not league:
        return TeamDriveStats(
            team="LEAGUE",
            offensive_drives=0,
            defensive_drives=0,
            offensive_epa_per_drive=DEFAULT_LEAGUE_EPA_PER_DRIVE,
            defensive_epa_allowed_per_drive=DEFAULT_LEAGUE_EPA_PER_DRIVE,
            offensive_points_per_drive=DEFAULT_LEAGUE_POINTS_PER_DRIVE,
            defensive_points_allowed_per_drive=DEFAULT_LEAGUE_POINTS_PER_DRIVE,
            offensive_red_zone_entry_rate=0.0,
            defensive_red_zone_entry_rate_allowed=0.0,
        )
    return TeamDriveStats(
        team="LEAGUE",
        offensive_drives=sum(item.offensive_drives for item in league.values()),
        defensive_drives=sum(item.defensive_drives for item in league.values()),
        offensive_epa_per_drive=_mean([item.offensive_epa_per_drive for item in league.values()], DEFAULT_LEAGUE_EPA_PER_DRIVE),
        defensive_epa_allowed_per_drive=_mean([item.defensive_epa_allowed_per_drive for item in league.values()], DEFAULT_LEAGUE_EPA_PER_DRIVE),
        offensive_points_per_drive=_mean([item.offensive_points_per_drive for item in league.values()], DEFAULT_LEAGUE_POINTS_PER_DRIVE),
        defensive_points_allowed_per_drive=_mean([item.defensive_points_allowed_per_drive for item in league.values()], DEFAULT_LEAGUE_POINTS_PER_DRIVE),
        offensive_red_zone_entry_rate=_mean([item.offensive_red_zone_entry_rate for item in league.values()], 0.0),
        defensive_red_zone_entry_rate_allowed=_mean([item.defensive_red_zone_entry_rate_allowed for item in league.values()], 0.0),
    )


def _safe_rate(numerator: float, denominator: float, default: float) -> float:
    return float(numerator) / float(denominator) if denominator else float(default)


def _mean(values: Iterable[float], default: float) -> float:
    values = list(values)
    return sum(values) / len(values) if values else default


def _int(value: object) -> int:
    try:
        text = str(value or "").strip()
        return int(float(text)) if text else 0
    except (TypeError, ValueError):
        return 0


def _float(value: object) -> float:
    try:
        text = str(value or "").strip()
        return float(text) if text else 0.0
    except (TypeError, ValueError):
        return 0.0


def _optional_float(value: object) -> Optional[float]:
    try:
        text = str(value or "").strip()
        return float(text) if text else None
    except (TypeError, ValueError):
        return None


def _bool(value: object) -> bool:
    text = str(value or "").strip().lower()
    return text in {"1", "true", "t", "yes", "y"}
