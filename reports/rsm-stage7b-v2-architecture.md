# Stage 7B - Structural RSM-v2 Candidate

This is an experimental architecture evaluation. It uses 2021-2022 for fitting/selection and 2023 for validation. RSM-v1 and 2024-2025 artifacts were not modified or used.

## Scope and availability

Training games: 543; validation games: 272; locked seasons used: no.

Available: QB, OL starter distribution, receiver depth, pass-rusher peaks, coverage weakness, front-seven average, home-field intercept, rest differential.

Unavailable and not synthesized: verified pregame injuries, red-zone offense/defense, direct pass-block/run-block grades, pass-rush win rate, coverage grades.

Frozen five-year PSR history retained because Stage 6 could not validate position-specific alternatives without rebuilding ratings.

## Correlation audit

Started with 22 interpretable candidates. Training-only zero-variance, pairwise |r| >= 0.90, and exact multivariate-dependency pruning retained 18 features.

| Feature | Decision | Reason |
| --- | --- | --- |
| home_field_indicator | DROP | zero variance; home field is absorbed by the margin intercept |
| qb_quality_diff | KEEP | max pairwise |r| 0.000; multivariate residual ratio 1.000 |
| qb_vs_pass_rush_matchup | KEEP | max pairwise |r| 0.717; multivariate residual ratio 0.697 |
| qb_vs_coverage_matchup | KEEP | max pairwise |r| 0.890; multivariate residual ratio 0.454 |
| ol_pass_vs_pass_rush_matchup | KEEP | max pairwise |r| 0.732; multivariate residual ratio 0.382 |
| ol_run_vs_front_matchup | KEEP | max pairwise |r| 0.688; multivariate residual ratio 0.627 |
| receiving_vs_secondary_matchup | KEEP | max pairwise |r| 0.756; multivariate residual ratio 0.479 |
| rushing_vs_front_matchup | KEEP | max pairwise |r| 0.502; multivariate residual ratio 0.789 |
| ol_weakest_diff | KEEP | max pairwise |r| 0.492; multivariate residual ratio 0.706 |
| ol_strongest_diff | KEEP | max pairwise |r| 0.410; multivariate residual ratio 0.656 |
| ol_continuity_diff | KEEP | max pairwise |r| 0.186; multivariate residual ratio 0.974 |
| ol_replacement_starters_diff | KEEP | max pairwise |r| 0.448; multivariate residual ratio 0.867 |
| wr1_diff | KEEP | max pairwise |r| 0.515; multivariate residual ratio 0.685 |
| wr2_diff | KEEP | max pairwise |r| 0.609; multivariate residual ratio 0.607 |
| te1_diff | KEEP | max pairwise |r| 0.464; multivariate residual ratio 0.511 |
| receiver_replacements_diff | KEEP | max pairwise |r| 0.077; multivariate residual ratio 0.896 |
| pass_rusher1_diff | KEEP | max pairwise |r| 0.819; multivariate residual ratio 0.438 |
| pass_rusher2_diff | DROP | multivariate linear dependency; residual ratio 1.44e-15 |
| weakest_coverage_diff | KEEP | max pairwise |r| 0.533; multivariate residual ratio 0.683 |
| secondary_average_diff | DROP | multivariate linear dependency; residual ratio 2.40e-16 |
| front_seven_average_diff | DROP | multivariate linear dependency; residual ratio 4.17e-16 |
| rest_diff | KEEP | max pairwise |r| 0.074; multivariate residual ratio 0.991 |

Model A never receives market spread. Model B receives the same direct features and predicts `ActualMargin - MarketImpliedMargin`; the market is used only as the target baseline. Home field is constant in a home-oriented margin row and is therefore represented by the intercept rather than an unidentifiable coefficient.

## Training-only model selection

The small ridge grid was selected using 2021 fit -> 2022 evaluation, before 2023 evaluation.

| Model | Alpha | 2022 MAE | 2022 RMSE |
| --- | ---: | ---: | ---: |
| model_a | 0.0 | 9.655 | 12.620 |
| model_a | 1.0 | 9.630 | 12.587 |
| model_a | 10.0 | 9.512 | 12.414 |
| model_a | 100.0 | 9.232 | 12.029 |
| model_b | 0.0 | 9.049 | 11.784 |
| model_b | 1.0 | 9.029 | 11.764 |
| model_b | 10.0 | 8.982 | 11.700 |
| model_b | 100.0 | 8.882 | 11.550 |

## Model A - football margin

| Model | Margin MAE | RMSE | Calibration R-squared | Predictive R-squared | Calibration slope | Predicted SD | Actual SD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RSM-v1 | 10.542 | 13.720 | 0.101 | 0.092 | 1.318 | 3.468 | 14.396 |
| existing predictor | 10.435 | 13.478 | 0.135 | 0.124 | 0.824 | 6.418 | 14.396 |
| market | 9.901 | 13.071 | 0.181 | 0.176 | 1.064 | 5.763 | 14.396 |
| RSM-v2 Model A | 10.528 | 13.567 | 0.117 | 0.112 | 1.131 | 4.352 | 14.396 |

Variance trace: RSM-v1 margin SD 3.468; Model A 4.352; actual 14.396.

Model A residual mean is -0.857 and residual SD is 13.540.

The market remains the best and simplest validation margin baseline. Model A's improvement over RSM-v1 is marginal and it does not beat the existing predictor or market.

## Direct-feature diagnostics

Coefficients are standardized training-fit effects. Validation correlations are diagnostic only and were not used for selection.

| Feature | Model A coef. | Corr. validation margin | Model B coef. | Corr. market residual |
| --- | ---: | ---: | ---: | ---: |
| te1_diff | +1.734 | +0.201 | +0.475 | +0.046 |
| ol_weakest_diff | +1.364 | +0.155 | +0.864 | +0.092 |
| ol_strongest_diff | +1.310 | +0.036 | +0.701 | -0.013 |
| ol_run_vs_front_matchup | -1.203 | +0.135 | -1.170 | -0.008 |
| ol_pass_vs_pass_rush_matchup | +1.092 | +0.198 | +0.291 | +0.035 |
| wr2_diff | +1.025 | +0.117 | +0.286 | -0.031 |
| receiving_vs_secondary_matchup | +0.993 | +0.237 | +0.067 | +0.025 |
| qb_vs_pass_rush_matchup | +0.854 | +0.276 | +0.158 | +0.008 |
| qb_vs_coverage_matchup | +0.667 | +0.277 | -0.150 | +0.010 |
| qb_quality_diff | +0.658 | +0.262 | -0.075 | -0.008 |
| receiver_replacements_diff | +0.485 | +0.057 | +0.414 | +0.065 |
| wr1_diff | -0.468 | +0.133 | -0.717 | -0.001 |
| weakest_coverage_diff | +0.197 | +0.152 | +0.467 | +0.043 |
| ol_continuity_diff | -0.183 | +0.051 | -0.083 | -0.004 |
| pass_rusher1_diff | -0.139 | +0.073 | -0.126 | -0.011 |
| rushing_vs_front_matchup | +0.134 | +0.095 | -0.291 | -0.067 |
| ol_replacement_starters_diff | +0.102 | -0.030 | +0.043 | -0.032 |
| rest_diff | +0.062 | +0.034 | -0.400 | +0.077 |

## Model B - market residual

Residual MAE 9.947; RMSE 13.005; predictive R-squared 0.004; predicted/actual correlation 0.094.

| Absolute predicted residual | N | Directional accuracy | Mean actual residual | Mean aligned residual |
| --- | ---: | ---: | ---: | ---: |
| 0-1 | 132 | 50.41% | 0.367 | -0.223 |
| 1-2 | 97 | 54.26% | 1.639 | 1.216 |
| 2-3 | 26 | 60.00% | 1.808 | 5.808 |
| 3+ | 17 | 43.75% | 1.441 | -0.029 |

All-game secondary ATS: 135-123-14 (52.33%, pushes excluded). No threshold was selected.
Directional accuracy by magnitude is not monotonic.

## New-architecture ablation

Positive MAE delta means removal worsened the model. Alpha is held fixed and every ablation is fit on 2021-2022, evaluated on 2023.

| Removed group | Status | Model A MAE delta | Model A calibration R2 delta | Model B MAE delta | Model B predictive R2 delta |
| --- | --- | ---: | ---: | ---: | ---: |
| QB | TESTED | +0.065 | -0.014 | +0.004 | -0.001 |
| OL | TESTED | +0.058 | -0.014 | +0.024 | -0.005 |
| receivers | TESTED | +0.182 | -0.023 | +0.027 | -0.002 |
| rushing | TESTED | +0.003 | -0.000 | +0.005 | -0.002 |
| pass rush | TESTED | +0.103 | -0.023 | +0.012 | -0.003 |
| secondary | TESTED | +0.052 | -0.009 | +0.006 | -0.004 |
| weakest-link features | TESTED | +0.107 | -0.011 | +0.054 | -0.009 |
| elite-player features | TESTED | -0.127 | +0.012 | -0.055 | +0.006 |
| injuries | UNAVAILABLE | - | - | - | - |

## Limited total diagnostic

| Model | Total MAE | RMSE | Calibration R-squared | Predictive R-squared | Predicted SD |
| --- | ---: | ---: | ---: | ---: | ---: |
| RSM-v1 | 11.255 | 14.033 | 0.002 | -0.056 | 3.697 |
| Direct-feature candidate | 10.928 | 13.904 | 0.000 | -0.037 | 2.610 |

## Final answers

1. Direct features partially reduce compression: margin SD rises 25.5% relative to RSM-v1, but remains only 30.2% of actual dispersion.
2. Model A margin SD is 4.352, versus RSM-v1 3.468 and actual 14.396.
3. Model A calibration R-squared is 0.117, versus RSM-v1 0.101.
4. Model A margin MAE is 10.528, versus RSM-v1 10.542.
5. Receivers and pass rush carry the clearest incremental validation signal, followed by weakest-link features; every effect is small and rushing is effectively neutral.
6. Weakest-link features help modestly: removing them worsens Model A MAE by 0.107 and Model B MAE by 0.054.
7. Elite-player features do not help in this specification: removing them improves Model A MAE by 0.127 and Model B MAE by 0.055.
8. QB signal survives independently but weakly: removing the QB group worsens Model A MAE by 0.065 and reduces calibration R-squared by 0.014.
9. OL information also survives weakly: removal worsens Model A MAE by 0.058 and Model B MAE by 0.024.
10. Defensive information is limited but present through pass-rush and secondary groups; their Model A removal penalties are 0.103 and 0.052. Injury-specific effects remain unavailable.
11. Model B only weakly predicts market residual direction: correlation 0.094, predictive R-squared 0.004, and all-game ATS 52.33%.
12-13. Larger predicted market residuals are not monotonically more reliable; therefore a monotonic betting signal is not established.
14. The direct-feature total calibration R-squared is 0.000; roster-based total signal remains effectively absent.
15. Roster-based O/U development should be suspended pending materially better inputs.
16. The candidate is structurally promising enough for limited research because dispersion and calibration R-squared improve, but practical superiority is not established: MAE improves by only 0.014 and the simpler existing predictor and market remain better.
17. Three next actions: independently validate the surviving direct features on a new future season; acquire timestamped injury and true OL/pass-rush/coverage grades; simplify or drop feature groups whose validation ablations add no information.

STOP: no confidence model was built, no 2024-2025 RSM-v2 evaluation occurred, and RSM-v1 remains frozen.
