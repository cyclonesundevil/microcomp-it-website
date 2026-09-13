# RSM-v1 Validation

Training seasons: 2021, 2022
Validation seasons: 2023
Locked test seasons: 2024, 2025 (not evaluated)
Selected ridge alpha: 1.0

| Split | Games | Score MAE | Margin MAE | Total MAE | Score RMSE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Training | 543 | 7.607 | 10.158 | 10.763 | 9.474 |
| Validation | 272 | 7.794 | 10.542 | 11.255 | 9.813 |

## Standardized coefficients

| Feature | Coefficient |
| --- | ---: |
| qb_rating | 3.8482 |
| pass_offense_rating | -2.9036 |
| receiving_rating | 1.6065 |
| home_field | 0.9142 |
| ol_rating | 0.8450 |
| opponent_pass_defense_rating | -0.5129 |
| run_offense_rating | 0.4261 |
| opponent_run_defense_rating | -0.4089 |
| kicker_rating | -0.1975 |

Market spread and total are not model features. Coefficients describe association, not causation.
