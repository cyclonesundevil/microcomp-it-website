import csv
import json
import shutil
import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from rsm.config import RSMConfig, normalize_position, normalize_team
from rsm.data import load_player_stats, load_roster_snapshot_rows
from rsm.historical_lineups import infer_expected_lineups
from rsm.fitting import TrainingPlan, fit_rsm_v1, game_observations
from rsm.integrity_audit import classify_lineup_confidence
from rsm.locked_backtest import (
    PLAYOFF_GAME_TYPES,
    grade_ats,
    grade_total,
    home_cover_probability,
    internal_home_margin,
    over_probability,
    select_ats,
    select_total,
    wilson_interval,
)
from rsm.stage6_diagnostics import edge_bucket, pearson
from rsm.stage7a_diagnostics import linear_regression, percentile
from rsm.stage7b_candidate import _select_alpha, multivariate_residual_ratio, residual_bucket
from rsm.stage7c_anomaly import (
    apply_frozen_rules,
    disagreement_direction,
    feature_contributions,
    freeze_thresholds,
    model_side,
    score_market_disagreement,
    sportsbook_home_spread_to_margin,
)
from rsm.stage8_shadow import (
    EXPECTED_DEFINITION_SHA256,
    EXPECTED_MODEL_SHA256,
    EXPECTED_RULES_SHA256,
    capture_observation,
    frozen_manifest,
    line_movements,
    load_frozen_stage7c,
    observation_identifier,
    preview_observation,
    verify_ledger,
)
from rsm.stage8_evaluation import EVALUATION_POLICY, evaluation_report, record_outcome
from rsm.stage8a_capture import (
    CaptureConfig,
    CaptureLock,
    FixtureProvider,
    ProviderError,
    _retry,
    health_report,
    run_capture_cycle,
    verify_frozen_baseline,
)
from rsm.ratings import (
    aggregate_player_stats,
    aggregate_snap_counts,
    build_player_ratings,
    build_team_ratings,
    expected_lineups,
)
from rsm.schema import PlayerRating
from rsm.score_model import predict_score


def roster_player(player_id, name, team, position, status="ACT", pfr_id=""):
    return {
        "gsis_id": player_id, "full_name": name, "team": team,
        "position": position, "depth_chart_position": position,
        "status": status, "pfr_id": pfr_id, "years_exp": "3",
    }


def stat_row(player_id, season, week, position="QB", epa=0.0, attempts=100.0):
    return {
        "player_id": player_id, "player_display_name": player_id,
        "season": str(season), "week": str(week), "season_type": "REG",
        "team": "KC", "opponent_team": "LV", "position": position,
        "attempts": str(attempts), "passing_epa": str(epa),
        "passing_yards": str(attempts * 7), "passing_tds": "5",
        "passing_interceptions": "2", "sacks_suffered": "5",
    }


def rating(player_id, position, value, team="KC"):
    return PlayerRating(
        player_id=player_id, name=player_id, team=team, position=position,
        rating=value, uncertainty=2.0, seasons_used=3, opportunities=1000,
        data_confidence="HIGH", as_of_season=2026, as_of_week=2,
        explanation={},
    )


def depth_row(team, player_id, position, slot, rank=1, group="Base Offense"):
    return {
        "team": team, "gsis_id": player_id, "player_name": player_id,
        "pos_abb": position, "pos_slot": str(slot), "pos_rank": str(rank),
        "pos_grp": group,
    }


def complete_depth(team="KC"):
    offense = [
        ("qb", "QB"), ("rb", "RB"), ("wr1", "WR"), ("wr2", "WR"),
        ("te", "TE"), ("lt", "LT"), ("lg", "LG"), ("c", "C"),
        ("rg", "RG"), ("rt", "RT"), ("fb", "FB"),
    ]
    defense = [
        ("lde", "LDE"), ("rdt", "RDT"), ("ldt", "LDT"), ("rde", "RDE"),
        ("wlb", "WLB"), ("mlb", "MLB"), ("slb", "SLB"),
        ("lcb", "LCB"), ("rcb", "RCB"), ("fs", "FS"), ("ss", "SS"),
    ]
    rows = [depth_row(team, player_id, position, slot) for slot, (player_id, position) in enumerate(offense, 1)]
    rows += [depth_row(team, player_id, position, slot, group="Base 4-3 D") for slot, (player_id, position) in enumerate(defense, 1)]
    rows.append(depth_row(team, "k", "PK", 1, group="Special Teams"))
    return rows


def test_player_history_strictly_precedes_prediction_week(tmp_path):
    path = tmp_path / "stats.csv"
    fields = list(stat_row("p1", 2026, 1).keys())
    with path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=fields)
        writer.writeheader()
        writer.writerow(stat_row("p1", 2026, 1))
        writer.writerow(stat_row("p1", 2026, 2))
        writer.writerow(stat_row("p1", 2025, 18))

    rows = load_player_stats([path], cutoff_season=2026, cutoff_week=2)

    assert {(int(row["season"]), int(row["week"])) for row in rows} == {(2025, 18), (2026, 1)}


def test_postseason_rows_are_not_loaded_into_regular_season_history(tmp_path):
    path = tmp_path / "stats.csv"
    regular = stat_row("p1", 2025, 18)
    postseason = {**stat_row("p1", 2025, 19), "season_type": "POST"}
    with path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=regular.keys())
        writer.writeheader(); writer.writerow(regular); writer.writerow(postseason)

    rows = load_player_stats([path], cutoff_season=2026, cutoff_week=2)

    assert len(rows) == 1
    assert rows[0]["season_type"] == "REG"


def test_recent_season_weighting_changes_player_rating():
    roster = [roster_player("recent", "Recent", "KC", "QB"), roster_player("peer", "Peer", "LV", "QB")]
    stats = [
        stat_row("recent", 2025, 1, epa=35), stat_row("peer", 2025, 1, epa=-10),
        stat_row("recent", 2022, 1, epa=-35), stat_row("peer", 2022, 1, epa=10),
    ]
    recent_config = RSMConfig(current_season=2026, current_week=2, season_weights=(0.35, .50, .05, .05, .05))
    old_config = replace(recent_config, season_weights=(.05, .05, .05, .05, .80))

    recent_rating = build_player_ratings(roster, stats, [], recent_config)["recent"].rating
    old_rating = build_player_ratings(roster, stats, [], old_config)["recent"].rating

    assert recent_rating > old_rating


def test_rookie_without_history_shrinks_to_replacement():
    roster = [roster_player("rookie", "Rookie", "KC", "QB")]
    result = build_player_ratings(roster, [], [], RSMConfig())["rookie"]

    assert result.rating == 50.0
    assert result.uncertainty == 12.0
    assert result.data_confidence == "LOW"


def test_inactive_depth_chart_starter_is_replaced_by_active_backup():
    roster = [
        roster_player("qb1", "Starter", "KC", "QB", status="RES"),
        roster_player("qb2", "Backup", "KC", "QB", status="ACT"),
    ]
    depth = [depth_row("KC", "qb1", "QB", 1, rank=1), depth_row("KC", "qb2", "QB", 1, rank=2)]
    lineups = expected_lineups(depth, roster, {"qb1": rating("qb1", "QB", 80), "qb2": rating("qb2", "QB", 52)})

    assert [player.player_id for player in lineups["KC"]] == ["qb2"]


def test_qb_has_more_offense_influence_than_running_back():
    depth = complete_depth()
    roster = [roster_player(row["gsis_id"], row["player_name"], "KC", row["pos_abb"]) for row in depth]
    base_ratings = {row["gsis_id"]: rating(row["gsis_id"], normalize_position(row["pos_abb"]), 60) for row in depth}
    qb_ratings = {**base_ratings, "qb": rating("qb", "QB", 80)}
    rb_ratings = {**base_ratings, "rb": rating("rb", "RB", 80)}

    qb_team = build_team_ratings(roster, depth, qb_ratings, "2026-09-11T00:00:00Z")[0]
    rb_team = build_team_ratings(roster, depth, rb_ratings, "2026-09-11T00:00:00Z")[0]

    assert qb_team.offense_rating > rb_team.offense_rating


def test_offensive_line_weakest_link_penalty_is_applied():
    depth = complete_depth()
    roster = [roster_player(row["gsis_id"], row["player_name"], "KC", row["pos_abb"]) for row in depth]
    ratings = {row["gsis_id"]: rating(row["gsis_id"], normalize_position(row["pos_abb"]), 60) for row in depth}
    ratings["lt"] = rating("lt", "OL", 40)

    team = build_team_ratings(roster, depth, ratings, "2026-09-11T00:00:00Z")[0]

    assert team.ol_overall_rating < 56.0


def test_team_rating_is_deterministic_and_has_defensive_dimensions():
    depth = complete_depth()
    roster = [roster_player(row["gsis_id"], row["player_name"], "KC", row["pos_abb"]) for row in depth]
    ratings = {row["gsis_id"]: rating(row["gsis_id"], normalize_position(row["pos_abb"]), 60) for row in depth}

    first = build_team_ratings(roster, depth, ratings, "2026-09-11T00:00:00Z")[0]
    second = build_team_ratings(roster, depth, ratings, "2026-09-11T00:00:00Z")[0]

    assert first == second
    assert first.pass_defense_rating == 60.0
    assert first.run_defense_rating == 60.0


def test_team_and_position_aliases_are_normalized():
    assert normalize_team("LAR") == "LA"
    assert normalize_team("OAK") == "LV"
    assert normalize_position("RDE") == "EDGE"
    assert normalize_position("LDT") == "DL"


def test_historical_lineup_never_uses_same_game_or_future_snaps():
    roster = [
        roster_player("prior", "Prior Starter", "KC", "QB", pfr_id="Prior01"),
        roster_player("future", "Future Starter", "KC", "QB", pfr_id="Future01"),
    ]
    snaps = [
        {"season": "2025", "week": "1", "game_type": "REG", "pfr_player_id": "Prior01", "offense_snaps": "50", "defense_snaps": "0", "st_snaps": "0"},
        {"season": "2025", "week": "2", "game_type": "REG", "pfr_player_id": "Future01", "offense_snaps": "70", "defense_snaps": "0", "st_snaps": "0"},
        {"season": "2025", "week": "3", "game_type": "REG", "pfr_player_id": "Future01", "offense_snaps": "70", "defense_snaps": "0", "st_snaps": "0"},
    ]
    ratings = {"prior": rating("prior", "QB", 55), "future": rating("future", "QB", 75)}

    lineups = infer_expected_lineups(roster, snaps, ratings, 2025, 2, "game", RSMConfig(current_season=2025, current_week=2))

    assert [player.player_id for player in lineups["KC"]] == ["prior"]


def test_unoptimized_score_model_is_market_independent_and_internally_consistent():
    depth = complete_depth()
    roster = [roster_player(row["gsis_id"], row["player_name"], "KC", row["pos_abb"]) for row in depth]
    ratings = {row["gsis_id"]: rating(row["gsis_id"], normalize_position(row["pos_abb"]), 60) for row in depth}
    home = build_team_ratings(roster, depth, ratings, "snapshot")[0]
    away = replace(home, team="LV", pass_defense_rating=50.0, run_defense_rating=50.0)

    prediction = predict_score(home, away)

    assert prediction.expected_home_points > prediction.expected_away_points
    assert prediction.predicted_margin == pytest.approx(
        prediction.expected_home_points - prediction.expected_away_points
    )
    assert prediction.predicted_total == pytest.approx(
        prediction.expected_home_points + prediction.expected_away_points
    )


def test_preaggregated_player_rating_path_matches_raw_rows():
    roster = [roster_player("qb", "Quarterback", "KC", "QB")]
    stats = [stat_row("qb", 2025, 1, epa=10)]
    config = RSMConfig(current_season=2026, current_week=2)

    raw = build_player_ratings(roster, stats, [], config)
    preaggregated = build_player_ratings(
        roster,
        [],
        [],
        config,
        stat_aggregates=aggregate_player_stats(stats),
        snap_aggregates=aggregate_snap_counts([]),
    )

    assert preaggregated == raw


def fitted_record(season, game_id, home_score, away_score, shift=0.0):
    return {
        "game_id": game_id, "season": season, "week": 1,
        "home_score": home_score, "away_score": away_score,
        "home_qb_rating": 60 + shift, "away_qb_rating": 58 - shift,
        "home_ol_rating": 60 + shift, "away_ol_rating": 59 - shift,
        "home_receiving_rating": 61 + shift, "away_receiving_rating": 58 - shift,
        "home_pass_offense_rating": 62 + shift, "away_pass_offense_rating": 57 - shift,
        "home_run_offense_rating": 60 + shift, "away_run_offense_rating": 58 - shift,
        "home_pass_defense_rating": 61 + shift, "away_pass_defense_rating": 57 - shift,
        "home_run_defense_rating": 60 + shift, "away_run_defense_rating": 58 - shift,
        "home_kicker_rating": 60 + shift, "away_kicker_rating": 59 - shift,
        "market_spread": -7.0, "market_total": 55.0,
    }


def test_fitted_feature_extraction_ignores_market_values():
    record = fitted_record(2021, "g1", 27, 20)
    changed_market = {**record, "market_spread": 14.0, "market_total": 31.0}

    assert game_observations(record) == game_observations(changed_market)


def test_fitted_feature_extraction_ignores_actual_result_values():
    record = fitted_record(2021, "g1", 27, 20)
    changed_result = {**record, "home_score": 3.0, "away_score": 44.0}

    original = [features for features, _, _ in game_observations(record)]
    changed = [features for features, _, _ in game_observations(changed_result)]

    assert original == changed


def test_historical_roster_snapshot_excludes_future_membership_and_injury_status():
    rows = [
        {**roster_player("qb1", "Week One", "KC", "QB", status="ACT"), "week": "1"},
        {**roster_player("qb2", "Future Addition", "KC", "QB", status="ACT"), "week": "2"},
        {**roster_player("qb1", "Week One", "KC", "QB", status="RES"), "week": "2"},
    ]

    snapshot = load_roster_snapshot_rows(rows, 1)

    assert {row["gsis_id"] for row in snapshot} == {"qb1"}
    assert snapshot[0]["status"] == "ACT"


def test_historical_lineup_does_not_use_unverified_injury_status():
    roster = [
        roster_player("prior", "Prior Starter", "KC", "QB", status="RES", pfr_id="Prior01"),
        roster_player("backup", "Backup", "KC", "QB", status="ACT", pfr_id="Backup01"),
    ]
    snaps = [
        {"season": "2024", "week": "18", "game_type": "REG", "pfr_player_id": "Prior01", "offense_snaps": "60", "defense_snaps": "0", "st_snaps": "0"},
    ]

    lineups = infer_expected_lineups(roster, snaps, {}, 2025, 1, "game")

    assert [player.player_id for player in lineups["KC"]] == ["prior"]


def test_trade_history_cannot_override_target_week_team_membership():
    roster = [roster_player("traded", "Traded Player", "KC", "QB", pfr_id="Trade01")]
    snaps = [
        {"season": "2025", "week": "1", "game_type": "REG", "pfr_player_id": "Trade01", "team": "LV", "offense_snaps": "65", "defense_snaps": "0", "st_snaps": "0"},
    ]

    lineups = infer_expected_lineups(roster, snaps, {}, 2025, 2, "game")

    assert lineups["KC"][0].team == "KC"


def test_lineup_confidence_thresholds_are_deterministic():
    assert classify_lineup_confidence(True, 0.90) == "HIGH"
    assert classify_lineup_confidence(True, 0.70) == "MEDIUM"
    assert classify_lineup_confidence(False, 1.0) == "LOW"


@pytest.mark.parametrize(
    ("home_score", "away_score", "expected"),
    [(27, 23, "WIN"), (24, 21, "PUSH"), (23, 21, "LOSS")],
)
def test_home_minus_three_spread_grading(home_score, away_score, expected):
    market_home_margin = internal_home_margin(-3.0)

    assert select_ats(4.0, market_home_margin) == "HOME"
    assert grade_ats("HOME", home_score - away_score, market_home_margin) == expected


def test_half_point_spread_cannot_push():
    market_home_margin = internal_home_margin(-3.5)

    assert grade_ats("HOME", 3.0, market_home_margin) == "LOSS"
    assert grade_ats("AWAY", 3.0, market_home_margin) == "WIN"


def test_total_grading_handles_half_points_and_whole_number_pushes():
    assert select_total(48.0, 47.5) == "OVER"
    assert grade_total("OVER", 48.0, 47.5) == "WIN"
    assert grade_total("UNDER", 47.0, 47.0) == "PUSH"


def test_wilson_interval_contains_observed_accuracy():
    low, high = wilson_interval(55, 100)

    assert low < 0.55 < high


def test_nflverse_playoff_round_labels_are_kept_separate_from_regular_season():
    assert PLAYOFF_GAME_TYPES == {"WC", "DIV", "CON", "SB"}
    assert "REG" not in PLAYOFF_GAME_TYPES


@pytest.mark.parametrize(
    ("edge", "bucket"),
    [(0.0, "0-1"), (0.999, "0-1"), (1.0, "1-2"), (2.5, "2-3"), (-4.0, "3-5"), (5.0, "5+")],
)
def test_stage6_edge_buckets_have_fixed_non_overlapping_boundaries(edge, bucket):
    assert edge_bucket(edge) == bucket


def test_stage6_pearson_detects_direction_without_external_dependencies():
    assert pearson([1, 2, 3], [2, 4, 6]) == pytest.approx(1.0)
    assert pearson([1, 2, 3], [6, 4, 2]) == pytest.approx(-1.0)


def test_home_cover_probability_increases_with_home_advantage():
    probabilities = [home_cover_probability(margin, 3.0, 13.0) for margin in (-3.0, 3.0, 9.0)]

    assert probabilities == sorted(probabilities)
    assert probabilities[1] == pytest.approx(0.5)
    assert (1.0 - probabilities[0]) > (1.0 - probabilities[1]) > (1.0 - probabilities[2])


def test_over_probability_increases_with_predicted_total():
    probabilities = [over_probability(total, 47.5, 14.0) for total in (40.0, 47.5, 55.0)]

    assert probabilities == sorted(probabilities)
    assert probabilities[1] == pytest.approx(0.5)


def test_probability_helpers_reject_nonpositive_residual_scale():
    with pytest.raises(ValueError, match="positive"):
        home_cover_probability(3.0, 3.0, 0.0)
    with pytest.raises(ValueError, match="positive"):
        over_probability(48.0, 47.5, -1.0)


def test_stage7a_percentile_uses_linear_interpolation():
    assert percentile([0.0, 10.0], 0.25) == pytest.approx(2.5)
    assert percentile([0.0, 10.0], 0.50) == pytest.approx(5.0)


def test_stage7a_calibration_regression_recovers_linear_scale():
    regression = linear_regression([1.0, 2.0, 3.0, 4.0], [3.0, 5.0, 7.0, 9.0])

    assert regression["intercept"] == pytest.approx(1.0)
    assert regression["slope"] == pytest.approx(2.0)
    assert regression["r_squared"] == pytest.approx(1.0)


@pytest.mark.parametrize(
    ("residual", "bucket"),
    [(0.0, "0-1"), (0.999, "0-1"), (-1.0, "1-2"), (1.999, "1-2"), (2.0, "2-3"), (-3.0, "3+")],
)
def test_stage7b_residual_buckets_have_fixed_boundaries(residual, bucket):
    assert residual_bucket(residual) == bucket


def test_stage7b_model_selection_skips_singular_unregularized_candidate():
    rows = [
        {"season": season, "feature_a": value, "feature_b": value, "target": value * 2.0}
        for season in (2021, 2022)
        for value in (1.0, 2.0, 3.0)
    ]

    alpha, grid = _select_alpha(rows, ("feature_a", "feature_b"), "target", "test model")

    assert alpha > 0.0
    assert grid[0] == {"alpha": 0.0, "status": "SINGULAR"}
    assert all(row["status"] == "VALID" for row in grid[1:])


def test_stage7b_multivariate_audit_detects_exact_combination():
    basis_x = [1 / 2**0.5, -1 / 2**0.5, 0.0, 0.0]
    basis_y = [0.0, 0.0, 1 / 2**0.5, -1 / 2**0.5]
    dependent = [1.0, -1.0, 1.0, -1.0]

    ratio, _ = multivariate_residual_ratio(dependent, [basis_x, basis_y])

    assert ratio < 1e-9


def stage7c_artifact():
    from rsm.stage7b_candidate import CandidateArtifact

    return CandidateArtifact(
        "test", "actual_margin", ("qb_quality_diff", "ol_weakest_diff", "rest_diff"),
        (0.0, 0.0, 0.0), (1.0, 1.0, 1.0), 1.0, (1.0, 0.5, -0.25), 10.0, (2021, 2022),
    )


def test_stage7c_spread_sign_conversion_and_disagreement_direction():
    assert sportsbook_home_spread_to_margin(-3.5) == 3.5
    assert sportsbook_home_spread_to_margin(2.5) == -2.5
    assert disagreement_direction(1.0) == "MODEL_MORE_HOME"
    assert disagreement_direction(-1.0) == "MODEL_MORE_AWAY"
    assert disagreement_direction(0.0) == "AGREES"


def test_stage7c_home_and_away_selection_pushes_and_half_points():
    assert model_side(2.0) == "HOME"
    assert model_side(-2.0) == "AWAY"
    assert grade_ats("HOME", 3.0, 3.0) == "PUSH"
    assert grade_ats("AWAY", 3.0, 3.5) == "WIN"


def test_stage7c_thresholds_use_development_inputs_not_outcomes():
    rows = [
        {"season": 2021 if index < 5 else 2022, "anomaly_score": float(index), "lineup_confidence": "HIGH", "structurally_supported": True, "actual_margin": float(index)}
        for index in range(10)
    ]
    changed_outcomes = [{**row, "actual_margin": 1000.0 - row["actual_margin"]} for row in rows]

    assert freeze_thresholds(rows) == freeze_thresholds(changed_outcomes)
    with pytest.raises(ValueError, match="only 2021-2022"):
        freeze_thresholds([*rows, {**rows[0], "season": 2023}])


def test_stage7c_low_confidence_forces_abstention():
    row = {"lineup_confidence": "LOW", "structurally_supported": True, "anomaly_score": 100.0}
    rule = {"name": "TOP_20_PERCENT", "target_coverage": 0.2, "threshold": 1.0}

    assert apply_frozen_rules(row, [rule])["flagged"] is False


def test_stage7c_missing_market_metadata_remains_blank_and_outcome_does_not_change_signal():
    base = {
        "season": "2023", "week": "1", "game_id": "g1", "away_team": "LV", "home_team": "KC",
        "actual_margin": "3", "market_spread": "2.5", "qb_quality_diff": "2", "ol_weakest_diff": "1", "rest_diff": "-2",
    }
    changed = {**base, "actual_margin": "-30"}
    original_score = score_market_disagreement(base, stage7c_artifact(), "HIGH", {})
    changed_score = score_market_disagreement(changed, stage7c_artifact(), "HIGH", {})

    assert original_score["sportsbook"] == ""
    assert original_score["line_timestamp"] == ""
    for field in ("roster_fair_home_margin", "market_disagreement", "anomaly_score", "top_reason_1", "top_reason_2", "top_reason_3"):
        assert original_score[field] == changed_score[field]


def test_stage7c_feature_explanations_are_deterministic():
    row = {"qb_quality_diff": "2", "ol_weakest_diff": "1", "rest_diff": "-2"}

    first = feature_contributions(row, stage7c_artifact())
    second = feature_contributions(row, stage7c_artifact())

    assert first == second
    assert [item["reason_code"] for item in first] == ["QB_DIFFERENCE", "OL_WEAKEST_LINK", "REST_DIFFERENTIAL"]


REPORTS_ROOT = Path(__file__).resolve().parents[1] / "reports"


def stage8_payload():
    manifest = frozen_manifest(REPORTS_ROOT)
    return {
        "game_id": "2099_01_LV_KC", "season": 2099, "week": 1,
        "kickoff": "2099-09-10T20:00:00-04:00",
        "prediction_timestamp": "2099-09-10T16:05:00-04:00",
        "away_team": "LV", "home_team": "KC",
        "schedule_source": "fixture-schedule", "schedule_observed_at": "2099-09-10T15:00:00-04:00",
        "features": {name: 0.0 for name in manifest["feature_names"]},
        "features_as_of": "2099-09-10T16:00:00-04:00", "features_source": "fixture-features",
        "lineup": {
            "confidence": "HIGH", "as_of": "2099-09-10T15:55:00-04:00", "source": "fixture-lineup",
            "expected_starters": [], "inactive_or_injured": [],
        },
        "market": {
            "sportsbook": "Fixture Book", "retrieved_timestamp": "2099-09-10T16:04:00-04:00",
            "line_type": "SPREAD", "line_stage": "CURRENT", "market_kind": "INDIVIDUAL_BOOK", "spread": -3.0,
            "spread_convention": "HOME_SPREAD", "home_price": -110, "away_price": -110,
            "source": "fixture-market",
        },
    }


def stage8a_fixture(tmp_path, mutate=None):
    payload = stage8_payload()
    fixture = {
        "provider": "fixture",
        "games": [{
            "schedule": {
                "game_id": payload["game_id"], "season": payload["season"], "week": payload["week"],
                "kickoff": payload["kickoff"], "away_team": payload["away_team"], "home_team": payload["home_team"],
                "source_observed_at": "2099-09-10T15:00:00-04:00", "source": "fixture-schedule",
            },
            "markets": [dict(payload["market"])],
            "lineup": dict(payload["lineup"]),
            "features": {"as_of": payload["features_as_of"], "values": dict(payload["features"]), "source": "fixture-features"},
        }],
    }
    if mutate:
        mutate(fixture)
    path = tmp_path / "stage8a-fixture.json"
    path.write_text(json.dumps(fixture), encoding="utf-8")
    return path


def stage8a_config(tmp_path):
    return CaptureConfig(
        store_path=tmp_path / "shadow.sqlite3", log_path=tmp_path / "capture.jsonl",
        state_path=tmp_path / "state.json", lock_path=tmp_path / "capture.lock",
        backoff_seconds=0,
    )


def test_stage8_freeze_hashes_pin_stage7b_model_and_stage7c_rules():
    manifest = frozen_manifest(REPORTS_ROOT)

    assert manifest["model_sha256"] == EXPECTED_MODEL_SHA256
    assert manifest["rules_sha256"] == EXPECTED_RULES_SHA256
    assert manifest["anomaly_definition_sha256"] == EXPECTED_DEFINITION_SHA256
    assert manifest["recommendations_generated"] is False
    assert manifest["automated_wagering"] is False


def test_stage8_rejects_tampered_frozen_model(tmp_path):
    shutil.copy(REPORTS_ROOT / "rsm-v2-candidate-stage7b.json", tmp_path)
    shutil.copy(REPORTS_ROOT / "rsm-stage7c-anomaly-analysis.json", tmp_path)
    model_path = tmp_path / "rsm-v2-candidate-stage7b.json"
    payload = json.loads(model_path.read_text(encoding="utf-8"))
    payload["model_a"]["intercept"] += 0.001
    model_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(RuntimeError, match="frozen hash"):
        load_frozen_stage7c(tmp_path)


def test_stage8_rejects_post_kickoff_naive_and_outcome_inputs(tmp_path):
    payload = stage8_payload()
    payload["prediction_timestamp"] = payload["kickoff"]
    with pytest.raises(ValueError, match="strictly before kickoff"):
        capture_observation(payload, tmp_path / "shadow.sqlite3", REPORTS_ROOT, datetime(2099, 9, 10, 20, tzinfo=timezone.utc))

    payload = stage8_payload()
    payload["prediction_timestamp"] = "2099-09-10T20:01:00-04:00"
    with pytest.raises(ValueError, match="strictly before kickoff"):
        capture_observation(payload, tmp_path / "shadow.sqlite3", REPORTS_ROOT, datetime(2099, 9, 11, 0, 2, tzinfo=timezone.utc))

    payload = stage8_payload()
    payload["features_as_of"] = "2099-09-10T16:00:00"
    with pytest.raises(ValueError, match="timezone"):
        capture_observation(payload, tmp_path / "shadow.sqlite3", REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))

    payload = stage8_payload()
    payload["actual_margin"] = 7
    with pytest.raises(ValueError, match="forbidden"):
        capture_observation(payload, tmp_path / "shadow.sqlite3", REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))


def test_stage8_requires_exact_frozen_features_and_rejects_totals(tmp_path):
    payload = stage8_payload()
    payload["features"].pop(next(iter(payload["features"])))
    with pytest.raises(ValueError, match="exactly match"):
        capture_observation(payload, tmp_path / "shadow.sqlite3", REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))

    payload = stage8_payload()
    payload["market"]["line_type"] = "TOTAL"
    with pytest.raises(ValueError, match="O/U is out of scope"):
        capture_observation(payload, tmp_path / "shadow.sqlite3", REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))


def test_stage8_append_only_capture_and_line_movement(tmp_path):
    store = tmp_path / "shadow.sqlite3"
    first = capture_observation(
        stage8_payload(), store, REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc),
    )
    second_payload = stage8_payload()
    second_payload["prediction_timestamp"] = "2099-09-10T17:05:00-04:00"
    second_payload["features_as_of"] = "2099-09-10T17:00:00-04:00"
    second_payload["lineup"]["as_of"] = "2099-09-10T16:55:00-04:00"
    second_payload["market"]["retrieved_timestamp"] = "2099-09-10T17:04:00-04:00"
    second_payload["market"]["spread"] = -2.0
    second = capture_observation(
        second_payload, store, REPORTS_ROOT, datetime(2099, 9, 10, 21, 10, tzinfo=timezone.utc),
    )

    assert first["research_only"] is True
    assert "recommendation" not in first
    assert first["event_hash"] != second["event_hash"]
    assert verify_ledger(store)["observations"] == 2
    movement = line_movements(store)[0]
    assert movement["observations"] == 2
    assert movement["movement_relative_to_first_model"] == "TOWARD_MODEL"
    assert movement["closing_line_value_computed"] is False
    with sqlite3.connect(store) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("UPDATE observations SET sportsbook = 'Other' WHERE sequence = 1")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM observations WHERE sequence = 1")


def test_stage8a_baseline_is_machine_readable_and_has_no_backfill(tmp_path):
    result = verify_frozen_baseline(tmp_path / "absent.sqlite3", REPORTS_ROOT)

    assert result["passed"] is True
    assert result["feature_count"] == 18
    assert len(result["coefficients"]) == len(result["feature_order"]) == 18
    assert result["historical_backfill_records"] == 0
    assert result["ledger"]["valid"] is True


def test_stage8a_fixture_feature_ordering_mismatch_fails_closed(tmp_path):
    def reorder(fixture):
        values = fixture["games"][0]["features"]["values"]
        first = next(iter(values))
        values[first] = values.pop(first)

    provider = FixtureProvider(stage8a_fixture(tmp_path, reorder))
    game = provider.upcoming_games(datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc), timedelta(hours=30), 1)[0]
    with pytest.raises(ProviderError, match="ordering"):
        provider.feature_observation(game, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc), frozen_manifest(REPORTS_ROOT)["feature_names"], 1)


def test_stage8a_source_timestamp_is_distinct_and_cannot_follow_receipt():
    payload = stage8_payload()
    payload["market"]["retrieved_timestamp"] = "2099-09-10T16:06:00-04:00"
    with pytest.raises(ValueError, match="later than prediction_timestamp"):
        preview_observation(payload, REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))


def test_stage8a_spread_sign_normalization_and_ambiguous_convention():
    payload = stage8_payload()
    home_spread = preview_observation(payload, REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))
    payload["market"]["spread_convention"] = "HOME_MARGIN"
    payload["market"]["spread"] = 3.0
    home_margin = preview_observation(payload, REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))
    assert home_spread["market_implied_home_margin"] == home_margin["market_implied_home_margin"] == 3.0

    payload["market"]["spread_convention"] = "TEAM_SPREAD"
    with pytest.raises(ValueError, match="HOME_SPREAD or HOME_MARGIN"):
        preview_observation(payload, REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))


def test_stage8a_consensus_and_individual_book_labels_are_strict():
    payload = stage8_payload()
    received_at = datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc)
    payload["market"]["market_kind"] = "CONSENSUS"
    with pytest.raises(ValueError, match="sportsbook CONSENSUS"):
        preview_observation(payload, REPORTS_ROOT, received_at)
    payload["market"]["sportsbook"] = "CONSENSUS"
    assert preview_observation(payload, REPORTS_ROOT, received_at)["market_kind"] == "CONSENSUS"
    payload["market"]["market_kind"] = "INDIVIDUAL_BOOK"
    with pytest.raises(ValueError, match="sportsbook identifier"):
        preview_observation(payload, REPORTS_ROOT, received_at)
    payload["market"]["sportsbook"] = ""
    with pytest.raises(ValueError, match="required"):
        preview_observation(payload, REPORTS_ROOT, received_at)


def test_stage8a_exact_duplicate_is_noop_but_new_retrieval_appends(tmp_path):
    store = tmp_path / "shadow.sqlite3"
    payload = stage8_payload()
    expected_id = observation_identifier(payload)
    first = capture_observation(payload, store, REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))
    retry = stage8_payload()
    retry["prediction_timestamp"] = "2099-09-10T16:06:00-04:00"
    duplicate = capture_observation(retry, store, REPORTS_ROOT, datetime(2099, 9, 10, 20, 11, tzinfo=timezone.utc))
    assert first["event_id"] == duplicate["event_id"] == expected_id
    assert duplicate["duplicate"] is True and duplicate["ledger_appended"] is False
    assert verify_ledger(store)["observations"] == 1

    later = stage8_payload()
    later["prediction_timestamp"] = "2099-09-10T17:05:00-04:00"
    later["features_as_of"] = "2099-09-10T17:00:00-04:00"
    later["lineup"]["as_of"] = "2099-09-10T16:55:00-04:00"
    later["market"]["retrieved_timestamp"] = "2099-09-10T17:04:00-04:00"
    later["market"]["spread"] = -2.0
    capture_observation(later, store, REPORTS_ROOT, datetime(2099, 9, 10, 21, 10, tzinfo=timezone.utc))
    assert verify_ledger(store)["observations"] == 2
    assert line_movements(store)[0]["observations"] == 2


def test_stage8a_failed_capture_recovers_without_partial_observation(tmp_path):
    store = tmp_path / "shadow.sqlite3"
    invalid = stage8_payload()
    invalid["market"]["spread"] = "not-a-number"
    with pytest.raises(ValueError, match="numeric"):
        capture_observation(invalid, store, REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))
    assert verify_ledger(store) == {"valid": True, "observations": 0, "last_event_hash": "GENESIS"}
    capture_observation(stage8_payload(), store, REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))
    assert verify_ledger(store)["observations"] == 1


def test_stage8a_capture_lock_rejects_concurrent_cycle(tmp_path):
    now = datetime.now(timezone.utc)
    lock_path = tmp_path / "capture.lock"
    with CaptureLock(lock_path, now, 900):
        with pytest.raises(RuntimeError, match="holds the lock"):
            with CaptureLock(lock_path, now, 900):
                pass
    assert not lock_path.exists()


def test_stage8a_dry_run_never_creates_ledger_and_discards_wager_fields(tmp_path):
    def add_out_of_scope_fields(fixture):
        fixture["games"][0]["markets"][0].update({"total": 44.5, "stake": 100, "recommendation": "none"})

    provider = FixtureProvider(stage8a_fixture(tmp_path, add_out_of_scope_fields))
    config = stage8a_config(tmp_path)
    result = run_capture_cycle(
        provider, provider, provider, provider, config, REPORTS_ROOT,
        observed_at=datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc), dry_run=True, sleeper=lambda _: None,
    )
    assert result["success"] is True
    assert result["events"][0]["ledger_appended"] is False
    assert not config.store_path.exists()
    assert result["outcomes_ingested"] is False and result["recommendations_generated"] is False


def test_stage8a_retry_is_bounded_and_uses_backoff():
    calls = []
    sleeps = []

    def operation():
        calls.append(1)
        raise TimeoutError("fixture timeout")

    with pytest.raises(ProviderError, match="after 3 attempts"):
        _retry(operation, 3, 0.25, sleeps.append)
    assert len(calls) == 3
    assert sleeps == [0.25, 0.5]


def test_stage8a_health_is_read_only_and_has_no_outcome_metrics(tmp_path):
    config = stage8a_config(tmp_path)
    result = health_report(config, REPORTS_ROOT, observed_at=datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))
    assert result["read_only"] is True
    assert result["outcome_statistics_reported"] is False
    assert not config.store_path.exists() and not config.state_path.exists()


def test_manual_stage8_production_path_is_explicitly_research_only_and_token_gated():
    repository_root = Path(__file__).resolve().parents[1]
    app_source = (repository_root / "backend" / "app.py").read_text(encoding="utf-8")
    ui_source = (repository_root / "frontend" / "nfl-predictor.js").read_text(encoding="utf-8")
    assert "RSM_MANUAL_CAPTURE_TOKEN" in app_source
    assert "rsm-observations" in app_source and "rsm-observations" in ui_source
    assert "automated_wagering" not in ui_source


def test_outcomes_are_separate_and_first_pre_kickoff_observation_is_predeclared(tmp_path):
    observation_store = tmp_path / "shadow.sqlite3"
    outcome_store = tmp_path / "outcomes.sqlite3"
    first = capture_observation(stage8_payload(), observation_store, REPORTS_ROOT, datetime(2099, 9, 10, 20, 10, tzinfo=timezone.utc))
    later = stage8_payload()
    later["prediction_timestamp"] = "2099-09-10T17:05:00-04:00"
    later["features_as_of"] = "2099-09-10T17:00:00-04:00"
    later["lineup"]["as_of"] = "2099-09-10T16:55:00-04:00"
    later["market"]["retrieved_timestamp"] = "2099-09-10T17:04:00-04:00"
    later["market"]["spread"] = -2.0
    capture_observation(later, observation_store, REPORTS_ROOT, datetime(2099, 9, 10, 21, 10, tzinfo=timezone.utc))
    # Pick an outcome that covers the direction frozen into the first record;
    # this exercises ATS grading without selecting between observations.
    home_score, away_score = (30, 0) if first["market_disagreement"] > 0 else (0, 30)
    recorded = record_outcome({"game_id": "2099_01_LV_KC", "home_score": home_score, "away_score": away_score, "source": "fixture-final", "observed_at": "2099-09-11T01:00:00Z"}, observation_store, outcome_store, datetime(2099, 9, 11, 1, 1, tzinfo=timezone.utc))
    report = evaluation_report(observation_store, outcome_store)
    assert recorded["recorded"] is True
    assert report["evaluation_policy"] == EVALUATION_POLICY
    assert report["graded_games"] == 1
    assert report["rows"][0]["observation_event_id"] == first["event_id"]
    assert report["rows"][0]["ats_result"] == "correct"
    assert (outcome_store).exists() and verify_ledger(observation_store)["observations"] == 2


def test_training_plan_rejects_overlap_with_locked_period():
    with pytest.raises(ValueError, match="disjoint"):
        TrainingPlan(training_seasons=(2022, 2024), validation_seasons=(2023,), locked_test_seasons=(2024, 2025)).validate()


def test_ridge_fit_uses_training_and_validation_but_not_locked_rows():
    records = [
        fitted_record(2021, "train1", 24, 20, -1),
        fitted_record(2021, "train2", 28, 17, 1),
        fitted_record(2022, "train3", 27, 21, 0.5),
        fitted_record(2022, "train4", 20, 23, -0.5),
        fitted_record(2023, "validation1", 26, 20, 0.25),
        fitted_record(2023, "validation2", 21, 24, -0.25),
        fitted_record(2024, "locked", 40, 3, 3),
    ]

    artifact, summary, predictions = fit_rsm_v1(records)

    assert artifact.training_seasons == (2021, 2022)
    assert summary["locked_test_evaluated"] is False
    assert {row["game_id"] for row in predictions} == {"validation1", "validation2"}
