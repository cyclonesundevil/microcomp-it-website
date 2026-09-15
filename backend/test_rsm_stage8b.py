import json
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from rsm.stage8_shadow import frozen_manifest
from rsm.stage8b_public_sources import (
    ESPN_SCOREBOARD_URL,
    FIXTURE_ROOT,
    ApiSportsNflHttpClient,
    PublicHttpClient,
    CredentialedMarketHttpClient,
    PublicSourceError,
    ParserDriftError,
    RateLimiter,
    assert_public_request,
    assert_market_request,
    assert_api_sports_request,
    audit_public_sources,
    build_id_crosswalk,
    derive_consensus,
    frozen_feature_payload,
    injury_evidence,
    parse_espn_scoreboard,
    parse_nfl_injury_report,
    parse_nflverse_release,
    parse_sleeper_players,
    parse_yahoo_public,
    report_conflicts,
    response_hash,
    sports_game_odds_market_dry_run,
    sports_game_odds_request_url,
    api_sports_nfl_capability_url,
    api_sports_nfl_dry_run,
    local_api_sports_key,
    local_sports_game_odds_key,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
REPORTS_ROOT = REPOSITORY_ROOT / "reports"
RETRIEVED = "2099-09-10T20:00:00Z"


def fixture(name):
    return json.loads((FIXTURE_ROOT / name).read_text(encoding="utf-8"))


def espn_payload():
    return fixture("espn-scoreboard-redacted.json")


def test_stage8b_espn_and_yahoo_parser_drift():
    with pytest.raises(ParserDriftError, match="events schema"):
        parse_espn_scoreboard({"items": []}, RETRIEVED)
    with pytest.raises(ParserDriftError, match="schema changed"):
        parse_yahoo_public({"schema_version": 2, "games": []}, RETRIEVED)
    assert parse_yahoo_public(fixture("yahoo-public-redacted.json"), RETRIEVED)[0]["source"] == "yahoo"


def test_stage8b_sleeper_daily_cache_prevents_network(monkeypatch, tmp_path):
    cache = tmp_path / "cache" / "sleeper-nfl-players.json"
    cache.parent.mkdir(parents=True)
    raw = json.dumps(fixture("sleeper-players-redacted.json")).encode()
    cache.write_bytes(raw)
    cache.with_suffix(".metadata.json").write_text(json.dumps({
        "source": "sleeper", "url": "public", "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source_updated_at": None, "source_published_at": None,
        "timestamp_quality": "RETRIEVAL_TIMESTAMP_ONLY", "sha256": response_hash(raw),
    }), encoding="utf-8")
    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: pytest.fail("network must not be called"))
    result = PublicHttpClient(tmp_path).get_json(
        "sleeper", "public", cache_ttl=timedelta(days=1), cache_name="sleeper-nfl-players",
    )
    assert result.timestamp_quality == "RETRIEVAL_TIMESTAMP_ONLY"


def test_stage8b_nflverse_release_and_snapshot_timestamps_are_separate():
    rows = parse_nflverse_release(fixture("nflverse-releases-redacted.json"), RETRIEVED)
    assert rows[0]["source_published_at"] != rows[0]["retrieved_at"]
    assert rows[0]["source_updated_at"] is not None


def test_stage8b_espn_pregame_line_normalizes_sign_and_preserves_timestamps():
    line = parse_espn_scoreboard(espn_payload(), RETRIEVED)[0]
    assert line["home_spread"] == -3.5 and line["away_spread"] == 3.5
    assert line["source_updated_at"] == "2099-09-10T19:55:00Z"
    assert line["retrieved_at"] == RETRIEVED
    assert line["source_url"] == ESPN_SCOREBOARD_URL


def test_stage8b_nfl_injury_fixture_preserves_report_and_retrieval_timestamps():
    raw = (FIXTURE_ROOT / "nfl-injury-report-redacted.json").read_bytes()
    rows = parse_nfl_injury_report(
        json.loads(raw), RETRIEVED, "https://www.nfl.com/injuries/", response_hash(raw),
    )
    assert rows[0]["source"] == "nfl.com"
    assert rows[0]["report_date"] == "2099-09-10"
    assert rows[0]["retrieved_at"] == RETRIEVED
    assert rows[0]["absence_means_healthy"] is False


@pytest.mark.parametrize("state,retrieved", [("in", RETRIEVED), ("post", RETRIEVED), ("pre", "2099-09-11T00:00:00Z")])
def test_stage8b_live_or_postkickoff_espn_lines_are_rejected(state, retrieved):
    payload = espn_payload()
    payload["events"][0]["competitions"][0]["status"]["type"]["state"] = state
    assert parse_espn_scoreboard(payload, retrieved) == []


def test_stage8b_unidentified_or_conflicting_sportsbook_line_is_rejected():
    payload = espn_payload()
    odds = payload["events"][0]["competitions"][0]["odds"][0]
    odds["provider"] = {}
    assert parse_espn_scoreboard(payload, RETRIEVED) == []
    odds["provider"] = {"name": "BOOK"}
    odds["awayTeamOdds"]["spread"] = 2.5
    assert parse_espn_scoreboard(payload, RETRIEVED) == []


def test_stage8b_derived_consensus_is_deterministic_median():
    base = parse_espn_scoreboard(espn_payload(), RETRIEVED)[0]
    lines = [dict(base, sportsbook="A", home_spread=-3, away_spread=3), dict(base, sportsbook="B", home_spread=-4, away_spread=4), dict(base, sportsbook="C", home_spread=-7, away_spread=7)]
    result = derive_consensus(lines)
    assert result["market_kind"] == "DERIVED_CONSENSUS"
    assert result["home_spread"] == -4 and result["constituent_books"] == ["A", "B", "C"]


def test_stage8b_cross_source_conflicts_are_reported():
    rows = [{"id": "g", "source": "a", "status": "active"}, {"id": "g", "source": "b", "status": "out"}]
    assert report_conflicts(rows, "id", ["status"])[0]["field"] == "status"


def test_stage8b_crosswalk_ambiguity_and_name_nonmatching():
    public = [{"source_player_id": "10", "position": "QB", "full_name": "Review Name"}, {"source_player_id": "20", "position": "WR", "full_name": "No Match"}]
    nflverse = [{"sleeper_id": "10", "gsis_id": "A"}, {"sleeper_id": "10", "gsis_id": "B"}]
    result = build_id_crosswalk(nflverse, public, "sleeper")
    assert result["ambiguous"]["10"] == ["A", "B"]
    assert result["name_review_candidates"][0]["not_auto_matched"] is True
    assert result["passes_threshold"] is False

    direct = build_id_crosswalk(
        [{"gsis_id": "GSIS-DIRECT"}],
        [{"source_player_id": "99", "position": "QB", "full_name": "Exact", "gsis_id_claim": "GSIS-DIRECT"}],
        "sleeper",
    )
    assert direct["matched"]["99"] == "GSIS-DIRECT"


def test_stage8b_injury_absence_is_unknown_not_healthy():
    players = parse_sleeper_players(fixture("sleeper-players-redacted.json"), RETRIEVED)
    evidence = injury_evidence(players, {"1001": "GSIS1"})[0]
    assert evidence["availability"] == "UNKNOWN"
    assert evidence["absence_means_healthy"] is False


def test_stage8b_fantasy_projection_cannot_enter_frozen_features():
    values = {name: 0 for name in frozen_manifest(REPORTS_ROOT)["feature_names"]}
    values["fantasy_projection"] = 99
    assert "fantasy_projection" not in frozen_feature_payload(values, REPORTS_ROOT)
    with pytest.raises(PublicSourceError, match="exact ordered frozen features"):
        frozen_feature_payload({"fantasy_projection": 99}, REPORTS_ROOT)


def test_stage8b_raw_response_hash_is_stable_and_credentials_are_prohibited():
    assert response_hash(b"redacted") == response_hash(b"redacted")
    assert_public_request({"User-Agent": "research"})
    with pytest.raises(PublicSourceError, match="prohibited"):
        assert_public_request({"Cookie": "private"})


def test_stage8b_opt_in_market_transport_is_key_free_by_default(monkeypatch, tmp_path):
    monkeypatch.delenv("RSM_STAGE8B_SPORTSGAMEODDS_API_KEY", raising=False)
    result = sports_game_odds_market_dry_run(tmp_path)
    assert result["enabled"] is False and result["ledger_writes"] == 0
    assert "apiKey" not in sports_game_odds_request_url()
    assert "leagueID=NFL" in sports_game_odds_request_url()
    assert_market_request({"User-Agent": "research", "x-api-key": "not-logged"})
    with pytest.raises(PublicSourceError, match="x-api-key"):
        assert_market_request({"User-Agent": "research"})
    with pytest.raises(PublicSourceError, match="required"):
        CredentialedMarketHttpClient(tmp_path).get_sports_game_odds_nfl_spreads("")


def test_stage8b_api_sports_capability_audit_is_disabled_without_a_key(monkeypatch, tmp_path):
    monkeypatch.delenv("RSM_STAGE8B_APISPORTS_API_KEY", raising=False)
    monkeypatch.setattr("rsm.stage8b_public_sources.local_api_sports_key", lambda: "")
    result = api_sports_nfl_dry_run(tmp_path, season=2026)
    assert result["enabled"] is False and result["ledger_writes"] == 0
    assert "2026" in api_sports_nfl_capability_url(2026)
    assert_api_sports_request({"User-Agent": "research", "x-apisports-key": "not-logged"})
    with pytest.raises(PublicSourceError, match="x-apisports-key"):
        assert_api_sports_request({"User-Agent": "research"})
    with pytest.raises(PublicSourceError, match="required"):
        ApiSportsNflHttpClient(tmp_path).get_league_capability("", 2026)


def test_stage8b_api_sports_key_reader_prefers_environment_and_supports_quotes(monkeypatch, tmp_path):
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text("RSM_STAGE8B_APISPORTS_API_KEY='from-file'\n", encoding="utf-8")
    monkeypatch.delenv("RSM_STAGE8B_APISPORTS_API_KEY", raising=False)
    assert local_api_sports_key(dotenv_path) == "from-file"
    monkeypatch.setenv("RSM_STAGE8B_APISPORTS_API_KEY", "from-environment")
    assert local_api_sports_key(dotenv_path) == "from-environment"
    monkeypatch.delenv("RSM_STAGE8B_APISPORTS_API_KEY")
    monkeypatch.setenv("API_SPORTS_KEY", "compatibility-name")
    assert local_api_sports_key(dotenv_path) == "compatibility-name"


def test_stage8b_sports_game_odds_key_reader_supports_ignored_dotenv(monkeypatch, tmp_path):
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text('RSM_STAGE8B_SPORTSGAMEODDS_API_KEY="from-file"\n', encoding="utf-8")
    monkeypatch.delenv("RSM_STAGE8B_SPORTSGAMEODDS_API_KEY", raising=False)
    assert local_sports_game_odds_key(dotenv_path) == "from-file"
    monkeypatch.setenv("RSM_STAGE8B_SPORTSGAMEODDS_API_KEY", "from-environment")
    assert local_sports_game_odds_key(dotenv_path) == "from-environment"


def test_stage8b_rate_limit_and_bounded_http_retries(monkeypatch, tmp_path):
    clock_value = [0.0]
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        clock_value[0] += seconds

    limiter = RateLimiter(lambda: clock_value[0], sleep)
    limiter.wait("source", 2)
    limiter.wait("source", 2)
    assert sleeps == [2]

    calls = []

    def fail(*args, **kwargs):
        calls.append(1)
        raise urllib.error.URLError("blocked")

    monkeypatch.setattr("urllib.request.urlopen", fail)
    monkeypatch.setattr("time.sleep", lambda _: None)
    with pytest.raises(PublicSourceError, match="after 3 attempts"):
        PublicHttpClient(tmp_path).get_json("test", "https://invalid.example", attempts=3, minimum_interval=0)
    assert len(calls) == 3


def test_stage8b_source_audit_is_ledger_read_only_and_not_ready():
    store = REPOSITORY_ROOT / "backend" / "data" / "rsm" / "shadow" / "stage8-shadow.sqlite3"
    before = (store.stat().st_size, store.stat().st_mtime_ns)
    result = audit_public_sources(REPOSITORY_ROOT, live=False)
    after = (store.stat().st_size, store.stat().st_mtime_ns)
    assert before == after
    assert result["live_ledger_writes"] == 0
    assert result["ready_for_genuine_prospective_writes"] is False


def test_stage8b_no_production_api_or_ui_exposure():
    assert "stage8b" not in (REPOSITORY_ROOT / "backend" / "app.py").read_text(encoding="utf-8").lower()
    assert not any("stage8b" in path.read_text(encoding="utf-8", errors="ignore").lower() for path in (REPOSITORY_ROOT / "frontend").rglob("*.js"))
