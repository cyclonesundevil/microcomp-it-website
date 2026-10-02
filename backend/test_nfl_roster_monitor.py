import json

import pytest

import nfl_roster_monitor as roster


def test_parse_official_injury_report_rows_identifies_qb_out():
    content = """
Player | Position | Injury | Wed | Thu | Fri | Game Status
--- | --- | --- | --- | --- | --- | ---
Baker Mayfield | QB | Right Thumb | DNP | DNP |  | OUT
Chris Godwin Jr. | WR | Ankle | DNP | FP |  | UNSPECIFIED
"""

    observations = roster.parse_official_injury_report(
        content,
        "TB",
        "https://www.buccaneers.com/team/injury-report/week/4",
        observed_at="2026-10-02T12:00:00Z",
    )

    baker = next(row for row in observations if row.player == "Baker Mayfield")
    assert baker.team == "TB"
    assert baker.position == "QB"
    assert baker.practice_status == "DNP"
    assert baker.injury_status == "OUT"
    assert baker.expected_role == "qb_unavailable"
    assert baker.confidence == "high"


def test_parse_official_transaction_news_observations():
    content = """
    The Buccaneers placed WR Jalen McMillan on injured reserve.
    Tampa Bay added quarterback Brett Rypien to the practice squad.
    The club promoted safety Ifeatu Melifonwu to the active roster.
    With Mayfield out, the Buccaneers will start rookie Jalon Daniels at quarterback.
    """

    observations = roster.parse_official_transaction_text(
        content,
        "TB",
        "https://www.buccaneers.com/news/roster-moves",
        observed_at="2026-09-30T16:29:00Z",
    )
    by_player = {row.player: row for row in observations}

    assert by_player["Jalen McMillan"].roster_status == "injured_reserve"
    assert by_player["Brett Rypien"].roster_status == "practice_squad"
    assert by_player["Brett Rypien"].position == "QB"
    assert by_player["Ifeatu Melifonwu"].roster_status == "active"
    assert by_player["Ifeatu Melifonwu"].position == "S"
    assert by_player["Jalon Daniels"].expected_role == "projected_starter"


def test_roster_snapshot_diff_creates_high_impact_events():
    previous = {
        "observations": [{
            "team": "TB",
            "player": "Bucky Irving",
            "position": "RB",
            "practice_status": "LP",
            "source_type": "official_injury_report",
        }]
    }
    current = [
        {
            "team": "TB",
            "player": "Baker Mayfield",
            "position": "QB",
            "roster_status": "active",
            "injury_status": "Right Thumb",
            "practice_status": "DNP",
            "expected_role": "qb_unavailable",
            "source_type": "official_injury_report",
            "confidence": "high",
        },
        {
            "team": "TB",
            "player": "Bucky Irving",
            "position": "RB",
            "practice_status": "DNP",
            "source_type": "official_injury_report",
            "confidence": "high",
        },
        {
            "team": "TB",
            "player": "Jalen McMillan",
            "position": "WR",
            "roster_status": "injured_reserve",
            "source_type": "official_transaction",
            "confidence": "high",
        },
    ]

    events = roster.diff_roster_snapshots(previous, current)
    event_types = {event.event_type for event in events}

    assert "QB1_OUT" in event_types
    assert "LIMITED_TO_DNP" in event_types
    assert "PLAYER_TO_IR" in event_types


def test_roster_context_cache_reuses_fresh_snapshot(tmp_path, monkeypatch):
    calls = {"count": 0}

    class Provider(roster.RosterProvider):
        source_type = "test_provider"

        def observations(self):
            calls["count"] += 1
            return [
                roster.RosterObservation(
                    team="TB",
                    player="Baker Mayfield",
                    position="QB",
                    practice_status="DNP",
                    expected_role="qb_unavailable",
                    source_type="official_injury_report",
                    confidence="high",
                )
            ]

    monkeypatch.setattr(roster, "roster_cache_root", lambda: tmp_path)
    first = roster.roster_context_for_teams(["TB"], providers=[Provider()])
    second = roster.roster_context_for_teams(["TB"], providers=[Provider()])

    assert calls["count"] == 1
    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    assert second["events"][0]["event_type"] == "QB1_OUT"


def test_matchup_prediction_metadata_can_include_roster_context_shape():
    context = {
        "teams": ["GB", "TB"],
        "events": [{
            "event_type": "QB1_OUT",
            "team": "TB",
            "player": "Baker Mayfield",
            "position": "QB",
            "description": "TB QB Baker Mayfield is unavailable or did not practice.",
            "source_type": "official_injury_report",
            "confidence": "high",
        }],
        "summary": ["TB QB Baker Mayfield is unavailable or did not practice. Source: official_injury_report; confidence: high."],
    }
    payload = {"prediction": {"model": "current_season_matrix", "roster_context": context}}

    encoded = json.loads(json.dumps(payload))
    assert encoded["prediction"]["roster_context"]["events"][0]["event_type"] == "QB1_OUT"
    assert "Baker Mayfield" in encoded["prediction"]["roster_context"]["summary"][0]
