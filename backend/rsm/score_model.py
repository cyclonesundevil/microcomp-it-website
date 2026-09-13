from dataclasses import dataclass

from .config import DEFAULT_CONFIG, RSMConfig
from .schema import TeamRating


@dataclass(frozen=True)
class ScorePrediction:
    expected_home_points: float
    expected_away_points: float
    predicted_margin: float
    predicted_total: float


def predict_score(
    home: TeamRating,
    away: TeamRating,
    config: RSMConfig = DEFAULT_CONFIG,
) -> ScorePrediction:
    """Unfitted RSM-v0 score prior; market lines are deliberately not accepted."""
    pass_weight = config.pass_matchup_weight
    run_weight = 1.0 - pass_weight
    home_advantage = (
        pass_weight * (home.pass_offense_rating - away.pass_defense_rating)
        + run_weight * (home.run_offense_rating - away.run_defense_rating)
    )
    away_advantage = (
        pass_weight * (away.pass_offense_rating - home.pass_defense_rating)
        + run_weight * (away.run_offense_rating - home.run_defense_rating)
    )
    half_home_field = config.home_field_points / 2.0
    home_points = (
        config.league_points_per_team
        + half_home_field
        + config.rating_advantage_to_points * home_advantage
        + config.kicker_rating_to_points * (home.kicker_rating - config.starter_rating)
    )
    away_points = (
        config.league_points_per_team
        - half_home_field
        + config.rating_advantage_to_points * away_advantage
        + config.kicker_rating_to_points * (away.kicker_rating - config.starter_rating)
    )
    home_points = max(0.0, home_points)
    away_points = max(0.0, away_points)
    return ScorePrediction(
        expected_home_points=round(home_points, 3),
        expected_away_points=round(away_points, 3),
        predicted_margin=round(home_points - away_points, 3),
        predicted_total=round(home_points + away_points, 3),
    )
