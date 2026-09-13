import csv
import hashlib
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from .config import normalize_team
from .schema import Game


NFLVERSE_BASE = "https://github.com/nflverse/nflverse-data/releases/download"
SOURCE_URLS = {
    "players": NFLVERSE_BASE + "/players/players.csv",
    "roster": NFLVERSE_BASE + "/rosters/roster_{season}.csv",
    "weekly_roster": NFLVERSE_BASE + "/weekly_rosters/roster_weekly_{season}.csv",
    "depth": NFLVERSE_BASE + "/depth_charts/depth_charts_{season}.csv",
    "stats": NFLVERSE_BASE + "/stats_player/stats_player_week_{season}.csv",
    "snaps": NFLVERSE_BASE + "/snap_counts/snap_counts_{season}.csv",
}
SCHEDULES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[1] / "data" / "rsm"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download_file(url: str, destination: Path, refresh: bool = False) -> dict:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if refresh or not destination.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "microcomp-rsm/0.1"})
        with urllib.request.urlopen(request, timeout=120) as response:
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
                temporary_path = Path(temporary.name)
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    temporary.write(block)
        os.replace(temporary_path, destination)
    return {
        "source": url,
        "path": str(destination),
        "retrieved_at": _utc_now(),
        "bytes": destination.stat().st_size,
        "sha256": _sha256(destination),
    }


def update_sources(
    season: int,
    history_seasons: int = 5,
    data_root: Path = DEFAULT_DATA_ROOT,
    refresh: bool = False,
) -> dict:
    raw_root = data_root / "raw"
    first_season = season - history_seasons + 1
    manifest = {
        "schema_version": 1,
        "created_at": _utc_now(),
        "season": season,
        "history_seasons": history_seasons,
        "files": {},
    }
    requested = [("players", None), ("roster", season), ("depth", season)]
    requested += [(kind, year) for year in range(first_season, season + 1) for kind in ("stats", "snaps")]
    for kind, year in requested:
        url = SOURCE_URLS[kind].format(season=year)
        destination = raw_root / ("players.csv" if year is None else f"{kind}_{year}.csv")
        try:
            key = kind if year is None else f"{kind}_{year}"
            manifest["files"][key] = download_file(url, destination, refresh=refresh)
        except urllib.error.HTTPError as error:
            if error.code == 404 and kind == "snaps":
                manifest["files"][f"{kind}_{year}"] = {
                    "source": url,
                    "missing": True,
                    "reason": "source_not_published",
                }
                continue
            raise
    manifest_path = data_root / "source-manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def read_csv(path: Path) -> Iterable[dict]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        yield from csv.DictReader(source)


def load_current_roster(path: Path) -> List[dict]:
    rows = list(read_csv(path))
    latest_week = max(int(row.get("week") or 0) for row in rows)
    latest = [row for row in rows if int(row.get("week") or 0) == latest_week]
    for row in latest:
        row["team"] = normalize_team(row.get("team", ""))
    return latest


def load_roster_snapshot(path: Path, week: int) -> List[dict]:
    """Return the latest roster identity snapshot at or before a target week."""
    return load_roster_snapshot_rows(read_csv(path), week)


def load_roster_snapshot_rows(rows: Iterable[dict], week: int) -> List[dict]:
    """Select one week from an already-loaded weekly-roster dataset."""
    rows = list(rows)
    available_weeks = sorted({int(row.get("week") or 0) for row in rows if int(row.get("week") or 0) <= week})
    if not available_weeks:
        raise ValueError(f"No roster snapshot exists at or before week {week}")
    snapshot_week = available_weeks[-1]
    result = [dict(row) for row in rows if int(row.get("week") or 0) == snapshot_week]
    for row in result:
        row["team"] = normalize_team(row.get("team", ""))
    return result


def _optional_float(value: object) -> Optional[float]:
    try:
        text = str(value).strip()
        return float(text) if text else None
    except (TypeError, ValueError):
        return None


def load_games(path: Path, seasons: Iterable[int]) -> List[Game]:
    selected = set(seasons)
    games = []
    for row in read_csv(path):
        season = int(row.get("season") or 0)
        if season not in selected:
            continue
        home_score = _optional_float(row.get("home_score"))
        away_score = _optional_float(row.get("away_score"))
        if home_score is None or away_score is None:
            continue
        games.append(Game(
            game_id=row.get("game_id") or "",
            season=season,
            week=int(row.get("week") or 0),
            game_type=row.get("game_type") or "",
            home_team=normalize_team(row.get("home_team", "")),
            away_team=normalize_team(row.get("away_team", "")),
            home_score=home_score,
            away_score=away_score,
            market_spread=_optional_float(row.get("spread_line")),
            market_total=_optional_float(row.get("total_line")),
            spread_source="nflverse closing consensus",
            total_source="nflverse closing consensus",
            spread_timestamp=None,
        ))
    return sorted(games, key=lambda game: (game.season, game.week, game.game_id))


def enrich_roster_ids(roster_rows: Iterable[dict], players_path: Path) -> List[dict]:
    players = {
        (row.get("gsis_id") or "").strip(): row
        for row in read_csv(players_path)
        if (row.get("gsis_id") or "").strip()
    }
    enriched = []
    for original in roster_rows:
        row = dict(original)
        player = players.get((row.get("gsis_id") or "").strip(), {})
        for field in ("pfr_id", "pff_id", "espn_id", "birth_date"):
            if not (row.get(field) or "").strip():
                row[field] = player.get(field) or ""
        enriched.append(row)
    return enriched


def load_latest_depth_chart(path: Path, as_of: Optional[str] = None) -> Tuple[str, List[dict]]:
    timestamps = {
        row.get("dt", "")
        for row in read_csv(path)
        if row.get("dt") and (as_of is None or row["dt"] <= as_of)
    }
    if not timestamps:
        raise ValueError("No depth-chart snapshot exists at or before the requested timestamp")
    timestamp = max(timestamps)
    rows = [row for row in read_csv(path) if row.get("dt") == timestamp]
    for row in rows:
        row["team"] = normalize_team(row.get("team", ""))
    return timestamp, rows


def load_player_stats(
    paths: Iterable[Path],
    cutoff_season: int,
    cutoff_week: int,
    season_type: str = "REG",
) -> List[dict]:
    rows = []
    for path in paths:
        if not path.exists():
            continue
        for row in read_csv(path):
            season = int(row.get("season") or 0)
            week = int(row.get("week") or 0)
            if row.get("season_type") != season_type:
                continue
            if season > cutoff_season or (season == cutoff_season and week >= cutoff_week):
                continue
            row["team"] = normalize_team(row.get("team", ""))
            row["opponent_team"] = normalize_team(row.get("opponent_team", ""))
            rows.append(row)
    return rows


def load_snap_counts(
    paths: Iterable[Path],
    cutoff_season: int,
    cutoff_week: int,
    game_type: str = "REG",
) -> List[dict]:
    rows = []
    for path in paths:
        if not path.exists():
            continue
        for row in read_csv(path):
            season = int(row.get("season") or 0)
            week = int(row.get("week") or 0)
            if row.get("game_type") != game_type:
                continue
            if season > cutoff_season or (season == cutoff_season and week >= cutoff_week):
                continue
            row["team"] = normalize_team(row.get("team", ""))
            rows.append(row)
    return rows


def source_paths(season: int, history_seasons: int, data_root: Path = DEFAULT_DATA_ROOT) -> Dict[str, object]:
    years = range(season - history_seasons + 1, season + 1)
    raw = data_root / "raw"
    return {
        "players": raw / "players.csv",
        "roster": raw / f"roster_{season}.csv",
        "depth": raw / f"depth_{season}.csv",
        "stats": [raw / f"stats_{year}.csv" for year in years],
        "snaps": [raw / f"snaps_{year}.csv" for year in years],
    }


def update_backtest_sources(
    seasons: Iterable[int],
    history_seasons: int = 5,
    data_root: Path = DEFAULT_DATA_ROOT,
    refresh: bool = False,
) -> dict:
    """Fetch inputs needed for point-in-time reconstruction over target seasons."""
    targets = sorted(set(seasons))
    if not targets:
        raise ValueError("At least one target season is required")
    first_history = min(targets) - history_seasons + 1
    last_target = max(targets)
    raw_root = data_root / "raw"
    manifest = {
        "schema_version": 1,
        "created_at": _utc_now(),
        "target_seasons": targets,
        "history_seasons": history_seasons,
        "files": {},
    }
    requests = [("players", None)]
    requests += [("weekly_roster", year) for year in targets]
    requests += [
        (kind, year)
        for year in range(first_history, last_target + 1)
        for kind in ("stats", "snaps")
    ]
    for kind, year in requests:
        url = SOURCE_URLS[kind].format(season=year)
        destination = raw_root / ("players.csv" if year is None else f"{kind}_{year}.csv")
        key = kind if year is None else f"{kind}_{year}"
        try:
            manifest["files"][key] = download_file(url, destination, refresh=refresh)
        except urllib.error.HTTPError as error:
            if error.code == 404 and kind == "snaps":
                manifest["files"][key] = {"source": url, "missing": True, "reason": "source_not_published"}
                continue
            raise
    manifest["files"]["games"] = download_file(
        SCHEDULES_URL, data_root.parent / "nfl_games.csv", refresh=refresh,
    )
    manifest_path = data_root / "backtest-source-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
