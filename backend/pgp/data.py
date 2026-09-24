from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable, Mapping, Optional

from parallel_models.nflverse_pbp import DriveSummary, drive_summary_path
from parallel_models.pbp_features import drive_summary_from_row

from .schema import PGPGame


DEFAULT_GAMES_PATH = Path(__file__).resolve().parents[1] / "data" / "nfl_games.csv"
DEFAULT_DRIVE_SUMMARIES_PATH = drive_summary_path()


def load_games(path: Path = DEFAULT_GAMES_PATH) -> list[PGPGame]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        return [game_from_row(row) for row in csv.DictReader(source)]


def game_from_row(row: Mapping[str, object]) -> PGPGame:
    return PGPGame(
        game_id=str(row.get("game_id") or ""),
        season=_int(row.get("season")),
        week=_int(row.get("week")),
        game_type=str(row.get("game_type") or "").upper(),
        away_team=str(row.get("away_team") or "").upper(),
        home_team=str(row.get("home_team") or "").upper(),
        away_score=_optional_int(row.get("away_score")),
        home_score=_optional_int(row.get("home_score")),
        gameday=str(row.get("gameday") or ""),
        gametime=str(row.get("gametime") or ""),
    )


def completed_games(games: Iterable[PGPGame], *, game_type: str = "REG") -> list[PGPGame]:
    desired = game_type.upper()
    return sorted(
        [
            game
            for game in games
            if game.game_type == desired and game.home_score is not None and game.away_score is not None
        ],
        key=game_order_key,
    )


def load_drive_summaries(path: Path = DEFAULT_DRIVE_SUMMARIES_PATH) -> list[DriveSummary]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        return [drive_summary_from_row(row) for row in csv.DictReader(source)]


def games_before(target: PGPGame, games: Iterable[PGPGame], *, game_type: str = "REG") -> list[PGPGame]:
    target_key = game_order_key(target)
    return [game for game in completed_games(games, game_type=game_type) if game_order_key(game) < target_key]


def game_order_key(game: PGPGame) -> tuple:
    return (
        int(game.season),
        int(game.week),
        game.gameday or "",
        game.gametime or "",
        game.game_id,
    )


def _optional_int(value: object) -> Optional[int]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def _int(value: object) -> int:
    result = _optional_int(value)
    return result if result is not None else 0
