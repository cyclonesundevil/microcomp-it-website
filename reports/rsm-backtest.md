# RSM-v1 Locked Walk-Forward Backtest

## Stage 4 gate

Stage 4 found no same-season future-stat, future-snap, future-roster-week, result-feature, or market-feature leakage requiring a model correction. Point-in-time and grading regression tests pass. Remaining injury, depth-chart, lineup-confidence, and market-timestamp limitations are reported below; they were not silently imputed.

## Frozen evaluation periods

- Training: 2021 regular season (2021-09-09 through 2022-01-09) and 2022 regular season (2022-09-08 through 2023-01-08).
- Validation: season [2023] (2023-09-07 through 2024-01-07).
- Locked test: 2024 regular season (2024-09-05 through 2025-01-05) and 2025 regular season (2025-09-04 through 2026-01-04).
- Locked postseason evaluation: 2025-01-11 through 2026-02-08.
- The locked period did not select player formulas, positional weights, features, coefficients, ridge alpha, probability scales, or confidence thresholds.

## RSM-v1 REGULAR SEASON

ATS — Wins: 275; Losses: 264; Pushes: 5; Eligible games: 544; Accuracy excluding pushes: 51.02%; 95% CI: 46.81%–55.22%.

OVER/UNDER — Wins: 269; Losses: 272; Pushes: 3; Eligible games: 544; Accuracy excluding pushes: 49.72%; 95% CI: 45.53%–53.92%.

Score MAE: 7.702
Margin MAE: 10.558
Total MAE: 10.746
Score RMSE: 9.669

## RSM-v1 PLAYOFFS

ATS: 57.69% (15-11-0), 95% CI 38.95%–74.46%
O/U: 61.54% (16-10-0), 95% CI 42.53%–77.57%
Sample: 26
Score MAE: 8.075
Margin MAE: 10.837
Total MAE: 11.450

Playoff predictions use each team's final available pre-playoff regular-season feature snapshot. They are not refitted, but lineup confidence is LOW because playoff-specific lineup features were not archived.

## Market and probability conventions

`market_spread` is expected home margin: sportsbook Home -3 is stored as +3. ATS grading compares actual home margin with that value. Whole-line ties are pushes; half-point lines cannot push.
Probability residual scales were frozen from 2023 validation only: margin SD 13.696, total SD 13.974.
Prediction confidence thresholds were frozen before locked scoring: LOW < 55%, MEDIUM 55%–<65%, HIGH ≥ 65%.

## Missing-data exclusions

Regular season: 0 exclusions from 544 source games.
Playoffs: 0 exclusions (none).
Regular-season per-game lineup confidence was not archived with the frozen feature artifact and is reported as UNKNOWN; games were not removed for this reason.
Exact market-line capture timestamps are unavailable for every game. The nflverse closing-consensus values are used only for edge calculation and grading, never as RSM features.

## By season

| Group | Games | ATS W-L-P | ATS | O/U W-L-P | O/U | Score MAE | Margin MAE | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2024 | 272 | 136-132-4 | 50.75% | 136-133-3 | 50.56% | 7.562 | 10.567 | 10.187 |
| 2025 | 272 | 139-132-1 | 51.29% | 133-139-0 | 48.90% | 7.843 | 10.549 | 11.304 |

## By week

| Group | Games | ATS W-L-P | ATS | O/U W-L-P | O/U | Score MAE | Margin MAE | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 32 | 22-10-0 | 68.75% | 16-16-0 | 50.00% | 7.155 | 7.595 | 11.460 |
| 10 | 28 | 17-11-0 | 60.71% | 12-15-1 | 44.44% | 7.482 | 9.320 | 12.428 |
| 11 | 29 | 12-17-0 | 41.38% | 18-11-0 | 62.07% | 7.304 | 10.545 | 8.672 |
| 12 | 27 | 14-11-2 | 56.00% | 12-15-0 | 44.44% | 7.165 | 9.623 | 9.968 |
| 13 | 32 | 14-18-0 | 43.75% | 18-13-1 | 58.06% | 6.572 | 9.642 | 9.325 |
| 14 | 27 | 13-13-1 | 50.00% | 13-14-0 | 48.15% | 8.586 | 10.661 | 11.767 |
| 15 | 32 | 16-16-0 | 50.00% | 13-19-0 | 40.62% | 8.602 | 11.536 | 13.289 |
| 16 | 32 | 14-18-0 | 43.75% | 19-13-0 | 59.38% | 7.507 | 10.608 | 9.989 |
| 17 | 32 | 14-18-0 | 43.75% | 13-19-0 | 40.62% | 9.602 | 12.726 | 13.293 |
| 18 | 32 | 18-14-0 | 56.25% | 17-15-0 | 53.12% | 8.609 | 11.567 | 11.650 |
| 2 | 32 | 17-14-1 | 54.84% | 16-16-0 | 50.00% | 7.234 | 10.118 | 11.030 |
| 3 | 32 | 19-13-0 | 59.38% | 14-18-0 | 43.75% | 8.685 | 12.944 | 12.409 |
| 4 | 32 | 19-13-0 | 59.38% | 15-17-0 | 46.88% | 7.054 | 9.118 | 9.658 |
| 5 | 28 | 13-15-0 | 46.43% | 10-18-0 | 35.71% | 7.689 | 10.009 | 10.610 |
| 6 | 29 | 14-15-0 | 48.28% | 16-12-1 | 57.14% | 6.886 | 9.975 | 9.776 |
| 7 | 30 | 11-19-0 | 36.67% | 20-10-0 | 66.67% | 8.372 | 12.631 | 10.144 |
| 8 | 29 | 15-14-0 | 51.72% | 14-15-0 | 48.28% | 7.413 | 11.799 | 9.257 |
| 9 | 29 | 13-15-1 | 46.43% | 13-16-0 | 44.83% | 6.544 | 9.353 | 8.231 |

## By home/away selection

| Group | Games | ATS W-L-P | ATS | O/U W-L-P | O/U | Score MAE | Margin MAE | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AWAY | 253 | 127-124-2 | 50.60% | 122-129-2 | 48.61% | 7.863 | 11.142 | 10.634 |
| HOME | 291 | 148-140-3 | 51.39% | 147-143-1 | 50.69% | 7.563 | 10.050 | 10.843 |

## By favorite/underdog selection

| Group | Games | ATS W-L-P | ATS | O/U W-L-P | O/U | Score MAE | Margin MAE | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FAVORITE | 86 | 47-37-2 | 55.95% | 35-51-0 | 40.70% | 7.505 | 9.487 | 11.280 |
| UNDERDOG | 458 | 228-227-3 | 50.11% | 234-221-3 | 51.43% | 7.740 | 10.759 | 10.645 |

## By spread size

| Group | Games | ATS W-L-P | ATS | O/U W-L-P | O/U | Score MAE | Margin MAE | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0-2.5 | 132 | 64-68-0 | 48.48% | 67-65-0 | 50.76% | 7.464 | 10.080 | 10.290 |
| 3-6.5 | 268 | 138-125-5 | 52.47% | 127-138-3 | 47.92% | 7.587 | 9.661 | 11.516 |
| 7+ | 144 | 73-71-0 | 50.69% | 75-69-0 | 52.08% | 8.136 | 12.665 | 9.730 |

## By market total

| Group | Games | ATS W-L-P | ATS | O/U W-L-P | O/U | Score MAE | Margin MAE | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 42-47 | 252 | 125-125-2 | 50.00% | 124-126-2 | 49.60% | 7.731 | 10.592 | 10.737 |
| 47.5+ | 152 | 81-70-1 | 53.64% | 73-78-1 | 48.34% | 7.628 | 9.947 | 10.919 |
| <42 | 140 | 69-69-2 | 50.00% | 72-68-0 | 51.43% | 7.732 | 11.159 | 10.573 |

## By prediction confidence

| Group | Games | ATS W-L-P | ATS | O/U W-L-P | O/U | Score MAE | Margin MAE | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| HIGH | 207 | 101-105-1 | 49.03% | 103-103-1 | 50.00% | 8.357 | 11.906 | 11.772 |
| LOW | 53 | 30-23-0 | 56.60% | 30-23-0 | 56.60% | 6.973 | 8.729 | 9.485 |
| MEDIUM | 284 | 144-136-4 | 51.43% | 136-146-2 | 48.23% | 7.361 | 9.917 | 10.233 |

## By historical-lineup confidence

| Group | Games | ATS W-L-P | ATS | O/U W-L-P | O/U | Score MAE | Margin MAE | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| UNKNOWN | 544 | 275-264-5 | 51.02% | 269-272-3 | 49.72% | 7.702 | 10.558 | 10.746 |

## Interpretation

Regular-season ATS accuracy of 51.02% indicates no apparent predictive advantage. Regular-season O/U accuracy of 49.72% also indicates no apparent advantage. Neither target exceeded 60%.

The playoff O/U result of 61.54% is not treated as an established edge: it contains only 26 games, its 95% interval is wide, and playoff-specific lineups were unavailable. The HIGH prediction-confidence bucket also underperformed the LOW bucket on both ATS and O/U, which is suspicious and should be checked for probability miscalibration during Stage 6.

Accuracy is reported exactly as observed. No coefficient, threshold, feature, or weight was changed after inspecting locked results. Stage 6 diagnostics and model comparisons were not performed.
