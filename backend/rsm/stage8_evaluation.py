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
