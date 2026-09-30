# RSM Total Gap Audit

This is a read-only audit of whether games with `market_total > rsm_predicted_total` lean Under.
No production RSM behavior, coefficients, thresholds, feature definitions, prediction outputs, UI, or APIs were changed.

## Ten-year support status

Ten-year point-in-time RSM total audit supported by current artifacts: **False**.

The repository does not contain point-in-time RSM total prediction artifacts for ten historical seasons. This audit is limited to saved 2023 validation and 2024-2025 locked RSM artifacts.

## Source artifacts

- `reports\rsm-stage7a-compression-confidence.csv` (2023 regular validation): RSM predicted total, market total, actual total, season/week/game metadata, O/U result.
- `reports\rsm-backtest-games.csv` (2024-2025 locked regular season and playoffs): RSM predicted total, market total, actual total, season/week/game metadata, O/U result, prediction confidence, game type.

## Period summary

| Period | Games | Over wins | Under wins | Pushes | Under accuracy | 95% CI | Avg market total | Avg RSM total | Avg actual total | Avg total gap | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023-2025 regular saved artifacts | 816 | 411 | 400 | 5 | 49.32% | 45.89%-52.76% | 44.06 | 44.60 | 45.13 | -0.54 | 10.92 |
| 2024-2025 playoffs | 26 | 13 | 13 | 0 | 50.00% | 32.06%-67.94% | 46.15 | 49.13 | 47.31 | -2.97 | 11.45 |

## Total-gap buckets

`total_gap = market_total - rsm_predicted_total`.

| Bucket | Games | Over wins | Under wins | Pushes | Under accuracy | 95% CI | Avg market total | Avg RSM total | Avg actual total | Avg gap | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| market below RSM | 443 | 217 | 222 | 4 | 50.57% | 45.91%-55.22% | 42.04 | 45.66 | 42.60 | -3.62 | 10.87 |
| 0 to +1.5 | 100 | 44 | 55 | 1 | 55.56% | 45.74%-64.95% | 45.06 | 44.34 | 45.69 | 0.72 | 9.74 |
| +1.5 to +3.5 | 132 | 71 | 61 | 0 | 46.21% | 37.93%-54.70% | 45.97 | 43.53 | 47.58 | 2.44 | 10.13 |
| +3.5 to +5.5 | 87 | 48 | 39 | 0 | 44.83% | 34.82%-55.28% | 47.02 | 42.64 | 48.44 | 4.38 | 11.35 |
| +5.5 or greater | 54 | 31 | 23 | 0 | 42.59% | 30.33%-55.84% | 49.28 | 42.17 | 53.50 | 7.11 | 14.70 |

## Comparison with blind inversion audit

- Blind inversion comparable period: 2023-2025 combined regular saved artifacts.
- Original O/U: 395-416-5 (48.71%).
- Fully inverted O/U: 416-395-5 (51.29%).

## Frozen research watchlist

**RSM_UNDER_WATCH** is defined as `0 <= market_total - rsm_predicted_total < 1.5`.

This is a hypothesis-generating research flag only. It is not a production signal, betting recommendation, confidence pick, or wagering instruction.

| Flag | Games | Over wins | Under wins | Pushes | Under accuracy | 95% CI | Avg gap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RSM_UNDER_WATCH | 100 | 44 | 55 | 1 | 55.56% | 45.74%-64.95% | 0.72 |


## Interpretation

- The broad regular-season `market_total > RSM total` condition is not an Under edge in the saved artifacts.
- The only positive-gap bucket above 50% Under is the narrow 0 to +1.5 bucket, now labeled `RSM_UNDER_WATCH` for prospective research; wider positive gaps skew Over, not Under.
- The +5.5 or greater bucket has the lowest Under rate among the positive-gap buckets, so larger market-above-RSM gaps contradict the proposed Under-ceiling hypothesis in these artifacts.
- Compared with blind inversion, total-gap bucketing is more interpretable but still not validated as a betting edge.
- Because the watchlist condition was identified after looking at these artifacts, it must be frozen and evaluated prospectively before any use beyond research.
- A true ten-year point-in-time RSM total test is unavailable from current artifacts.

## Detailed breakdowns

| Group | Label | Games | Over wins | Under wins | Pushes | Under accuracy | Avg gap | Total MAE |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| season | 2023 | 272 | 124 | 146 | 2 | 54.07% | -1.87 | 11.26 |
| season | 2024 | 272 | 145 | 124 | 3 | 46.10% | -0.15 | 10.19 |
| season | 2025 | 272 | 142 | 130 | 0 | 47.79% | 0.39 | 11.30 |
| week | 1 | 48 | 17 | 31 | 0 | 64.58% | -2.41 | 11.93 |
| week | 10 | 42 | 19 | 22 | 1 | 53.66% | -0.84 | 12.58 |
| week | 11 | 43 | 18 | 24 | 1 | 57.14% | -0.90 | 8.79 |
| week | 12 | 43 | 23 | 20 | 0 | 46.51% | -1.49 | 9.95 |
| week | 13 | 45 | 23 | 21 | 1 | 47.73% | -1.94 | 11.05 |
| week | 14 | 42 | 25 | 17 | 0 | 40.48% | -1.48 | 11.69 |
| week | 15 | 48 | 25 | 23 | 0 | 47.92% | -2.15 | 12.97 |
| week | 16 | 48 | 31 | 17 | 0 | 35.42% | -1.97 | 9.03 |
| week | 17 | 48 | 25 | 23 | 0 | 47.92% | -2.56 | 13.05 |
| week | 18 | 48 | 26 | 22 | 0 | 45.83% | -3.54 | 11.68 |
| week | 2 | 48 | 28 | 20 | 0 | 41.67% | 2.82 | 11.35 |
| week | 3 | 48 | 19 | 29 | 0 | 60.42% | 2.48 | 11.97 |
| week | 4 | 48 | 27 | 21 | 0 | 43.75% | 1.45 | 9.98 |
| week | 5 | 42 | 21 | 21 | 0 | 50.00% | 1.54 | 10.17 |
| week | 6 | 44 | 18 | 24 | 2 | 57.14% | 1.10 | 10.73 |
| week | 7 | 43 | 20 | 23 | 0 | 53.49% | 0.34 | 10.14 |
| week | 8 | 45 | 29 | 16 | 0 | 35.56% | -0.41 | 9.95 |
| week | 9 | 43 | 17 | 26 | 0 | 60.47% | 0.40 | 9.02 |
| market_total_bucket | 42-47 | 366 | 182 | 181 | 3 | 49.86% | -0.13 | 10.38 |
| market_total_bucket | 47.5+ | 204 | 99 | 104 | 1 | 51.23% | 2.53 | 11.24 |
| market_total_bucket | <42 | 246 | 130 | 115 | 1 | 46.94% | -3.71 | 11.44 |
| rsm_original_ou_pick | OVER | 443 | 217 | 222 | 4 | 50.57% | -3.62 | 10.87 |
| rsm_original_ou_pick | UNDER | 373 | 194 | 178 | 1 | 47.85% | 3.11 | 10.97 |
| prediction_confidence | HIGH | 269 | 142 | 125 | 2 | 46.82% | -1.31 | 12.39 |
| prediction_confidence | LOW | 124 | 56 | 68 | 0 | 54.84% | -0.02 | 9.49 |
| prediction_confidence | MEDIUM | 423 | 213 | 207 | 3 | 49.29% | -0.21 | 10.40 |
| rsm_under_watch | NOT_UNDER_WATCH | 716 | 367 | 345 | 4 | 48.46% | -0.72 | 11.08 |
| rsm_under_watch | UNDER_WATCH | 100 | 44 | 55 | 1 | 55.56% | 0.72 | 9.74 |
| game_type | CON | 4 | 3 | 1 | 0 | 25.00% | -2.87 | 20.87 |
| game_type | DIV | 8 | 6 | 2 | 0 | 25.00% | -3.87 | 9.11 |
| game_type | REG | 816 | 411 | 400 | 5 | 49.32% | -0.54 | 10.92 |
| game_type | SB | 2 | 1 | 1 | 0 | 50.00% | -3.30 | 7.04 |
| game_type | WC | 12 | 3 | 9 | 0 | 75.00% | -2.36 | 10.60 |
