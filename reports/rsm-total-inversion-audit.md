# RSM Total Inversion Audit

This is a read-only audit of the hypothesis that RSM over/under selections should be inverted.
No production RSM behavior, coefficients, thresholds, feature definitions, or prediction outputs were changed.

## Ten-year support status

Ten-year point-in-time RSM total audit supported by current artifacts: **False**.

The repository does not contain point-in-time RSM total prediction artifacts for ten historical seasons. The audit is limited to saved 2023 validation and 2024-2025 locked RSM artifacts.

## Source artifacts

- `reports\rsm-stage7a-compression-confidence.csv`
- `reports\rsm-backtest-games.csv`

## Period summary

| Period | Games | Original O/U | Original accuracy | Original 95% CI | Inverted O/U | Inverted accuracy | Inverted 95% CI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023 validation regular season | 272 | 126-144-2 | 46.67% | 40.80%-52.62% | 144-126-2 | 53.33% | 47.38%-59.20% |
| 2024-2025 locked regular season | 544 | 269-272-3 | 49.72% | 45.53%-53.92% | 272-269-3 | 50.28% | 46.08%-54.47% |
| 2024-2025 locked playoffs | 26 | 16-10-0 | 61.54% | 42.53%-77.57% | 10-16-0 | 38.46% | 22.43%-57.47% |
| 2023-2025 combined regular saved artifacts | 816 | 395-416-5 | 48.71% | 45.28%-52.14% | 416-395-5 | 51.29% | 47.86%-54.72% |

## Interpretation

- The inversion pattern is visible in 2023 validation and 2025 locked regular season, but not in 2024.
- Across the saved 2023-2025 regular-season artifacts, inversion improves O/U from 48.71% to 51.29%, which is below common break-even levels and has a confidence interval that includes 50%.
- Locked 2024-2025 regular season alone improves only from 49.72% to 50.28% when inverted.
- Locked playoff O/U was positive in the original direction, so inversion would have harmed that small sample.
- This does not validate flipping production RSM O/U selections. It identifies a research question for future point-in-time/prospective tracking.

## Detailed breakdowns

| Group | Label | Games | Original O/U | Original accuracy | Inverted O/U | Inverted accuracy |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| season | 2023 | 272 | 126-144-2 | 46.67% | 144-126-2 | 53.33% |
| season | 2024 | 272 | 136-133-3 | 50.56% | 133-136-3 | 49.44% |
| season | 2025 | 272 | 133-139-0 | 48.90% | 139-133-0 | 51.10% |
| week | 1 | 48 | 19-29-0 | 39.58% | 29-19-0 | 60.42% |
| week | 10 | 42 | 19-22-1 | 46.34% | 22-19-1 | 53.66% |
| week | 11 | 43 | 21-21-1 | 50.00% | 21-21-1 | 50.00% |
| week | 12 | 43 | 21-22-0 | 48.84% | 22-21-0 | 51.16% |
| week | 13 | 45 | 24-20-1 | 54.55% | 20-24-1 | 45.45% |
| week | 14 | 42 | 20-22-0 | 47.62% | 22-20-0 | 52.38% |
| week | 15 | 48 | 20-28-0 | 41.67% | 28-20-0 | 58.33% |
| week | 16 | 48 | 32-16-0 | 66.67% | 16-32-0 | 33.33% |
| week | 17 | 48 | 23-25-0 | 47.92% | 25-23-0 | 52.08% |
| week | 18 | 48 | 26-22-0 | 54.17% | 22-26-0 | 45.83% |
| week | 2 | 48 | 22-26-0 | 45.83% | 26-22-0 | 54.17% |
| week | 3 | 48 | 22-26-0 | 45.83% | 26-22-0 | 54.17% |
| week | 4 | 48 | 22-26-0 | 45.83% | 26-22-0 | 54.17% |
| week | 5 | 42 | 18-24-0 | 42.86% | 24-18-0 | 57.14% |
| week | 6 | 44 | 20-22-2 | 47.62% | 22-20-2 | 52.38% |
| week | 7 | 43 | 28-15-0 | 65.12% | 15-28-0 | 34.88% |
| week | 8 | 45 | 20-25-0 | 44.44% | 25-20-0 | 55.56% |
| week | 9 | 43 | 18-25-0 | 41.86% | 25-18-0 | 58.14% |
| market_total_bucket | 42-47 | 366 | 172-191-3 | 47.38% | 191-172-3 | 52.62% |
| market_total_bucket | 47.5+ | 204 | 102-101-1 | 50.25% | 101-102-1 | 49.75% |
| market_total_bucket | <42 | 246 | 121-124-1 | 49.39% | 124-121-1 | 50.61% |
| absolute_total_edge_bucket | 0-1.99 | 291 | 145-143-3 | 50.35% | 143-145-3 | 49.65% |
| absolute_total_edge_bucket | 2-3.99 | 249 | 117-132-0 | 46.99% | 132-117-0 | 53.01% |
| absolute_total_edge_bucket | 4-5.99 | 160 | 81-79-0 | 50.62% | 79-81-0 | 49.38% |
| absolute_total_edge_bucket | 6+ | 116 | 52-62-2 | 45.61% | 62-52-2 | 54.39% |
| prediction_confidence | HIGH | 269 | 130-137-2 | 48.69% | 137-130-2 | 51.31% |
| prediction_confidence | LOW | 124 | 61-63-0 | 49.19% | 63-61-0 | 50.81% |
| prediction_confidence | MEDIUM | 423 | 204-216-3 | 48.57% | 216-204-3 | 51.43% |
