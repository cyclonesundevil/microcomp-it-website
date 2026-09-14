"""Append-only outcome records and predeclared grading for manual Stage 8 capture.

This module does not modify observations.  It grades one deterministic
observation per game: the first successfully recorded pre-kickoff observation
(lowest ledger sequence).  Later captures are retained for line-movement
research but never selected after an outcome is known.
"""
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .stage8_shadow import _connect, _iso, _parse_timestamp


DEFAULT_OUTCOME_STORE = Path(__file__).resolve().parents[1] / "data" / "rsm" / "shadow" / "stage8-outcomes.sqlite3"
EVALUATION_POLICY = "FIRST_RECORDED_PRE_KICKOFF_OBSERVATION_PER_GAME"
DEFAULT_TOTAL_OBSERVATION_STORE = Path(__file__).resolve().parents[1] / "data" / "rsm" / "shadow" / "stage8-total-observations.sqlite3"
# This is deliberately a distinct policy from the spread ledger.  It is fixed
# before outcomes are recorded, so repeated market captures cannot be selected
# after the fact.
TOTAL_EVALUATION_POLICY = "FIRST_RECORDED_PRE_KICKOFF_TOTAL_OBSERVATION_PER_GAME"
TOTAL_MODEL_VERSION = "RSM-v2 Stage7B Total diagnostic (experimental)"


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def initialize_outcome_store(path: Path) -> None:
    with _connect(path) as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS outcomes (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT NOT NULL UNIQUE,
                observation_event_id TEXT NOT NULL,
                home_score REAL NOT NULL,
                away_score REAL NOT NULL,
                source TEXT NOT NULL,
                observed_at TEXT NOT NULL,
                received_at TEXT NOT NULL,
                record_hash TEXT NOT NULL UNIQUE
            );
            CREATE TRIGGER IF NOT EXISTS outcomes_no_update
                BEFORE UPDATE ON outcomes BEGIN SELECT RAISE(ABORT, 'Stage 8 outcomes are append-only'); END;
            CREATE TRIGGER IF NOT EXISTS outcomes_no_delete
                BEFORE DELETE ON outcomes BEGIN SELECT RAISE(ABORT, 'Stage 8 outcomes are append-only'); END;
        """)


def _first_observations(observation_store: Path):
    if not observation_store.exists():
        return []
    with _connect(observation_store) as connection:
        rows = connection.execute("""
            SELECT o.* FROM observations o
            JOIN (SELECT game_id, MIN(sequence) AS sequence FROM observations GROUP BY game_id) chosen
              ON chosen.sequence = o.sequence
            ORDER BY o.kickoff, o.sequence
        """).fetchall()
    return [dict(row) for row in rows]


def initialize_total_observation_store(path: Path) -> None:
    """Create the companion total ledger without changing the Stage 8 spread ledger."""
    with _connect(path) as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS total_observations (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                record_hash TEXT NOT NULL UNIQUE,
                game_id TEXT NOT NULL,
                season INTEGER NOT NULL,
                week INTEGER NOT NULL,
                game_type TEXT NOT NULL CHECK(game_type IN ('REG', 'POST')),
                kickoff TEXT NOT NULL,
                received_at TEXT NOT NULL,
                prediction_timestamp TEXT NOT NULL,
                away_team TEXT NOT NULL,
                home_team TEXT NOT NULL,
                predicted_total REAL NOT NULL,
                market_total REAL NOT NULL,
                total_edge REAL NOT NULL,
                total_pick TEXT NOT NULL CHECK(total_pick IN ('OVER', 'UNDER', 'NONE')),
                sportsbook TEXT NOT NULL,
                market_source TEXT NOT NULL,
                market_observed_at TEXT NOT NULL,
                market_entry_mode TEXT NOT NULL,
                total_model_version TEXT NOT NULL,
                feature_names_json TEXT NOT NULL,
                features_json TEXT NOT NULL,
                features_as_of TEXT NOT NULL,
                features_source TEXT NOT NULL,
                lineup_confidence TEXT NOT NULL,
                lineup_source TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS total_observations_game_time
                ON total_observations(game_id, sequence);
            CREATE TRIGGER IF NOT EXISTS total_observations_no_update
                BEFORE UPDATE ON total_observations BEGIN SELECT RAISE(ABORT, 'Stage 8 total observations are append-only'); END;
            CREATE TRIGGER IF NOT EXISTS total_observations_no_delete
                BEFORE DELETE ON total_observations BEGIN SELECT RAISE(ABORT, 'Stage 8 total observations are append-only'); END;
        """)


def _total_pick(edge: float) -> str:
    return "OVER" if edge > 0 else "UNDER" if edge < 0 else "NONE"


def capture_total_observation(payload: dict, store: Path, received_at=None) -> dict:
    """Append a pre-kickoff total record with the exact frozen display inputs."""
    expected = {
        "game_id", "season", "week", "game_type", "kickoff", "away_team", "home_team",
        "predicted_total", "market_total", "sportsbook", "market_source", "market_observed_at",
        "features", "feature_names", "features_as_of", "features_source", "lineup_confidence",
        "lineup_source", "total_model_version",
    }
    if not isinstance(payload, dict) or set(payload) != expected:
        raise ValueError("total observation fields are incomplete or invalid")
    received = (received_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    kickoff = _parse_timestamp(payload["kickoff"], "kickoff")
    market_observed = _parse_timestamp(payload["market_observed_at"], "market_observed_at")
    features_as_of = _parse_timestamp(payload["features_as_of"], "features_as_of")
    if received >= kickoff:
        raise ValueError("total observations must be recorded strictly before kickoff")
    if market_observed > received:
        raise ValueError("market_observed_at cannot be later than receipt time")
    if features_as_of > received:
        raise ValueError("features_as_of cannot be later than receipt time")
    if str(payload["game_type"]).upper() not in {"REG", "POST"}:
        raise ValueError("game_type must be REG or POST")
    if not all(str(payload[key]).strip() for key in ("game_id", "away_team", "home_team", "sportsbook", "market_source", "features_source", "lineup_confidence", "lineup_source")):
        raise ValueError("total observation provenance fields are required")
    if payload["total_model_version"] != TOTAL_MODEL_VERSION:
        raise ValueError("unexpected frozen total model version")
    feature_names = payload["feature_names"]
    features = payload["features"]
    if not isinstance(feature_names, list) or not feature_names or not isinstance(features, dict) or set(feature_names) != set(features):
        raise ValueError("total observation features must preserve the exact named model vector")
    try:
        predicted_total = float(payload["predicted_total"])
        market_total = float(payload["market_total"])
        [float(features[name]) for name in feature_names]
    except (TypeError, ValueError) as error:
        raise ValueError("total prediction, market total, and features must be numeric") from error
    edge = predicted_total - market_total
    record = {
        "game_id": str(payload["game_id"]), "season": int(payload["season"]), "week": int(payload["week"]),
        "game_type": str(payload["game_type"]).upper(), "kickoff": _iso(kickoff), "received_at": _iso(received),
        "prediction_timestamp": _iso(received), "away_team": str(payload["away_team"]).upper(), "home_team": str(payload["home_team"]).upper(),
        "predicted_total": predicted_total, "market_total": market_total, "total_edge": edge, "total_pick": _total_pick(edge),
        "sportsbook": str(payload["sportsbook"]).strip(), "market_source": str(payload["market_source"]).strip(),
        "market_observed_at": _iso(market_observed), "market_entry_mode": "MANUAL_UNVERIFIED",
        "total_model_version": TOTAL_MODEL_VERSION, "feature_names_json": json.dumps(feature_names, separators=(",", ":")),
        "features_json": json.dumps(features, sort_keys=True, separators=(",", ":")), "features_as_of": _iso(features_as_of),
        "features_source": str(payload["features_source"]), "lineup_confidence": str(payload["lineup_confidence"]), "lineup_source": str(payload["lineup_source"]),
    }
    record_hash = _digest(record)
    event_id = f"rsm-total-{record_hash[:20]}"
    initialize_total_observation_store(store)
    with _connect(store) as connection:
        existing = connection.execute("SELECT * FROM total_observations WHERE record_hash = ?", (record_hash,)).fetchone()
        if existing:
            return {"recorded": False, "duplicate": True, "event_id": existing["event_id"], "observation": dict(existing)}
        connection.execute(
            f"INSERT INTO total_observations (event_id, record_hash, {', '.join(record)}) VALUES ({', '.join('?' for _ in range(len(record) + 2))})",
            [event_id, record_hash, *record.values()],
        )
    return {"recorded": True, "duplicate": False, "event_id": event_id, "observation": {"event_id": event_id, "record_hash": record_hash, **record}}


def _first_total_observations(store: Path):
    if not store.exists():
        return []
    with _connect(store) as connection:
        rows = connection.execute("""
            SELECT o.* FROM total_observations o
            JOIN (SELECT game_id, MIN(sequence) sequence FROM total_observations GROUP BY game_id) chosen
              ON o.sequence = chosen.sequence
            ORDER BY o.kickoff, o.sequence
        """).fetchall()
    return [dict(row) for row in rows]


def _wilson_interval(wins: int, total: int):
    if not total:
        return None
    z = 1.959963984540054
    proportion = wins / total
    denominator = 1 + z * z / total
    center = (proportion + z * z / (2 * total)) / denominator
    radius = z * ((proportion * (1 - proportion) / total + z * z / (4 * total * total)) ** 0.5) / denominator
    return [center - radius, center + radius]


def total_evaluation_report(total_store: Path, outcome_store: Path) -> dict:
    observations = _first_total_observations(total_store)
    outcomes = {}
    if outcome_store.exists():
        with _connect(outcome_store) as connection:
            outcomes = {row["game_id"]: dict(row) for row in connection.execute("SELECT * FROM outcomes")}
    rows = []
    for observation in observations:
        outcome = outcomes.get(observation["game_id"])
        if not outcome:
            continue
        actual_total = outcome["home_score"] + outcome["away_score"]
        line_delta = actual_total - observation["market_total"]
        result = "push" if abs(line_delta) < 1e-9 else ("win" if (observation["total_pick"] == "OVER") == (line_delta > 0) else "loss")
        if observation["total_pick"] == "NONE":
            result = "no_selection"
        rows.append({
            "game_id": observation["game_id"], "observation_event_id": observation["event_id"], "selected_by": TOTAL_EVALUATION_POLICY,
            "game_type": observation["game_type"], "predicted_total": observation["predicted_total"], "market_total": observation["market_total"],
            "actual_total": actual_total, "total_absolute_error": abs(observation["predicted_total"] - actual_total),
            "total_squared_error": (observation["predicted_total"] - actual_total) ** 2, "total_pick": observation["total_pick"], "ou_result": result,
            "outcome_source": outcome["source"],
        })
    def summary(group):
        eligible = [row for row in group if row["ou_result"] in {"win", "loss", "push"}]
        decided = [row for row in eligible if row["ou_result"] in {"win", "loss"}]
        return {"eligible_games": len(eligible), "mae": sum(row["total_absolute_error"] for row in group) / len(group) if group else None,
                "rmse": (sum(row["total_squared_error"] for row in group) / len(group)) ** .5 if group else None,
                "wins": sum(row["ou_result"] == "win" for row in eligible), "losses": sum(row["ou_result"] == "loss" for row in eligible),
                "pushes": sum(row["ou_result"] == "push" for row in eligible), "accuracy_excluding_pushes": sum(row["ou_result"] == "win" for row in decided) / len(decided) if decided else None,
                "accuracy_95_ci": _wilson_interval(sum(row["ou_result"] == "win" for row in decided), len(decided))}
    return {"research_only": True, "evaluation_policy": TOTAL_EVALUATION_POLICY, "observations_available": len(observations),
            "outcomes_recorded": len(outcomes), "graded_games": len(rows), "overall": summary(rows),
            "regular_season": summary([row for row in rows if row["game_type"] == "REG"]), "playoffs": summary([row for row in rows if row["game_type"] == "POST"]), "rows": rows}


def record_outcome(payload: dict, observation_store: Path, outcome_store: Path, received_at=None) -> dict:
    expected = {"game_id", "home_score", "away_score", "source", "observed_at"}
    if not isinstance(payload, dict) or set(payload) != expected:
        raise ValueError("outcome fields must be game_id, home_score, away_score, source, and observed_at")
    received_at = (received_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    observed_at = _parse_timestamp(payload["observed_at"], "observed_at")
    if observed_at > received_at:
        raise ValueError("observed_at cannot be later than receipt time")
    if not str(payload["source"]).strip():
        raise ValueError("outcome source is required")
    try:
        home_score, away_score = float(payload["home_score"]), float(payload["away_score"])
    except (TypeError, ValueError) as error:
        raise ValueError("outcome scores must be numeric") from error
    if min(home_score, away_score) < 0:
        raise ValueError("outcome scores cannot be negative")
    chosen = next((row for row in _first_observations(observation_store) if row["game_id"] == str(payload["game_id"])), None)
    if not chosen:
        raise ValueError("no immutable pre-kickoff observation exists for this game")
    if received_at <= _parse_timestamp(chosen["kickoff"], "kickoff"):
        raise ValueError("outcomes can only be recorded after kickoff")
    initialize_outcome_store(outcome_store)
    record = {
        "game_id": chosen["game_id"], "observation_event_id": chosen["event_id"],
        "home_score": home_score, "away_score": away_score, "source": str(payload["source"]),
        "observed_at": _iso(observed_at), "received_at": _iso(received_at),
    }
    record_hash = _digest(record)
    with _connect(outcome_store) as connection:
        existing = connection.execute("SELECT * FROM outcomes WHERE game_id = ?", (record["game_id"],)).fetchone()
        if existing:
            return {"recorded": False, "duplicate": True, "outcome": dict(existing)}
        connection.execute(
            "INSERT INTO outcomes (game_id, observation_event_id, home_score, away_score, source, observed_at, received_at, record_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [*record.values(), record_hash],
        )
    return {"recorded": True, "duplicate": False, "outcome": {**record, "record_hash": record_hash}}


def _ats_result(observation, actual_margin):
    edge = actual_margin - observation["market_implied_home_margin"]
    pick = "home" if observation["market_disagreement"] > 0 else "away" if observation["market_disagreement"] < 0 else None
    if not pick:
        return None
    if abs(edge) < 1e-9:
        return "push"
    return "correct" if (pick == "home") == (edge > 0) else "wrong"


def evaluation_report(observation_store: Path, outcome_store: Path) -> dict:
    observations = _first_observations(observation_store)
    outcomes = {}
    if outcome_store.exists():
        with _connect(outcome_store) as connection:
            outcomes = {row["game_id"]: dict(row) for row in connection.execute("SELECT * FROM outcomes")}
    rows = []
    for observation in observations:
        outcome = outcomes.get(observation["game_id"])
        if not outcome:
            continue
        actual_margin = outcome["home_score"] - outcome["away_score"]
        predicted_margin = observation["roster_fair_home_margin"]
        winner_pick = "home" if predicted_margin > 0 else "away" if predicted_margin < 0 else None
        actual_winner = "home" if actual_margin > 0 else "away" if actual_margin < 0 else None
        rows.append({
            "game_id": observation["game_id"], "observation_event_id": observation["event_id"],
            "selected_by": EVALUATION_POLICY, "predicted_margin": predicted_margin,
            "actual_margin": actual_margin, "margin_absolute_error": abs(predicted_margin - actual_margin),
            "winner_pick": winner_pick, "winner_result": None if not winner_pick or not actual_winner else ("correct" if winner_pick == actual_winner else "wrong"),
            "ats_pick": "home" if observation["market_disagreement"] > 0 else "away" if observation["market_disagreement"] < 0 else None,
            "ats_result": _ats_result(observation, actual_margin),
            "market_implied_home_margin": observation["market_implied_home_margin"],
            "outcome_source": outcome["source"],
        })
    winner_rows = [row for row in rows if row["winner_result"]]
    ats_rows = [row for row in rows if row["ats_result"] in {"correct", "wrong"}]
    return {
        "research_only": True, "evaluation_policy": EVALUATION_POLICY,
        "observations_available": len(observations), "outcomes_recorded": len(outcomes), "graded_games": len(rows),
        "winner_accuracy": (sum(row["winner_result"] == "correct" for row in winner_rows) / len(winner_rows)) if winner_rows else None,
        "margin_mae": (sum(row["margin_absolute_error"] for row in rows) / len(rows)) if rows else None,
        "ats": {"graded": len(ats_rows), "correct": sum(row["ats_result"] == "correct" for row in ats_rows), "pushes": sum(row["ats_result"] == "push" for row in rows)},
        "rows": rows,
    }
