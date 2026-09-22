"""Research-only parallel NFL model interfaces.

This package is intentionally separate from the production NFL predictor and
the protected RSM implementation.  Phase 1 wraps existing RSM behavior behind
a common interface.  Phase 2 adds reusable nflverse PBP/drive feature sources
for future DSM and PRM work; it does not expose new production predictions.
"""

from .interface import NFLGameContext, NFLPrediction
from .drive_models import DriveSuccessModel, EPAPointsModel
from .nflverse_pbp import DriveSummary
from .pbp_features import MatchupPBPFeatures, TeamDriveStats
from .rsm_wrapper import RSMParallelModel

__all__ = [
    "DriveSummary",
    "DriveSuccessModel",
    "EPAPointsModel",
    "MatchupPBPFeatures",
    "NFLGameContext",
    "NFLPrediction",
    "RSMParallelModel",
    "TeamDriveStats",
]
