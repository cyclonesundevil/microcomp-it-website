import pytest

from parallel_models.interface import NFLGameContext
from parallel_models.nflverse_pbp import DriveSummary
from parallel_models.pbp_features import (
    aggregate_team_drive_stats,
    build_matchup_pbp_features,
    filter_drives_before_game,
)


def _drive(
    game_id: str,
    season: int,
    week: int,
    offense: str,
    defense: str,
    epa: float,
    points: float,
    red_zone: bool = False,
    season_type: str = "REG",
) -> DriveSummary:
    return DriveSummary(
        game_id=game_id,
        season=season,
        season_type=season_type,
        week=week,
        drive="1",
        offense=offense,
        defense=defense,
        plays=6,
        epa=epa,
        points=points,
        result="TOUCHDOWN" if points >= 6 else "UNKNOWN",
        start_yardline_100=75.0,
        red_zone_entry=red_zone,
    )


def test_filter_drives_before_game_excludes_target_week_and_playoffs():
    drives = [
        _drive("2025_18_A_B", 2025, 18, "A", "B", 1.0, 7.0),
        _drive("2026_01_A_B", 2026, 1, "A", "B", 2.0, 7.0),
        _drive("2026_02_A_B", 2026, 2, "A", "B", 99.0, 7.0),
        _drive("2025_WC_A_B", 2025, 19, "A", "B", 50.0, 7.0, season_type="POST"),
    ]
    context = NFLGameContext(home_team="A", away_team="B", season=2026, week=2)

    filtered = filter_drives_before_game(drives, context)

    assert [drive.game_id for drive in filtered] == ["2025_18_A_B", "2026_01_A_B"]


def test_filter_drives_before_game_includes_known_same_week_prior_games_only():
    drives = [
        _drive("2026_02_THU_A_B", 2026, 2, "A", "B", 1.0, 7.0),
        _drive("2026_02_SUN_C_D", 2026, 2, "C", "D", 99.0, 7.0),
        _drive("2026_02_MNF_E_F", 2026, 2, "E", "F", 100.0, 7.0),
    ]
    context = NFLGameContext(home_team="C", away_team="D", season=2026, week=2, metadata={"game_id": "2026_02_SUN_C_D"})
    order = {
        "2026_02_THU_A_B": (2026, 2, "2026-09-17T20:15:00Z", "2026_02_THU_A_B"),
        "2026_02_SUN_C_D": (2026, 2, "2026-09-20T13:00:00Z", "2026_02_SUN_C_D"),
        "2026_02_MNF_E_F": (2026, 2, "2026-09-21T20:15:00Z", "2026_02_MNF_E_F"),
    }

    filtered = filter_drives_before_game(drives, context, game_order=order, target_game_id="2026_02_SUN_C_D")

    assert [drive.game_id for drive in filtered] == ["2026_02_THU_A_B"]


def test_aggregate_team_drive_stats_calculates_offense_and_defense_rates():
    drives = [
        _drive("g1", 2026, 1, "A", "B", 2.0, 7.0, red_zone=True),
        _drive("g2", 2026, 1, "A", "C", 0.0, 0.0, red_zone=False),
        _drive("g3", 2026, 1, "B", "A", -1.0, 0.0, red_zone=False),
    ]

    stats = aggregate_team_drive_stats(drives)

    assert stats["A"].offensive_drives == 2
    assert stats["A"].defensive_drives == 1
    assert stats["A"].offensive_epa_per_drive == pytest.approx(1.0)
    assert stats["A"].offensive_points_per_drive == pytest.approx(3.5)
    assert stats["A"].defensive_epa_allowed_per_drive == pytest.approx(-1.0)
    assert stats["A"].offensive_red_zone_entry_rate == pytest.approx(0.5)


def test_build_matchup_pbp_features_returns_no_leakage_signals():
    drives = [
        _drive("2026_01_HOME_AWAY", 2026, 1, "HOME", "AWAY", 2.0, 7.0, red_zone=True),
        _drive("2026_01_AWAY_HOME", 2026, 1, "AWAY", "HOME", -1.0, 0.0, red_zone=False),
        _drive("2026_02_HOME_AWAY", 2026, 2, "AWAY", "HOME", 100.0, 7.0, red_zone=True),
    ]
    context = NFLGameContext(home_team="HOME", away_team="AWAY", season=2026, week=2)

    features = build_matchup_pbp_features(context, drives)

    assert features.home_team == "HOME"
    assert features.away_team == "AWAY"
    assert features.sample_drives == 2
    assert features.home_offensive_epa_per_drive == pytest.approx(2.0)
    assert features.away_offensive_epa_per_drive == pytest.approx(-1.0)
    assert features.dsm_margin_signal == pytest.approx(6.0)
    assert features.prm_total_signal == pytest.approx(7.0)
