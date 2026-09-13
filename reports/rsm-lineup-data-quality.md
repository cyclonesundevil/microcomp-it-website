# RSM Historical Lineup Data Quality

## Scope

Audited 815 existing historical game feature rows across 2021, 2022, 2023. No player ratings, unit ratings, matchup features, fitted coefficients, or predictions were rebuilt.

## Coverage

| Measure | Count | Percentage |
| --- | ---: | ---: |
| Games with complete expected starter slots | 777 | 95.34% |
| Games with directly verified pregame expected lineups | 0 | 0.00% |
| Games using prior-snap lineup reconstruction | 815 | 100.00% |
| Expected starter slots filled | 37450 / 37490 | 99.89% |
| Starter slots supported by prior snap evidence | 37319 | 99.54% |
| Starter slots using deterministic fallback | 131 | 0.35% |
| Starter slots without earlier player-stat history | 163 | 0.43% |
| Starter selections following a team transition | 1617 | 4.31% |

## Lineup confidence

HIGH requires all configured slots and at least 90% prior-snap evidence. MEDIUM requires all slots and at least 70%; every other game is LOW.

| Confidence | Games | Percentage |
| --- | ---: | ---: |
| HIGH | 777 | 95.34% |
| MEDIUM | 0 | 0.00% |
| LOW | 38 | 4.66% |

## Missing information

- Verified pregame injury availability is missing for 815 games (100%). Retrospective weekly-roster status is intentionally ignored because its publication time cannot be proven to precede kickoff.
- Market spread is missing for 0 games; market total is missing for 0 games.
- A verifiable market-line timestamp is missing for 815 games (100%). Lines are evaluation-only and do not enter RSM football features.
- Historical depth-chart changes are not directly available in the audited artifact. Expected starters are reconstructed from weekly roster membership and strictly prior snaps.

## Point-in-time findings

- Player-stat and snap loaders reject same-week and future rows. Final-season totals are not used for earlier weeks.
- Weekly roster selection never reads a future week. The audit found 0 games lacking an exact target-week roster.
- Trades are handled through the target-week team roster; prior snaps from an earlier team may support role evidence but cannot change target-week membership.
- Historical injury replacements cannot be validated with the selected public data. Deterministic fallback selections are not claimed as verified injury replacements.
- Actual scores are outcome targets only. Feature extraction is invariant to changing scores and market values, as enforced by tests.

## Residual leakage risks

1. Weekly roster assets identify the game-week player pool but do not provide a source publication timestamp for every row. Team membership is therefore point-in-time by week, not proven to the kickoff second.
2. Closing consensus lines have no captured timestamp. They must remain evaluation-only until timestamp provenance is available.
3. Injury and depth-chart confidence is incomplete; this affects lineup fidelity rather than introducing known future performance into PSR inputs.

Stage 4 conclusion: no same-season future-stat, future-snap, future-roster-week, result, or market-feature leakage was found in the audited code paths. Injury/depth and market timestamp provenance remain explicit data-quality limitations.
