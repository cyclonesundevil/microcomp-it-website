import csv
import json

import pytest

from parallel_models.nflverse_pbp import DriveSummary

from pgp.data import load_games
from pgp.distributions import PGPScoreDistribution
from pgp.evaluation import evaluate
from pgp.features import build_team_context, score_event_decomposition
from pgp.reports import write_evaluation_outputs
from pgp.schema import InformationTier, PGPSimulationConfig
from pgp.simulator import simulate_game


def _write_games(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def _rows():
    return [
        {
            "game_id": "2024_01_A_B",
            "season": "2024",
            "game_type": "REG",
            "week": "1",
            "gameday": "2024-09-08",
            "gametime": "13:00",
            "away_team": "A",
            "away_score": "14",
            "home_team": "B",
            "home_score": "21",
        },
        {
            "game_id": "2024_02_C_D",
            "season": "2024",
            "game_type": "REG",
            "week": "2",
            "gameday": "2024-09-15",
            "gametime": "13:00",
            "away_team": "C",
            "away_score": "10",
            "home_team": "D",
            "home_score": "17",
        },
        {
            "game_id": "2025_01_A_B",
            "season": "2025",
            "game_type": "REG",
            "week": "1",
            "gameday": "2025-09-07",
            "gametime": "13:00",
            "away_team": "A",
            "away_score": "24",
            "home_team": "B",
            "home_score": "20",
        },
        {
            "game_id": "2025_02_A_B",
            "season": "2025",
            "game_type": "REG",
            "week": "2",
            "gameday": "2025-09-14",
            "gametime": "13:00",
            "away_team": "A",
            "away_score": "13",
            "home_team": "B",
            "home_score": "27",
        },
    ]


def _drive(game_id, season, week, offense, defense, points, result="UNKNOWN"):
    return DriveSummary(
        game_id=game_id,
        season=season,
        season_type="REG",
        week=week,
        drive="1",
        offense=offense,
        defense=defense,
        plays=6,
        epa=0.0,
        points=float(points),
        result=result,
        start_yardline_100=75.0,
        red_zone_entry=points > 0,
    )


def test_score_event_decomposition_uses_football_events():
    assert score_event_decomposition(21) == (3, 0, 0)
    assert score_event_decomposition(16) == (1, 3, 0)
    assert score_event_decomposition(2) == (0, 0, 1)


def test_simulation_is_deterministic_and_probabilities_sum(tmp_path):
    games_path = tmp_path / "games.csv"
    _write_games(games_path, _rows())
    games = load_games(games_path)
    target = games[-1]
    config = PGPSimulationConfig(simulations=500, seed=99)

    first = simulate_game(target, games, tier=InformationTier.LEAGUE_BASELINE, config=config)
    second = simulate_game(target, games, tier=InformationTier.LEAGUE_BASELINE, config=config)
    summary = first.summary()

    assert first.home_scores == second.home_scores
    assert first.away_scores == second.away_scores
    assert summary["home_win_probability"] + summary["away_win_probability"] + summary["tie_probability"] == pytest.approx(1.0)
    assert sum(summary["total_distribution"].values()) == pytest.approx(1.0)
    assert sum(summary["joint_score_distribution"].values()) == pytest.approx(1.0)


def test_percentiles_are_ordered_and_scores_are_plausible():
    distribution = PGPScoreDistribution(home_scores=(0, 3, 7, 14, 21), away_scores=(0, 0, 3, 7, 10))
    summary = distribution.summary()

    for key in ("home_score", "away_score", "total", "margin"):
        item = summary[key]
        assert item["p10"] <= item["p25"] <= item["median"] <= item["p75"] <= item["p90"]
    assert all(score >= 0 for score in distribution.home_scores + distribution.away_scores)


def test_tier_zero_ignores_team_identity_and_tier_one_uses_only_prior_games(tmp_path):
    games_path = tmp_path / "games.csv"
    _write_games(games_path, _rows())
    games = load_games(games_path)
    target = games[-1]

    tier0 = build_team_context(target, games, tier=InformationTier.LEAGUE_BASELINE)
    tier1 = build_team_context(target, games, tier=InformationTier.TEAM_STRENGTH)

    assert tier0.feature_metadata["team_identity_used"] is False
    assert tier0.feature_metadata["market_used"] is False
    assert tier1.feature_metadata["team_identity_used"] is True
    assert tier1.feature_metadata["history_games"] == 3
    assert tier1.feature_metadata["home_offense_team_games"] == 2
    assert tier1.feature_metadata["away_offense_team_games"] == 2


def test_drive_prior_uses_only_drives_before_target_week(tmp_path):
    games_path = tmp_path / "games.csv"
    _write_games(games_path, _rows())
    games = load_games(games_path)
    target = games[-1]
    drives = [
        _drive("2025_01_A_B", 2025, 1, "A", "B", 7, "TOUCHDOWN"),
        _drive("2025_01_B_A", 2025, 1, "B", "A", 3, "FIELD_GOAL"),
        _drive("2025_02_A_B", 2025, 2, "A", "B", 7, "TOUCHDOWN"),
    ]

    context = build_team_context(
        target,
        games,
        tier=InformationTier.TEAM_STRENGTH,
        drive_summaries=drives,
        prior_source="drive",
    )

    assert context.feature_metadata["prior_source"] == "drive"
    assert context.feature_metadata["history_drives"] == 2
    assert context.home_profile.field_goal > 0


def test_drive_prior_simulation_is_deterministic(tmp_path):
    games_path = tmp_path / "games.csv"
    _write_games(games_path, _rows())
    games = load_games(games_path)
    target = games[-1]
    drives = [
        _drive("2024_01_A_B", 2024, 1, "A", "B", 7, "TOUCHDOWN"),
        _drive("2024_01_B_A", 2024, 1, "B", "A", 0, "PUNT"),
        _drive("2025_01_A_B", 2025, 1, "A", "B", 3, "FIELD_GOAL"),
    ]
    config = PGPSimulationConfig(simulations=500, seed=44, prior_source="drive")

    first = simulate_game(target, games, tier=InformationTier.TEAM_STRENGTH, config=config, drive_summaries=drives)
    second = simulate_game(target, games, tier=InformationTier.TEAM_STRENGTH, config=config, drive_summaries=drives)

    assert first.home_scores == second.home_scores
    assert first.summary()["metadata"]["prior_source"] == "drive"


def test_evaluate_writes_machine_readable_outputs(tmp_path):
    games_path = tmp_path / "games.csv"
    output_dir = tmp_path / "reports"
    _write_games(games_path, _rows())
    config = PGPSimulationConfig(simulations=200, seed=7)

    result = evaluate(
        load_games(games_path),
        train_through=2024,
        test_season=2025,
        tiers=[InformationTier.LEAGUE_BASELINE, InformationTier.TEAM_STRENGTH],
        config=config,
    )
    output = write_evaluation_outputs(result, output_dir)

    assert result["games_evaluated"] == 2
    assert result["prediction_rows"] == 4
    assert {metric["tier"] for metric in result["metrics"]} == {0, 1}
    assert (output_dir / "pgp-evaluation-games.csv").exists()
    assert (output_dir / "pgp-evaluation-summary.json").exists()
    assert (output_dir / "pgp-evaluation-summary.md").exists()
    stored = json.loads((output_dir / "pgp-evaluation-summary.json").read_text(encoding="utf-8"))
    assert "records" not in stored
    assert output["summary_markdown"].endswith("pgp-evaluation-summary.md")
