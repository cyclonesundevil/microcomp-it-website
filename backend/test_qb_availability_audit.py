from datetime import datetime
from zoneinfo import ZoneInfo

import json

from qb_availability_audit import apply_ready_availability_adjustments, build_monday_night_roster_audit, build_qb_availability_audit, merge_existing_review_fields


def _schedule_csv(rows):
    header = (
        "game_id,season,week,game_type,away_team,home_team,away_score,home_score,"
        "spread_line,total_line,gameday,gametime,away_rest,home_rest,div_game,roof,temp,wind"
    )
    return header + "\n" + "\n".join(rows) + "\n"


def _FixedDateTime(fixed_now):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return fixed_now.replace(tzinfo=None)
            return fixed_now.astimezone(tz)

    return FixedDateTime


def test_qb_availability_audit_lists_every_upcoming_team(tmp_path, monkeypatch):
    schedule_path = tmp_path / "nfl_games.csv"
    schedule_path.write_text(_schedule_csv([
        "2026_02_CAR_ATL,2026,2,REG,CAR,ATL,,,-2.5,43.5,2026-09-20,13:00,7,7,1,dome,,",
        "2026_02_DAL_NYG,2026,2,REG,DAL,NYG,,,-2.5,45.5,2026-09-20,13:00,7,7,1,outdoors,,",
    ]), encoding="utf-8")
    now = datetime(2026, 9, 20, 8, 0, tzinfo=ZoneInfo("America/Phoenix"))

    monkeypatch.setattr("nfl_predictor.download_games", lambda *args, **kwargs: str(schedule_path))
    monkeypatch.setattr("nfl_predictor.datetime", _FixedDateTime(now))

    report = build_qb_availability_audit()

    assert report["season"] == 2026
    assert report["week"] == 2
    assert {row["team"] for row in report["candidate_overlays"]} == {"CAR", "ATL", "DAL", "NYG"}
    assert all(row["recommended_margin_delta"] == 0.0 for row in report["candidate_overlays"])
    assert all(row["overlay_ready"] is False for row in report["candidate_overlays"])
    assert all(row["confidence"] == "UNREVIEWED" for row in report["candidate_overlays"])


def test_monday_night_roster_audit_lists_only_monday_game_teams(tmp_path, monkeypatch):
    schedule_path = tmp_path / "nfl_games.csv"
    schedule_path.write_text(_schedule_csv([
        "2026_03_LV_NO,2026,3,REG,LV,NO,,,3.0,43.5,2026-09-27,16:25,7,7,0,dome,,",
        "2026_03_PHI_CHI,2026,3,REG,PHI,CHI,,,-3.5,42.5,2026-09-28,20:15,7,7,0,outdoors,58,7",
    ]), encoding="utf-8")
    now = datetime(2026, 9, 28, 10, 0, tzinfo=ZoneInfo("America/Phoenix"))

    monkeypatch.setattr("nfl_predictor.download_games", lambda *args, **kwargs: str(schedule_path))
    monkeypatch.setattr("nfl_predictor.datetime", _FixedDateTime(now))

    report = build_monday_night_roster_audit()

    assert report["audit_type"] == "monday_night_roster_availability"
    assert report["games_reviewed"] == 1
    assert {row["team"] for row in report["candidate_overlays"]} == {"PHI", "CHI"}
    assert all(row["game_id"] == "2026_03_PHI_CHI" for row in report["candidate_overlays"])
    assert all(row["market_recheck_required"] is True for row in report["candidate_overlays"])
    assert all(row["final_inactives_checked"] is False for row in report["candidate_overlays"])


def test_monday_night_roster_audit_handles_week_without_monday_game(tmp_path, monkeypatch):
    schedule_path = tmp_path / "nfl_games.csv"
    schedule_path.write_text(_schedule_csv([
        "2026_04_DAL_NYG,2026,4,REG,DAL,NYG,,,-2.5,45.5,2026-10-04,13:00,7,7,1,outdoors,,",
    ]), encoding="utf-8")
    now = datetime(2026, 10, 4, 8, 0, tzinfo=ZoneInfo("America/Phoenix"))

    monkeypatch.setattr("nfl_predictor.download_games", lambda *args, **kwargs: str(schedule_path))
    monkeypatch.setattr("nfl_predictor.datetime", _FixedDateTime(now))

    report = build_monday_night_roster_audit()

    assert report["games_reviewed"] == 0
    assert report["candidate_overlays"] == []


def test_apply_ready_availability_adjustments_writes_only_approved_nonzero_rows(tmp_path):
    adjustments_path = tmp_path / "availability.json"
    report = {
        "candidate_overlays": [
            {
                "season": 2026,
                "week": 3,
                "game_id": "2026_03_PHI_CHI",
                "team": "CHI",
                "recommended_margin_delta": -4.0,
                "recommended_total_delta": -2.0,
                "overlay_ready": True,
                "source": "Official inactive report",
                "review_notes": "CHI QB downgrade confirmed.",
            },
            {
                "season": 2026,
                "week": 3,
                "game_id": "2026_03_PHI_CHI",
                "team": "PHI",
                "recommended_margin_delta": 2.0,
                "recommended_total_delta": 0.0,
                "overlay_ready": False,
                "source": "Unapproved note",
                "review_notes": "Should not apply.",
            },
        ],
    }

    result = apply_ready_availability_adjustments(report, str(adjustments_path))

    payload = json.loads(adjustments_path.read_text(encoding="utf-8"))
    assert result["ready_adjustments"] == 1
    assert result["inserted"] == 1
    assert len(payload["adjustments"]) == 1
    assert payload["adjustments"][0]["team"] == "CHI"
    assert payload["adjustments"][0]["margin_delta"] == -4.0
    assert payload["adjustments"][0]["total_delta"] == -2.0


def test_apply_ready_availability_adjustments_upserts_existing_row(tmp_path):
    adjustments_path = tmp_path / "availability.json"
    adjustments_path.write_text(json.dumps({
        "schema_version": 1,
        "adjustments": [{
            "season": 2026,
            "week": 3,
            "game_id": "2026_03_PHI_CHI",
            "team": "CHI",
            "margin_delta": -2.0,
            "total_delta": -1.0,
            "label": "Old note",
            "source": "Old source",
        }],
    }), encoding="utf-8")
    report = {
        "candidate_overlays": [{
            "season": 2026,
            "week": 3,
            "game_id": "2026_03_PHI_CHI",
            "team": "CHI",
            "recommended_margin_delta": -4.0,
            "recommended_total_delta": -2.0,
            "overlay_ready": True,
            "source": "Official inactive report",
            "review_notes": "Updated note",
        }],
    }

    result = apply_ready_availability_adjustments(report, str(adjustments_path))

    payload = json.loads(adjustments_path.read_text(encoding="utf-8"))
    assert result["inserted"] == 0
    assert result["updated"] == 1
    assert len(payload["adjustments"]) == 1
    assert payload["adjustments"][0]["label"] == "Updated note"


def test_merge_existing_review_fields_preserves_approved_monday_review():
    generated = {
        "candidate_overlays": [{
            "season": 2026,
            "week": 3,
            "game_id": "2026_03_PHI_CHI",
            "team": "CHI",
            "recommended_margin_delta": 0.0,
            "recommended_total_delta": 0.0,
            "overlay_ready": False,
            "source": None,
            "review_notes": "Human review required before creating an availability overlay.",
        }],
    }
    existing = {
        "candidate_overlays": [{
            "season": 2026,
            "week": 3,
            "game_id": "2026_03_PHI_CHI",
            "team": "CHI",
            "recommended_margin_delta": -4.0,
            "recommended_total_delta": -2.0,
            "overlay_ready": True,
            "source": "Official inactive report",
            "review_notes": "CHI QB downgrade confirmed.",
        }],
    }

    merged = merge_existing_review_fields(generated, existing)

    row = merged["candidate_overlays"][0]
    assert row["overlay_ready"] is True
    assert row["recommended_margin_delta"] == -4.0
    assert row["source"] == "Official inactive report"
