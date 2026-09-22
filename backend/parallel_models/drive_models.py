from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional, Sequence

from .interface import NFLGameContext, NFLPrediction
from .nflverse_pbp import DriveSummary
from .pbp_features import MatchupPBPFeatures, build_matchup_pbp_features


DEFAULT_DRIVES_PER_TEAM_GAME = 10.5
DEFAULT_NFL_TOTAL = 44.0
DEFAULT_HOME_FIELD_POINTS = 1.5
MIN_SAMPLE_DRIVES_FOR_FULL_WEIGHT = 500


@dataclass
class DriveSuccessModel:
    """Research-only DSM baseline from drive-level EPA features.

    This candidate does not use market spread or market total as inputs.  It is
    intentionally simple and shrunk toward league-average priors until enough
    historical team drives are available.
    """

    drive_summaries: Sequence[DriveSummary]
    game_order: Optional[Mapping[str, Sequence[object]]] = None
    model_name: str = "dsm"
    model_version: str = "research-dsm-pbp-baseline-0.1"
    drives_per_team_game: float = DEFAULT_DRIVES_PER_TEAM_GAME
    home_field_points: float = DEFAULT_HOME_FIELD_POINTS
    total_prior: float = DEFAULT_NFL_TOTAL

    def predict(self, game_context: NFLGameContext) -> NFLPrediction:
        features = build_matchup_pbp_features(
            game_context,
            self.drive_summaries,
            game_order=self.game_order,
            target_game_id=_target_game_id(game_context),
        )
        weight = _sample_weight(features.sample_drives)
        raw_margin = features.dsm_margin_signal * self.drives_per_team_game + self.home_field_points
        expected_margin = raw_margin * weight + self.home_field_points * (1.0 - weight)
        expected_total = _shrunk_total(features.prm_total_signal * self.drives_per_team_game, self.total_prior, weight)
        home_score, away_score = _scores_from_margin_total(expected_margin, expected_total)
        return NFLPrediction(
            model_name=self.model_name,
            model_version=self.model_version,
            home_team=game_context.home_team,
            away_team=game_context.away_team,
            kickoff=game_context.kickoff,
            expected_home_score=home_score,
            expected_away_score=away_score,
            expected_margin=expected_margin,
            expected_total=expected_total,
            home_win_probability=None,
            uncertainty={
                "sample_drives": features.sample_drives,
                "sample_weight": weight,
                "research_only": True,
            },
            metadata={"features": _feature_metadata(features)},
        )


@dataclass
class EPAPointsModel:
    """Research-only PRM baseline from drive-level points/EPA features."""

    drive_summaries: Sequence[DriveSummary]
    game_order: Optional[Mapping[str, Sequence[object]]] = None
    model_name: str = "prm"
    model_version: str = "research-prm-epa-baseline-0.1"
    drives_per_team_game: float = DEFAULT_DRIVES_PER_TEAM_GAME
    home_field_points: float = DEFAULT_HOME_FIELD_POINTS
    total_prior: float = DEFAULT_NFL_TOTAL

    def predict(self, game_context: NFLGameContext) -> NFLPrediction:
        features = build_matchup_pbp_features(
            game_context,
            self.drive_summaries,
            game_order=self.game_order,
            target_game_id=_target_game_id(game_context),
        )
        weight = _sample_weight(features.sample_drives)
        home_ppd, away_ppd = _expected_points_per_drive(features)
        raw_home_score = home_ppd * self.drives_per_team_game + self.home_field_points / 2
        raw_away_score = away_ppd * self.drives_per_team_game - self.home_field_points / 2
        raw_total = max(24.0, min(64.0, raw_home_score + raw_away_score))
        raw_margin = raw_home_score - raw_away_score
        expected_total = _shrunk_total(raw_total, self.total_prior, weight)
        expected_margin = raw_margin * weight + self.home_field_points * (1.0 - weight)
        home_score, away_score = _scores_from_margin_total(expected_margin, expected_total)
        return NFLPrediction(
            model_name=self.model_name,
            model_version=self.model_version,
            home_team=game_context.home_team,
            away_team=game_context.away_team,
            kickoff=game_context.kickoff,
            expected_home_score=home_score,
            expected_away_score=away_score,
            expected_margin=expected_margin,
            expected_total=expected_total,
            home_win_probability=None,
            uncertainty={
                "sample_drives": features.sample_drives,
                "sample_weight": weight,
                "research_only": True,
            },
            metadata={"features": _feature_metadata(features)},
        )


def _sample_weight(sample_drives: int) -> float:
    if sample_drives <= 0:
        return 0.0
    return min(1.0, float(sample_drives) / float(MIN_SAMPLE_DRIVES_FOR_FULL_WEIGHT))


def _shrunk_total(raw_total: float, prior: float, weight: float) -> float:
    bounded = max(24.0, min(64.0, raw_total))
    return bounded * weight + prior * (1.0 - weight)


def _scores_from_margin_total(margin: float, total: float) -> tuple[float, float]:
    home = (total + margin) / 2.0
    away = (total - margin) / 2.0
    return home, away


def _target_game_id(game_context: NFLGameContext) -> Optional[str]:
    value = game_context.metadata.get("game_id") if game_context.metadata else None
    return str(value) if value else None


def _expected_points_per_drive(features: MatchupPBPFeatures) -> tuple[float, float]:
    home_ppd = (features.home_offensive_points_per_drive + features.away_defensive_points_allowed_per_drive) / 2.0
    away_ppd = (features.away_offensive_points_per_drive + features.home_defensive_points_allowed_per_drive) / 2.0
    return home_ppd, away_ppd


def _feature_metadata(features: MatchupPBPFeatures) -> dict:
    return {
        "sample_drives": features.sample_drives,
        "dsm_margin_signal": features.dsm_margin_signal,
        "prm_total_signal": features.prm_total_signal,
        "home_offensive_epa_per_drive": features.home_offensive_epa_per_drive,
        "away_offensive_epa_per_drive": features.away_offensive_epa_per_drive,
        "home_defensive_epa_allowed_per_drive": features.home_defensive_epa_allowed_per_drive,
        "away_defensive_epa_allowed_per_drive": features.away_defensive_epa_allowed_per_drive,
    }
