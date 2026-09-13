# RSM Checkpoint Two Review

## Outcome

RSM-v0 produced internally consistent expected home points, expected away points, margin, and total for every regular-season game in the 2024 and 2025 seasons. The mapping is deliberately unoptimized and cannot receive a market spread or total as an input.

| Split | Games | Score MAE | Margin MAE | Total MAE | Score RMSE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Overall | 544 | 7.789 | 10.950 | 10.473 | 9.762 |
| 2024 | 272 | 7.750 | 10.979 | 9.996 | 9.687 |
| 2025 | 272 | 7.827 | 10.922 | 10.949 | 9.836 |

These are baseline measurements, not betting results. ATS and over/under accuracy have not been optimized or promoted as model performance.

## Leakage controls

- Player statistics and snaps must have a season/week strictly earlier than the predicted game.
- Same-game actual starters and snaps are never used to construct the expected lineup.
- Weekly roster data supplies player identity, team, and position only. Retrospective status/injury fields are ignored because their publication time cannot be proven to precede kickoff.
- Closing lines are copied to the prediction artifact for later evaluation but are not accepted by the RSM-v0 score function.
- The command refuses to publish partial results when any eligible game lacks a prediction.

## Known limitations

- Week-one starter inference has less prior-team evidence and may rely on prior-season snaps and deterministic roster fallbacks.
- Public OL and coverage metrics remain materially weaker than skill-position and pass-rush inputs.
- The checkpoint covers regular-season games only; playoffs remain a separate later evaluation.
- Weekly rating normalization is reproducible but computationally expensive and should be cached before broader tuning.

## Artifacts

- `reports/rsm-v0-predictions.csv`
- `reports/rsm-v0-summary.json`
- `reports/rsm-v0-backtest.md`

Checkpoint two meets its infrastructure goal. It does not establish that RSM beats the existing predictor or betting markets.
