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


def test_parse_official_injury_report_uses_section_team_when_multiple_clubs_present():
    content = """
<div class="d3-l-col__col-12 nfl-o-injury-report__container">
  <div class="nfl-o-injury-report__title">
    <span class="nfl-o-injury-report__club-name">Indianapolis Colts</span>
  </div>
  <table>
    <tr><th>Player</th><th>Position</th><th>Injury</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Game Status</th></tr>
    <tr><td>Keenan Allen</td><td>WR</td><td>Rest, Groin</td><td>LP</td><td>LP</td><td>DNP</td><td>OUT</td></tr>
  </table>
</div>
<div class="d3-l-col__col-12 nfl-o-injury-report__container">
  <div class="nfl-o-injury-report__title">
    <span class="nfl-o-injury-report__club-name">Washington Commanders</span>
  </div>
  <table>
    <tr><th>Player</th><th>Position</th><th>Injury</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Game Status</th></tr>
    <tr><td>Jayden Daniels</td><td>QB</td><td>Elbow</td><td>LP</td><td>LP</td><td>LP</td><td>OUT</td></tr>
  </table>
</div>
"""

    observations = roster.parse_official_injury_report(
        content,
        "IND",
        "https://www.colts.com/team/injury-report/",
        observed_at="2026-10-04T12:00:00Z",
    )
    by_player = {row.player: row for row in observations}

    assert by_player["Keenan Allen"].team == "IND"
    assert by_player["Jayden Daniels"].team == "WAS"
    assert all(row.team == "IND" for row in observations if row.player == "Keenan Allen")


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


def test_roster_context_ignores_cached_snapshot_from_old_schema(tmp_path, monkeypatch):
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
    old_cache = {
        "schema_version": roster.ROSTER_CONTEXT_SCHEMA_VERSION - 1,
        "generated_at": "2026-10-03T00:00:00Z",
        "events": [],
        "observations": [],
    }
    roster.atomic_write_json(roster.roster_snapshot_path(["TB"]), old_cache)

    context = roster.roster_context_for_teams(["TB"], providers=[Provider()])

    assert calls["count"] == 1
    assert context["cache_hit"] is False
    assert context["events"][0]["player"] == "Baker Mayfield"


def test_default_official_injury_provider_is_configured(monkeypatch):
    monkeypatch.delenv("NFL_OFFICIAL_INJURY_REPORT_URLS", raising=False)
    monkeypatch.setenv("NFL_ROSTER_DISABLE_DEFAULT_NFLVERSE", "1")

    providers = roster.configured_roster_providers(["TB"])

    injury_provider = next(provider for provider in providers if provider.source_type == "official_injury_report")
    assert injury_provider.team_urls == {"TB": "https://www.buccaneers.com/team/injury-report/"}


def test_roster_context_accepts_alias_team_codes(tmp_path, monkeypatch):
    monkeypatch.delenv("NFL_OFFICIAL_INJURY_REPORT_URLS", raising=False)
    monkeypatch.setenv("NFL_ROSTER_DISABLE_DEFAULT_NFLVERSE", "1")
    monkeypatch.setattr(roster, "roster_cache_root", lambda: tmp_path)

    providers = roster.configured_roster_providers(["LAR", "WSH"])
    injury_provider = next(provider for provider in providers if provider.source_type == "official_injury_report")

    assert set(injury_provider.team_urls) == {"LA", "WAS"}


def test_roster_context_cache_is_keyed_by_requested_teams(tmp_path, monkeypatch):
    monkeypatch.setattr(roster, "roster_cache_root", lambda: tmp_path)

    tb_path = roster.roster_snapshot_path(["TB"])
    gb_path = roster.roster_snapshot_path(["GB"])

    assert tb_path != gb_path
    assert tb_path.name.startswith("roster_snapshot.teams_")


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


def test_roster_context_suppresses_same_player_on_multiple_selected_teams(tmp_path, monkeypatch):
    class Provider:
        source_type = "official_injury_report"

        def observations(self):
            return [
                roster.RosterObservation(team="IND", player="Keenan Allen", position="WR", injury_status="OUT", practice_status="DNP", source_type=self.source_type, confidence="high"),
                roster.RosterObservation(team="WAS", player="Keenan Allen", position="WR", injury_status="OUT", practice_status="DNP", source_type=self.source_type, confidence="high"),
                roster.RosterObservation(team="WAS", player="Jayden Daniels", position="QB", injury_status="OUT", practice_status="LP", source_type=self.source_type, confidence="high"),
            ]

    monkeypatch.setattr(roster, "roster_cache_root", lambda: tmp_path)

    context = roster.roster_context_for_teams(["IND", "WAS"], providers=[Provider()])

    players = {event["player"] for event in context["events"]}
    assert "Keenan Allen" not in players
    assert "Jayden Daniels" in players
    assert context["suppressed_conflicts"][0]["player"] == "Keenan Allen"


def test_roster_context_dedupes_same_official_injury_player_with_position_variants(tmp_path, monkeypatch):
    class Provider:
        source_type = "official_injury_report"

        def observations(self):
            return [
                roster.RosterObservation(team="WAS", player="Nick Cross", position="SAF", injury_status="OUT", practice_status="DNP", source_type=self.source_type, confidence="high"),
                roster.RosterObservation(team="WAS", player="Nick Cross", position="S", injury_status="OUT", practice_status="DNP", source_type=self.source_type, confidence="high"),
            ]

    monkeypatch.setattr(roster, "roster_cache_root", lambda: tmp_path)

    context = roster.roster_context_for_teams(["WAS"], providers=[Provider()])
    nick_events = [event for event in context["events"] if event["player"] == "Nick Cross"]

    assert len(nick_events) == 1
