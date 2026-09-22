# RSM / DSM / PRM Research Backtest

Research-only validation artifact. DSM/PRM are not production recommendations. RSM is evaluated through the existing wrapper without changing production behavior.

Period: `validation`
Game type: `REG`
Games evaluated: 272
Prediction rows: 1088

| Row | Games | Spread MAE | Total Score MAE | Spread RMSE | Total Score RMSE | Avg sample drives |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RSM | 272 | 10.877 | 11.090 | 13.889 | 13.951 | - |
| dsm | 272 | 11.194 | 10.648 | 14.018 | 13.480 | 535.952 |
| prm | 272 | 10.803 | 10.648 | 13.728 | 13.480 | 535.952 |
| market_baseline | 272 | 9.722 | 10.393 | 12.271 | 13.186 | - |

Frozen periods:

- Training: 2024
- Validation: 2025
- Prospective/current observation: 2026

Important boundaries:

- Market spread and market total are not model inputs for DSM/PRM.
- `market_baseline` is a line baseline, not an algorithmic model.
- RSM rows are generated through `RSMParallelModel`; production RSM behavior is not changed.
