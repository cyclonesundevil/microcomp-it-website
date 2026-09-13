# RSM-v0 Checkpoint Two

This is an unoptimized, market-independent score baseline. Market columns are retained only for later comparison and are not inputs to `predict_score`.

Historical starters are pregame proxies inferred from the target week's roster identity and snap participation strictly before that game. Historical injury status is not used.

| Split | Games | Score MAE | Margin MAE | Total MAE | Score RMSE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Overall | 815 | 7.801 | 10.76 | 10.945 | 9.769 |
| 2021 | 272 | 8.331 | 11.913 | 11.013 | 10.203 |
| 2022 | 271 | 7.29 | 9.383 | 10.985 | 9.198 |
| 2023 | 272 | 7.78 | 10.979 | 10.837 | 9.875 |

Eligible regular-season games: 815
Predicted regular-season games: 815

Known limitation: weekly nflverse rosters identify the available player pool, but their publication timestamp is not precise enough to use retrospective injury/status fields without leakage risk. Checkpoint two therefore uses identity/team/position only.
