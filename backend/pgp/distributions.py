from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable


@dataclass(frozen=True)
class PGPScoreDistribution:
    home_scores: tuple[int, ...]
    away_scores: tuple[int, ...]
    metadata: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if len(self.home_scores) != len(self.away_scores):
            raise ValueError("home_scores and away_scores must have equal length")
        if not self.home_scores:
            raise ValueError("at least one simulation sample is required")

    @property
    def simulations(self) -> int:
        return len(self.home_scores)

    def summary(self) -> dict:
        totals = tuple(home + away for home, away in zip(self.home_scores, self.away_scores))
        margins = tuple(home - away for home, away in zip(self.home_scores, self.away_scores))
        home_wins = sum(1 for margin in margins if margin > 0)
        away_wins = sum(1 for margin in margins if margin < 0)
        ties = self.simulations - home_wins - away_wins
        return {
            "simulations": self.simulations,
            "home_score": _series_summary(self.home_scores),
            "away_score": _series_summary(self.away_scores),
            "total": _series_summary(totals),
            "margin": _series_summary(margins),
            "home_win_probability": home_wins / self.simulations,
            "away_win_probability": away_wins / self.simulations,
            "tie_probability": ties / self.simulations,
            "home_score_distribution": _histogram(self.home_scores),
            "away_score_distribution": _histogram(self.away_scores),
            "total_distribution": _histogram(totals),
            "margin_distribution": _histogram(margins),
            "joint_score_distribution": _joint_histogram(self.home_scores, self.away_scores),
            "metadata": dict(self.metadata),
        }


def _series_summary(values: Iterable[int]) -> dict:
    data = tuple(sorted(int(value) for value in values))
    mean = sum(data) / len(data)
    variance = sum((value - mean) ** 2 for value in data) / len(data)
    return {
        "mean": mean,
        "median": percentile(data, 50),
        "stddev": math.sqrt(variance),
        "p10": percentile(data, 10),
        "p25": percentile(data, 25),
        "p75": percentile(data, 75),
        "p90": percentile(data, 90),
        "interval_50": [percentile(data, 25), percentile(data, 75)],
        "interval_80": [percentile(data, 10), percentile(data, 90)],
        "interval_90": [percentile(data, 5), percentile(data, 95)],
    }


def percentile(sorted_values: Iterable[int], percent: float) -> float:
    data = tuple(sorted(int(value) for value in sorted_values))
    if not data:
        raise ValueError("percentile requires at least one value")
    if percent <= 0:
        return float(data[0])
    if percent >= 100:
        return float(data[-1])
    position = (len(data) - 1) * (percent / 100.0)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(data[lower])
    fraction = position - lower
    return float(data[lower] * (1.0 - fraction) + data[upper] * fraction)


def _histogram(values: Iterable[int]) -> dict[str, float]:
    counter = Counter(int(value) for value in values)
    total = sum(counter.values())
    return {str(value): count / total for value, count in sorted(counter.items())}


def _joint_histogram(home_scores: Iterable[int], away_scores: Iterable[int]) -> dict[str, float]:
    counter = Counter((int(home), int(away)) for home, away in zip(home_scores, away_scores))
    total = sum(counter.values())
    return {f"{home}-{away}": count / total for (home, away), count in sorted(counter.items())}
