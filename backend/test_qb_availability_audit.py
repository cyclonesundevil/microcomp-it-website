from datetime import datetime
from zoneinfo import ZoneInfo

from qb_availability_audit import build_qb_availability_audit


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
