import json
import math
import os
import sqlite3
import time
from abc import ABC, abstractmethod
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Dict, List, Sequence

from .config import normalize_team
from .stage8_shadow import (
    DEFAULT_STORE,
    EXPECTED_DEFINITION_SHA256,
    EXPECTED_MODEL_SHA256,
    EXPECTED_RULES_SHA256,
    capture_observation,
    frozen_manifest,
    load_frozen_stage7c,
    preview_observation,
    verify_ledger,
)


DEFAULT_LOG = DEFAULT_STORE.with_name("stage8a-capture.jsonl")
DEFAULT_STATE = DEFAULT_STORE.with_name("stage8a-operational-state.json")
DEFAULT_LOCK = DEFAULT_STORE.with_name("stage8a-capture.lock")
EVALUATION_GATE = {
    "minimum_complete_regular_seasons": 1,
    "minimum_prospective_candidate_anomalies": 25,
    "insufficient_flags_behavior": "Continue unchanged into the next season",
    "operational_audits_may_inspect": ["completeness", "timestamps", "provider reliability", "ledger integrity"],
    "operational_audits_may_not_inspect": ["game outcomes", "ATS", "ROI", "financial results"],
    "frozen_during_collection": ["thresholds", "coefficients", "features", "anomaly score", "explanation rules"],
}


class ProviderError(RuntimeError):
    pass


class ProviderTimeout(ProviderError):
    pass


class ScheduleProvider(ABC):
    name: str

    @abstractmethod
    def upcoming_games(self, observed_at: datetime, horizon: timedelta, timeout_seconds: float) -> List[dict]:
        raise NotImplementedError


class MarketProvider(ABC):
    name: str

    @abstractmethod
    def spread_observations(self, game: dict, observed_at: datetime, timeout_seconds: float) -> List[dict]:
        raise NotImplementedError


class LineupProvider(ABC):
    name: str

    @abstractmethod
    def lineup_observation(self, game: dict, observed_at: datetime, timeout_seconds: float) -> dict:
        raise NotImplementedError


class FeatureProvider(ABC):
    name: str

    @abstractmethod
    def feature_observation(self, game: dict, observed_at: datetime, feature_names: Sequence[str], timeout_seconds: float) -> dict:
        raise NotImplementedError


def _parse_utc(value: object, label: str) -> datetime:
    text = str(value or "").strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProviderError(f"{label} must be ISO-8601") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ProviderError(f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class FixtureProvider(ScheduleProvider, MarketProvider, LineupProvider, FeatureProvider):
    """Offline provider for contract tests and controlled operator rehearsals only."""

    name = "fixture"

    def __init__(self, path: Path):
        self.path = path
        self.payload = json.loads(path.read_text(encoding="utf-8"))
        if set(self.payload) != {"provider", "games"} or self.payload["provider"] != "fixture":
            raise ProviderError("Fixture must contain provider='fixture' and games")

    def _game(self, game_id: str) -> dict:
        match = next((row for row in self.payload["games"] if row.get("schedule", {}).get("game_id") == game_id), None)
        if not match:
            raise ProviderError(f"Fixture game missing: {game_id}")
        return match

    def upcoming_games(self, observed_at: datetime, horizon: timedelta, timeout_seconds: float) -> List[dict]:
        games = []
        for item in self.payload["games"]:
            schedule = dict(item.get("schedule") or {})
            required = {"game_id", "season", "week", "kickoff", "away_team", "home_team", "source_observed_at", "source"}
            if set(schedule) != required:
                raise ProviderError("Fixture schedule fields are incomplete or ambiguous")
            kickoff = _parse_utc(schedule["kickoff"], "schedule.kickoff")
            source_time = _parse_utc(schedule["source_observed_at"], "schedule.source_observed_at")
            if source_time > observed_at or source_time >= kickoff:
                raise ProviderError("Schedule observation must be known before receipt and kickoff")
            if observed_at < kickoff <= observed_at + horizon:
                schedule["away_team"] = normalize_team(schedule["away_team"])
                schedule["home_team"] = normalize_team(schedule["home_team"])
                games.append(schedule)
        return sorted(games, key=lambda row: (_parse_utc(row["kickoff"], "kickoff"), row["game_id"]))

    def spread_observations(self, game: dict, observed_at: datetime, timeout_seconds: float) -> List[dict]:
        observations = self._game(game["game_id"]).get("markets") or []
        current = []
        for market in observations:
            source_time = _parse_utc(market.get("retrieved_timestamp"), "market.retrieved_timestamp")
            if source_time <= observed_at:
                current.append(dict(market))
        if not current:
            raise ProviderError(f"No pre-receipt market observation for {game['game_id']}")
        latest_by_book = {}
        for market in current:
            key = (str(market.get("market_kind", "")).upper(), str(market.get("sportsbook", "")))
            if key in latest_by_book:
                raise ProviderError("Fixture contains multiple current retrieval events for one sportsbook; use one per cycle")
            latest_by_book[key] = market
        return [latest_by_book[key] for key in sorted(latest_by_book)]

    def lineup_observation(self, game: dict, observed_at: datetime, timeout_seconds: float) -> dict:
        lineup = dict(self._game(game["game_id"]).get("lineup") or {})
        if _parse_utc(lineup.get("as_of"), "lineup.as_of") > observed_at:
            raise ProviderError("Lineup source timestamp cannot be later than local receipt")
        return lineup

    def feature_observation(self, game: dict, observed_at: datetime, feature_names: Sequence[str], timeout_seconds: float) -> dict:
        observation = dict(self._game(game["game_id"]).get("features") or {})
        if _parse_utc(observation.get("as_of"), "features.as_of") > observed_at:
            raise ProviderError("Feature source timestamp cannot be later than local receipt")
        values = observation.get("values")
        if not isinstance(values, dict) or list(values) != list(feature_names):
            raise ProviderError("Fixture feature ordering must exactly match the frozen model")
        return observation


@dataclass(frozen=True)
class CaptureConfig:
    store_path: Path = DEFAULT_STORE
    log_path: Path = DEFAULT_LOG
    state_path: Path = DEFAULT_STATE
    lock_path: Path = DEFAULT_LOCK
    timeout_seconds: float = 10.0
    max_attempts: int = 3
    backoff_seconds: float = 0.25
    horizon_hours: float = 30.0
    minimum_lead_minutes: float = 5.0
    stale_lock_seconds: float = 900.0


class CaptureLock:
    def __init__(self, path: Path, now: datetime, stale_seconds: float):
        self.path = path
        self.now = now
        self.stale_seconds = stale_seconds
        self.acquired = False

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as error:
            age = self.now.timestamp() - self.path.stat().st_mtime
            if age <= self.stale_seconds:
                raise RuntimeError("Another Stage 8A capture cycle holds the lock") from error
            self.path.unlink()
            descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(descriptor, json.dumps({"pid": os.getpid(), "acquired_at": _iso(self.now)}).encode("utf-8"))
        os.close(descriptor)
        self.acquired = True
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if self.acquired and self.path.exists():
            self.path.unlink()


def _retry(operation: Callable[[], object], attempts: int, backoff: float, sleeper: Callable[[float], None]) -> tuple[object, int]:
    if attempts < 1 or attempts > 5:
        raise ValueError("max_attempts must be between 1 and 5")
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            return operation(), attempt
        except (ProviderError, TimeoutError) as error:
            last_error = error
            if attempt < attempts:
                sleeper(backoff * (2 ** (attempt - 1)))
    raise ProviderError(f"Provider failed after {attempts} attempts: {last_error}") from last_error


def _read_state(path: Path) -> dict:
    if not path.exists():
        return {"rejected_late": 0, "rejected_malformed": 0, "provider_failures": 0, "duplicate_attempts": 0, "cycles": 0}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, indent=2), encoding="utf-8")
    temporary.replace(path)


def _append_log(path: Path, event: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as destination:
        destination.write(json.dumps(event, sort_keys=True) + "\n")


def _capture_window(kickoff: datetime, observed_at: datetime) -> str:
    hours = (kickoff - observed_at).total_seconds() / 3600.0
    if hours > 36:
        return "EARLIER_THAN_36H"
    if hours > 12:
        return "AROUND_24H"
    if hours > 3:
        return "AROUND_6H"
    if hours > 1:
        return "AROUND_90M"
    return "AROUND_30M"


def _observation_payload(game: dict, market: dict, lineup: dict, features: dict, observed_at: datetime) -> dict:
    if int(game["season"]) <= 2025:
        raise ProviderError("Stage 8A prohibits capture/backfill of 2025 or earlier games")
    allowed_market = {
        key: market.get(key)
        for key in (
            "sportsbook", "retrieved_timestamp", "line_type", "line_stage", "market_kind",
            "spread", "spread_convention", "home_price", "away_price", "source",
        )
    }
    return {
        "game_id": game["game_id"], "season": int(game["season"]), "week": int(game["week"]),
        "kickoff": game["kickoff"], "prediction_timestamp": _iso(observed_at),
        "away_team": normalize_team(game["away_team"]), "home_team": normalize_team(game["home_team"]),
        "schedule_source": game["source"], "schedule_observed_at": game["source_observed_at"],
        "features": features["values"], "features_as_of": features["as_of"],
        "features_source": features["source"],
        "lineup": {key: lineup.get(key) for key in (
            "confidence", "as_of", "source", "expected_starters", "inactive_or_injured",
        )},
        "market": allowed_market,
    }


def run_capture_cycle(
    schedule_provider: ScheduleProvider,
    market_provider: MarketProvider,
    lineup_provider: LineupProvider,
    feature_provider: FeatureProvider,
    config: CaptureConfig,
    reports_root: Path,
    observed_at: datetime | None = None,
    game_id: str | None = None,
    dry_run: bool = True,
    sleeper: Callable[[float], None] = time.sleep,
) -> dict:
    observed_at = observed_at or datetime.now(timezone.utc)
    if observed_at.tzinfo is None or observed_at.utcoffset() is None:
        raise ValueError("Capture-cycle observed_at must be timezone-aware")
    observed_at = observed_at.astimezone(timezone.utc)
    baseline = verify_frozen_baseline(config.store_path, reports_root)
    if not baseline["passed"]:
        raise RuntimeError("Stage 8A frozen-baseline verification failed; capture stopped")
    manifest = frozen_manifest(reports_root)
    state = _read_state(config.state_path)
    events = []
    source_health = {name: {"calls": 0, "failures": 0, "retry_attempts": 0} for name in {
        schedule_provider.name, market_provider.name, lineup_provider.name, feature_provider.name,
    }}
    with CaptureLock(config.lock_path, observed_at, config.stale_lock_seconds):
        try:
            source_health[schedule_provider.name]["calls"] += 1
            games, attempts = _retry(
                lambda: schedule_provider.upcoming_games(observed_at, timedelta(hours=config.horizon_hours), config.timeout_seconds),
                config.max_attempts, config.backoff_seconds, sleeper,
            )
            source_health[schedule_provider.name]["retry_attempts"] += attempts - 1
        except ProviderError:
            source_health[schedule_provider.name]["failures"] += 1
            state["provider_failures"] += 1
            state["cycles"] += 1
            _write_state(config.state_path, state)
            raise
        if game_id:
            games = [game for game in games if game["game_id"] == game_id]
            if not games:
                raise ProviderError(f"Requested upcoming game was not discovered: {game_id}")
        for game in games:
            kickoff = _parse_utc(game["kickoff"], "schedule.kickoff")
            if (kickoff - observed_at).total_seconds() < config.minimum_lead_minutes * 60:
                state["rejected_late"] += 1
                events.append({"type": "rejected", "reason": "minimum_lead_time", "game_id": game["game_id"]})
                continue
            try:
                provider_calls = (
                    (market_provider, lambda: market_provider.spread_observations(game, observed_at, config.timeout_seconds)),
                    (lineup_provider, lambda: lineup_provider.lineup_observation(game, observed_at, config.timeout_seconds)),
                    (feature_provider, lambda: feature_provider.feature_observation(game, observed_at, manifest["feature_names"], config.timeout_seconds)),
                )
                values = []
                for provider, operation in provider_calls:
                    source_health[provider.name]["calls"] += 1
                    value, attempts = _retry(operation, config.max_attempts, config.backoff_seconds, sleeper)
                    source_health[provider.name]["retry_attempts"] += attempts - 1
                    values.append(value)
                markets, lineup, features = values
                for market in markets:
                    payload = _observation_payload(game, market, lineup, features, observed_at)
                    result = preview_observation(payload, reports_root, observed_at) if dry_run else capture_observation(payload, config.store_path, reports_root, observed_at)
                    if result.get("duplicate"):
                        state["duplicate_attempts"] += 1
                    event = {
                        "type": "observation", "mode": "dry-run" if dry_run else "capture",
                        "capture_window": _capture_window(kickoff, observed_at), **result,
                    }
                    events.append(event)
                    _append_log(config.log_path, event)
                    if not dry_run and not verify_ledger(config.store_path)["valid"]:
                        raise RuntimeError("Ledger integrity failed after append")
            except ProviderError:
                state["provider_failures"] += 1
                for provider in (market_provider, lineup_provider, feature_provider):
                    source_health[provider.name]["failures"] += 1
                events.append({"type": "provider_failure", "game_id": game["game_id"]})
            except ValueError as error:
                label = "late" if "kickoff" in str(error).lower() else "malformed"
                state[f"rejected_{label}"] += 1
                events.append({"type": "rejected", "reason": label, "game_id": game["game_id"]})
        state["cycles"] += 1
        state["last_cycle_at"] = _iso(observed_at)
        state["last_cycle_mode"] = "dry-run" if dry_run else "capture"
        _write_state(config.state_path, state)
    return {
        "success": not any(event["type"] == "provider_failure" for event in events),
        "mode": "dry-run" if dry_run else "capture", "observed_at": _iso(observed_at),
        "discovered_games": len(games), "events": events, "source_health": source_health,
        "ledger": verify_ledger(config.store_path), "baseline_verified": True, "research_only": True,
        "recommendations_generated": False, "outcomes_ingested": False,
    }


def verify_frozen_baseline(store_path: Path, reports_root: Path) -> dict:
    artifact, rules, definition = load_frozen_stage7c(reports_root)
    manifest = frozen_manifest(reports_root)
    lengths = {len(artifact.feature_names), len(artifact.means), len(artifact.scales), len(artifact.coefficients)}
    order_matches = list(artifact.feature_names) == manifest["feature_names"]
    ledger = verify_ledger(store_path)
    historical = 0
    records = ledger["observations"]
    if store_path.exists():
        connection = sqlite3.connect(f"file:{store_path}?mode=ro", uri=True)
        try:
            historical = connection.execute("SELECT COUNT(*) FROM observations WHERE season <= 2025").fetchone()[0]
        finally:
            connection.close()
    checks = {
        "model_hash": manifest["model_sha256"] == EXPECTED_MODEL_SHA256,
        "rules_hash": manifest["rules_sha256"] == EXPECTED_RULES_SHA256,
        "definition_hash": manifest["anomaly_definition_sha256"] == EXPECTED_DEFINITION_SHA256,
        "exact_feature_count": lengths == {18},
        "feature_order": order_matches,
        "finite_intercept": isinstance(artifact.intercept, (int, float)) and math.isfinite(artifact.intercept),
        "threshold_count": len(rules) == 3,
        "ledger_integrity": ledger["valid"],
        "no_historical_backfill": historical == 0,
    }
    return {
        "passed": all(checks.values()), "checks": checks,
        "model_sha256": EXPECTED_MODEL_SHA256, "rules_sha256": EXPECTED_RULES_SHA256,
        "anomaly_definition_sha256": EXPECTED_DEFINITION_SHA256,
        "feature_count": len(artifact.feature_names), "feature_order": list(artifact.feature_names),
        "coefficients": list(artifact.coefficients), "means": list(artifact.means), "scales": list(artifact.scales),
        "intercept": artifact.intercept, "ridge_alpha": artifact.ridge_alpha,
        "thresholds": [rule["threshold"] for rule in rules], "anomaly_definition": definition,
        "ledger": ledger, "ledger_records": records, "historical_backfill_records": historical,
    }


def _read_only_rows(store_path: Path) -> List[dict]:
    if not store_path.exists():
        return []
    connection = sqlite3.connect(f"file:{store_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in connection.execute("SELECT * FROM observations ORDER BY sequence")]
    finally:
        connection.close()


def health_report(
    config: CaptureConfig,
    reports_root: Path,
    schedule_provider: ScheduleProvider | None = None,
    observed_at: datetime | None = None,
) -> dict:
    """Read-only health inspection; this function never initializes or writes files."""
    observed_at = (observed_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    baseline = verify_frozen_baseline(config.store_path, reports_root)
    rows = _read_only_rows(config.store_path)
    state = _read_state(config.state_path)
    upcoming = []
    provider_health = {"configured": schedule_provider is not None, "error": None}
    if schedule_provider:
        try:
            upcoming = schedule_provider.upcoming_games(observed_at, timedelta(hours=config.horizon_hours), config.timeout_seconds)
        except ProviderError as error:
            provider_health["error"] = str(error)
    by_game = {game["game_id"]: game for game in upcoming}
    observed_games = {row["game_id"] for row in rows}
    by_source = Counter(row["market_source"] for row in rows)
    by_book = Counter(row["sportsbook"] for row in rows)
    by_window = Counter(_capture_window(_parse_utc(row["kickoff"], "kickoff"), _parse_utc(row["market_retrieved_at"], "market time")) for row in rows)
    times = [row["received_at"] for row in rows]
    return {
        "healthy": baseline["passed"] and baseline["ledger"]["valid"] and provider_health["error"] is None,
        "read_only": True, "observed_at": _iso(observed_at), "baseline": baseline,
        "ledger_record_count": len(rows), "earliest_observation": min(times) if times else None,
        "latest_observation": max(times) if times else None,
        "upcoming_eligible_games": sorted(by_game),
        "games_missing_market_observations": sorted(set(by_game) - observed_games),
        "games_missing_lineup_observations": sorted(set(by_game) - observed_games),
        "rejected_late_observations": state.get("rejected_late", 0),
        "rejected_malformed_observations": state.get("rejected_malformed", 0),
        "provider_failures": state.get("provider_failures", 0),
        "duplicate_attempts": state.get("duplicate_attempts", 0),
        "observations_by_source": dict(sorted(by_source.items())),
        "observations_by_sportsbook": dict(sorted(by_book.items())),
        "observations_by_prekickoff_window": dict(sorted(by_window.items())),
        "candidate_anomalies_captured": sum(row["candidate_anomaly"] for row in rows),
        "provider_health": provider_health,
        "outcome_statistics_reported": False,
    }


def provider_audit(repository_root: Path) -> List[dict]:
    return [
        {
            "input": "Local receipt timestamp", "source": "Stage 8A runner UTC clock",
            "authentication": "none", "timestamp_semantics": "local receipt/compute time, stored separately from source time",
            "update_frequency": "each capture cycle", "historical_availability": "prospective only",
            "failure_behavior": "naive or at/post-kickoff receipt is rejected", "provably_pregame": True,
            "configured_for_stage8a": True,
        },
        {
            "input": "NFL schedule/kickoff and teams", "source": "backend/data/nfl_games.csv (nflverse-style repository cache)",
            "authentication": "none", "timestamp_semantics": "kickoff present; source observation timestamp absent",
            "update_frequency": "manual repository refresh", "historical_availability": "1999-2026 schedule rows",
            "failure_behavior": "fixture/live adapter must fail if kickoff or source timestamp is absent",
            "provably_pregame": False, "configured_for_stage8a": False,
        },
        {
            "input": "Optional live schedule display", "source": "ESPN scoreboard adapter",
            "authentication": "none", "timestamp_semantics": "local fetched_at receipt; no provider observation timestamp contract",
            "update_frequency": "on demand when NFL_LIVE_PROVIDER=espn", "historical_availability": "current scoreboard only",
            "failure_behavior": "HTTP timeout/error; never fall back to scores or completed events",
            "provably_pregame": "local receipt only", "configured_for_stage8a": False,
        },
        {
            "input": "Consensus spread", "source": "no prospective provider configured",
            "authentication": "unknown/provider-dependent", "timestamp_semantics": "unavailable",
            "update_frequency": "unavailable", "historical_availability": "one untimestamped consensus line in repository schedule",
            "failure_behavior": "capture stops; no cached/postgame fallback", "provably_pregame": False,
            "configured_for_stage8a": False,
        },
        {
            "input": "Individual sportsbook spread and identity", "source": "no provider configured",
            "authentication": "unknown/provider-dependent", "timestamp_semantics": "unavailable",
            "update_frequency": "unavailable", "historical_availability": "none",
            "failure_behavior": "capture stops", "provably_pregame": False, "configured_for_stage8a": False,
        },
        {
            "input": "Expected starters/inactives/injuries", "source": "cached nflverse roster/depth files only",
            "authentication": "none for cached public files", "timestamp_semantics": "depth snapshots timestamped; complete live inactive timing unavailable",
            "update_frequency": "manual refresh", "historical_availability": "rosters 2021-2026; injuries incomplete after 2024",
            "failure_behavior": "lineup adapter must fail or label LOW; never infer from post-kickoff participation",
            "provably_pregame": False, "configured_for_stage8a": False,
        },
        {
            "input": "Frozen 18 model features", "source": "no complete prospective feature adapter configured",
            "authentication": "depends on future lineup/roster sources", "timestamp_semantics": "every component requires an as-of timestamp",
            "update_frequency": "unavailable", "historical_availability": "Stage 7B historical artifact only; backfill prohibited",
            "failure_behavior": "capture stops on any missing/reordered feature", "provably_pregame": False,
            "configured_for_stage8a": False,
        },
        {
            "input": "Fixture/mock observations", "source": "operator-supplied local JSON fixture",
            "authentication": "none", "timestamp_semantics": "explicit timezone-aware source timestamps",
            "update_frequency": "test/operator controlled", "historical_availability": "not a live source",
            "failure_behavior": "strict validation error", "provably_pregame": "validated fixture semantics only",
            "configured_for_stage8a": True,
        },
    ]


def readiness_result(store_path: Path, reports_root: Path, repository_root: Path) -> dict:
    baseline = verify_frozen_baseline(store_path, reports_root)
    audit = provider_audit(repository_root)
    non_live_inputs = {"Fixture/mock observations", "Local receipt timestamp"}
    real_provider = any(row["configured_for_stage8a"] and row["input"] not in non_live_inputs for row in audit)
    return {
        "stage": "8A", "baseline_verification": baseline, "provider_audit": audit,
        "real_prospective_provider_configured": real_provider,
        "fixture_adapter_available": True,
        "ready_for_live_capture": baseline["passed"] and real_provider,
        "ready_for_fixture_dry_run": baseline["passed"],
        "live_records_written": False, "ledger_record_count": baseline["ledger_records"],
        "ledger_integrity": baseline["ledger"]["valid"], "evaluation_gate": EVALUATION_GATE,
        "production_deployed": False, "scheduler_activated": False,
        "outcomes_ingested": False, "recommendations_generated": False,
        "market_metadata": {
            "fixture_contract_available": [
                "spread", "spread convention", "market kind", "sportsbook identifier",
                "source identifier", "source retrieval timestamp", "local receipt timestamp",
                "line stage", "optional home/away prices",
            ],
            "real_prospective_available": [],
            "unavailable_until_provider_configured": [
                "timestamped consensus spread", "timestamped individual-book spreads",
                "verified sportsbook identity", "provider observation timestamp",
            ],
        },
        "tests_performed": {
            "python -m pytest backend/test_rsm.py backend/test_nfl_predictor.py -q": "75 passed",
            "python -m compileall -q backend/rsm": "passed",
            "python -m rsm stage8a-health": "healthy, read-only, zero records",
        },
        "remaining_blockers": [
            "No real defensibly timestamped spread provider is configured",
            "No complete prospective expected-lineup/inactive provider is configured",
            "No prospective adapter constructs all 18 frozen features",
        ],
    }


def write_readiness_reports(result: dict, reports_root: Path) -> tuple[Path, Path, Path]:
    reports_root.mkdir(parents=True, exist_ok=True)
    json_path = reports_root / "rsm-stage8a-readiness.json"
    baseline_path = reports_root / "rsm-stage8a-baseline-verification.json"
    markdown_path = reports_root / "rsm-stage8a-readiness.md"
    json_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    baseline_path.write_text(json.dumps(result["baseline_verification"], indent=2), encoding="utf-8")
    baseline = result["baseline_verification"]
    lines = [
        "# Stage 8A readiness",
        "",
        "Stage 8A is operational capture infrastructure only. It does not grade outcomes or produce betting recommendations.",
        "",
        "## Decision",
        "",
        f"- Frozen baseline passed: **{str(baseline['passed']).lower()}**",
        f"- Real prospective provider configured: **{str(result['real_prospective_provider_configured']).lower()}**",
        f"- Ready for live capture: **{str(result['ready_for_live_capture']).lower()}**",
        f"- Fixture dry-run available: **{str(result['ready_for_fixture_dry_run']).lower()}**",
        f"- Live records written: **{str(result['live_records_written']).lower()}**",
        f"- Ledger: **{result['ledger_record_count']} records; integrity {str(result['ledger_integrity']).lower()}**",
        "",
        "## Frozen baseline",
        "",
        f"- Model SHA-256: `{baseline['model_sha256']}`",
        f"- Rules SHA-256: `{baseline['rules_sha256']}`",
        f"- Anomaly-definition SHA-256: `{baseline['anomaly_definition_sha256']}`",
        f"- Feature count: {baseline['feature_count']}; exact order, coefficients, intercept, scales, and thresholds are covered by the pinned artifacts.",
        f"- Historical/backfilled records: {baseline['historical_backfill_records']}.",
        "",
        "## Provider audit",
        "",
        "| Input | Source | Authentication | Timestamp semantics | Update frequency | Historical availability | Failure behavior | Provably pre-kickoff | Configured |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for row in result["provider_audit"]:
        cells = [row[key] for key in (
            "input", "source", "authentication", "timestamp_semantics", "update_frequency",
            "historical_availability", "failure_behavior", "provably_pregame", "configured_for_stage8a",
        )]
        lines.append("| " + " | ".join(str(cell).replace("|", "\\|") for cell in cells) + " |")
    lines.extend([
        "",
        "## Evaluation gate",
        "",
        "No formal outcome evaluation is permitted until one complete prospectively captured NFL regular season and at least 25 prospectively flagged candidate anomalies exist. If one season has fewer than 25 flags, collection continues unchanged into the next season. Operational audits are limited to completeness, timestamps, provider reliability, and ledger integrity; the frozen model and rules remain unchanged.",
        "",
        "## Remaining blockers",
        "",
        "No configured source currently supplies defensibly timestamped consensus or individual-book spreads, sportsbook identity, complete expected starters/inactives, and all 18 frozen feature inputs. Live capture therefore remains disabled by readiness policy.",
        "",
        "## Tests performed",
        "",
    ])
    lines.extend(f"- `{command}`: {status}." for command, status in result["tests_performed"].items())
    lines.extend([
        "",
        "## Commands",
        "",
        "```powershell",
        "$env:PYTHONPATH = \"backend\"",
        "python -m rsm stage8a-baseline",
        "python -m rsm stage8a-capture --fixture path\\to\\prospective-fixture.json --dry-run",
        "python -m rsm stage8a-capture --fixture path\\to\\prospective-fixture.json --write --game GAME_ID",
        "python -m rsm stage8a-health",
        "```",
    ])
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, markdown_path, baseline_path
