from datetime import datetime, timedelta, timezone

import pytest

from rsm.stage8_evaluation import (
    TOTAL_EVALUATION_POLICY,
    TOTAL_MODEL_VERSION,
    _connect,
    _digest,
    capture_total_observation,
    initialize_outcome_store,
    total_evaluation_report,
)


NOW = datetime(2026, 9, 14, 12, tzinfo=timezone.utc)
FEATURES = {"feature_a": 1.25, "feature_b": -2.5}


def payload(**changes):
    value = {
        "game_id": "2026_02_KC_PHI", "season": 2026, "week": 2, "game_type": "REG",
        "kickoff": "2026-09-15T00:00:00Z", "away_team": "KC", "home_team": "PHI",
        "predicted_total": 45.0, "market_total": 44.0, "sportsbook": "ExampleBook",
        "market_source": "MANUAL_UNVERIFIED: test", "market_observed_at": "2026-09-14T11:00:00Z",
        "features": FEATURES, "feature_names": ["feature_a", "feature_b"],
        "features_as_of": "2026-09-14T10:00:00Z", "features_source": "frozen fixture",
        "lineup_confidence": "LOW", "lineup_source": "frozen fixture", "total_model_version": TOTAL_MODEL_VERSION,
    }
    value.update(changes)
    return value


def add_outcome(store, game_id, home, away):
    initialize_outcome_store(store)
    record = {"game_id": game_id, "observation_event_id": "spread-or-total-anchor", "home_score": home,
              "away_score": away, "source": "manual final", "observed_at": "2026-09-16T01:00:00Z",
              "received_at": "2026-09-16T01:01:00Z"}
    with _connect(store) as connection:
        connection.execute(
            "INSERT INTO outcomes (game_id, observation_event_id, home_score, away_score, source, observed_at, received_at, record_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [*record.values(), _digest(record)],
        )


def test_total_observation_records_frozen_provenance_and_is_append_only(tmp_path):
    store = tmp_path / "totals.sqlite3"
    result = capture_total_observation(payload(), store, NOW)
    assert result["recorded"] is True
    assert result["observation"]["total_pick"] == "OVER"
    assert result["observation"]["total_model_version"] == TOTAL_MODEL_VERSION
    assert result["observation"]["market_entry_mode"] == "MANUAL_UNVERIFIED"
    assert capture_total_observation(payload(), store, NOW)["duplicate"] is True
    with _connect(store) as connection:
        with pytest.raises(Exception, match="append-only"):
            connection.execute("UPDATE total_observations SET market_total = 1")
        with pytest.raises(Exception, match="append-only"):
            connection.execute("DELETE FROM total_observations")


def test_total_edge_signs_and_whole_number_push(tmp_path):
    store, outcomes = tmp_path / "totals.sqlite3", tmp_path / "outcomes.sqlite3"
    first = capture_total_observation(payload(predicted_total=45, market_total=44), store, NOW)
    capture_total_observation(payload(game_id="2026_03_A_B", week=3, home_team="B", away_team="A", predicted_total=43, market_total=44), store, NOW)
    capture_total_observation(payload(game_id="2026_04_C_D", week=4, home_team="D", away_team="C", predicted_total=44, market_total=44), store, NOW)
    assert first["observation"]["total_pick"] == "OVER"
    add_outcome(outcomes, "2026_02_KC_PHI", 24, 20)  # Whole-number 44 is a push.
    add_outcome(outcomes, "2026_03_A_B", 20, 21)
    add_outcome(outcomes, "2026_04_C_D", 20, 24)
    report = total_evaluation_report(store, outcomes)
    assert report["evaluation_policy"] == TOTAL_EVALUATION_POLICY
    assert report["overall"]["pushes"] == 1
    assert report["overall"]["wins"] == 1
    assert report["overall"]["eligible_games"] == 2  # zero edge is no selection
    assert report["regular_season"]["accuracy_95_ci"] is not None


def test_half_point_total_cannot_push_for_integer_score(tmp_path):
    store, outcomes = tmp_path / "totals.sqlite3", tmp_path / "outcomes.sqlite3"
    capture_total_observation(payload(market_total=44.5, predicted_total=43), store, NOW)
    add_outcome(outcomes, "2026_02_KC_PHI", 24, 21)  # actual 45 > 44.5
    row = total_evaluation_report(store, outcomes)["rows"][0]
    assert row["ou_result"] == "loss"


def test_total_observation_rejects_missing_inputs_and_late_submission(tmp_path):
    store = tmp_path / "totals.sqlite3"
    incomplete = payload()
    incomplete.pop("features")
    with pytest.raises(ValueError, match="incomplete"):
        capture_total_observation(incomplete, store, NOW)
    with pytest.raises(ValueError, match="strictly before kickoff"):
        capture_total_observation(payload(), store, NOW + timedelta(days=1))
