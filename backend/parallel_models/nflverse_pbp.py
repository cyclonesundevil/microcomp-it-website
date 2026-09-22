from __future__ import annotations

import csv
import hashlib
import json
import os
import tempfile
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Mapping, Optional, Sequence


NFLVERSE_DATA_RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download"
PBP_RELEASE_URL_TEMPLATE = NFLVERSE_DATA_RELEASE_BASE + "/pbp/play_by_play_{season}.csv"
DEFAULT_PARALLEL_DATA_ROOT = Path(__file__).resolve().parents[1] / "data" / "parallel_models"
PBP_MANIFEST_SCHEMA_VERSION = 1
DRIVE_SUMMARY_SCHEMA_VERSION = 1
REQUIRED_PBP_FIELDS = frozenset({
    "game_id",
    "season",
    "week",
    "drive",
    "posteam",
    "defteam",
    "epa",
    "yardline_100",
})
DRIVE_SUMMARY_FIELDS = (
    "game_id",
    "season",
    "week",
    "drive",
    "offense",
    "defense",
    "plays",
    "epa",
    "points",
    "result",
    "start_yardline_100",
    "red_zone_entry",
)


@dataclass(frozen=True)
class DriveSummary:
    game_id: str
    season: int
    week: int
    drive: str
    offense: str
    defense: str
    plays: int
    epa: float
    points: float
    result: str
    start_yardline_100: Optional[float]
    red_zone_entry: bool


def pbp_path(season: int, data_root: Path = DEFAULT_PARALLEL_DATA_ROOT) -> Path:
    return data_root / "raw" / "pbp" / f"play_by_play_{season}.csv"


def pbp_manifest_path(data_root: Path = DEFAULT_PARALLEL_DATA_ROOT) -> Path:
    return data_root / "pbp-source-manifest.json"


def drive_summary_path(data_root: Path = DEFAULT_PARALLEL_DATA_ROOT) -> Path:
    return data_root / "derived" / "drive_summaries.csv"


def drive_summary_manifest_path(data_root: Path = DEFAULT_PARALLEL_DATA_ROOT) -> Path:
    return data_root / "derived" / "drive-summary-manifest.json"


def pbp_url(season: int) -> str:
    return PBP_RELEASE_URL_TEMPLATE.format(season=int(season))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_pbp_season(season: int, data_root: Path = DEFAULT_PARALLEL_DATA_ROOT, refresh: bool = False) -> dict:
    """Download one nflverse play-by-play CSV into the research data root.

    This function is not called by tests.  It is intentionally explicit because
    nflverse PBP files are large and should not be fetched during normal page
    requests or production model display.
    """
    destination = pbp_path(season, data_root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    url = pbp_url(season)
    if refresh or not destination.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "microcomp-parallel-nfl/0.1"})
        with urllib.request.urlopen(request, timeout=180) as response:
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
                temporary_path = Path(temporary.name)
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    temporary.write(block)
        os.replace(temporary_path, destination)
    return {
        "season": int(season),
        "source": url,
        "path": str(destination),
        "retrieved_at": _utc_now(),
        "bytes": destination.stat().st_size,
        "sha256": _sha256(destination),
    }


def update_pbp_sources(seasons: Sequence[int], data_root: Path = DEFAULT_PARALLEL_DATA_ROOT, refresh: bool = False) -> dict:
    manifest = {
        "schema_version": PBP_MANIFEST_SCHEMA_VERSION,
        "created_at": _utc_now(),
        "source_family": "nflverse play-by-play",
        "url_template": PBP_RELEASE_URL_TEMPLATE,
        "seasons": [int(season) for season in seasons],
        "files": {},
    }
    for season in seasons:
        manifest["files"][str(int(season))] = download_pbp_season(int(season), data_root, refresh=refresh)
    path = pbp_manifest_path(data_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def read_pbp_rows(paths: Iterable[Path]) -> Iterator[dict]:
    for path in paths:
        with path.open(newline="", encoding="utf-8-sig") as source:
            yield from csv.DictReader(source)


def pbp_paths_for_seasons(seasons: Iterable[int], data_root: Path = DEFAULT_PARALLEL_DATA_ROOT) -> list[Path]:
    return [pbp_path(int(season), data_root) for season in seasons]


def inspect_pbp_schema(paths: Iterable[Path], required_fields: frozenset[str] = REQUIRED_PBP_FIELDS) -> dict:
    files = []
    combined_fields: set[str] = set()
    for path in paths:
        with path.open(newline="", encoding="utf-8-sig") as source:
            reader = csv.DictReader(source)
            fields = list(reader.fieldnames or [])
        field_set = set(fields)
        combined_fields.update(field_set)
        files.append({
            "path": str(path),
            "field_count": len(fields),
            "fields": fields,
            "missing_required": sorted(required_fields - field_set),
            "sha256": _sha256(path),
            "bytes": path.stat().st_size,
        })
    return {
        "schema_version": PBP_MANIFEST_SCHEMA_VERSION,
        "inspected_at": _utc_now(),
        "required_fields": sorted(required_fields),
        "files": files,
        "combined_missing_required": sorted(required_fields - combined_fields),
    }


def validate_pbp_schema(paths: Iterable[Path], required_fields: frozenset[str] = REQUIRED_PBP_FIELDS) -> dict:
    inspection = inspect_pbp_schema(paths, required_fields)
    missing = {
        item["path"]: item["missing_required"]
        for item in inspection["files"]
        if item["missing_required"]
    }
    if missing:
        raise ValueError(f"PBP files are missing required fields: {missing}")
    return inspection


def _float_or_none(value: object) -> Optional[float]:
    try:
        text = str(value or "").strip()
        return float(text) if text else None
    except (TypeError, ValueError):
        return None


def _int_or_none(value: object) -> Optional[int]:
    try:
        text = str(value or "").strip()
        return int(float(text)) if text else None
    except (TypeError, ValueError):
        return None


def game_order_key(game: Mapping[str, object]) -> tuple:
    return (
        _int_or_none(game.get("season")) or 0,
        _int_or_none(game.get("week")) or 0,
        str(game.get("gameday") or ""),
        str(game.get("gametime") or ""),
        str(game.get("game_id") or ""),
    )


def build_game_order(games: Iterable[Mapping[str, object]]) -> dict[str, tuple]:
    return {
        str(game["game_id"]): game_order_key(game)
        for game in games
        if game.get("game_id")
    }


def filter_pbp_strictly_before_game(
    rows: Iterable[dict],
    target_game: Mapping[str, object],
    game_order: Mapping[str, tuple],
) -> Iterator[dict]:
    """Yield only plays from games ordered strictly before the target game."""
    target_key = game_order.get(str(target_game.get("game_id"))) or game_order_key(target_game)
    for row in rows:
        game_id = str(row.get("game_id") or "")
        row_key = game_order.get(game_id)
        if row_key is None:
            row_key = game_order_key(row)
        if row_key < target_key:
            yield row


def derive_drive_summaries(rows: Iterable[dict]) -> list[DriveSummary]:
    grouped: dict[tuple[str, str, str], list[dict]] = {}
    for row in rows:
        game_id = str(row.get("game_id") or "")
        drive = str(row.get("drive") or "")
        offense = str(row.get("posteam") or row.get("possession_team") or "").upper()
        if not game_id or not drive or not offense:
            continue
        grouped.setdefault((game_id, drive, offense), []).append(row)

    summaries = []
    for (game_id, drive, offense), plays in grouped.items():
        first = plays[0]
        defense = str(first.get("defteam") or "").upper()
        epa = sum(_float_or_none(play.get("epa")) or 0.0 for play in plays)
        points = _drive_points(plays)
        result = _drive_result(plays, points)
        start_yardline = _float_or_none(first.get("yardline_100") or first.get("drive_start_yard_line"))
        red_zone_entry = any((_float_or_none(play.get("yardline_100")) or 100.0) <= 20.0 for play in plays)
        summaries.append(DriveSummary(
            game_id=game_id,
            season=_int_or_none(first.get("season")) or 0,
            week=_int_or_none(first.get("week")) or 0,
            drive=drive,
            offense=offense,
            defense=defense,
            plays=len(plays),
            epa=epa,
            points=points,
            result=result,
            start_yardline_100=start_yardline,
            red_zone_entry=red_zone_entry,
        ))
    return sorted(summaries, key=lambda drive: (drive.season, drive.week, drive.game_id, int(drive.drive) if drive.drive.isdigit() else drive.drive, drive.offense))


def write_drive_summaries(
    pbp_paths: Iterable[Path],
    output_path: Path,
    manifest_path: Optional[Path] = None,
) -> dict:
    paths = list(pbp_paths)
    schema = validate_pbp_schema(paths)
    summaries = derive_drive_summaries(read_pbp_rows(paths))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=list(DRIVE_SUMMARY_FIELDS))
        writer.writeheader()
        for summary in summaries:
            writer.writerow(asdict(summary))
    manifest = {
        "schema_version": DRIVE_SUMMARY_SCHEMA_VERSION,
        "created_at": _utc_now(),
        "source_family": "nflverse play-by-play",
        "source_files": [
            {
                "path": str(path),
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
            for path in paths
        ],
        "required_pbp_fields": sorted(REQUIRED_PBP_FIELDS),
        "schema_inspection": schema,
        "drive_summary": {
            "path": str(output_path),
            "rows": len(summaries),
            "bytes": output_path.stat().st_size,
            "sha256": _sha256(output_path),
        },
    }
    if manifest_path is not None:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _drive_points(plays: list[dict]) -> float:
    explicit = [_float_or_none(play.get("drive_points")) for play in plays if _float_or_none(play.get("drive_points")) is not None]
    if explicit:
        return explicit[-1] or 0.0
    touchdowns = sum(1 for play in plays if (_float_or_none(play.get("touchdown")) or 0.0) > 0.0)
    field_goals = sum(1 for play in plays if str(play.get("field_goal_result") or "").lower() == "made")
    safeties_against_offense = sum(1 for play in plays if (_float_or_none(play.get("safety")) or 0.0) > 0.0)
    return 7.0 * touchdowns + 3.0 * field_goals - 2.0 * safeties_against_offense


def _drive_result(plays: list[dict], points: float) -> str:
    values = [
        str(play.get(field) or "").strip().upper()
        for play in plays
        for field in ("fixed_drive_result", "drive_result", "series_result")
        if str(play.get(field) or "").strip()
    ]
    if values:
        return values[-1]
    if points >= 6:
        return "TOUCHDOWN"
    if points == 3:
        return "FIELD_GOAL"
    if any((_float_or_none(play.get("interception")) or 0.0) > 0.0 or (_float_or_none(play.get("fumble_lost")) or 0.0) > 0.0 for play in plays):
        return "TURNOVER"
    if any(str(play.get("punt_result") or "").strip() for play in plays):
        return "PUNT"
    return "UNKNOWN"
