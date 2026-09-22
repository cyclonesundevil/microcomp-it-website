# DSM / PRM Research Backtest

Research-only validation artifact. These models are not production recommendations.

Period: `validation`
Game type: `REG`
Games evaluated: 272
Prediction rows: 544

| Model | Games | Spread MAE | Total Score MAE | Spread RMSE | Total Score RMSE | Avg sample drives |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dsm | 272 | 11.194 | 10.648 | 14.018 | 13.480 | 535.952 |
| prm | 272 | 10.803 | 10.648 | 13.728 | 13.480 | 535.952 |

Frozen periods:

- Training: 2024
- Validation: 2025
- Prospective/current observation: 2026

Important boundary: market spread and market total are not model inputs for DSM/PRM.
