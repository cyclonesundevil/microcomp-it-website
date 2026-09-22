"""Research-only parallel NFL model interfaces.

This package is intentionally separate from the production NFL predictor and
the protected RSM implementation.  Phase 1 only wraps existing RSM behavior
behind a common interface; it does not implement DSM, PRM, or ensembles.
"""

from .interface import NFLGameContext, NFLPrediction
from .nflverse_pbp import DriveSummary
from .rsm_wrapper import RSMParallelModel

__all__ = ["DriveSummary", "NFLGameContext", "NFLPrediction", "RSMParallelModel"]
