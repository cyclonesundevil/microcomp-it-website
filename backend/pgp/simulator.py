from __future__ import annotations

import random
from typing import Optional

from parallel_models.nflverse_pbp import DriveSummary

from .distributions import PGPScoreDistribution
from .features import build_team_context
from .schema import DriveOutcomeProfile, InformationTier, PGPGame, PGPSimulationConfig


def simulate_game(
    target: PGPGame,
    historical_games: list[PGPGame],
    *,
    tier: InformationTier = InformationTier.LEAGUE_BASELINE,
    config: PGPSimulationConfig = PGPSimulationConfig(),
    drive_summaries: Optional[list[DriveSummary]] = None,
) -> PGPScoreDistribution:
    context = build_team_context(
        target,
        historical_games,
        tier=tier,
        possessions_per_team=config.possessions_per_team,
        drive_summaries=drive_summaries,
        prior_source=config.prior_source,
    )
    rng = random.Random(_game_seed(config.seed, target.game_id, int(tier)))
    home_distribution = _team_score_distribution(context.home_profile, config.possessions_per_team)
    away_distribution = _team_score_distribution(context.away_profile, config.possessions_per_team)
    home_scores = []
    away_scores = []
    for _ in range(config.simulations):
        home = _sample_score(rng, home_distribution)
        away = _sample_score(rng, away_distribution)
        home_scores.append(min(config.max_score, home))
        away_scores.append(min(config.max_score, away))
    return PGPScoreDistribution(
        home_scores=tuple(home_scores),
        away_scores=tuple(away_scores),
        metadata={
            "model": "PGP",
            "tier": int(tier),
            "tier_label": tier.name,
            "seed": config.seed,
            "possessions_per_team": config.possessions_per_team,
            "prior_source": config.prior_source,
            "feature_metadata": dict(context.feature_metadata),
        },
    )


def _team_score_distribution(profile: DriveOutcomeProfile, possessions: int) -> tuple[tuple[int, float], ...]:
    normalized = profile.normalized()
    single_drive = (
        (0, normalized.no_score),
        (2, normalized.safety),
        (3, normalized.field_goal),
        (7, normalized.touchdown),
    )
    distribution = {0: 1.0}
    for _ in range(possessions):
        next_distribution: dict[int, float] = {}
        for base_score, base_probability in distribution.items():
            for points, probability in single_drive:
                next_distribution[base_score + points] = next_distribution.get(base_score + points, 0.0) + base_probability * probability
        distribution = next_distribution
    cumulative = []
    running = 0.0
    for score, probability in sorted(distribution.items()):
        running += probability
        cumulative.append((score, running))
    if cumulative:
        cumulative[-1] = (cumulative[-1][0], 1.0)
    return tuple(cumulative)


def _sample_score(rng: random.Random, cumulative_distribution: tuple[tuple[int, float], ...]) -> int:
    draw = rng.random()
    for score, cumulative_probability in cumulative_distribution:
        if draw <= cumulative_probability:
            return score
    return cumulative_distribution[-1][0]


def _game_seed(seed: int, game_id: str, tier: int) -> int:
    value = int(seed) * 1_000_003 + int(tier) * 97
    for char in game_id:
        value = (value * 33 + ord(char)) % (2**63 - 1)
    return value
