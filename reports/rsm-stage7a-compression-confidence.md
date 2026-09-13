# Stage 7A - Score Compression and Confidence Inversion

Stage 7A is diagnostic. RSM-v1 and its frozen 2024-2025 results were not changed or used for fitting. Score and probability experiments were fitted on 2021-2022 and evaluated once on 2023.

## Scope

- Training: 2021-2022 (543 regular-season games)
- Validation: 2023 (272 regular-season games)
- Locked 2024-2025 data read or tuned: no

## 1. Validation distribution and compression

| Output | Series | Mean | Std | Variance | Min | P05 | P25 | Median | P75 | P95 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| home_points | predicted | 23.35 | 2.48 | 6.17 | 17.48 | 19.69 | 21.74 | 23.14 | 24.63 | 27.95 | 32.13 |
| home_points | actual | 23.11 | 10.37 | 107.62 | 0.00 | 7.00 | 17.00 | 23.00 | 29.00 | 39.90 | 70.00 |
| away_points | predicted | 21.47 | 2.58 | 6.68 | 15.34 | 17.64 | 19.68 | 21.16 | 23.04 | 26.14 | 29.39 |
| away_points | actual | 20.43 | 9.45 | 89.24 | 0.00 | 6.00 | 14.00 | 20.00 | 27.00 | 37.00 | 45.00 |
| game_margin | predicted | 1.88 | 3.47 | 12.02 | -7.28 | -4.13 | -0.31 | 2.15 | 4.16 | 7.20 | 10.78 |
| game_margin | actual | 2.68 | 14.40 | 207.25 | -40.00 | -21.00 | -6.00 | 2.00 | 12.00 | 27.45 | 50.00 |
| game_total | predicted | 44.82 | 3.70 | 13.67 | 36.89 | 39.24 | 42.06 | 44.54 | 47.04 | 51.44 | 57.03 |
| game_total | actual | 43.54 | 13.66 | 186.48 | 3.00 | 24.10 | 35.00 | 42.00 | 52.00 | 68.00 | 90.00 |

Margin standard-deviation ratio: 0.241; variance ratio: 0.058.
Total standard-deviation ratio: 0.271; variance ratio: 0.073.

## 2. Validation calibration slopes

A slope above 1 means actual variation is wider than predicted variation. Confidence intervals use the large-sample 1.96 standard-error approximation.

| Output | Intercept | Slope | Slope 95% CI | R-squared |
| --- | ---: | ---: | ---: | ---: |
| home_points | 5.658 | 0.747 | [0.257, 1.238] | 0.032 |
| away_points | 5.853 | 0.679 | [0.250, 1.107] | 0.034 |
| game_margin | 0.212 | 1.318 | [0.848, 1.787] | 0.101 |
| game_total | 35.540 | 0.178 | [-0.262, 0.619] | 0.002 |

Margin slope above 1 is consistent with compressed useful margin variation. Total slope is below 1, but its R-squared is only 0.002: raw total variation is almost unrelated to actual total variation, so simply expanding totals would amplify noise rather than solve compression.

## 3. Where compression enters

Player-level historical PSRs were not archived; PSR distributions use the current checkpoint snapshot only.

| Stage/value | Standard deviation |
| --- | ---: |
| Current PSR, all players | 5.298 |

Current checkpoint PSR distribution by position:

| Position | N | Mean | Std | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| CB | 332 | 53.72 | 4.67 | 50.02 | 72.33 |
| DL | 263 | 54.24 | 5.19 | 50.01 | 71.23 |
| EDGE | 377 | 54.32 | 5.07 | 49.88 | 73.21 |
| K | 40 | 56.49 | 7.58 | 41.53 | 72.64 |
| LB | 205 | 53.75 | 4.82 | 50.02 | 68.56 |
| OL | 508 | 54.49 | 6.59 | 45.80 | 71.48 |
| OTHER | 73 | 55.10 | 5.01 | 44.11 | 73.62 |
| QB | 119 | 53.84 | 5.07 | 42.98 | 66.52 |
| RB | 213 | 53.60 | 4.40 | 46.86 | 65.94 |
| S | 243 | 53.89 | 4.59 | 50.02 | 70.67 |
| TE | 207 | 54.41 | 5.90 | 44.53 | 72.60 |
| WR | 382 | 53.36 | 4.55 | 45.99 | 66.23 |

Historical validation pipeline dispersion:

| Stage/value | Standard deviation |
| --- | ---: |
| Validation unit qb_rating | 4.107 |
| Validation unit ol_rating | 2.415 |
| Validation unit receiving_rating | 2.424 |
| Validation unit pass_offense_rating | 2.588 |
| Validation unit run_offense_rating | 1.922 |
| Validation unit pass_defense_rating | 2.330 |
| Validation unit run_defense_rating | 2.455 |
| Validation unit kicker_rating | 6.595 |
| Validation roster-strength proxy | 1.732 |
| Validation roster-differential proxy | 1.939 |
| Validation matchup pass_offense_minus_defense | 3.153 |
| Validation matchup run_offense_minus_defense | 2.794 |
| RSM-v1 expected team points | 2.702 |
| Actual team points | 10.012 |

Ridge contribution standard deviations:

| Feature | Contribution std |
| --- | ---: |
| qb_rating | 3.783 |
| pass_offense_rating | 3.011 |
| receiving_rating | 1.514 |
| home_field | 0.914 |
| ol_rating | 0.905 |
| opponent_pass_defense_rating | 0.483 |
| run_offense_rating | 0.438 |
| opponent_run_defense_rating | 0.380 |
| kicker_rating | 0.236 |

Compression is cumulative: player reliability shrinks ratings toward the 50 replacement prior; missing groups fall back to 50; season weighting averages history; unit ratings average multiple positions; standardized ridge coefficients then convert those already-aggregated ratings to scores around a 22.433 intercept. RSM-v1 has no explicit score clipping. The largest identifiable loss of dispersion is the unit/matchup-to-expected-points conversion, amplified by correlated inputs and regression toward the mean.

## 4. Ridge shrinkage diagnostic

No alpha is selected here. All variants fit 2021-2022 and evaluate 2023.

| Alpha | Score MAE | Margin MAE | Total MAE | Margin std | Total std | Margin slope | Total slope | Coefficient L2 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.0 | 7.796 | 10.550 | 11.260 | 3.497 | 3.704 | 1.303 | 0.168 | 6.162 |
| 0.1 | 7.795 | 10.549 | 11.259 | 3.494 | 3.703 | 1.305 | 0.170 | 6.060 |
| 1.0 | 7.794 | 10.542 | 11.255 | 3.468 | 3.697 | 1.318 | 0.178 | 5.293 |
| 10.0 | 7.794 | 10.531 | 11.240 | 3.382 | 3.683 | 1.357 | 0.209 | 2.759 |
| 100.0 | 7.796 | 10.544 | 11.217 | 3.236 | 3.595 | 1.419 | 0.231 | 1.769 |
| 1000.0 | 7.808 | 10.664 | 11.096 | 2.452 | 2.852 | 1.890 | 0.280 | 1.236 |

## 5. Mean-reversion mechanisms

- PSR metrics are z-scored, capped at +/-3, reliability-shrunk toward replacement level 50, clipped to 25-99, and averaged across five weighted seasons.
- Missing position groups use the replacement value 50. Unit ratings are weighted averages; OL also includes a weakest-link adjustment.
- RSM-v1 standardizes inputs, uses a league-like intercept of 22.433 team points, and applies ridge shrinkage to correlated coefficients.
- QB, receiving, and composite pass offense overlap strongly, allowing offsetting coefficients rather than clean independent effects.
- Unlike RSM-v0, RSM-v1 expected scores are not explicitly clipped or capped.
- The confidence layer does not change scores; it only maps model-market distance through a global residual SD.

## 6. Confidence pipeline

- ATS: `Phi(abs(PredictedMargin - MarketHomeMargin) / validation_margin_residual_SD)`
- O/U: `Phi(abs(PredictedTotal - MarketTotal) / validation_total_residual_SD)`
- Label: `max(picked ATS probability, picked O/U probability): LOW < .55, MEDIUM < .65, HIGH >= .65`
- Frozen validation residual SDs: margin 13.696, total 13.974.

There is no simulation, learned win-probability model, or logistic layer in RSM-v1. Because Phi(abs(edge)/SD) is strictly increasing in absolute edge, raw-edge and probability rankings are mechanically identical within ATS and within O/U. The probability layer can exaggerate magnitude, but it cannot create or reverse the ordering.

## 7. Validation raw-edge and confidence monotonicity

### ATS raw absolute edge deciles

| Decile | N | Mean absolute edge | Mean probability | W-L-P | Accuracy |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 28 | 0.240 | 50.70% | 15-12-1 | 55.56% |
| 2 | 27 | 0.753 | 52.19% | 14-12-1 | 53.85% |
| 3 | 27 | 1.243 | 53.62% | 9-17-1 | 34.62% |
| 4 | 27 | 1.803 | 55.24% | 10-15-2 | 40.00% |
| 5 | 27 | 2.315 | 56.71% | 13-14-0 | 48.15% |
| 6 | 28 | 2.869 | 58.29% | 14-13-1 | 51.85% |
| 7 | 27 | 3.663 | 60.54% | 14-11-2 | 56.00% |
| 8 | 27 | 4.629 | 63.23% | 12-10-5 | 54.55% |
| 9 | 27 | 5.749 | 66.26% | 13-13-1 | 50.00% |
| 10 | 27 | 7.927 | 71.76% | 12-15-0 | 44.44% |

### ATS predicted-probability deciles

| Decile | N | Mean absolute edge | Mean probability | W-L-P | Accuracy |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 28 | 0.240 | 50.70% | 15-12-1 | 55.56% |
| 2 | 27 | 0.753 | 52.19% | 14-12-1 | 53.85% |
| 3 | 27 | 1.243 | 53.62% | 9-17-1 | 34.62% |
| 4 | 27 | 1.803 | 55.24% | 10-15-2 | 40.00% |
| 5 | 27 | 2.315 | 56.71% | 13-14-0 | 48.15% |
| 6 | 28 | 2.869 | 58.29% | 14-13-1 | 51.85% |
| 7 | 27 | 3.663 | 60.54% | 14-11-2 | 56.00% |
| 8 | 27 | 4.629 | 63.23% | 12-10-5 | 54.55% |
| 9 | 27 | 5.749 | 66.26% | 13-13-1 | 50.00% |
| 10 | 27 | 7.927 | 71.76% | 12-15-0 | 44.44% |

These probability-sorted deciles contain the same games in the same order as raw-edge deciles because probability is a monotonic transform of absolute edge.

### OU raw absolute edge deciles

| Decile | N | Mean absolute edge | Mean probability | W-L-P | Accuracy |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 28 | 0.345 | 50.99% | 15-13-0 | 53.57% |
| 2 | 27 | 0.958 | 52.73% | 12-15-0 | 44.44% |
| 3 | 27 | 1.686 | 54.80% | 9-17-1 | 34.62% |
| 4 | 27 | 2.354 | 56.69% | 12-15-0 | 44.44% |
| 5 | 27 | 3.039 | 58.61% | 10-17-0 | 37.04% |
| 6 | 28 | 3.676 | 60.37% | 17-11-0 | 60.71% |
| 7 | 27 | 4.435 | 62.45% | 15-12-0 | 55.56% |
| 8 | 27 | 5.174 | 64.44% | 12-15-0 | 44.44% |
| 9 | 27 | 6.580 | 68.10% | 13-14-0 | 48.15% |
| 10 | 27 | 9.345 | 74.67% | 11-15-1 | 42.31% |

### OU predicted-probability deciles

| Decile | N | Mean absolute edge | Mean probability | W-L-P | Accuracy |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 28 | 0.345 | 50.99% | 15-13-0 | 53.57% |
| 2 | 27 | 0.958 | 52.73% | 12-15-0 | 44.44% |
| 3 | 27 | 1.686 | 54.80% | 9-17-1 | 34.62% |
| 4 | 27 | 2.354 | 56.69% | 12-15-0 | 44.44% |
| 5 | 27 | 3.039 | 58.61% | 10-17-0 | 37.04% |
| 6 | 28 | 3.676 | 60.37% | 17-11-0 | 60.71% |
| 7 | 27 | 4.435 | 62.45% | 15-12-0 | 55.56% |
| 8 | 27 | 5.174 | 64.44% | 12-15-0 | 44.44% |
| 9 | 27 | 6.580 | 68.10% | 13-14-0 | 48.15% |
| 10 | 27 | 9.345 | 74.67% | 11-15-1 | 42.31% |

These probability-sorted deciles contain the same games in the same order as raw-edge deciles because probability is a monotonic transform of absolute edge.

## 8. Probability calibration

| Market/model | N | Brier | Calibration intercept | Calibration slope |
| --- | ---: | ---: | ---: | ---: |
| ATS raw | 258 | 0.2636 | -0.065 | 0.051 |
| ATS training-fitted recalibration | 258 | 0.2524 | -0.093 | 0.303 |
| OU raw | 270 | 0.2707 | -0.205 | 0.165 |
| OU training-fitted recalibration | 270 | 0.2542 | -0.381 | 1.518 |

A constant 50% forecast has Brier score 0.2500. Both recalibrated results remain worse than that reference, so the numerical improvement is confidence shrinkage rather than evidence of a useful calibrated betting probability.

### ATS validation probability bins

| Model | Probability bin | N | Mean probability | Observed frequency |
| --- | --- | ---: | ---: | ---: |
| raw | 0.50-0.55 | 92 | 52.43% | 48.86% |
| raw | 0.55-0.60 | 78 | 57.24% | 46.67% |
| raw | 0.60-0.65 | 54 | 62.47% | 50.00% |
| raw | 0.65-0.70 | 34 | 67.51% | 51.52% |
| raw | 0.70-0.80 | 14 | 74.44% | 50.00% |
| recalibrated | 0.50-0.55 | 226 | 53.45% | 48.36% |
| recalibrated | 0.55-0.60 | 46 | 55.76% | 51.11% |

### OU validation probability bins

| Model | Probability bin | N | Mean probability | Observed frequency |
| --- | --- | ---: | ---: | ---: |
| raw | 0.50-0.55 | 71 | 52.43% | 43.66% |
| raw | 0.55-0.60 | 73 | 57.52% | 44.44% |
| raw | 0.60-0.65 | 66 | 62.36% | 54.55% |
| raw | 0.65-0.70 | 33 | 67.31% | 45.45% |
| raw | 0.70-0.80 | 26 | 73.62% | 36.00% |
| raw | 0.80-1.00 | 3 | 80.93% | 100.00% |
| recalibrated | 0.50-0.55 | 233 | 53.82% | 46.55% |
| recalibrated | 0.55-0.60 | 39 | 55.60% | 47.37% |

## 9. Direction and sign audit

Code inspection and property tests confirm that increasing home margin advantage increases home-cover probability, increasing away advantage increases away-cover probability, and increasing predicted total relative to market increases Over probability. Spread conversion uses sportsbook home -3 -> internal home margin +3. No sign, CDF-direction, or comparison-operator bug was found.

## 10. Residual variance

| Grouping | Quartile | N | Range | Margin residual SD | Total residual SD |
| --- | --- | ---: | ---: | ---: | ---: |
| absolute_spread_edge | Q1 | 68 | 0.04-1.23 | 14.129 | 12.655 |
| absolute_spread_edge | Q2 | 68 | 1.25-2.57 | 12.131 | 12.813 |
| absolute_spread_edge | Q3 | 68 | 2.59-4.54 | 14.675 | 15.373 |
| absolute_spread_edge | Q4 | 68 | 4.64-10.93 | 13.399 | 14.610 |
| absolute_total_edge | Q1 | 68 | 0.04-1.66 | 11.100 | 12.417 |
| absolute_total_edge | Q2 | 68 | 1.70-3.32 | 13.359 | 11.971 |
| absolute_total_edge | Q3 | 68 | 3.32-5.05 | 14.426 | 14.458 |
| absolute_total_edge | Q4 | 68 | 5.08-13.08 | 15.217 | 15.982 |
| roster_strength_gap | Q1 | 68 | 0.01-0.54 | 13.898 | 14.455 |
| roster_strength_gap | Q2 | 68 | 0.57-1.20 | 13.129 | 15.476 |
| roster_strength_gap | Q3 | 68 | 1.23-2.13 | 14.719 | 14.367 |
| roster_strength_gap | Q4 | 68 | 2.14-6.22 | 12.812 | 10.799 |
| absolute_market_spread | Q1 | 71 | 1.00-2.50 | 12.216 | 13.124 |
| absolute_market_spread | Q2 | 78 | 3.00-3.50 | 14.365 | 14.398 |
| absolute_market_spread | Q3 | 58 | 4.00-6.50 | 14.744 | 15.449 |
| absolute_market_spread | Q4 | 65 | 7.00-17.50 | 12.791 | 12.076 |
| predicted_total | Q1 | 68 | 36.89-42.02 | 11.199 | 15.072 |
| predicted_total | Q2 | 68 | 42.07-44.54 | 14.862 | 14.154 |
| predicted_total | Q3 | 68 | 44.54-47.04 | 14.118 | 14.300 |
| predicted_total | Q4 | 68 | 47.06-57.03 | 13.161 | 10.923 |

Across these observable quartiles, margin residual SD ranges from 11.100 to 15.217, and total residual SD ranges from 10.799 to 15.982. This is material heteroskedasticity, although the pattern is not uniformly monotonic.

UNAVAILABLE: historical per-game lineup confidence was not archived in development predictions.

## 11. Controlled score-calibration experiment

Training-only formulas: calibrated margin = -0.439 + 1.239 * raw margin; calibrated total = 11.528 + 0.743 * raw total.

| Validation model | Score MAE | Margin MAE | Total MAE | Score std | Margin std | Total std | ATS | O/U |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Raw RSM-v1 | 7.794 | 10.542 | 11.255 | 2.702 | 3.468 | 3.697 | 48.84% | 46.67% |
| Calibrated experiment | 7.713 | 10.541 | 11.078 | 2.718 | 4.297 | 2.747 | 49.61% | 46.67% |

The training-only layer expands margin SD from 3.468 to 4.297 and moves its validation calibration slope from 1.318 to 1.064. It contracts total SD from 3.697 to 2.747 while improving total MAE, confirming that the raw total's limited variation is mostly weak signal rather than a scale-only defect.

Post-calibration validation slopes:

| Output | Slope | R-squared |
| --- | ---: | ---: |
| home_points | 0.876 | 0.045 |
| away_points | 0.777 | 0.046 |
| game_margin | 1.064 | 0.101 |
| game_total | 0.240 | 0.002 |

## 12. Controlled probability-recalibration experiment

Training-only ATS correctness model: sigmoid(0.094 + 0.019 * abs(edge)).
Training-only O/U correctness model: sigmoid(0.116 + 0.013 * abs(edge)).

This layer leaves the raw pick unchanged and estimates only its probability of success. Validation Brier and calibration results are in Section 8.

### ATS recalibrated-probability deciles

| Decile | N | Mean probability | Observed accuracy |
| ---: | ---: | ---: | ---: |
| 1 | 28 | 52.46% | 55.56% |
| 2 | 27 | 52.70% | 53.85% |
| 3 | 27 | 52.94% | 34.62% |
| 4 | 27 | 53.21% | 40.00% |
| 5 | 27 | 53.46% | 48.15% |
| 6 | 28 | 53.73% | 51.85% |
| 7 | 27 | 54.11% | 56.00% |
| 8 | 27 | 54.57% | 54.55% |
| 9 | 27 | 55.11% | 50.00% |
| 10 | 27 | 56.15% | 44.44% |

### OU recalibrated-probability deciles

| Decile | N | Mean probability | Observed accuracy |
| ---: | ---: | ---: | ---: |
| 1 | 28 | 53.02% | 53.57% |
| 2 | 27 | 53.21% | 44.44% |
| 3 | 27 | 53.44% | 34.62% |
| 4 | 27 | 53.64% | 44.44% |
| 5 | 27 | 53.86% | 37.04% |
| 6 | 28 | 54.06% | 60.71% |
| 7 | 27 | 54.29% | 55.56% |
| 8 | 27 | 54.52% | 44.44% |
| 9 | 27 | 54.96% | 48.15% |
| 10 | 27 | 55.82% | 42.31% |

Both training-fitted slopes are positive, so recalibration compresses claimed probabilities toward 50% but preserves the same edge ordering. Validation accuracy remains non-monotonic and the highest deciles remain below 50%; monotonic confidence is not restored.

## Final answers

1. Score compression is severe: validation margin SD is 24.1% of actual and total SD is 27.1% of actual.
2. Compression is cumulative, but it primarily becomes operationally severe when averaged unit/matchup features are converted by the correlated ridge score model into expected points.
3. Ridge is not the primary cause if low-alpha rows retain similarly compressed output; the diagnostic table quantifies its incremental effect.
4. Player ratings include explicit reliability and history shrinkage, and unit aggregation narrows them further. Historical player-level PSRs were not archived, so the exact historical share is uncertain.
5. Yes. The expected-score layer produces much less dispersion than actual scores and has no explicit clipping that would otherwise explain it.
6. Raw edge is not reliably informative on 2023: accuracy is non-monotonic and the largest-edge deciles are below 50% for both ATS and O/U. No betting threshold is selected.
7. Within each market, confidence ordering is identical to raw absolute-edge ordering. Any inversion in ordering is already present in raw edge; the global-normal probability layer adds overstatement, not reversal.
8. No spread-sign or probability-direction bug was found.
9. A single global residual SD is incomplete: the quartile table shows residual variance changes across observable game conditions, and lineup uncertainty is omitted.
10. Training-only score recalibration modestly improves 2023 score/margin/total MAE from 7.794/10.542/11.255 to 7.713/10.541/11.078. It corrects margin scale but contracts totals further, so it is not a general cure for score compression.
11. Training-only probability recalibration improves validation Brier from 0.2636 to 0.2524 ATS and 0.2707 to 0.2542 O/U by shrinking confidence toward 50%, but it does not restore monotonic decile ordering and remains worse than the 0.2500 constant-50% reference.
12. The evidence can justify a separately developed RSM-v2 candidate, but not a production replacement. A new untouched future test period is required.
13. Three specific RSM-v2 changes: simplify correlated unit inputs before score conversion; fit training-only margin/total calibration with explicit dispersion checks; replace the global-normal confidence transform with training-fitted calibration that incorporates heteroskedastic and lineup uncertainty.

STOP: no full RSM-v2 was implemented and RSM-v1 artifacts were not overwritten.
