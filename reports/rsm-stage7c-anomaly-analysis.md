# Stage 7C - Selective Market-Anomaly Framework

This report evaluates explainable market disagreement, not a validated betting advantage. Rules were frozen from 2021-2022 inputs before 2023 outcomes were evaluated. RSM-v1 and the Stage 7B roster-only margin artifact were not refit, and 2024-2025 results were not read.

## Exact scope

- Development/model selection: 2021-09-09 through 2023-01-08 (543 regular-season games).
- Untouched rule validation: 2023-09-07 through 2024-01-07 (272 regular-season games).
- The stored spread uses expected home margin: +3 means the market favors the home team by three. Conventional sportsbook Home -3 converts explicitly to +3.

## Market-data availability

| Item | Status | Present games | Notes |
| --- | --- | ---: | --- |
| Single stored consensus spread | AVAILABLE | 815 / 815 | Internal positive-home-margin convention; temporal status unverified |
| Spread prices | AVAILABLE | 815 / 815 | Home and away prices exist; sportsbook identity absent |
| Opening spread | UNAVAILABLE | 0 / 815 | No opening-line field |
| Closing spread classification | UNAVAILABLE | 0 / 815 | Stored line is not labeled opening/current/closing |
| Individual sportsbook lines | UNAVAILABLE | 0 / 815 | No per-book records |
| Sportsbook identifier | UNAVAILABLE | 0 / 815 | No sportsbook field |
| Retrieved/line timestamp | UNAVAILABLE | 0 / 815 | No retrieval or line timestamp |
| Line movement/history | UNAVAILABLE | 0 / 815 | Only one line observation per game |
| Pregame provenance | UNAVAILABLE | 0 / 815 | No timestamp proves the line preceded kickoff |
| Scheduled kickoff date | AVAILABLE | 815 / 815 | Date present for all scoped games |
| Scheduled kickoff time | AVAILABLE | 815 / 815 | Clock time present; timezone provenance absent |

The data support comparison with one stored consensus line only. They do not support true individual-sportsbook anomaly detection, detection-time analysis, line movement, or closing-line-value measurement.

### Required future multi-book contract

`game_id`, `sportsbook`, `retrieved_timestamp` (timezone-aware), `line_type`, `spread`, `spread_convention`, `total`, `price_or_odds`, `line_stage` (`opening`/`current`/`closing`), `scheduled_kickoff` (timezone-aware), and `source`.

## Frozen anomaly definition

`market_disagreement = roster_fair_home_margin - market_implied_home_margin`.

The anomaly score multiplies absolute disagreement by a lineup-confidence weight and a structural-agreement factor. A candidate anomaly additionally requires at least two independently grouped feature contributions of at least 0.25 points aligned with the disagreement and MEDIUM-or-better reconstructed-lineup confidence. Missing verified injuries and market timestamps are not treated as known inputs.
Each game record preserves the strongest absolute fair-line driver, the strongest available opposite-sign counterweight, and the next-largest contribution so explanations expose both positive and negative pressure when both exist.
Reconstructed-lineup confidence is HIGH/LOW for 511/32 development games and 266/6 validation games; there are no MEDIUM games. This is prior-snap evidence confidence, not verified injury confidence.

| Rule | Development threshold | Development eligible | Development flagged | Development total coverage | Validation flagged | Validation coverage | W-L-P | ATS | 95% Wilson CI | Avg. disagreement | Median disagreement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TOP_20_PERCENT | 4.683 | 264 | 53 | 9.76% | 32 | 11.76% | 13-16-3 | 44.83% | 28.41%-62.45% | 6.866 | 6.621 |
| TOP_10_PERCENT | 6.423 | 264 | 27 | 4.97% | 12 | 4.41% | 8-3-1 | 72.73% | 43.43%-90.25% | 8.263 | 8.257 |
| TOP_5_PERCENT | 7.440 | 264 | 14 | 2.58% | 6 | 2.21% | 4-2-0 | 66.67% | 30.00%-90.32% | 9.064 | 8.839 |

All eligible 2023 roster-only disagreements: 122-136-14 (47.29%). Constant benchmark: 50.00%. Stage 7B all-game residual result: 52.33%.

Nested top-20%, top-10%, and top-5% accuracy is not monotonically improving as selectivity increases. These nested samples are descriptive and were not used to choose a rule.

## Flagged-game diagnostics

### Home/away model side

| Bucket | Games | W-L-P | ATS | 95% Wilson CI | Avg. disagreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| AWAY | 11 | 6-3-2 | 66.67% | 35.42%-87.94% | 7.242 |
| HOME | 21 | 7-13-1 | 35.00% | 18.12%-56.71% | 6.670 |

### Favorite/underdog

| Bucket | Games | W-L-P | ATS | 95% Wilson CI | Avg. disagreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| FAVORITE | 7 | 4-3-0 | 57.14% | 25.05%-84.18% | 6.022 |
| UNDERDOG | 25 | 9-13-3 | 40.91% | 23.26%-61.27% | 7.103 |

### Lineup confidence

| Bucket | Games | W-L-P | ATS | 95% Wilson CI | Avg. disagreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| HIGH | 32 | 13-16-3 | 44.83% | 28.41%-62.45% | 6.866 |

### Disagreement size

| Bucket | Games | W-L-P | ATS | 95% Wilson CI | Avg. disagreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3-5 | 1 | 0-1-0 | 0.00% | 0.00%-79.35% | 4.977 |
| 5-7 | 19 | 7-10-2 | 41.18% | 21.61%-63.99% | 5.947 |
| 7+ | 12 | 6-5-1 | 54.55% | 28.01%-78.73% | 8.480 |

### Primary feature group

| Bucket | Games | W-L-P | ATS | 95% Wilson CI | Avg. disagreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| OL | 16 | 9-6-1 | 60.00% | 35.75%-80.18% | 7.413 |
| QB | 1 | 0-1-0 | 0.00% | 0.00%-79.35% | 5.459 |
| RECEIVERS | 15 | 4-9-2 | 30.77% | 12.68%-57.63% | 6.377 |

### Primary reason code

| Bucket | Games | W-L-P | ATS | 95% Wilson CI | Avg. disagreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| OL_RUN_VS_FRONT | 1 | 0-1-0 | 0.00% | 0.00%-79.35% | 6.574 |
| OL_STRONGEST_PLAYER | 4 | 3-0-1 | 100.00% | 43.85%-100.00% | 6.735 |
| OL_VS_PASS_RUSH | 3 | 1-2-0 | 33.33% | 6.15%-79.23% | 8.327 |
| OL_WEAKEST_LINK | 8 | 5-3-0 | 62.50% | 30.57%-86.32% | 7.514 |
| QB_DIFFERENCE | 1 | 0-1-0 | 0.00% | 0.00%-79.35% | 5.459 |
| RECEIVERS_VS_SECONDARY | 1 | 0-1-0 | 0.00% | 0.00%-79.35% | 7.283 |
| RECEIVER_REPLACEMENTS | 2 | 0-2-0 | 0.00% | 0.00%-65.76% | 5.855 |
| TE1_DIFFERENCE | 12 | 4-6-2 | 40.00% | 16.82%-68.73% | 6.389 |

## Interpretation

1. The current data can support retrospective consensus-line market-disagreement analysis, subject to missing timestamp provenance.
2. It cannot support true individual-sportsbook comparison because book identifiers and line histories are absent.
3. Frozen rules flag 32 games (11.76%), 12 games (4.41%), 6 games (2.21%) from least to most selective.
4. Larger anomaly scores do not produce monotonically better 2023 outcomes.
5. One validation season and small nested samples are not stable enough to justify actionable use; continued prospective observation is reasonable only as research.
6. The most frequent primary feature groups among top-20% candidate anomalies are: OL, RECEIVERS, QB.
7. Actionable treatment requires timestamped multi-book lines, line-stage labels and movement, verified pregame injuries/lineups, and materially better OL, pass-rush, and coverage grades, followed by independent prospective validation.

No result in this report is labeled a betting opportunity. The output consists of market disagreements and rule-qualified candidate anomalies only.

STOP: Stage 8, deployment, O/U anomaly modeling, confidence calibration, and 2024-2025 evaluation were not performed.
