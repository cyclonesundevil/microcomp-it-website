import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

from .stage7b_candidate import CandidateArtifact
from .stage7c_anomaly import apply_frozen_rules, score_market_disagreement


EXPECTED_MODEL_SHA256 = "679b088a793e0b3f56e946e3dc4c06e5d1b274827375b058bf03e85617f5b1fe"
EXPECTED_RULES_SHA256 = "afbe5518089b3e9ed55e28063f8836b8c11c05abf509cd622deafe94717746e8"
EXPECTED_DEFINITION_SHA256 = "1aeb53395566e4897dde44c72dfa47894e781687eede4b98f3f426f20b273d11"
SHADOW_SCHEMA_VERSION = 1
SHADOW_MODEL_VERSION = "RSM-v2-stage7c-frozen-stage8-shadow"
DEFAULT_STORE = Path(__file__).resolve().parents[1] / "data" / "rsm" / "shadow" / "stage8-shadow.sqlite3"


TOP_LEVEL_FIELDS = {
    "game_id", "season", "week", "kickoff", "prediction_timestamp",
    "away_team", "home_team", "schedule_source", "schedule_observed_at",
    "features", "features_as_of", "features_source", "lineup", "market",
}
LINEUP_FIELDS = {"confidence", "as_of", "source", "expected_starters", "inactive_or_injured"}
MARKET_FIELDS = {
    "sportsbook", "retrieved_timestamp", "line_type", "line_stage",
    "spread", "spread_convention", "home_price", "away_price", "source", "market_kind",
}
FORBIDDEN_TERMS = {"actual", "result", "outcome", "wager", "stake", "bet", "recommendation"}
LINE_STAGES = {"OPENING", "CURRENT", "CLOSING"}
SPREAD_CONVENTIONS = {"HOME_SPREAD", "HOME_MARGIN"}
MARKET_KINDS = {"CONSENSUS", "DERIVED_CONSENSUS", "INDIVIDUAL_BOOK"}


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _parse_timestamp(value: object, field: str) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field} is required")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{field} must be ISO-8601") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone offset")
    return parsed.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _artifact(payload: dict) -> CandidateArtifact:
    converted = dict(payload)
    for field in ("feature_names", "means", "scales", "coefficients", "training_seasons"):
        converted[field] = tuple(converted[field])
    return CandidateArtifact(**converted)


def load_frozen_stage7c(reports_root: Path) -> Tuple[CandidateArtifact, List[dict], dict]:
    model = json.loads((reports_root / "rsm-v2-candidate-stage7b.json").read_text(encoding="utf-8"))["model_a"]
    analysis = json.loads((reports_root / "rsm-stage7c-anomaly-analysis.json").read_text(encoding="utf-8"))
    rules = analysis["frozen_rules"]
    definition = analysis["anomaly_definition"]
    checks = (
        ("Stage 7B model", _digest(model), EXPECTED_MODEL_SHA256),
        ("Stage 7C rules", _digest(rules), EXPECTED_RULES_SHA256),
        ("Stage 7C anomaly definition", _digest(definition), EXPECTED_DEFINITION_SHA256),
    )
    for label, actual, expected in checks:
        if actual != expected:
            raise RuntimeError(f"{label} does not match the Stage 8 frozen hash")
    return _artifact(model), rules, definition


def frozen_manifest(reports_root: Path) -> dict:
    artifact, rules, definition = load_frozen_stage7c(reports_root)
    return {
        "schema_version": SHADOW_SCHEMA_VERSION,
        "shadow_model_version": SHADOW_MODEL_VERSION,
        "research_only": True,
        "automated_wagering": False,
        "recommendations_generated": False,
        "source_model": artifact.model_name,
        "source_training_seasons": list(artifact.training_seasons),
        "feature_names": list(artifact.feature_names),
        "ridge_alpha": artifact.ridge_alpha,
        "model_sha256": EXPECTED_MODEL_SHA256,
        "rules_sha256": EXPECTED_RULES_SHA256,
        "anomaly_definition_sha256": EXPECTED_DEFINITION_SHA256,
        "frozen_rules": rules,
        "anomaly_definition": definition,
    }


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_store(path: Path, reports_root: Path) -> dict:
    manifest = frozen_manifest(reports_root)
    with _connect(path) as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS observations (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                previous_event_hash TEXT NOT NULL,
                event_hash TEXT NOT NULL UNIQUE,
                received_at TEXT NOT NULL,
                prediction_timestamp TEXT NOT NULL,
                kickoff TEXT NOT NULL,
                game_id TEXT NOT NULL,
                season INTEGER NOT NULL,
                week INTEGER NOT NULL,
                away_team TEXT NOT NULL,
                home_team TEXT NOT NULL,
                schedule_source TEXT NOT NULL,
                schedule_observed_at TEXT NOT NULL,
                features_as_of TEXT NOT NULL,
                features_source TEXT NOT NULL,
                features_json TEXT NOT NULL,
                lineup_confidence TEXT NOT NULL,
                lineup_as_of TEXT NOT NULL,
                lineup_source TEXT NOT NULL,
                expected_starters_json TEXT NOT NULL,
                inactive_or_injured_json TEXT NOT NULL,
                sportsbook TEXT NOT NULL,
                market_kind TEXT NOT NULL,
                market_retrieved_at TEXT NOT NULL,
                line_stage TEXT NOT NULL,
                spread_convention TEXT NOT NULL,
                entered_spread REAL NOT NULL,
                market_implied_home_margin REAL NOT NULL,
                home_price REAL,
                away_price REAL,
                market_source TEXT NOT NULL,
                roster_fair_home_margin REAL NOT NULL,
                market_disagreement REAL NOT NULL,
                absolute_market_disagreement REAL NOT NULL,
                disagreement_direction TEXT NOT NULL,
                anomaly_score REAL NOT NULL,
                candidate_anomaly INTEGER NOT NULL CHECK(candidate_anomaly IN (0, 1)),
                flag_rule TEXT NOT NULL,
                supporting_group_count INTEGER NOT NULL,
                opposing_group_count INTEGER NOT NULL,
                top_reason_1 TEXT NOT NULL,
                top_reason_2 TEXT NOT NULL,
                top_reason_3 TEXT NOT NULL,
                model_version TEXT NOT NULL,
                model_sha256 TEXT NOT NULL,
                rules_sha256 TEXT NOT NULL,
                raw_payload_sha256 TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS observations_game_book_time
                ON observations(game_id, sportsbook, market_retrieved_at);
            CREATE TRIGGER IF NOT EXISTS observations_no_update
                BEFORE UPDATE ON observations BEGIN
                    SELECT RAISE(ABORT, 'Stage 8 observations are append-only');
                END;
            CREATE TRIGGER IF NOT EXISTS observations_no_delete
                BEFORE DELETE ON observations BEGIN
                    SELECT RAISE(ABORT, 'Stage 8 observations are append-only');
                END;
        """)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(observations)")}
        required_additions = {
            "market_kind": "TEXT NOT NULL DEFAULT 'INDIVIDUAL_BOOK'",
            "schedule_source": "TEXT NOT NULL DEFAULT 'pre-stage8a-unknown'",
            "schedule_observed_at": "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'",
            "features_source": "TEXT NOT NULL DEFAULT 'pre-stage8a-unknown'",
            "expected_starters_json": "TEXT NOT NULL DEFAULT '[]'",
            "inactive_or_injured_json": "TEXT NOT NULL DEFAULT '[]'",
        }
        missing_additions = [name for name in required_additions if name not in columns]
        if missing_additions:
            if connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0]:
                raise RuntimeError("Cannot migrate a nonempty pre-Stage-8A shadow ledger")
            for name in missing_additions:
                connection.execute(f"ALTER TABLE observations ADD COLUMN {name} {required_additions[name]}")
        metadata = {
            "schema_version": str(SHADOW_SCHEMA_VERSION),
            "model_sha256": EXPECTED_MODEL_SHA256,
            "rules_sha256": EXPECTED_RULES_SHA256,
            "definition_sha256": EXPECTED_DEFINITION_SHA256,
            "research_only": "true",
        }
        existing = dict(connection.execute("SELECT key, value FROM metadata"))
        for key, value in metadata.items():
            if key in existing and existing[key] != value:
                raise RuntimeError(f"Shadow store metadata mismatch for {key}")
            connection.execute("INSERT OR IGNORE INTO metadata(key, value) VALUES (?, ?)", (key, value))
    return manifest


def _validate_exact_fields(value: dict, expected: set[str], label: str) -> None:
    keys = set(value)
    if keys != expected:
        missing = sorted(expected - keys)
        extra = sorted(keys - expected)
        raise ValueError(f"{label} fields mismatch; missing={missing}, extra={extra}")


def _reject_forbidden_fields(value: object, path: str = "payload") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            words = set(str(key).lower().replace("-", "_").split("_"))
            if words & FORBIDDEN_TERMS:
                raise ValueError(f"{path}.{key} is forbidden in the shadow pre-kickoff contract")
            _reject_forbidden_fields(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_forbidden_fields(child, f"{path}[{index}]")


def validate_observation(payload: dict, artifact: CandidateArtifact, received_at: datetime) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Observation must be a JSON object")
    _reject_forbidden_fields(payload)
    _validate_exact_fields(payload, TOP_LEVEL_FIELDS, "observation")
    if not isinstance(payload["features"], dict) or set(payload["features"]) != set(artifact.feature_names):
        raise ValueError("features must exactly match the frozen Stage 7C feature set")
    _validate_exact_fields(payload["lineup"], LINEUP_FIELDS, "lineup")
    _validate_exact_fields(payload["market"], MARKET_FIELDS, "market")
    kickoff = _parse_timestamp(payload["kickoff"], "kickoff")
    prediction_time = _parse_timestamp(payload["prediction_timestamp"], "prediction_timestamp")
    schedule_time = _parse_timestamp(payload["schedule_observed_at"], "schedule_observed_at")
    features_as_of = _parse_timestamp(payload["features_as_of"], "features_as_of")
    lineup_as_of = _parse_timestamp(payload["lineup"]["as_of"], "lineup.as_of")
    market_time = _parse_timestamp(payload["market"]["retrieved_timestamp"], "market.retrieved_timestamp")
    if received_at.tzinfo is None or received_at.utcoffset() is None:
        raise ValueError("received_at must include a timezone offset")
    received = received_at.astimezone(timezone.utc)
    if prediction_time >= kickoff or received >= kickoff:
        raise ValueError("prediction and receipt must occur strictly before kickoff")
    if prediction_time > received:
        raise ValueError("prediction_timestamp cannot be later than receipt time")
    for label, timestamp in (("schedule_observed_at", schedule_time), ("features_as_of", features_as_of), ("lineup.as_of", lineup_as_of), ("market.retrieved_timestamp", market_time)):
        if timestamp > prediction_time:
            raise ValueError(f"{label} cannot be later than prediction_timestamp")
    confidence = str(payload["lineup"]["confidence"]).upper()
    if confidence not in {"HIGH", "MEDIUM", "LOW"}:
        raise ValueError("lineup.confidence must be HIGH, MEDIUM, or LOW")
    if not isinstance(payload["lineup"]["expected_starters"], list) or not isinstance(payload["lineup"]["inactive_or_injured"], list):
        raise ValueError("lineup expected_starters and inactive_or_injured must be lists")
    market = payload["market"]
    if str(market["line_type"]).upper() != "SPREAD":
        raise ValueError("Stage 8 accepts spread observations only; O/U is out of scope")
    stage = str(market["line_stage"]).upper()
    if stage not in LINE_STAGES:
        raise ValueError("market.line_stage must be OPENING, CURRENT, or CLOSING")
    convention = str(market["spread_convention"]).upper()
    if convention not in SPREAD_CONVENTIONS:
        raise ValueError("market.spread_convention must be HOME_SPREAD or HOME_MARGIN")
    if not str(market["sportsbook"]).strip() or not str(market["source"]).strip():
        raise ValueError("market sportsbook and source are required")
    market_kind = str(market["market_kind"]).upper()
    if market_kind not in MARKET_KINDS:
        raise ValueError("market.market_kind must be CONSENSUS, DERIVED_CONSENSUS, or INDIVIDUAL_BOOK")
    if market_kind == "CONSENSUS" and str(market["sportsbook"]).upper() != "CONSENSUS":
        raise ValueError("consensus observations must use sportsbook CONSENSUS")
    if market_kind == "DERIVED_CONSENSUS" and str(market["sportsbook"]).upper() != "DERIVED_CONSENSUS":
        raise ValueError("derived-consensus observations must use sportsbook DERIVED_CONSENSUS")
    if market_kind == "INDIVIDUAL_BOOK" and str(market["sportsbook"]).upper() == "CONSENSUS":
        raise ValueError("individual-book observations require a sportsbook identifier")
    if not all(str(payload[field]).strip() for field in ("schedule_source", "features_source")):
        raise ValueError("schedule and feature sources are required")
    if not str(payload["lineup"]["source"]).strip():
        raise ValueError("lineup source is required")
    if not str(payload["game_id"]).strip() or not str(payload["home_team"]).strip() or not str(payload["away_team"]).strip():
        raise ValueError("game and team identifiers are required")
    try:
        features = {name: float(payload["features"][name]) for name in artifact.feature_names}
        entered_spread = float(market["spread"])
        home_price = None if market["home_price"] in (None, "") else float(market["home_price"])
        away_price = None if market["away_price"] in (None, "") else float(market["away_price"])
    except (TypeError, ValueError) as error:
        raise ValueError("features, spread, and supplied prices must be numeric") from error
    market_margin = -entered_spread if convention == "HOME_SPREAD" else entered_spread
    return {
        "kickoff": kickoff, "prediction_time": prediction_time, "schedule_time": schedule_time,
        "features_as_of": features_as_of,
        "lineup_as_of": lineup_as_of, "market_time": market_time, "received_at": received,
        "confidence": confidence, "line_stage": stage, "spread_convention": convention, "market_kind": market_kind,
        "features": features, "entered_spread": entered_spread, "market_margin": market_margin,
        "home_price": home_price, "away_price": away_price,
    }


def observation_identifier(payload: dict) -> str:
    """Identify a source retrieval independently of local retry/compute time."""
    identity = {key: value for key, value in payload.items() if key != "prediction_timestamp"}
    return _digest(identity)[:24]


def _calculate_signal(payload: dict, artifact: CandidateArtifact, rules: Sequence[dict], validated: dict) -> dict:
    signal_row = {
        "season": payload["season"], "week": payload["week"], "game_id": payload["game_id"],
        "away_team": payload["away_team"], "home_team": payload["home_team"],
        "market_spread": validated["market_margin"], **validated["features"],
    }
    return apply_frozen_rules(
        score_market_disagreement(signal_row, artifact, validated["confidence"], {}),
        rules,
    )


def preview_observation(payload: dict, reports_root: Path, received_at: datetime | None = None) -> dict:
    artifact, rules, _ = load_frozen_stage7c(reports_root)
    received_at = received_at or datetime.now(timezone.utc)
    validated = validate_observation(payload, artifact, received_at)
    signal = _calculate_signal(payload, artifact, rules, validated)
    return {
        "event_id": observation_identifier(payload), "game_id": str(payload["game_id"]),
        "prediction_timestamp": _iso(validated["prediction_time"]), "kickoff": _iso(validated["kickoff"]),
        "sportsbook": str(payload["market"]["sportsbook"]), "line_stage": validated["line_stage"],
        "market_kind": validated["market_kind"],
        "roster_fair_home_margin": signal["roster_fair_home_margin"],
        "market_implied_home_margin": validated["market_margin"],
        "market_disagreement": signal["market_disagreement"],
        "disagreement_direction": signal["disagreement_direction"],
        "anomaly_score": signal["anomaly_score"], "candidate_anomaly": bool(signal["flagged"]),
        "flag_rule": signal["flag_rule"],
        "explanations": [signal["top_reason_1"], signal["top_reason_2"], signal["top_reason_3"]],
        "research_only": True, "dry_run": True, "ledger_appended": False, "duplicate": False,
    }


def _stored_result(row: sqlite3.Row | dict, duplicate: bool) -> dict:
    value = dict(row)
    return {
        "event_id": value["event_id"], "event_hash": value["event_hash"], "game_id": value["game_id"],
        "prediction_timestamp": value["prediction_timestamp"], "kickoff": value["kickoff"],
        "sportsbook": value["sportsbook"], "market_kind": value["market_kind"],
        "line_stage": value["line_stage"],
        "roster_fair_home_margin": value["roster_fair_home_margin"],
        "market_implied_home_margin": value["market_implied_home_margin"],
        "market_disagreement": value["market_disagreement"],
        "disagreement_direction": value["disagreement_direction"],
        "anomaly_score": value["anomaly_score"], "candidate_anomaly": bool(value["candidate_anomaly"]),
        "flag_rule": value["flag_rule"],
        "explanations": [value["top_reason_1"], value["top_reason_2"], value["top_reason_3"]],
        "research_only": True, "dry_run": False, "ledger_appended": not duplicate, "duplicate": duplicate,
    }


def capture_observation(payload: dict, store_path: Path, reports_root: Path, received_at: datetime | None = None) -> dict:
    artifact, rules, _ = load_frozen_stage7c(reports_root)
    initialize_store(store_path, reports_root)
    ledger = verify_ledger(store_path)
    if not ledger["valid"]:
        raise RuntimeError("Shadow ledger hash chain is invalid; capture stopped")
    received_at = received_at or datetime.now(timezone.utc)
    validated = validate_observation(payload, artifact, received_at)
    signal = _calculate_signal(payload, artifact, rules, validated)
    raw_payload_hash = _digest(payload)
    event_id = observation_identifier(payload)
    with _connect(store_path) as connection:
        duplicate_row = connection.execute("SELECT * FROM observations WHERE event_id = ?", (event_id,)).fetchone()
        if duplicate_row:
            return _stored_result(duplicate_row, duplicate=True)
        prior = connection.execute("SELECT event_hash FROM observations ORDER BY sequence DESC LIMIT 1").fetchone()
        previous_hash = prior["event_hash"] if prior else "GENESIS"
        record = {
            "previous_event_hash": previous_hash,
            "received_at": _iso(validated["received_at"]),
            "prediction_timestamp": _iso(validated["prediction_time"]),
            "kickoff": _iso(validated["kickoff"]),
            "game_id": str(payload["game_id"]), "season": int(payload["season"]), "week": int(payload["week"]),
            "away_team": str(payload["away_team"]), "home_team": str(payload["home_team"]),
            "schedule_source": str(payload["schedule_source"]),
            "schedule_observed_at": _iso(validated["schedule_time"]),
            "features_as_of": _iso(validated["features_as_of"]),
            "features_source": str(payload["features_source"]),
            "features_json": json.dumps(validated["features"], sort_keys=True, separators=(",", ":")),
            "lineup_confidence": validated["confidence"], "lineup_as_of": _iso(validated["lineup_as_of"]),
            "lineup_source": str(payload["lineup"]["source"]),
            "expected_starters_json": json.dumps(payload["lineup"]["expected_starters"], sort_keys=True, separators=(",", ":")),
            "inactive_or_injured_json": json.dumps(payload["lineup"]["inactive_or_injured"], sort_keys=True, separators=(",", ":")),
            "sportsbook": str(payload["market"]["sportsbook"]),
            "market_kind": validated["market_kind"],
            "market_retrieved_at": _iso(validated["market_time"]), "line_stage": validated["line_stage"],
            "spread_convention": validated["spread_convention"], "entered_spread": validated["entered_spread"],
            "market_implied_home_margin": validated["market_margin"], "home_price": validated["home_price"],
            "away_price": validated["away_price"], "market_source": str(payload["market"]["source"]),
            "roster_fair_home_margin": signal["roster_fair_home_margin"],
            "market_disagreement": signal["market_disagreement"],
            "absolute_market_disagreement": signal["absolute_market_disagreement"],
            "disagreement_direction": signal["disagreement_direction"], "anomaly_score": signal["anomaly_score"],
            "candidate_anomaly": int(signal["flagged"]), "flag_rule": signal["flag_rule"],
            "supporting_group_count": signal["supporting_group_count"], "opposing_group_count": signal["opposing_group_count"],
            "top_reason_1": signal["top_reason_1"], "top_reason_2": signal["top_reason_2"], "top_reason_3": signal["top_reason_3"],
            "model_version": SHADOW_MODEL_VERSION, "model_sha256": EXPECTED_MODEL_SHA256,
            "rules_sha256": EXPECTED_RULES_SHA256, "raw_payload_sha256": raw_payload_hash,
        }
        event_hash = _digest(record)
        columns = ["event_id", "event_hash", *record]
        values = [event_id, event_hash, *record.values()]
        connection.execute(
            f"INSERT INTO observations ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
            values,
        )
    with _connect(store_path) as connection:
        stored = connection.execute("SELECT * FROM observations WHERE event_id = ?", (event_id,)).fetchone()
    return _stored_result(stored, duplicate=False)


def verify_ledger(store_path: Path) -> dict:
    if not store_path.exists():
        return {"valid": True, "observations": 0, "last_event_hash": "GENESIS"}
    previous = "GENESIS"
    count = 0
    with _connect(store_path) as connection:
        rows = connection.execute("SELECT * FROM observations ORDER BY sequence").fetchall()
        for row in rows:
            values = dict(row)
            values.pop("sequence")
            event_id = values.pop("event_id")
            expected_hash = values.pop("event_hash")
            if values["previous_event_hash"] != previous or _digest(values) != expected_hash:
                return {"valid": False, "observations": count, "last_event_hash": previous}
            previous = expected_hash
            count += 1
    return {"valid": True, "observations": count, "last_event_hash": previous}


def line_movements(store_path: Path) -> List[dict]:
    if not store_path.exists():
        return []
    with _connect(store_path) as connection:
        rows = [dict(row) for row in connection.execute(
            "SELECT * FROM observations ORDER BY game_id, sportsbook, market_retrieved_at, sequence"
        )]
    grouped: Dict[Tuple[str, str], List[dict]] = {}
    for row in rows:
        grouped.setdefault((row["game_id"], row["sportsbook"]), []).append(row)
    output = []
    for (game_id, sportsbook), observations in sorted(grouped.items()):
        first, latest = observations[0], observations[-1]
        first_distance = abs(first["roster_fair_home_margin"] - first["market_implied_home_margin"])
        latest_distance_to_first_model = abs(first["roster_fair_home_margin"] - latest["market_implied_home_margin"])
        if len(observations) == 1 or math_is_close(first_distance, latest_distance_to_first_model):
            direction = "UNCHANGED"
        elif latest_distance_to_first_model < first_distance:
            direction = "TOWARD_MODEL"
        else:
            direction = "AWAY_FROM_MODEL"
        output.append({
            "game_id": game_id, "sportsbook": sportsbook, "observations": len(observations),
            "first_market_timestamp": first["market_retrieved_at"], "latest_market_timestamp": latest["market_retrieved_at"],
            "first_market_implied_home_margin": first["market_implied_home_margin"],
            "latest_market_implied_home_margin": latest["market_implied_home_margin"],
            "home_margin_movement": latest["market_implied_home_margin"] - first["market_implied_home_margin"],
            "reference_fair_home_margin": first["roster_fair_home_margin"],
            "movement_relative_to_first_model": direction,
            "closing_line_value_computed": False,
        })
    return output


def math_is_close(left: float, right: float) -> bool:
    return abs(left - right) < 1e-9


def shadow_status(store_path: Path, reports_root: Path) -> dict:
    manifest = frozen_manifest(reports_root)
    ledger = verify_ledger(store_path)
    movements = line_movements(store_path)
    observation_count = ledger["observations"]
    candidate_count = 0
    books = []
    games = []
    if store_path.exists():
        with _connect(store_path) as connection:
            candidate_count = connection.execute("SELECT COUNT(*) FROM observations WHERE candidate_anomaly = 1").fetchone()[0]
            books = [row[0] for row in connection.execute("SELECT DISTINCT sportsbook FROM observations ORDER BY sportsbook")]
            games = [row[0] for row in connection.execute("SELECT DISTINCT game_id FROM observations ORDER BY game_id")]
    return {
        "system": "Stage 8 prospective shadow observation",
        "research_only": True, "recommendations_generated": False, "automated_wagering": False,
        "store": str(store_path), "ledger": ledger, "observations": observation_count,
        "games": len(games), "sportsbooks": books, "candidate_anomaly_observations": candidate_count,
        "line_movements": movements, "freeze": manifest,
    }


def write_status_reports(status: dict, reports_root: Path) -> None:
    (reports_root / "rsm-stage8-shadow-status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
    lines = [
        "# Stage 8 - Prospective Shadow Observation System",
        "",
        "This is a research-only observation ledger. It records frozen-model fair margins, timestamped market spreads, reconstructed lineup confidence, explanations, candidate-anomaly labels, and pre-kickoff line movement. It does not generate betting recommendations or perform automated wagering.",
        "",
        "## Frozen configuration",
        "",
        f"- Model hash: `{status['freeze']['model_sha256']}`",
        f"- Rule hash: `{status['freeze']['rules_sha256']}`",
        f"- Anomaly-definition hash: `{status['freeze']['anomaly_definition_sha256']}`",
        f"- Frozen feature count: {len(status['freeze']['feature_names'])}",
        f"- Frozen ridge alpha: {status['freeze']['ridge_alpha']}",
        "- Source fitting period: 2021-2022. Stage 7C thresholds remain unchanged. No 2023-2025 outcome is used by capture or reporting.",
        "",
        "## Capture safeguards",
        "",
        "- Prediction receipt, model features, lineup snapshot, and market retrieval must all be timezone-aware and strictly pre-kickoff.",
        "- Feature keys must exactly equal the frozen Stage 7C feature set.",
        "- Outcome, result, wager, stake, bet, and recommendation fields are rejected.",
        "- Only spread observations are accepted; O/U anomaly modeling is not implemented.",
        "- Records are hash-chained and protected by SQLite triggers against update or deletion.",
        "",
        "## Current shadow ledger",
        "",
        f"- Ledger valid: {status['ledger']['valid']}",
        f"- Observations: {status['observations']}",
        f"- Games: {status['games']}",
        f"- Sportsbooks: {', '.join(status['sportsbooks']) if status['sportsbooks'] else 'none yet'}",
        f"- Candidate-anomaly observations: {status['candidate_anomaly_observations']}",
        "",
        "Line movement is measured relative to the first captured frozen-model fair margin for each game and sportsbook. Closing-line value is not computed, because Stage 8 has no outcomes and a line labeled CLOSING still depends on source timestamp integrity.",
        "",
        "STOP: this system is not deployed, does not place wagers, does not recommend sides, and does not evaluate or retune on 2023-2025 outcomes.",
    ]
    (reports_root / "rsm-stage8-shadow-system.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
