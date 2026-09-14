import pytest

from nfl_predictor import (
    MODEL_PROFILES,
    MarketBlendNFLModel,
    RsmStage7CComparisonModel,
    _rsm_artifact,
    list_teams,
    predict_matchup,
    run_backtest,
    side_from_edge,
    summarize,
)


def _game(season, away_team, home_team):
    return {
        "season": season,
        "away_team": away_team,
        "home_team": home_team,
    }


def _graded_game(season=2025, away_team="KC", home_team="PHI"):
    return {
        **_game(season, away_team, home_team),
        "week": 1,
        "away_score": 20.0,
        "home_score": 24.0,
        "actual_margin": 4.0,
        "actual_total": 44.0,
        "spread_line": 3.0,
        "total_line": 47.0,
        "away_rest": 7.0,
        "home_rest": 7.0,
        "div_game": False,
        "roof": "outdoors",
        "temp": 65.0,
        "wind": 5.0,
    }


def test_current_teams_retain_previous_season_during_partial_opening_week():
    games = [
        _game(2025, "ARI", "ATL"),
        _game(2025, "BUF", "CAR"),
        _game(2026, "NE", "SEA"),
    ]

    assert list_teams(games, current_only=True) == [
        "ARI",
        "ATL",
        "BUF",
        "CAR",
        "NE",
        "SEA",
    ]


def test_current_teams_use_latest_season_once_its_team_set_is_complete():
    games = [
        _game(2025, "OAK", "SD"),
        _game(2026, "LV", "LAC"),
    ]

    assert list_teams(games, current_only=True) == ["LAC", "LV"]


def test_market_blend_shrinks_baseline_projection_toward_market():
    model = MarketBlendNFLModel(model_weight=0.5)
    margin, total = model.predict(_graded_game())

    assert margin == pytest.approx(2.3)
    assert total == pytest.approx(45.5)


def test_matchup_api_uses_conventional_negative_home_favorite_line():
    prediction = predict_matchup(
        [_graded_game()],
        away_team="KC",
        home_team="PHI",
        spread_line=-3.0,
        model_profile="baseline",
    )

    assert prediction["spread_line"] == -3.0
    assert prediction["market_margin"] == 3.0
    assert prediction["spread_edge"] == pytest.approx(prediction["pred_margin"] - 3.0)


def test_rsm_profile_maps_frozen_margin_to_experimental_winner_and_ats_projection():
    assert "rsm_stage7c" in MODEL_PROFILES
    games = [
        _graded_game(2025, "KC", "PHI"),
        _graded_game(2026, "KC", "PHI"),
    ]

    prediction = predict_matchup(
        games,
        away_team="KC",
        home_team="PHI",
        spread_line=-3.0,
        model_profile="rsm_stage7c",
        market_source="manual_test_source",
        market_observed_at="2026-09-13T12:00:00Z",
    )

    assert prediction["model"] == "rsm_stage7c"
    assert prediction["pred_total"] is not None
    assert prediction["total_pick"] in {"over", "under", None}
    assert prediction["total_line"] is None
    assert prediction["market_margin"] == 3.0
    assert prediction["spread_edge"] == pytest.approx(prediction["pred_margin"] - 3.0)
    assert prediction["spread_threshold"] == 0.0
    assert prediction["winner_pick"] == ("home" if prediction["pred_margin"] > 0 else "away")
    assert prediction["spread_pick"] == ("home" if prediction["spread_edge"] > 0 else "away")
    assert prediction["market_source"] == "manual_test_source"
    assert prediction["market_observed_at"] == "2026-09-13T12:00:00Z"
    assert prediction["lineup_confidence"] == "LOW"
    assert prediction["total_model_version"] == "RSM-v2 Stage7B Total diagnostic (experimental)"
    assert prediction["model_notes"]


def test_rsm_spread_sign_convention_and_exact_tie_abstention():
    # Conventional home -3 maps to a +3 expected home margin. A positive edge
    # chooses home; a negative edge chooses away; exact equality abstains.
    assert side_from_edge(2.0, threshold=0.0) == "home"
    assert side_from_edge(-2.0, threshold=0.0) == "away"
    assert side_from_edge(0.0, threshold=0.0) is None


def test_rsm_missing_market_line_has_no_ats_projection_or_total_pick():
    prediction = predict_matchup(
        [_graded_game(2025, "KC", "PHI"), _graded_game(2026, "KC", "PHI")],
        away_team="KC",
        home_team="PHI",
        spread_line=None,
        model_profile="rsm_stage7c",
    )
    assert prediction["market_margin"] is None
    assert prediction["spread_edge"] is None
    assert prediction["spread_pick"] is None
    assert prediction["pred_total"] is not None
    assert prediction["total_pick"] is None


def test_rsm_total_is_independent_of_market_total_and_grades_edge_at_zero():
    games = [_graded_game(2025, "KC", "PHI"), _graded_game(2026, "KC", "PHI")]
    without_line = predict_matchup(games, "KC", "PHI", model_profile="rsm_stage7c")
    with_line = predict_matchup(games, "KC", "PHI", total_line=without_line["pred_total"], model_profile="rsm_stage7c")

    assert without_line["pred_total"] == pytest.approx(with_line["pred_total"])
    assert without_line["total_edge"] is None
    assert without_line["total_pick"] is None
    assert with_line["total_edge"] == pytest.approx(0.0)
    assert with_line["total_pick"] is None


def test_rsm_missing_snapshot_team_fails_instead_of_fabricating_features():
    with pytest.raises(ValueError, match="snapshot ratings are unavailable"):
        RsmStage7CComparisonModel().predict({"home_team": "PHI", "away_team": "ZZZ"})


def test_rsm_manual_capture_details_preserve_the_exact_frozen_feature_vector():
    details = RsmStage7CComparisonModel().prediction_details({"home_team": "PHI", "away_team": "KC", "home_rest": 7, "away_rest": 7})

    assert len(details["features"]) == 18
    assert list(details["features"]) == list(_rsm_artifact()["feature_names"])
    assert details["lineup_confidence"] == "LOW"
    assert "no prospective lineup verification" in details["lineup_source"]


def test_rsm_backtest_uses_committed_validation_rows_without_picks():
    games = [
        {
            **_graded_game(2023, "ARI", "WAS"),
            "game_id": "2023_01_ARI_WAS",
        }
    ]

    summary, records = run_backtest(games, seasons_to_test=1, model_profile="rsm_stage7c")

    assert records
    assert records[0]["spread_pick"] is None
    assert summary["games"] == 1
    assert summary["spread_bets"] == 0
    assert summary["margin_mae"] is not None


def test_summary_reports_uncertainty_and_minus_110_roi():
    records = [
        {"spread_pick": "home", "spread_result": "win", "total_pick": None,
         "pred_margin": 3.0, "actual_margin": 4.0, "pred_total": 44.0, "actual_total": 45.0},
        {"spread_pick": "away", "spread_result": "loss", "total_pick": None,
         "pred_margin": -2.0, "actual_margin": 1.0, "pred_total": 43.0, "actual_total": 42.0},
    ]

    summary = summarize(records)

    assert summary["spread_losses"] == 1
    assert summary["spread_win_rate_ci95"][0] < 0.5 < summary["spread_win_rate_ci95"][1]
    assert summary["spread_roi_at_minus_110"] == pytest.approx(-0.0454545, abs=1e-7)
