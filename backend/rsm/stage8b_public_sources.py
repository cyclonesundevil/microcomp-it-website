"""Stage 8B public-source adapters for research-only prospective dry runs.

No function in this module writes to the Stage 8 ledger. Live retrieval is limited
to explicitly enabled sources and archives provenance. Credentialed market sources
are isolated from the unauthenticated public-source client and remain disabled until
an operator explicitly supplies a key.
"""

import hashlib
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Callable, Iterable, Sequence

from .config import normalize_team
from .data import read_csv
from .stage8_shadow import DEFAULT_STORE, frozen_manifest
from .stage8a_capture import CaptureConfig, health_report, verify_frozen_baseline


USER_AGENT = "MicroComp-RSM-Research/0.2 (+public-data-audit; no wagering)"
SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
NFLVERSE_RELEASES_URL = "https://api.github.com/repos/nflverse/nflverse-data/releases"
SPORTSGAMEODDS_EVENTS_URL = "https://api.sportsgameodds.com/v2/events"
DEFAULT_PUBLIC_ROOT = DEFAULT_STORE.parent / "public-sources"
FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures" / "stage8b"
CROSSWALK_MINIMUM = 0.95


class PublicSourceError(RuntimeError):
    pass


class ParserDriftError(PublicSourceError):
    pass


@dataclass(frozen=True)
class PublicResponse:
    source: str
    url: str
    retrieved_at: str
    source_updated_at: str | None
    source_published_at: str | None
    timestamp_quality: str
    sha256: str
    archive_path: str
    payload: object


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic, sleeper: Callable[[float], None] = time.sleep):
        self.clock, self.sleeper, self.last = clock, sleeper, {}

    def wait(self, source: str, minimum_interval: float) -> None:
        now = self.clock()
        remaining = minimum_interval - (now - self.last.get(source, now - minimum_interval))
        if remaining > 0:
            self.sleeper(remaining)
        self.last[source] = self.clock()


def _utc(value: datetime | None = None) -> str:
    return (value or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_time(value: object, field: str, nullable: bool = False) -> datetime | None:
    if value in (None, "") and nullable:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as error:
        raise ParserDriftError(f"{field} is not ISO-8601") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ParserDriftError(f"{field} lacks a timezone")
    return parsed.astimezone(timezone.utc)


def response_hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def assert_public_request(headers: dict[str, str]) -> None:
    forbidden = {"authorization", "cookie", "proxy-authorization", "x-api-key"}
    present = forbidden & {key.lower() for key in headers}
    if present:
        raise PublicSourceError(f"Credential/cookie headers are prohibited: {sorted(present)}")


def assert_market_request(headers: dict[str, str]) -> None:
    """Allow only the provider API-key header for the opt-in market adapter.

    This deliberately does not reuse ``assert_public_request``: market access is
    authenticated, while all existing Stage 8B public-source paths remain
    unauthenticated. The key is passed only in an HTTP header and is never added
    to a URL, response archive, cache metadata, report, or exception message.
    """
    lowered = {key.lower() for key in headers}
    forbidden = {"authorization", "cookie", "proxy-authorization"} & lowered
    if forbidden or "x-api-key" not in lowered:
        raise PublicSourceError("Market request must use only an x-api-key credential header")


def sports_game_odds_request_url() -> str:
    """Return the narrowly scoped, key-free NFL full-game spread query URL."""
    return (
        f"{SPORTSGAMEODDS_EVENTS_URL}?leagueID=NFL&oddsAvailable=true"
        "&includeAltLines=false&oddIDs=points-home-game-sp-home&includeOpposingOdds=true"
    )


class PublicHttpClient:
    def __init__(self, root: Path = DEFAULT_PUBLIC_ROOT, limiter: RateLimiter | None = None):
        self.root = root
        self.limiter = limiter or RateLimiter()

    def get_json(
        self, source: str, url: str, timeout: float = 15, attempts: int = 3,
        minimum_interval: float = 1.0, cache_ttl: timedelta | None = None,
        cache_name: str | None = None,
    ) -> PublicResponse:
        if attempts < 1 or attempts > 5:
            raise ValueError("attempts must be between 1 and 5")
        cache_path = self.root / "cache" / f"{cache_name or source}.json"
        metadata_path = cache_path.with_suffix(".metadata.json")
        if cache_ttl and cache_path.exists() and metadata_path.exists():
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            retrieved = _parse_time(metadata["retrieved_at"], "cache.retrieved_at")
            if datetime.now(timezone.utc) - retrieved < cache_ttl:
                raw = cache_path.read_bytes()
                return PublicResponse(payload=json.loads(raw), archive_path=str(cache_path), **{
                    key: metadata[key] for key in (
                        "source", "url", "retrieved_at", "source_updated_at",
                        "source_published_at", "timestamp_quality", "sha256",
                    )
                })
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        assert_public_request(headers)
        error = None
        for attempt in range(1, attempts + 1):
            try:
                self.limiter.wait(source, minimum_interval)
                request = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    raw = response.read()
                    retrieved_at = _utc()
                    published = response.headers.get("Last-Modified")
                payload = json.loads(raw)
                digest = response_hash(raw)
                stamp = retrieved_at.replace(":", "").replace("-", "")
                archive = self.root / "raw" / source / f"{stamp}-{digest[:12]}.json"
                archive.parent.mkdir(parents=True, exist_ok=True)
                archive.write_bytes(raw)
                metadata = {
                    "source": source, "url": url, "retrieved_at": retrieved_at,
                    "source_updated_at": None, "source_published_at": published,
                    "timestamp_quality": "RETRIEVAL_TIMESTAMP_ONLY" if not published else "PUBLISHER_AND_RETRIEVAL",
                    "sha256": digest,
                }
                if cache_ttl:
                    cache_path.parent.mkdir(parents=True, exist_ok=True)
                    with tempfile.NamedTemporaryFile(dir=cache_path.parent, delete=False) as temporary:
                        temporary.write(raw)
                        temporary_path = Path(temporary.name)
                    os.replace(temporary_path, cache_path)
                    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
                return PublicResponse(payload=payload, archive_path=str(archive), **metadata)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as caught:
                error = caught
                if attempt < attempts:
                    time.sleep(0.25 * (2 ** (attempt - 1)))
        raise PublicSourceError(f"{source} failed after {attempts} attempts: {error}") from error


class CredentialedMarketHttpClient(PublicHttpClient):
    """Opt-in, read-only transport for SportsGameOdds NFL spread snapshots.

    It intentionally returns the raw provider response only. Stage 8 does not
    treat a market snapshot as capture-ready until a real-key response has been
    schema-audited against schedule identity and all independent lineup/feature
    gates pass. This prevents an unverified third-party schema from entering the
    frozen observation boundary.
    """

    def get_sports_game_odds_nfl_spreads(self, api_key: str, timeout: float = 15) -> PublicResponse:
        if not isinstance(api_key, str) or not api_key.strip():
            raise PublicSourceError("SportsGameOdds API key is required for the opt-in market dry run")
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "x-api-key": api_key.strip(),
        }
        assert_market_request(headers)
        url = sports_game_odds_request_url()
        self.limiter.wait("sportsgameodds", 6.0)
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                retrieved_at = _utc()
                published = response.headers.get("Last-Modified")
            payload = json.loads(raw)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            # Do not interpolate request headers (which contain the key).
            raise PublicSourceError("sportsgameodds market dry run failed") from error
        digest = response_hash(raw)
        stamp = retrieved_at.replace(":", "").replace("-", "")
        archive = self.root / "raw" / "sportsgameodds" / f"{stamp}-{digest[:12]}.json"
        archive.parent.mkdir(parents=True, exist_ok=True)
        archive.write_bytes(raw)
        metadata = {
            "source": "sportsgameodds", "url": url, "retrieved_at": retrieved_at,
            "source_updated_at": None, "source_published_at": published,
            "timestamp_quality": "RETRIEVAL_TIMESTAMP_ONLY" if not published else "PUBLISHER_AND_RETRIEVAL",
            "sha256": digest,
        }
        return PublicResponse(payload=payload, archive_path=str(archive), **metadata)


def fetch_sleeper_players(client: PublicHttpClient, timeout: float = 15) -> PublicResponse:
    return client.get_json(
        "sleeper", SLEEPER_PLAYERS_URL, timeout=timeout, minimum_interval=1,
        cache_ttl=timedelta(days=1), cache_name="sleeper-nfl-players",
    )


def sports_game_odds_market_dry_run(root: Path = DEFAULT_PUBLIC_ROOT, timeout: float = 15) -> dict:
    """Fetch and archive one raw NFL spread response, without parsing or capture.

    This command is intentionally separate from the normal public dry run. It is
    opt-in through ``RSM_STAGE8B_SPORTSGAMEODDS_API_KEY`` and cannot append a
    ledger observation. A successful transport response is evidence only that
    the account/key works; it does not make the provider capture-ready.
    """
    api_key = os.environ.get("RSM_STAGE8B_SPORTSGAMEODDS_API_KEY", "")
    if not api_key.strip():
        return {
            "source": "sportsgameodds", "enabled": False, "accessed": False,
            "reason": "RSM_STAGE8B_SPORTSGAMEODDS_API_KEY is not configured",
            "ledger_writes": 0, "capture_ready": False,
        }
    response = CredentialedMarketHttpClient(root).get_sports_game_odds_nfl_spreads(api_key, timeout=timeout)
    return {
        "source": "sportsgameodds", "enabled": True, "accessed": True,
        "retrieved_at": response.retrieved_at, "sha256": response.sha256,
        "archive_path": response.archive_path, "timestamp_quality": response.timestamp_quality,
        "response_type": type(response.payload).__name__, "ledger_writes": 0,
        "capture_ready": False,
        "reason": "Raw response archived only; provider schema and schedule matching remain unaudited",
    }


def parse_sleeper_players(payload: object, retrieved_at: str) -> list[dict]:
    _parse_time(retrieved_at, "retrieved_at")
    if not isinstance(payload, dict):
        raise ParserDriftError("Sleeper players root must be an object")
    output = []
    for source_id, value in sorted(payload.items()):
        if not isinstance(value, dict) or "player_id" not in value:
            raise ParserDriftError("Sleeper player schema changed")
        output.append({
            "source": "sleeper", "source_player_id": str(source_id),
            "player_id": str(value["player_id"]), "full_name": value.get("full_name") or " ".join(
                part for part in (value.get("first_name"), value.get("last_name")) if part
            ),
            "team": normalize_team(value.get("team") or ""), "position": value.get("position"),
            "fantasy_positions": value.get("fantasy_positions") or [], "active": value.get("active"),
            "status": value.get("status"), "injury_status": value.get("injury_status"),
            "depth_chart_position": value.get("depth_chart_position"),
            "depth_chart_order": value.get("depth_chart_order"),
            "gsis_id_claim": str(value.get("gsis_id") or "").strip(),
            "ids": {key: value.get(key) for key in (
                "espn_id", "yahoo_id", "sportradar_id", "fantasy_data_id", "sleeper_id",
            ) if value.get(key) not in (None, "")},
            "source_updated_at": None, "retrieved_at": retrieved_at,
            "timestamp_quality": "RETRIEVAL_TIMESTAMP_ONLY",
        })
    return output


def parse_espn_scoreboard(payload: object, retrieved_at: str, source_url: str = ESPN_SCOREBOARD_URL) -> list[dict]:
    retrieved = _parse_time(retrieved_at, "retrieved_at")
    if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
        raise ParserDriftError("ESPN scoreboard events schema changed")
    lines = []
    for event in payload["events"]:
        if not isinstance(event, dict) or not event.get("id") or not event.get("date"):
            raise ParserDriftError("ESPN event identity/date schema changed")
        kickoff = _parse_time(event["date"], "event.date")
        competitions = event.get("competitions")
        if not isinstance(competitions, list) or len(competitions) != 1:
            raise ParserDriftError("ESPN competition schema changed")
        competition = competitions[0]
        status = (competition.get("status") or event.get("status") or {}).get("type") or {}
        state = str(status.get("state") or "").lower()
        if state != "pre" or status.get("completed") or retrieved >= kickoff:
            continue
        competitors = competition.get("competitors") or []
        home = next((row for row in competitors if row.get("homeAway") == "home"), None)
        away = next((row for row in competitors if row.get("homeAway") == "away"), None)
        if not home or not away:
            raise ParserDriftError("ESPN home/away competitor schema changed")
        home_team = normalize_team((home.get("team") or {}).get("abbreviation") or "")
        away_team = normalize_team((away.get("team") or {}).get("abbreviation") or "")
        for odds in competition.get("odds") or []:
            provider = odds.get("provider") or {}
            sportsbook = str(provider.get("name") or "").strip()
            if not sportsbook:
                continue
            home_spread = odds.get("homeTeamOdds", {}).get("spread")
            away_spread = odds.get("awayTeamOdds", {}).get("spread")
            if home_spread is None or away_spread is None:
                match = re.fullmatch(r"\s*([A-Za-z]{2,4})\s*([+-]?\d+(?:\.\d+)?)\s*", str(odds.get("details") or ""))
                if not match:
                    continue
                favorite, number = normalize_team(match.group(1)), float(match.group(2))
                favorite_spread = number if number < 0 else -number
                if favorite == home_team:
                    home_spread, away_spread = favorite_spread, -favorite_spread
                elif favorite == away_team:
                    away_spread, home_spread = favorite_spread, -favorite_spread
                else:
                    continue
            home_spread, away_spread = float(home_spread), float(away_spread)
            if abs(home_spread + away_spread) > 1e-9:
                continue
            source_updated = _parse_time(odds.get("lastUpdated"), "odds.lastUpdated", nullable=True)
            lines.append({
                "source": "espn", "source_url": source_url, "source_event_id": str(event["id"]),
                "sportsbook": sportsbook, "market_kind": "INDIVIDUAL_BOOK",
                "home_team": home_team, "away_team": away_team,
                "home_spread": home_spread, "away_spread": away_spread,
                "home_price": odds.get("homeTeamOdds", {}).get("spreadOdds"),
                "away_price": odds.get("awayTeamOdds", {}).get("spreadOdds"),
                "source_updated_at": _utc(source_updated) if source_updated else None, "source_published_at": None,
                "retrieved_at": retrieved_at, "kickoff_at": _utc(kickoff),
                "timestamp_quality": "PUBLISHER_AND_RETRIEVAL" if odds.get("lastUpdated") else "RETRIEVAL_TIMESTAMP_ONLY",
                "live": False, "alternate": False,
            })
    return lines


def parse_yahoo_public(payload: object, retrieved_at: str) -> list[dict]:
    """Fixture-only parser. Live Yahoo automation is policy-disabled."""
    _parse_time(retrieved_at, "retrieved_at")
    if not isinstance(payload, dict) or payload.get("schema_version") != 1 or not isinstance(payload.get("games"), list):
        raise ParserDriftError("Yahoo public-page structured schema changed")
    return [dict(game, source="yahoo", retrieved_at=retrieved_at) for game in payload["games"]]


def parse_nfl_injury_report(payload: object, retrieved_at: str, source_url: str, raw_sha256: str) -> list[dict]:
    """Fixture-only official-injury parser until an allowed NFL.com feed is identified."""
    _parse_time(retrieved_at, "retrieved_at")
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != 1
        or not isinstance(payload.get("games"), list)
    ):
        raise ParserDriftError("NFL injury-report structured schema changed")
    report_date = str(payload.get("report_date") or "").strip()
    if not report_date:
        raise ParserDriftError("NFL injury-report date is missing")
    output = []
    for game in payload["games"]:
        if not isinstance(game, dict) or not isinstance(game.get("players"), list):
            raise ParserDriftError("NFL injury-report game schema changed")
        for player in game["players"]:
            if not isinstance(player, dict) or not player.get("gsis_id"):
                raise ParserDriftError("NFL injury-report player identity schema changed")
            output.append({
                "source": "nfl.com", "source_url": source_url,
                "source_event_id": str(game.get("source_event_id") or ""),
                "home_team": normalize_team(game.get("home_team") or ""),
                "away_team": normalize_team(game.get("away_team") or ""),
                "gsis_id": str(player["gsis_id"]),
                "designation": player.get("designation"),
                "practice_status": player.get("practice_status"),
                "report_date": report_date, "retrieved_at": retrieved_at,
                "raw_sha256": raw_sha256, "absence_means_healthy": False,
                "timestamp_quality": "REPORT_DATE_AND_RETRIEVAL",
            })
    return output


def derive_consensus(lines: Sequence[dict]) -> dict | None:
    eligible = [line for line in lines if line.get("market_kind") == "INDIVIDUAL_BOOK" and line.get("sportsbook")]
    books = {line["sportsbook"] for line in eligible}
    if len(books) < 2:
        return None
    identities = {(line["source_event_id"], line["home_team"], line["away_team"], line["kickoff_at"]) for line in eligible}
    if len(identities) != 1:
        raise PublicSourceError("Cannot derive consensus from conflicting games")
    event_id, home, away, kickoff = identities.pop()
    return {
        "source": "stage8b-derived", "source_event_id": event_id, "sportsbook": "DERIVED_CONSENSUS",
        "market_kind": "DERIVED_CONSENSUS", "home_team": home, "away_team": away,
        "home_spread": median(sorted(float(line["home_spread"]) for line in eligible)),
        "away_spread": median(sorted(float(line["away_spread"]) for line in eligible)),
        "kickoff_at": kickoff, "retrieved_at": max(line["retrieved_at"] for line in eligible),
        "constituent_books": sorted(books), "method": "median of identifiable individual-book home/away spreads",
    }


def build_id_crosswalk(nflverse_players: Iterable[dict], public_players: Iterable[dict], source: str) -> dict:
    id_field = {"sleeper": "sleeper_id", "espn": "espn_id", "yahoo": "yahoo_id"}[source]
    by_source = defaultdict(list)
    nflverse_players = list(nflverse_players)
    known_gsis = {str(row.get("gsis_id") or "").strip() for row in nflverse_players if str(row.get("gsis_id") or "").strip()}
    for row in nflverse_players:
        source_id = str(row.get(id_field) or "").strip()
        gsis = str(row.get("gsis_id") or "").strip()
        if source_id and gsis:
            by_source[source_id].append(gsis)
    matched, ambiguous, unmatched, review_candidates = {}, {}, [], []
    position_totals, position_matched = Counter(), Counter()
    for row in public_players:
        source_id = str(row.get("source_player_id") or row.get("player_id") or "").strip()
        position = str(row.get("position") or "UNKNOWN")
        position_totals[position] += 1
        claimed_gsis = str(row.get("gsis_id_claim") or "").strip()
        candidates = [claimed_gsis] if claimed_gsis in known_gsis else sorted(set(by_source.get(source_id, [])))
        if len(candidates) == 1:
            matched[source_id] = candidates[0]
            position_matched[position] += 1
        elif len(candidates) > 1:
            ambiguous[source_id] = candidates
        else:
            unmatched.append(source_id)
            if row.get("full_name"):
                review_candidates.append({"source_player_id": source_id, "name": row["full_name"], "not_auto_matched": True})
    coverage = {
        position: {"matched": position_matched[position], "total": total, "ratio": position_matched[position] / total if total else 0}
        for position, total in sorted(position_totals.items())
    }
    total = sum(position_totals.values())
    return {
        "source": source, "matched": matched, "ambiguous": ambiguous, "unmatched": sorted(unmatched),
        "name_review_candidates": review_candidates, "coverage_by_position": coverage,
        "overall_coverage": len(matched) / total if total else 0,
        "passes_threshold": bool(total) and len(matched) / total >= CROSSWALK_MINIMUM and not ambiguous,
        "threshold": CROSSWALK_MINIMUM,
    }


def report_conflicts(observations: Sequence[dict], identity: str, fields: Sequence[str]) -> list[dict]:
    conflicts = []
    grouped = defaultdict(list)
    for row in observations:
        grouped[row.get(identity)].append(row)
    for key, rows in sorted(grouped.items(), key=lambda item: str(item[0])):
        for field in fields:
            values = {json.dumps(row.get(field), sort_keys=True) for row in rows if row.get(field) is not None}
            if len(values) > 1:
                conflicts.append({"identity": key, "field": field, "sources": sorted(str(row.get("source")) for row in rows), "values": sorted(values)})
    return conflicts


def injury_evidence(players: Sequence[dict], gsis_crosswalk: dict) -> list[dict]:
    output = []
    for player in players:
        source_id = player["source_player_id"]
        if source_id not in gsis_crosswalk:
            continue
        status = player.get("injury_status")
        output.append({
            "gsis_id": gsis_crosswalk[source_id], "source": player["source"],
            "injury_status": status, "availability": "UNKNOWN" if status in (None, "") else "REPORTED_STATUS",
            "absence_means_healthy": False, "retrieved_at": player["retrieved_at"],
        })
    return output


def frozen_feature_payload(candidate: dict, reports_root: Path) -> dict:
    names = frozen_manifest(reports_root)["feature_names"]
    if any("projection" in key.lower() or "ranking" in key.lower() for key in candidate):
        candidate = {key: value for key, value in candidate.items() if "projection" not in key.lower() and "ranking" not in key.lower()}
    if list(candidate) != names:
        raise PublicSourceError("Only the exact ordered frozen features may enter the model")
    return {name: float(candidate[name]) for name in names}


def parse_nflverse_release(payload: object, retrieved_at: str) -> list[dict]:
    _parse_time(retrieved_at, "retrieved_at")
    if not isinstance(payload, list):
        raise ParserDriftError("nflverse GitHub releases schema changed")
    output = []
    for release in payload:
        if not isinstance(release, dict) or not release.get("tag_name") or "published_at" not in release:
            raise ParserDriftError("nflverse release metadata schema changed")
        output.append({
            "release": release["tag_name"], "source_published_at": release["published_at"],
            "source_updated_at": release.get("updated_at"), "retrieved_at": retrieved_at,
            "assets": sorted(asset.get("name") for asset in release.get("assets", []) if asset.get("name")),
        })
    return output


def source_inventory() -> list[dict]:
    return [
        {"source": "nflverse", "accessible": True, "access_policy": "public GitHub releases/downloads", "fields": ["schedule", "GSIS IDs", "rosters", "depth snapshots", "prior stats", "prior snaps"], "timestamp_quality": "release metadata plus retrieval; depth snapshot where supplied", "sportsbook_identification": "not used for prospective lines", "player_id_coverage": "GSIS primary", "update_frequency": "daily rosters; pipeline-dependent releases", "parser_confidence": "HIGH", "role": "REQUIRED"},
        {"source": "Sleeper", "accessible": True, "access_policy": "documented unauthenticated read-only API; noncommercial; players at most daily", "fields": ["active/injury status", "depth order", "fantasy positions", "public IDs"], "timestamp_quality": "RETRIEVAL_TIMESTAMP_ONLY", "sportsbook_identification": "none", "player_id_coverage": "crosswalk required", "update_frequency": "cached at least 24 hours", "parser_confidence": "HIGH", "role": "SUPPLEMENTAL"},
        {"source": "SportsGameOdds", "accessible": "disabled until RSM_STAGE8B_SPORTSGAMEODDS_API_KEY is supplied", "access_policy": "operator-provided free-tier/API key; explicit dry run only", "fields": ["raw NFL full-game home-spread response only"], "timestamp_quality": "provider response headers plus retrieval when supplied", "sportsbook_identification": "provider schema audit required", "player_id_coverage": "not applicable", "update_frequency": "manual explicit dry run only", "parser_confidence": "TRANSPORT_ONLY", "role": "OPTIONAL_MARKET"},
        {"source": "ESPN", "accessible": "public endpoint observed; disabled by default", "access_policy": "unofficial/contract uncertain; stop on blocking", "fields": ["schedule", "pregame displayed spread when identifiable"], "timestamp_quality": "provider time if present, else retrieval only", "sportsbook_identification": "required from provider.name", "player_id_coverage": "crosswalk required", "update_frequency": "fixture validation only until access is approved", "parser_confidence": "MEDIUM", "role": "OPTIONAL"},
        {"source": "Yahoo", "accessible": False, "access_policy": "BLOCKED_POLICY: automated collection requires express permission", "fields": ["redacted fixture parser only"], "timestamp_quality": "not collected live", "sportsbook_identification": "not collected live", "player_id_coverage": "fixture crosswalk only", "update_frequency": "none", "parser_confidence": "FIXTURE_ONLY", "role": "SUPPLEMENTAL"},
        {"source": "NFL.com", "accessible": False, "access_policy": "CORROBORATION_ONLY until an expressly permitted public feed is identified", "fields": ["official injury-report fixture evidence"], "timestamp_quality": "report date plus retrieval when permitted", "sportsbook_identification": "none", "player_id_coverage": "GSIS crosswalk required", "update_frequency": "none automated", "parser_confidence": "NOT_ENABLED", "role": "SUPPLEMENTAL"},
    ]


def audit_public_sources(repository_root: Path, live: bool = False, root: Path = DEFAULT_PUBLIC_ROOT) -> dict:
    reports_root = repository_root / "reports"
    baseline = verify_frozen_baseline(DEFAULT_STORE, reports_root)
    inventory = source_inventory()
    checks = []
    crosswalk_summary = None
    manifest = repository_root / "backend" / "data" / "rsm" / "source-manifest.json"
    checks.append({"source": "nflverse", "status": "CACHED" if manifest.exists() else "MISSING", "manifest": str(manifest)})
    for source, cache_name in (("nflverse", "nflverse-releases"), ("sleeper", "sleeper-nfl-players")):
        metadata_path = root / "cache" / f"{cache_name}.metadata.json"
        if metadata_path.exists():
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            checks.append({
                "source": source, "status": "CACHED_PUBLIC_RESPONSE",
                "retrieved_at": metadata["retrieved_at"], "sha256": metadata["sha256"],
                "timestamp_quality": metadata["timestamp_quality"],
            })
    if live:
        client = PublicHttpClient(root)
        for source, operation in (
            ("nflverse", lambda: client.get_json("nflverse", NFLVERSE_RELEASES_URL, minimum_interval=1, cache_ttl=timedelta(hours=1), cache_name="nflverse-releases")),
            ("sleeper", lambda: fetch_sleeper_players(client)),
        ):
            try:
                response = operation()
                parsed_count = len(parse_nflverse_release(response.payload, response.retrieved_at)) if source == "nflverse" else len(parse_sleeper_players(response.payload, response.retrieved_at))
                checks.append({"source": source, "status": "ACCESSIBLE", "retrieved_at": response.retrieved_at, "sha256": response.sha256, "archive_path": response.archive_path, "parsed_records": parsed_count})
            except PublicSourceError as error:
                checks.append({"source": source, "status": "FAILED", "error": str(error)})
    sleeper_cache = root / "cache" / "sleeper-nfl-players.json"
    sleeper_metadata = sleeper_cache.with_suffix(".metadata.json")
    if sleeper_cache.exists() and sleeper_metadata.exists():
        metadata = json.loads(sleeper_metadata.read_text(encoding="utf-8"))
        sleeper_rows = parse_sleeper_players(json.loads(sleeper_cache.read_text(encoding="utf-8")), metadata["retrieved_at"])
        current_rows = [row for row in sleeper_rows if row.get("active") and row.get("team") and row.get("position")]
        players_path = repository_root / "backend" / "data" / "rsm" / "raw" / "players.csv"
        if players_path.exists():
            crosswalk = build_id_crosswalk(read_csv(players_path), current_rows, "sleeper")
            crosswalk_summary = {
                "source": "sleeper", "population": len(current_rows),
                "matched": len(crosswalk["matched"]), "ambiguous": len(crosswalk["ambiguous"]),
                "unmatched": len(crosswalk["unmatched"]), "overall_coverage": crosswalk["overall_coverage"],
                "coverage_by_position": crosswalk["coverage_by_position"],
                "threshold": CROSSWALK_MINIMUM, "passes_threshold": crosswalk["passes_threshold"],
                "names_auto_matched": False,
            }
            for row in inventory:
                if row["source"] == "Sleeper":
                    row["player_id_coverage"] = f"{crosswalk['overall_coverage']:.2%} of active/team/position records by explicit Sleeper ID"
    readiness_checks = {
        "frozen_pins": baseline["passed"], "kickoff_verified": False, "identifiable_spread": False,
        "all_18_features_constructed": False,
        "crosswalk_threshold_passed": bool(crosswalk_summary and crosswalk_summary["passes_threshold"]),
        "prospective_timestamps_passed": False,
    }
    return {
        "stage": "8B", "research_only": True, "live_requested": live, "sources": inventory,
        "source_checks": checks, "readiness_checks": readiness_checks,
        "ready_for_genuine_prospective_writes": all(readiness_checks.values()),
        "live_ledger_writes": 0, "outcomes_ingested": False, "recommendations_generated": False,
        "baseline": baseline, "ledger": baseline["ledger"], "crosswalk_summary": crosswalk_summary,
    }


def write_public_readiness(result: dict, reports_root: Path) -> tuple[Path, Path]:
    reports_root.mkdir(parents=True, exist_ok=True)
    json_path = reports_root / "rsm-stage8b-public-readiness.json"
    md_path = reports_root / "rsm-stage8b-public-readiness.md"
    json_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    lines = [
        "# Stage 8B public-source readiness", "",
        f"Frozen baseline: **{'passed' if result['baseline']['passed'] else 'failed'}**. Genuine prospective writes ready: **{str(result['ready_for_genuine_prospective_writes']).lower()}**. Live ledger writes: **0**.", "",
        "| Source | Accessible | Access policy | Fields | Timestamp quality | Sportsbook ID | Player-ID coverage | Update frequency | Parser confidence | Role |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for row in result["sources"]:
        cells = [row[key] for key in ("source", "accessible", "access_policy", "fields", "timestamp_quality", "sportsbook_identification", "player_id_coverage", "update_frequency", "parser_confidence", "role")]
        lines.append("| " + " | ".join(", ".join(cell) if isinstance(cell, list) else str(cell).replace("|", "\\|") for cell in cells) + " |")
    lines.extend(["", "## Readiness gates", ""])
    lines.extend(f"- {key.replace('_', ' ')}: **{str(value).lower()}**" for key, value in result["readiness_checks"].items())
    lines.extend(["", "## Public retrieval evidence", ""])
    for check in result["source_checks"]:
        detail = f"- {check['source']}: {check['status']}"
        if check.get("retrieved_at"):
            detail += f", retrieved `{check['retrieved_at']}`"
        if check.get("sha256"):
            detail += f", sha256 `{check['sha256']}`"
        if check.get("parsed_records") is not None:
            detail += f", parsed records {check['parsed_records']}"
        lines.append(detail)
    summary = result.get("crosswalk_summary")
    if summary:
        lines.extend([
            "",
            "## Explicit ID crosswalk",
            "",
            f"- Source: {summary['source']}",
            f"- Population: {summary['population']}",
            f"- Matched by explicit ID/GSIS claim: {summary['matched']}",
            f"- Ambiguous: {summary['ambiguous']}",
            f"- Unmatched: {summary['unmatched']}",
            f"- Overall coverage: {summary['overall_coverage']:.2%}",
            f"- Required threshold: {summary['threshold']:.2%}",
            f"- Passed: {str(summary['passes_threshold']).lower()}",
            "- Names auto-matched: false",
        ])
    lines.extend([
        "", "## Decision", "",
        "nflverse and Sleeper are the permitted public integration paths. ESPN is optional and disabled by default because its JSON interface is unofficial and contract status is uncertain. Yahoo live automation is policy-blocked; NFL.com remains manual/corroborative until an expressly permitted feed is identified. No source may be replaced with fabricated data.",
        "", "The current layer cannot safely construct every frozen feature or demonstrate required crosswalk/market/timestamp gates, so genuine prospective writes remain disabled. Fixture rehearsals must use a separate ledger.",
        "",
        "## Verification commands",
        "",
        "- `python -m pytest backend/test_rsm_stage8b.py backend/test_rsm.py backend/test_nfl_predictor.py -q`",
        "- `python -m compileall -q backend/rsm`",
        "- `python -m rsm stage8a-baseline`",
        "- `python -m rsm stage8b-source-audit`",
        "- `python -m rsm stage8b-health`",
    ])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def public_health(repository_root: Path, root: Path = DEFAULT_PUBLIC_ROOT) -> dict:
    reports_root = repository_root / "reports"
    config = CaptureConfig(store_path=DEFAULT_STORE, state_path=DEFAULT_STORE.with_name("stage8a-operational-state.json"))
    stage8a = health_report(config, reports_root)
    readiness = audit_public_sources(repository_root, live=False, root=root)
    return {"healthy": stage8a["healthy"], "read_only": True, "stage8a": stage8a, "stage8b": readiness, "outcome_statistics_reported": False}
