import pytest

from parallel_models.drive_models import DriveSuccessModel, EPAPointsModel
from parallel_models.evaluation import DEFAULT_PARALLEL_MODEL_PERIODS, assign_period, eligible_seasons
from parallel_models.interface import NFLGameContext
from parallel_models.nflverse_pbp import DriveSummary


def _drive(game_id: str, week: int, offense: str, defense: str, epa: float, points: float) -> DriveSummary:
    return DriveSummary(
        game_id=game_id,
        season=2026,
        season_type="REG",
        week=week,
        drive="1",
        offense=offense,
        defense=defense,
        plays=6,
        epa=epa,
        points=points,
        result="TOUCHDOWN" if points >= 6 else "UNKNOWN",
        start_yardline_100=70.0,
        red_zone_entry=points > 0,
    )


def test_default_parallel_model_periods_are_chronological_and_frozen():
    assert DEFAULT_PARALLEL_MODEL_PERIODS.training_seasons == (2024,)
    assert DEFAULT_PARALLEL_MODEL_PERIODS.validation_seasons == (2025,)
    assert DEFAULT_PARALLEL_MODEL_PERIODS.prospective_seasons == (2026,)
    assert assign_period(2024) == "train"
    assert assign_period(2025) == "validation"
    assert assign_period(2026) == "prospective"
    assert eligible_seasons() == (2024, 2025, 2026)


def test_drive_success_model_uses_pregame_history_and_returns_research_prediction():
    drives = [
        _drive("2026_01_HOME_AWAY", 1, "HOME", "AWAY", 3.0, 7.0),
        _drive("2026_01_AWAY_HOME", 1, "AWAY", "HOME", -1.0, 0.0),
        _drive("2026_02_LEAK", 2, "AWAY", "HOME", 100.0, 7.0),
    ]
    game = NFLGameContext(home_team="HOME", away_team="AWAY", season=2026, week=2)

    prediction = DriveSuccessModel(drives).predict(game)

    assert prediction.model_name == "dsm"
    assert prediction.uncertainty["research_only"] is True
    assert prediction.uncertainty["sample_drives"] == 2
    assert prediction.expected_margin > 0
    assert prediction.expected_total is not None
    assert prediction.expected_total < 50.0
    assert prediction.expected_home_score == pytest.approx((prediction.expected_total + prediction.expected_margin) / 2)


def test_epa_points_model_returns_total_without_using_market_inputs():
    drives = [
        _drive("2026_01_HOME_AWAY", 1, "HOME", "AWAY", 2.0, 7.0),
        _drive("2026_01_AWAY_HOME", 1, "AWAY", "HOME", 1.0, 3.0),
    ]
    base_game = NFLGameContext(home_team="HOME", away_team="AWAY", season=2026, week=2)
    market_game = NFLGameContext(
        home_team="HOME",
        away_team="AWAY",
        season=2026,
        week=2,
        market_home_margin=-14.5,
        market_total=70.5,
    )

    base = EPAPointsModel(drives).predict(base_game)
    with_market = EPAPointsModel(drives).predict(market_game)

    assert base.model_name == "prm"
    assert base.expected_total == pytest.approx(with_market.expected_total)
    assert base.expected_margin == pytest.approx(with_market.expected_margin)
    assert 24.0 <= base.expected_total <= 64.0
