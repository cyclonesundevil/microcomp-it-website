from datetime import datetime, timezone

import pytest

from nfl_predictor import RsmStage7CComparisonModel, predict_matchup
from parallel_models import NFLGameContext, NFLPrediction, RSMParallelModel


def _graded_game(season=2025, away_team="KC", home_team="PHI"):
    return {
        "season": season,
        "week": 1,
        "away_team": away_team,
        "home_team": home_team,
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


def test_rsm_parallel_wrapper_matches_existing_adapter_exactly():
    context = NFLGameContext(
        away_team="KC",
        home_team="PHI",
        kickoff=datetime(2026, 9, 13, 17, 0, tzinfo=timezone.utc),
        season=2026,
        week=2,
        home_rest=7.0,
        away_rest=7.0,
    )

    wrapped = RSMParallelModel().predict(context)
    direct_margin, direct_total = RsmStage7CComparisonModel().predict(context.as_predictor_game())

    assert isinstance(wrapped, NFLPrediction)
    assert wrapped.model_name == "RSM"
    assert wrapped.expected_margin == pytest.approx(direct_margin)
    assert wrapped.expected_total == pytest.approx(direct_total)
    assert wrapped.expected_home_score == pytest.approx((direct_total + direct_margin) / 2.0)
    assert wrapped.expected_away_score == pytest.approx((direct_total - direct_margin) / 2.0)
    assert wrapped.home_win_probability is None
    assert wrapped.metadata["source_model_profile"] == "rsm_stage7c"
    assert wrapped.metadata["features"]


def test_rsm_parallel_wrapper_matches_existing_predict_matchup_core_projection():
    games = [_graded_game(2025, "KC", "PHI"), _graded_game(2026, "KC", "PHI")]
    existing = predict_matchup(
        games,
        away_team="KC",
        home_team="PHI",
        spread_line=-3.0,
        total_line=47.5,
        model_profile="rsm_stage7c",
        home_rest=8.0,
        away_rest=6.0,
    )
    wrapped = RSMParallelModel().predict(NFLGameContext(
        away_team="KC",
        home_team="PHI",
        season=2026,
        week=2,
        home_rest=8.0,
        away_rest=6.0,
        market_home_margin=3.0,
        market_total=47.5,
    ))

    assert wrapped.expected_margin == pytest.approx(existing["pred_margin"])
    assert wrapped.expected_total == pytest.approx(existing["pred_total"])
    assert wrapped.home_win_probability is None


def test_parallel_model_margin_sign_convention_is_home_minus_away():
    prediction = NFLPrediction(
        model_name="test",
        model_version="test-v0",
        home_team="HOME",
        away_team="AWAY",
        kickoff=None,
        expected_home_score=24.0,
        expected_away_score=17.0,
        expected_margin=7.0,
        expected_total=41.0,
        home_win_probability=None,
    )

    assert prediction.margin == pytest.approx(prediction.expected_home_score - prediction.expected_away_score)
    assert prediction.total == pytest.approx(prediction.expected_home_score + prediction.expected_away_score)
