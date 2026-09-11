import pytest

from nfl_predictor import MarketBlendNFLModel, list_teams, predict_matchup, summarize


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
