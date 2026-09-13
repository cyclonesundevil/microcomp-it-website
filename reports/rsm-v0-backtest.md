# RSM-v0 Checkpoint Two

This is an unoptimized, market-independent score baseline. Market columns are retained only for later comparison and are not inputs to `predict_score`.

Historical starters are pregame proxies inferred from the target week's roster identity and snap participation strictly before that game. Historical injury status is not used.

| Split | Games | Score MAE | Margin MAE | Total MAE | Score RMSE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Overall | 544 | 7.789 | 10.95 | 10.473 | 9.762 |
| 2024 | 272 | 7.75 | 10.979 | 9.996 | 9.687 |
| 2025 | 272 | 7.827 | 10.922 | 10.949 | 9.836 |

Eligible regular-season games: 544
Predicted regular-season games: 544

Known limitation: weekly nflverse rosters identify the available player pool, but their publication timestamp is not precise enough to use retrospective injury/status fields without leakage risk. Checkpoint two therefore uses identity/team/position only.
