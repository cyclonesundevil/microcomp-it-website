# RSM Stage 6 Diagnostics

This report diagnoses the frozen RSM-v1 results. It does not tune 2024-2025, change model coefficients, or implement RSM-v2.

## Existing predictor comparison — identical 544 games

The comparison uses the documented pre-RSM `baseline` profile chronologically, with an all-game pick on the same closing lines and the same grading convention as RSM.

| Model | ATS | O/U | Score MAE | Margin MAE | Total MAE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Existing baseline | 48.24% | 49.91% | 7.468 | 10.417 | 10.450 |
| RSM-v1 | 51.02% | 49.72% | 7.702 | 10.558 | 10.746 |

## RSM versus market error

| Measure | RSM | Market |
| --- | ---: | ---: |
| Margin MAE | 10.558 | 9.666 |
| Total MAE | 10.746 | 10.062 |

RSM/market error correlation is 0.941 for margin and 0.955 for total. RSM prediction correlation with the market is 0.622 for margin and 0.452 for total.
The correlation between RSM edge and what the market missed is -0.098 for margin and -0.042 for total.

## Edge-size analysis

### ATS

| Absolute edge | N | W-L-P | Accuracy |
| --- | ---: | ---: | ---: |
| 0-1 | 78 | 49-27-2 | 64.47% |
| 1-2 | 109 | 53-56-0 | 48.62% |
| 2-3 | 94 | 41-51-2 | 44.57% |
| 3-5 | 110 | 58-51-1 | 53.21% |
| 5+ | 153 | 74-79-0 | 48.37% |

### O/U

| Absolute edge | N | W-L-P | Accuracy |
| --- | ---: | ---: | ---: |
| 0-1 | 105 | 57-46-2 | 55.34% |
| 1-2 | 103 | 52-51-0 | 50.49% |
| 2-3 | 91 | 42-49-0 | 46.15% |
| 3-5 | 139 | 70-69-0 | 50.36% |
| 5+ | 106 | 48-57-1 | 45.71% |

## Confidence deciles

Deciles are ordered from lowest to highest claimed confidence using the stronger of the ATS and O/U pick probabilities.

| Decile | N | ATS | Mean ATS p | Actual ATS | O/U | Mean O/U p | Actual O/U | Mean ATS edge | Mean O/U edge |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 55 | 58.18% | 52.69% | 58.18% | 54.55% | 52.44% | 54.55% | 0.93 | 0.86 |
| 2 | 54 | 53.85% | 54.60% | 53.85% | 37.74% | 55.03% | 37.74% | 1.58 | 1.77 |
| 3 | 55 | 60.00% | 55.93% | 60.00% | 42.59% | 56.02% | 42.59% | 2.05 | 2.12 |
| 4 | 54 | 46.30% | 57.44% | 46.30% | 48.15% | 57.18% | 48.15% | 2.58 | 2.54 |
| 5 | 54 | 49.06% | 59.08% | 49.06% | 53.70% | 58.82% | 53.70% | 3.15 | 3.13 |
| 6 | 55 | 44.44% | 59.58% | 44.44% | 60.00% | 59.74% | 60.00% | 3.34 | 3.47 |
| 7 | 54 | 57.41% | 62.36% | 57.41% | 46.30% | 60.15% | 46.30% | 4.34 | 3.63 |
| 8 | 55 | 53.70% | 63.93% | 53.70% | 54.55% | 60.81% | 54.55% | 4.93 | 3.89 |
| 9 | 54 | 51.85% | 65.47% | 51.85% | 54.72% | 62.90% | 54.72% | 5.55 | 4.69 |
| 10 | 54 | 35.19% | 72.19% | 35.19% | 44.44% | 65.90% | 44.44% | 8.41 | 5.97 |

The confidence score is derived from a normal residual model whose scales came from 2023 validation. It is distinct from lineup confidence. The deciles show whether larger model-market deviations and the residual-based probabilities are monotonic out of sample.

### Confidence-inversion findings

| Question | Finding |
| --- | --- |
| A. Probability calibration incorrect? | Yes. The highest decile claimed 72.19% mean ATS probability but won 35.19%; O/U claimed 65.90% and won 44.44%. |
| B. Raw edge inversely related to accuracy? | At the extreme, yes; overall it is non-monotonic. The largest ATS and O/U edge buckets did not outperform the smaller buckets. |
| C. Uncertainty calculation incorrect? | Inadequate out of sample. A single 2023 residual SD converts edge magnitude directly into confidence and does not model feature or lineup uncertainty. |
| D. Lineup and prediction confidence confused? | No. Prediction confidence is computed from market edge and residual SD; lineup confidence is a separate field. |
| E. Extreme ratings causing excess confidence? | Plausible but not proven causally. Correlated QB, receiving, and composite-offense inputs can create extreme model-market deviations, which the probability transform treats as highly certain. |

## Score bias

| Group | N team scores | Predicted | Actual | Bias | MAE |
| --- | ---: | ---: | ---: | ---: | ---: |
| HOME | 544 | 23.15 | 23.95 | -0.79 | 7.85 |
| AWAY | 544 | 21.34 | 21.98 | -0.64 | 7.56 |
| FAVORITE | 544 | 23.21 | 25.96 | -2.75 | 7.85 |
| UNDERDOG | 544 | 21.28 | 19.97 | 1.31 | 7.56 |
| STRONG_OFFENSE | 273 | 25.22 | 25.30 | -0.07 | 8.49 |
| WEAK_OFFENSE | 273 | 19.79 | 20.92 | -1.13 | 7.15 |
| STRONG_DEFENSE_FACED | 273 | 21.78 | 21.86 | -0.08 | 7.08 |
| WEAK_DEFENSE_FACED | 273 | 22.78 | 23.40 | -0.62 | 8.16 |
| OVERALL | 1088 | 22.24 | 22.96 | -0.72 | 7.70 |

Predicted team-score SD is 2.558, versus actual SD 9.860; a materially smaller predicted SD indicates compression toward the mean.

## Validation-only component ablation

Each available component is removed, the ridge model is refit on 2021-2022 with the frozen alpha, and the ablated model is evaluated on 2023. Positive deltas mean removal made error worse. No 2024-2025 locked result is used for fitting, classification, or selection.

| Component removed | Score MAE | Δ | Margin MAE | Δ | Total MAE | Δ | Assessment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| FULL RSM-v1 | 7.794 | — | 10.542 | — | 11.255 | — | REFERENCE |
| QB rating | 7.796 | +0.002 | 10.533 | -0.009 | 11.226 | -0.029 | NEUTRAL |
| OL rating | 7.797 | +0.002 | 10.534 | -0.008 | 11.234 | -0.022 | NEUTRAL |
| WR/TE receiving rating | 7.792 | -0.002 | 10.543 | +0.001 | 11.223 | -0.032 | NEUTRAL |
| composite pass-offense rating | 7.795 | +0.001 | 10.530 | -0.012 | 11.240 | -0.015 | NEUTRAL |
| RB/rushing rating (unit proxy) | 7.790 | -0.004 | 10.560 | +0.018 | 11.229 | -0.026 | NEUTRAL (PROXY) |
| defensive front (run-defense proxy) | 7.799 | +0.005 | 10.528 | -0.014 | 11.290 | +0.035 | NEUTRAL (PROXY) |
| secondary (pass-defense proxy) | 7.816 | +0.021 | 10.597 | +0.055 | 11.251 | -0.004 | NEUTRAL (PROXY) |
| kicker | 7.793 | -0.001 | 10.550 | +0.008 | 11.259 | +0.004 | NEUTRAL |
| linebackers (separate) | — | — | — | — | — | — | UNCERTAIN |
| injury/replacement adjustment | — | — | — | — | — | — | UNCERTAIN |
| recent-form component | — | — | — | — | — | — | UNCERTAIN |
| multi-year component | — | — | — | — | — | — | UNCERTAIN |
| matchup interaction terms | — | — | — | — | — | — | UNCERTAIN |

## Position-weight diagnostics

Validation correlation with subsequent game margin:

| Rating differential | Correlation |
| --- | ---: |
| QB | 0.262 |
| OL | 0.156 |
| WR_TE | 0.243 |
| RB_rushing_proxy | 0.247 |
| pass_defense | 0.214 |
| run_defense | 0.020 |
| kicker | 0.037 |

Validation correlation with subsequent team scoring (defense rows use opponent points, so negative is favorable):

| Rating | Correlation |
| --- | ---: |
| QB | 0.158 |
| OL | 0.077 |
| WR_TE | 0.124 |
| RB_rushing_proxy | 0.115 |
| pass_defense | -0.082 |
| run_defense | -0.036 |
| kicker | 0.012 |

Key within-model feature correlations:

| Pair | Correlation |
| --- | ---: |
| QB_vs_pass_offense | 0.949 |
| OL_vs_run_offense | 0.663 |
| receiving_vs_pass_offense | 0.735 |
| pass_defense_vs_run_defense | 0.554 |

Frozen standardized coefficients:

| Feature | Coefficient |
| --- | ---: |
| qb_rating | +3.848 |
| pass_offense_rating | -2.904 |
| receiving_rating | +1.606 |
| home_field | +0.914 |
| ol_rating | +0.845 |
| opponent_pass_defense_rating | -0.513 |
| run_offense_rating | +0.426 |
| opponent_run_defense_rating | -0.409 |
| kicker_rating | -0.198 |

The artifact contains both QB/OL/receiving features and composite pass/run offense, so high correlations and opposing coefficient signs are evidence of multicollinearity and possible double-counting. Pass rush, linebackers, and secondary are not separately exposed and cannot be assigned causal importance.

## Five-year history

Only the frozen five-year feature artifact exists; 1/2/3-year comparisons require rebuilding player ratings and were prohibited in Stage 6.

## Market pricing and residual signal

| Roster feature | Corr. market spread | Corr. margin residual | Corr. total residual |
| --- | ---: | ---: | ---: |
| QB mismatch | 0.579 | 0.053 | 0.026 |
| OL mismatch | 0.070 | 0.016 | -0.007 |
| receiver mismatch | 0.503 | 0.059 | 0.014 |
| pass offense-defense matchup | 0.414 | -0.015 | 0.003 |
| run offense-defense matchup | 0.254 | -0.013 | -0.020 |
| overall roster proxy | 0.622 | 0.045 | 0.006 |

QB and receiver differentials move strongly with the market spread, but every available feature has near-zero correlation with margin and total residuals. Timestamped injury availability is absent, so major-injury pricing cannot be tested directly. The available evidence says the market already prices much of the strongest measured roster information and RSM-v1 adds no demonstrated independent residual signal.

## Playoff diagnostic

| Split | N | Mean absolute ATS edge | Mean absolute O/U edge | Actual total | ATS | O/U |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Regular season | 544 | 3.68 | 3.20 | 45.92 | 51.02% | 49.72% |
| Playoffs | 26 | 3.96 | 4.27 | 47.31 | 57.69% | 61.54% |

| Playoff split | N | Record | Accuracy |
| --- | ---: | ---: | ---: |
| ATS pick HOME | 11 | 9-2-0 | 81.82% |
| ATS pick AWAY | 15 | 6-9-0 | 40.00% |
| ATS pick FAVORITE | 3 | 2-1-0 | 66.67% |
| ATS pick UNDERDOG | 23 | 13-10-0 | 56.52% |
| O/U pick OVER | 19 | 11-8-0 | 57.89% |
| O/U pick UNDER | 7 | 5-2-0 | 71.43% |

Playoffs had somewhat larger mean edges and a 1.39-point higher scoring environment. Any apparent matchup split is too small to distinguish from luck. The 26-game sample and stale pre-playoff lineup features make attribution uncertain; no playoff-specific optimization is justified.

## Answers and recommendation

1. Score prediction: RSM-v1 does not improve on the existing baseline (7.702 vs 7.468 MAE).
2. Margin prediction: RSM-v1 does not improve (10.558 vs 10.417 MAE).
3. Total prediction: RSM-v1 does not improve (10.746 vs 10.450 MAE).
4. Independent market information is weak: edge/residual correlations are -0.098 for margin and -0.042 for total.
5. HIGH confidence underperformed because confidence is mostly a transformation of edge magnitude under a fixed normal residual scale, while larger deviations were not reliably more accurate. It is not caused by confusion with lineup confidence, which is a separate field.
6. Larger edges perform worse at the extreme and are non-monotonic overall; no threshold is selected.
7. No available component shows a robust, material validation improvement after refitting. The pass-defense/secondary proxy is directionally helpful but small; the rest are approximately neutral or mixed.
8. No component is robustly HARMFUL under the refit ablation. Separate linebackers, injuries, recent form, history components, and interaction terms remain UNCERTAIN because they are absent from the frozen artifact.
9. QB is not demonstrably weighted appropriately: it has the largest coefficient, but 0.949 correlation with composite pass offense and the opposing pass-offense coefficient make the effective contribution unstable and hard to identify.
10. OL does not show a material independent validation contribution; its rating remains a limited snap/experience proxy.
11. Defensive player strength shows limited proxy evidence. Pass defense is directionally useful, run defense is near zero, and separate pass-rush/LB/secondary effects cannot be identified.
12-13. Five-year history cannot be compared fairly with shorter windows from existing artifacts, so whether it helps and the best window both remain UNCERTAIN.
14. Market-residual correlations above show which available roster variables have any directional relationship with what the market missed; none should be treated as selected features from this locked analysis.
15. RSM agrees with market direction at correlations 0.622 (margin) and 0.452 (total), while failing to outperform market MAE, consistent with strong roster information already being priced.
16. The evidence points primarily to score conversion/multicollinearity and probability calibration, plus limited information beyond the market; the diagnostic cannot isolate all player-rating and unit-aggregation weaknesses.
17. RSM-v2 is justified only as a new development experiment, not as a production betting upgrade. It will require a new future untouched test period.
18. Three highest-value RSM-v2 research changes: remove or regularize duplicated unit features using development data; calibrate uncertainty against edge monotonicity; add timestamped injury/lineup and stronger OL/coverage data. These are recommendations only and were not implemented.
