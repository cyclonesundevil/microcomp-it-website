from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from nfl_predictor import RSM_PROFILE, RsmStage7CComparisonModel

from .interface import NFLGameContext, NFLPrediction


@dataclass
class RSMParallelModel:
    """Common-interface wrapper for the protected RSM display adapter.

    This class delegates prediction to `RsmStage7CComparisonModel` and performs
    only arithmetic conversions that are already implied by the existing RSM
    outputs.  It does not refit, retune, recalibrate, or alter RSM artifacts.
    """

    adapter: RsmStage7CComparisonModel = field(default_factory=RsmStage7CComparisonModel)
    model_name: str = "RSM"
    model_version: str = "RSM-v2-stage7c-display-wrapper"

    def predict(self, game_context: NFLGameContext) -> NFLPrediction:
        details = self.adapter.prediction_details(game_context.as_predictor_game())
        expected_margin = float(details["predicted_margin"])
        expected_total = _optional_float(details.get("predicted_total"))
        expected_home_score, expected_away_score = _scores_from_margin_total(expected_margin, expected_total)
        return NFLPrediction(
            model_name=self.model_name,
            model_version=self.model_version,
            home_team=game_context.home_team,
            away_team=game_context.away_team,
            kickoff=game_context.kickoff,
            expected_home_score=expected_home_score,
            expected_away_score=expected_away_score,
            expected_margin=expected_margin,
            expected_total=expected_total,
            home_win_probability=None,
            uncertainty={
                "lineup_confidence": details.get("lineup_confidence"),
                "probability_calibration": "unavailable",
            },
            metadata={
                "source_model_profile": RSM_PROFILE,
                "features": details.get("features"),
                "features_as_of": details.get("features_as_of"),
                "features_source": details.get("features_source"),
                "lineup_source": details.get("lineup_source"),
                "total_model_version": details.get("total_model_version"),
                "wrapper_note": "Scores are algebraically derived from the frozen RSM margin and total diagnostic.",
            },
        )


def _optional_float(value: object) -> Optional[float]:
    if value is None:
        return None
    return float(value)


def _scores_from_margin_total(margin: float, total: Optional[float]) -> tuple[Optional[float], Optional[float]]:
    if total is None:
        return None, None
    home = (total + margin) / 2.0
    away = (total - margin) / 2.0
    return home, away
