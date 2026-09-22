import csv
import json
from pathlib import Path

import pytest

from parallel_models.nflverse_pbp import (
    derive_drive_summaries,
    drive_summary_manifest_path,
    drive_summary_path,
    filter_pbp_strictly_before_game,
    inspect_pbp_schema,
    pbp_manifest_path,
    pbp_path,
    pbp_url,
    read_pbp_rows,
    update_pbp_sources,
    validate_pbp_schema,
    write_drive_summaries,
)


def _write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def test_pbp_url_uses_nflverse_release_csv():
    assert pbp_url(2026) == "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv"


def test_update_pbp_sources_writes_manifest_with_fingerprints(monkeypatch, tmp_path):
    def fake_download(season, data_root, refresh=False):
        destination = pbp_path(season, data_root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text("game_id,season,week\nx,2026,1\n", encoding="utf-8")
        return {
            "season": season,
            "source": pbp_url(season),
            "path": str(destination),
            "retrieved_at": "2026-09-21T00:00:00+00:00",
            "bytes": destination.stat().st_size,
            "sha256": "fake-sha",
        }

    monkeypatch.setattr("parallel_models.nflverse_pbp.download_pbp_season", fake_download)

    manifest = update_pbp_sources([2025, 2026], tmp_path)
    stored = json.loads(pbp_manifest_path(tmp_path).read_text(encoding="utf-8"))

    assert manifest["source_family"] == "nflverse play-by-play"
    assert stored["files"]["2025"]["source"].endswith("play_by_play_2025.csv")
    assert stored["files"]["2026"]["sha256"] == "fake-sha"


def test_filter_pbp_strictly_before_game_excludes_target_and_future_games():
    rows = [
        {"game_id": "2026_01_A_B", "season": "2026", "week": "1", "posteam": "A", "drive": "1"},
        {"game_id": "2026_02_C_D", "season": "2026", "week": "2", "posteam": "C", "drive": "1"},
        {"game_id": "2026_03_E_F", "season": "2026", "week": "3", "posteam": "E", "drive": "1"},
    ]
    game_order = {
        "2026_01_A_B": (2026, 1, "2026-09-10", "13:00", "2026_01_A_B"),
        "2026_02_C_D": (2026, 2, "2026-09-17", "13:00", "2026_02_C_D"),
        "2026_03_E_F": (2026, 3, "2026-09-24", "13:00", "2026_03_E_F"),
    }

    filtered = list(filter_pbp_strictly_before_game(rows, {"game_id": "2026_02_C_D"}, game_order))

    assert [row["game_id"] for row in filtered] == ["2026_01_A_B"]


def test_read_pbp_rows_and_derive_drive_summaries(tmp_path):
    path = tmp_path / "play_by_play_2026.csv"
    _write_csv(path, [
        {
            "game_id": "2026_01_A_B",
            "season": "2026",
            "week": "1",
            "drive": "1",
            "posteam": "A",
            "defteam": "B",
            "epa": "0.5",
            "yardline_100": "75",
            "touchdown": "0",
            "field_goal_result": "",
            "fixed_drive_result": "",
            "fumble_lost": "0",
            "interception": "0",
            "punt_result": "",
            "safety": "0",
        },
        {
            "game_id": "2026_01_A_B",
            "season": "2026",
            "week": "1",
            "drive": "1",
            "posteam": "A",
            "defteam": "B",
            "epa": "2.0",
            "yardline_100": "10",
            "touchdown": "1",
            "field_goal_result": "",
            "fixed_drive_result": "Touchdown",
            "fumble_lost": "0",
            "interception": "0",
            "punt_result": "",
            "safety": "0",
        },
    ])

    rows = list(read_pbp_rows([path]))
    drives = derive_drive_summaries(rows)

    assert len(drives) == 1
    drive = drives[0]
    assert drive.game_id == "2026_01_A_B"
    assert drive.offense == "A"
    assert drive.defense == "B"
    assert drive.plays == 2
    assert drive.epa == pytest.approx(2.5)
    assert drive.points == pytest.approx(7.0)
    assert drive.result == "TOUCHDOWN"
    assert drive.start_yardline_100 == pytest.approx(75.0)
    assert drive.red_zone_entry is True


def test_pbp_schema_validation_reports_missing_required_fields(tmp_path):
    path = tmp_path / "bad_play_by_play.csv"
    path.write_text("game_id,season\n2026_01_A_B,2026\n", encoding="utf-8")

    inspection = inspect_pbp_schema([path])

    assert "drive" in inspection["files"][0]["missing_required"]
    assert "posteam" in inspection["combined_missing_required"]
    with pytest.raises(ValueError, match="missing required fields"):
        validate_pbp_schema([path])


def test_write_drive_summaries_persists_csv_and_manifest(tmp_path):
    path = pbp_path(2026, tmp_path)
    _write_csv(path, [
        {
            "game_id": "2026_01_A_B",
            "season": "2026",
            "week": "1",
            "drive": "1",
            "posteam": "A",
            "defteam": "B",
            "epa": "0.5",
            "yardline_100": "75",
            "touchdown": "0",
            "field_goal_result": "",
            "fixed_drive_result": "",
            "fumble_lost": "0",
            "interception": "0",
            "punt_result": "",
            "safety": "0",
        },
        {
            "game_id": "2026_01_A_B",
            "season": "2026",
            "week": "1",
            "drive": "1",
            "posteam": "A",
            "defteam": "B",
            "epa": "2.0",
            "yardline_100": "10",
            "touchdown": "1",
            "field_goal_result": "",
            "fixed_drive_result": "Touchdown",
            "fumble_lost": "0",
            "interception": "0",
            "punt_result": "",
            "safety": "0",
        },
    ])
    output = drive_summary_path(tmp_path)
    manifest_file = drive_summary_manifest_path(tmp_path)

    manifest = write_drive_summaries([path], output, manifest_file)
    rows = list(csv.DictReader(output.open(newline="", encoding="utf-8")))
    stored = json.loads(manifest_file.read_text(encoding="utf-8"))

    assert len(rows) == 1
    assert rows[0]["game_id"] == "2026_01_A_B"
    assert rows[0]["result"] == "TOUCHDOWN"
    assert rows[0]["red_zone_entry"] == "True"
    assert manifest["drive_summary"]["rows"] == 1
    assert stored["drive_summary"]["sha256"] == manifest["drive_summary"]["sha256"]
    assert stored["source_files"][0]["sha256"]
