from __future__ import annotations

from functools import lru_cache
from typing import Iterable, Optional

from parallel_models.nflverse_pbp import DriveSummary

from .data import games_before
from .schema import DriveOutcomeProfile, InformationTier, PGPGame, PGPTeamContext


MIN_TEAM_GAMES_FOR_FULL_WEIGHT = 16


def build_team_context(
    target: PGPGame,
    all_games: Iterable[PGPGame],
    *,
    tier: InformationTier,
    possessions_per_team: int = 11,
    drive_summaries: Optional[Iterable[DriveSummary]] = None,
    prior_source: str = "score",
) -> PGPTeamContext:
    history = games_before(target, all_games, game_type=target.game_type or "REG")
    if prior_source == "drive":
        if drive_summaries is None:
            raise ValueError("drive_summaries are required when prior_source='drive'")
        drive_history = drives_before_game(target, drive_summaries, season_type=target.game_type or "REG")
        league_profile = outcome_profile_from_drives(drive_history, possessions_per_team=possessions_per_team, label="league drives")
    elif prior_source == "score":
        drive_history = None
        league_profile = outcome_profile_from_team_scores(
            _team_scores(history),
            possessions_per_team=possessions_per_team,
            label="league",
        )
    else:
        raise ValueError("prior_source must be 'score' or 'drive'")
    if tier == InformationTier.LEAGUE_BASELINE:
        return PGPTeamContext(
            home_profile=league_profile,
            away_profile=league_profile,
            tier=tier,
            feature_metadata={
                "history_games": len(history),
                "history_drives": len(drive_history) if drive_history is not None else None,
                "prior_source": prior_source,
                "team_identity_used": False,
                "market_used": False,
            },
        )
    if tier != InformationTier.TEAM_STRENGTH:
        raise ValueError(f"Unsupported PGP information tier for Phase B: {tier}")

    if prior_source == "drive":
        home_offense = outcome_profile_from_drives(_drives_for_team(drive_history or [], target.home_team, offense=True), possessions_per_team=possessions_per_team, label=f"{target.home_team} offense drives")
        away_defense = outcome_profile_from_drives(_drives_for_team(drive_history or [], target.away_team, offense=False), possessions_per_team=possessions_per_team, label=f"{target.away_team} defense allowed drives")
        away_offense = outcome_profile_from_drives(_drives_for_team(drive_history or [], target.away_team, offense=True), possessions_per_team=possessions_per_team, label=f"{target.away_team} offense drives")
        home_defense = outcome_profile_from_drives(_drives_for_team(drive_history or [], target.home_team, offense=False), possessions_per_team=possessions_per_team, label=f"{target.home_team} defense allowed drives")
    else:
        home_offense = outcome_profile_from_team_scores(
            _scores_for_team(history, target.home_team, scored=True),
            possessions_per_team=possessions_per_team,
            label=f"{target.home_team} offense",
        )
        away_defense = outcome_profile_from_team_scores(
            _scores_for_team(history, target.away_team, scored=False),
            possessions_per_team=possessions_per_team,
            label=f"{target.away_team} defense allowed",
        )
        away_offense = outcome_profile_from_team_scores(
            _scores_for_team(history, target.away_team, scored=True),
            possessions_per_team=possessions_per_team,
            label=f"{target.away_team} offense",
        )
        home_defense = outcome_profile_from_team_scores(
            _scores_for_team(history, target.home_team, scored=False),
            possessions_per_team=possessions_per_team,
            label=f"{target.home_team} defense allowed",
        )
    home_profile = blend_profiles(home_offense, away_defense, league_profile)
    away_profile = blend_profiles(away_offense, home_defense, league_profile)
    return PGPTeamContext(
        home_profile=home_profile,
        away_profile=away_profile,
        tier=tier,
        feature_metadata={
            "history_games": len(history),
            "history_drives": len(drive_history) if drive_history is not None else None,
            "prior_source": prior_source,
            "home_offense_team_games": home_offense.sample_team_games,
            "away_defense_team_games": away_defense.sample_team_games,
            "away_offense_team_games": away_offense.sample_team_games,
            "home_defense_team_games": home_defense.sample_team_games,
            "team_identity_used": True,
            "market_used": False,
        },
    )


def drives_before_game(
    target: PGPGame,
    summaries: Iterable[DriveSummary],
    *,
    season_type: str = "REG",
) -> list[DriveSummary]:
    desired_type = season_type.upper()
    return [
        drive
        for drive in summaries
        if (not desired_type or drive.season_type == desired_type)
        and (drive.season < target.season or (drive.season == target.season and drive.week < target.week))
    ]


def blend_profiles(
    offense: DriveOutcomeProfile,
    defense_allowed: DriveOutcomeProfile,
    league: DriveOutcomeProfile,
) -> DriveOutcomeProfile:
    offense_weight = _sample_weight(offense.sample_team_games)
    defense_weight = _sample_weight(defense_allowed.sample_team_games)
    league_weight = max(0.0, 2.0 - offense_weight - defense_weight)
    denominator = offense_weight + defense_weight + league_weight
    if denominator <= 0:
        return league

    def weighted(field: str) -> float:
        return (
            getattr(offense, field) * offense_weight
            + getattr(defense_allowed, field) * defense_weight
            + getattr(league, field) * league_weight
        ) / denominator

    return DriveOutcomeProfile(
        touchdown=weighted("touchdown"),
        field_goal=weighted("field_goal"),
        safety=weighted("safety"),
        no_score=weighted("no_score"),
        sample_team_games=min(offense.sample_team_games, defense_allowed.sample_team_games),
        label=f"{offense.label} vs {defense_allowed.label}",
    ).normalized()


def outcome_profile_from_team_scores(
    scores: Iterable[int],
    *,
    possessions_per_team: int,
    label: str,
) -> DriveOutcomeProfile:
    values = [max(0, int(score)) for score in scores]
    if not values:
        return DriveOutcomeProfile(0.2, 0.15, 0.005, 0.645, 0, label).normalized()
    touchdowns = field_goals = safeties = 0
    for score in values:
        td, fg, safety = score_event_decomposition(score)
        touchdowns += td
        field_goals += fg
        safeties += safety
    possessions = max(1, len(values) * possessions_per_team)
    scoring_drives = touchdowns + field_goals + safeties
    return DriveOutcomeProfile(
        touchdown=touchdowns / possessions,
        field_goal=field_goals / possessions,
        safety=safeties / possessions,
        no_score=max(0.0, (possessions - scoring_drives) / possessions),
        sample_team_games=len(values),
        label=label,
    ).normalized()


def outcome_profile_from_drives(
    drives: Iterable[DriveSummary],
    *,
    possessions_per_team: int,
    label: str,
) -> DriveOutcomeProfile:
    selected = list(drives)
    if not selected:
        return DriveOutcomeProfile(0.2, 0.15, 0.005, 0.645, 0, label).normalized()
    touchdowns = sum(1 for drive in selected if drive.points >= 6)
    field_goals = sum(1 for drive in selected if drive.points == 3)
    safeties = sum(1 for drive in selected if drive.points == 2)
    scoring_drives = touchdowns + field_goals + safeties
    return DriveOutcomeProfile(
        touchdown=touchdowns / len(selected),
        field_goal=field_goals / len(selected),
        safety=safeties / len(selected),
        no_score=max(0.0, (len(selected) - scoring_drives) / len(selected)),
        sample_team_games=max(1, round(len(selected) / max(1, possessions_per_team))),
        label=label,
    ).normalized()


@lru_cache(maxsize=256)
def score_event_decomposition(score: int) -> tuple[int, int, int]:
    """Approximate a final score as football scoring events.

    This is intentionally a conservative Phase B helper for building empirical
    priors from game-level scores. PBP-derived drive outcomes should replace it
    when drive summaries are mandatory inputs.
    """
    score = max(0, int(score))
    best: tuple[int, int, int, int, int] | None = None
    for touchdowns in range(score // 6 + 1):
        for field_goals in range(score // 3 + 1):
            for safeties in range(score // 2 + 1):
                points = 7 * touchdowns + 3 * field_goals + 2 * safeties
                if points != score:
                    continue
                penalty = safeties * 4 + abs(field_goals - touchdowns)
                events = touchdowns + field_goals + safeties
                candidate = (penalty, events, touchdowns, field_goals, safeties)
                if best is None or candidate < best:
                    best = candidate
    if best is None:
        # Rare historical scores can include missed PAT/two-point structure.
        # Fall back to a close normal-football decomposition.
        touchdowns = score // 7
        remainder = score - touchdowns * 7
        field_goals = remainder // 3
        safeties = max(0, (remainder - field_goals * 3) // 2)
        return touchdowns, field_goals, safeties
    return best[2], best[3], best[4]


def _team_scores(games: Iterable[PGPGame]) -> list[int]:
    scores = []
    for game in games:
        if game.home_score is not None:
            scores.append(game.home_score)
        if game.away_score is not None:
            scores.append(game.away_score)
    return scores


def _scores_for_team(games: Iterable[PGPGame], team: str, *, scored: bool) -> list[int]:
    team = team.upper()
    scores = []
    for game in games:
        if game.home_team == team and game.home_score is not None and game.away_score is not None:
            scores.append(game.home_score if scored else game.away_score)
        elif game.away_team == team and game.away_score is not None and game.home_score is not None:
            scores.append(game.away_score if scored else game.home_score)
    return scores


def _drives_for_team(drives: Iterable[DriveSummary], team: str, *, offense: bool) -> list[DriveSummary]:
    team = team.upper()
    return [
        drive
        for drive in drives
        if (drive.offense.upper() == team if offense else drive.defense.upper() == team)
    ]


def _sample_weight(team_games: int) -> float:
    if team_games <= 0:
        return 0.0
    return min(1.0, float(team_games) / float(MIN_TEAM_GAMES_FOR_FULL_WEIGHT))
