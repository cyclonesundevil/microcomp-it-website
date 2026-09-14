# RSM Progress

## Complete

- Phase 0 repository and data-source assessment.
- Separate-package architecture and leakage-prevention plan.
- nflverse source/schema validation for rosters, weekly player stats, depth charts, and snap counts.
- Phase 1 normalized schemas, source provenance, strict cutoff loaders, stable-ID enrichment, and deterministic reports.
- First checkpoint generated 2,962 PSRs and offense/OL/defense/kicking/overall ratings for all 32 teams from the `2026-09-11T12:21:50Z` depth-chart snapshot.
- Checkpoint two reconstructs expected weekly starters from nflverse weekly rosters and strictly prior snap participation.
- RSM-v0 generated unoptimized, market-independent expected scores for all 544 regular-season games in 2024 and 2025.
- Checkpoint three fitted RSM-v1 on 2021-2022 and validated it on 2023; the 2024-2025 locked period was not evaluated by the fitting command.
- Stage 4 historical integrity audit completed across all 815 existing 2021-2023 development games.
- Stage 5 applied the frozen RSM-v1 artifact once to the 2024-2025 locked test period, preserving all 544 eligible regular-season games and 26 playoff games.
- Stage 6 diagnostics completed without changing RSM-v1 or fitting against the 2024-2025 locked outcomes.
- Stage 7A score-compression and confidence-inversion diagnostics completed using 2021-2022 training and 2023 validation only.
- Stage 7B built and evaluated an experimental direct-feature RSM-v2 candidate using 2021-2022 training and 2023 validation only; the 2024-2025 locked period remained untouched.
- Stage 7C built a selective, explainable consensus-line market-disagreement framework. Flagging thresholds were frozen on 2021-2022 inputs and evaluated once on 2023; the 2024-2025 locked period remained untouched.
- Stage 8 built and initialized a prospective, append-only shadow observation system with cryptographically pinned Stage 7B/7C artifacts, strict pre-kickoff validation, deterministic explanations, and multi-observation line-movement reporting.
- Stage 8A added fail-closed provider contracts, an offline fixture adapter, dry-run/write capture cycles, deterministic idempotency, bounded retry/locking/state/logging support, a read-only health command, and a predeclared prospective evaluation gate. No real provider is configured and no live observations were written.
- Stage 8B added public-source adapter infrastructure for nflverse and Sleeper dry-runs, redacted fixture parsers for ESPN/Yahoo/NFL.com evidence, strict public-request/caching/hash archival controls, deterministic derived-consensus labeling, explicit-ID crosswalk auditing, and read-only Stage 8B health/readiness commands. No live prospective observation writes are enabled.
- Stage 8B now also includes a disabled, explicit SportsGameOdds free-tier market transport. It accepts an operator-supplied environment key only for a manual raw-response dry run, archives no key material, and cannot write the ledger or enable capture.
- Ninety-three focused RSM and existing-predictor tests pass.
- By explicit authorization, the NFL Predictor now presents the frozen RSM margin as **RSM — Experimental** winner and directional ATS projections when a user supplies a market spread. This presentation path is separate from Stage 7C/8 research eligibility. It does not change pins, coefficients, feature definitions, anomaly thresholds, historical artifacts, or the shadow ledger.

## Current

- Stage 8B public-source infrastructure is complete for a bounded release. Frozen pins pass and the empty ledger is valid, but prospective capture is not operational because the public-source gates still fail: no enabled identifiable pre-kickoff market spread source, no complete all-18-feature prospective provider, no complete pre-kickoff lineup/inactive provider, and only 20.40% explicit Sleeper-to-GSIS coverage against the 95% threshold.
- Stage 8 infrastructure remains research-only: it has no scheduler or network poller, writes no production shadow-ledger observations, and ingests no outcomes. Separately, the NFL Predictor presents frozen RSM winner/ATS projections as experimental display output when a market spread is manually supplied. This display does not make a game a Stage 7C anomaly or enable Stage 8 capture.

## Next

- Improve individual OL and coverage inputs if a reliable licensed/public source is selected.
- Freeze the PSR scale after validation against independent player-quality references.
- Independently test the surviving Stage 7B direct features on a new future untouched season before considering deployment.
- Acquire timestamped pregame injuries and true OL block, pass-rush win-rate, and coverage-grade inputs.
- Simplify or remove feature groups that did not survive validation ablation, and add artifact caching before another broad walk-forward run.
- Add timestamped multi-book line ingestion with sportsbook identity, line stage, prices, scheduled kickoff, and complete line history before attempting detection-time or closing-line-value analysis.
- Observe the frozen Stage 7C rules prospectively on a new untouched future season; do not select a rule from the 2023 results.
- Connect a future timestamped lineup and multi-book market-data source through the documented Stage 8 capture contract without weakening its pre-kickoff or frozen-hash checks.
- Re-run the Stage 8A provider audit after a real provider is selected; do not make live captures until every required source timestamp and frozen feature can be established prospectively.
- Re-run the Stage 8B public-source readiness audit only after an allowed market-line source, permitted official injury/lineup feed, and explicit player-ID crosswalk improvements are available. Do not infer matches from names or backfill prospective observations.

## Known issues

- nflverse historical injury data ends after 2024; later injury completeness is unavailable from the selected public source.
- Public offensive-line data supports availability and snap-derived priors, not full individual block-quality grading.
- Depth-chart records changed from week-based to timestamp-based snapshots beginning in 2025.
- The checkpoint-one 0-100 scale is statistically ordered but remains compressed for some position groups; it must not yet be interpreted as a calibrated scouting grade.
- Historical weekly roster snapshots lack precise publication timestamps. The backtest uses identity/team/position only and excludes retrospective injury/status fields.
- The complete walk-forward command is CPU-heavy because weekly PSR populations are independently normalized; artifact caching is still needed.
- No historical game has a directly timestamped expected-lineup record; all 815 development lineups are reconstructions from weekly roster identity and prior snaps.
- Verified pregame injury availability and market-line timestamps are missing for all 815 audited games. Those fields remain excluded from football-model features.
- Locked regular-season lineup confidence was not archived per game and is reported as UNKNOWN without excluding games.
- Playoff-specific feature snapshots were not archived. Playoff evaluation uses the last pre-playoff regular-season team features and is marked LOW confidence.
- The HIGH prediction-confidence bucket underperformed LOW confidence, warning that probabilities may be miscalibrated.
- Historical injury availability and separate pass-rush, linebacker, secondary, recent-form, and history-window features are not present in the frozen artifact, so their Stage 6 contribution remains uncertain.
- Only the frozen five-year player-history artifact exists. Comparing 1/2/3-year windows would rebuild ratings and was therefore not performed in Stage 6.
- Historical player-level PSRs were not archived, so Stage 7A's player-rating distribution audit uses the current checkpoint snapshot while historical unit/matchup analysis uses 2023 point-in-time features.
- Development predictions do not contain per-game lineup confidence, preventing direct validation-period residual-variance analysis by lineup confidence.
- Stage 7B's training-only redundancy audit removes three exact multivariate feature combinations in addition to the constant home indicator; the resulting OLS candidates are nonsingular. Training-only selection still chooses alpha 100 for both margin models.
- Stage 7B's direct-feature rebuild remains CPU-heavy because it independently reconstructs weekly point-in-time ratings and lineups across three seasons.
- The schedule has one stored spread and home/away prices for all 815 development/validation games, but no sportsbook identifiers, opening/current/closing labels, retrieval timestamps, or line history. Pregame timing and closing-line value cannot be verified.
- Stage 7C lineup confidence describes roster completeness and strictly prior-snap evidence only. It does not imply verified pregame injury or depth-chart knowledge.
- Stage 7C's nested validation samples are small: 32, 12, and 6 games. Their wide Wilson intervals cannot establish a betting advantage.
- Stage 8 has no network poller or licensed multi-book/lineup feed. Observations must be supplied by a future adapter with trustworthy source and timezone-aware retrieval timestamps.
- The initialized Stage 8 ledger is intentionally empty. It contains frozen metadata only and has not backfilled 2023-2025 games.
- Stage 8A has only a fixture/mock provider. Repository schedules, ESPN display data, cached rosters/depth charts, and historical lines do not jointly satisfy the prospective timestamp/provenance contract.
- Stage 8B live dry-runs contact only nflverse GitHub release metadata and Sleeper's public players endpoint. ESPN, Yahoo, and NFL.com integrations remain disabled or fixture-only.
- SportsGameOdds is transport-only and disabled pending an operator-created free-tier key and a real-response schema audit. It is not a verified Stage 8 market provider and does not remove the other readiness blockers.
- The cached Stage 8B source audit verified nflverse and Sleeper retrievals from `2026-09-12T21:59:32.470536Z` and `2026-09-12T21:59:33.280215Z`, respectively. Both are archived by SHA-256 in the ignored shadow-data directory; these retrieval timestamps are not treated as publisher timestamps.
- The current explicit Sleeper-to-GSIS crosswalk matches 546 of 2,676 active/team/position records, with zero ambiguous matches and 2,130 unmatched records. Overall coverage is 20.40%, below the 95% readiness threshold.
- ESPN's public scoreboard parser is fixture-tested but not enabled for live retrieval because the JSON interface is unofficial and access terms are uncertain. Yahoo live automation is policy-blocked. NFL.com injury evidence is fixture-only until an expressly permitted public feed is identified.
- `DERIVED_CONSENSUS` is supported as a separately labeled Stage 8 market kind for future fixture/rehearsal data, distinct from provider-published `CONSENSUS`.
- The RSM display adapter has no compatible frozen total output. It explicitly reports O/U unavailable rather than borrowing a total from another model. Its supplied spread has no verified source, observation time, or prospective lineup confidence unless a future permitted source provides them.
- RSM display projections are not calibrated probabilities and have no established betting advantage. A zero margin or zero margin-versus-market difference produces no directional winner or ATS projection.

## Test results

- `python -m pytest backend/test_nfl_predictor.py backend/test_rsm.py -q`: 80 passed after the authorized RSM presentation change.
- `python -m compileall -q backend/nfl_predictor.py backend/app.py`: passed.
- `node --check frontend/nfl-predictor.js`: passed.
- `python -m pytest backend/test_rsm.py backend/test_nfl_predictor.py -q`: 75 passed.
- `python -m pytest backend/test_rsm_stage8b.py -q`: 18 passed.
- `python -m pytest backend/test_rsm_stage8b.py backend/test_rsm.py backend/test_nfl_predictor.py -q`: 93 passed.
- `python -m compileall -q backend/rsm`: passed.
- `python -m rsm stage8a-baseline`: passed; frozen model/rules/definition hashes match and ledger remains `GENESIS` with zero observations.
- `python -m rsm stage8b-source-audit`: passed as a read-only audit; `ready_for_genuine_prospective_writes` is false and ledger writes remain zero.
- `python -m rsm stage8b-health`: healthy/read-only; no outcome statistics reported.
- Backend app smoke with the repository virtualenv: `/api/health` returned 200 and `/nfl-predictor.html` returned 200. The system interpreter lacks Quart, so startup smoke used `backend/.venv/Scripts/python.exe`.
- Frontend build: no frontend package/build script exists in this repository. Static NFL frontend files `frontend/nfl-predictor.html` and `frontend/nfl-predictor.js` are present.
- `python -m rsm checkpoint-one`: 2,962 players and 32 teams generated.
- `python -m rsm checkpoint-two`: 544 of 544 eligible regular-season games predicted.
- `python -m rsm audit-history`: 815 existing games audited without rebuilding RSM-v1.
- `python -m rsm locked-backtest`: 544 regular-season and 26 playoff games graded with zero exclusions.
- `python -m rsm stage6-diagnostics`: exact 544-game existing-model comparison, market residual analysis, confidence deciles, validation ablations, position diagnostics, and separate playoff diagnostics generated.
- `python -m rsm stage7a-diagnostics`: 543-game training/272-game validation compression, ridge, confidence, heteroskedasticity, and controlled calibration diagnostics generated without reading or tuning locked seasons.
- `python -m rsm stage7b-candidate`: 543-game training/272-game validation direct-feature candidate, correlation audit, training-only ridge selection, component ablations, market-residual diagnostic, and limited total diagnostic generated without reading or tuning locked seasons.
- `python -m rsm stage7c-anomaly`: frozen 2021-2022 selective market-disagreement rules applied once to all 272 games in 2023, with game-level explanations, abstentions, Wilson intervals, and subgroup diagnostics; no 2024-2025 results used.
- `python -m rsm stage8-shadow-init`: append-only SQLite research ledger initialized with zero observations, a valid `GENESIS` hash-chain state, and pinned model/rule/anomaly-definition hashes.
- `python -m rsm stage8a-baseline`: all frozen pins, 18-feature order/vector lengths, thresholds, anomaly definition, empty-ledger integrity, and no-backfill checks passed.
- `python -m rsm stage8a-health`: read-only health passed with zero ledger records and no outcome-based metrics.

## Interim findings

- RSM can be isolated from the existing predictor until it earns integration through out-of-sample evidence.
- Stable GSIS IDs exist across roster, depth-chart, and player-stat sources; PFR IDs provide the snap-count join.
- Stable-ID enrichment fixed missing roster-to-snap joins without using player names.
- QB and pass-rush rankings show reasonable face validity, but public box scores are insufficient for declaring the checkpoint ratings production-ready.
- Unoptimized RSM-v0 results: score MAE 7.789, margin MAE 10.950, total MAE 10.473 across 544 games.
- Results were stable across the two seasons, but no ATS/O/U success claim is appropriate before RSM-v1 fitting and locked evaluation.
- Stage 4 lineup audit: 95.34% of games have all configured starter slots; 99.54% of starter slots have prior-snap evidence; 4.66% of games are LOW confidence.
- No future-stat, future-snap, future-roster-week, actual-result-feature, or market-feature leakage was found in the audited paths.
- Injury/depth-chart fidelity and exact market timestamp provenance remain unresolved data-quality risks, documented in `reports/rsm-lineup-data-quality.md`.
- Evaluation periods: training 2021-2022 regular seasons (`2021-09-09` through `2023-01-08`), validation 2023 regular season (`2023-09-07` through `2024-01-07`), locked regular seasons 2024-2025 (`2024-09-05` through `2026-01-04`), and locked postseasons (`2025-01-11` through `2026-02-08`) reported separately.
- Locked regular season ATS: 275-264-5, 51.02% excluding pushes (95% CI 46.81%-55.22%).
- Locked regular season O/U: 269-272-3, 49.72% excluding pushes (95% CI 45.53%-53.92%).
- Locked regular season score MAE 7.702, margin MAE 10.558, total MAE 10.746, score RMSE 9.669.
- Locked playoffs: ATS 15-11-0 (57.69%), O/U 16-10-0 (61.54%), score MAE 8.075, margin MAE 10.837, total MAE 11.450; sample 26.
- The playoff O/U result is not considered reliable evidence because of its small sample, wide 42.53%-77.57% interval, and stale lineup inputs.
- Neither regular-season ATS nor O/U exceeded 60%; both results indicate no apparent predictive betting advantage.
- On the identical 544-game regular-season set, the pre-RSM baseline beat RSM-v1 on score MAE (7.468 vs 7.702), margin MAE (10.417 vs 10.558), and total MAE (10.450 vs 10.746). RSM-v1 ATS was higher (51.02% vs 48.24%), while O/U was slightly lower (49.72% vs 49.91%).
- Market-implied margin and total beat RSM-v1: margin MAE 9.666 vs 10.558 and total MAE 10.062 vs 10.746. RSM/market error correlations were 0.941 for margin and 0.955 for total.
- RSM edge correlation with market residual was -0.098 for margin and -0.042 for total; measured roster features showed no demonstrated independent residual signal.
- Edge accuracy was non-monotonic. The largest buckets returned 48.37% ATS and 45.71% O/U, while the highest confidence decile returned 35.19% ATS and 44.44% O/U despite mean claimed probabilities of 72.19% and 65.90%.
- RSM-v1 compresses team scores strongly toward the mean: predicted team-score SD 2.558 versus actual SD 9.860. It underpredicted favorites by 2.75 points and overpredicted underdogs by 1.31 points on average.
- Component ablations refit on 2021-2022 with frozen alpha and evaluated only on 2023. No available component had a robust material effect; the pass-defense/secondary proxy was directionally helpful but small. Unavailable components remain uncertain.
- QB and composite pass offense are correlated at 0.949 and have opposing standardized coefficients, indicating multicollinearity and possible offensive double-counting. OL showed no material independent validation contribution.
- The 26-game playoff result remains uncertain: playoff edges were somewhat larger and actual totals averaged 1.39 points higher, but matchup splits are too small and lineup features are stale.
- Stage 6 diagnosis: the main weaknesses are score conversion/mean compression, multicollinearity, probability calibration, and lack of demonstrated information beyond the market. RSM-v2 may be researched as a new development experiment, not treated as a production betting upgrade.
- Stage 7A validation compression is severe: predicted margin SD is 3.468 versus 14.396 actual (24.1%), and predicted total SD is 3.697 versus 13.656 actual (27.1%).
- Removing ridge regularization does not resolve compression: alpha 0 produces margin/total SD of 3.497/3.704 versus 3.468/3.697 at frozen alpha 1. Ridge is incremental, not the primary cause.
- Compression is cumulative across PSR reliability shrinkage, replacement fallbacks, history averaging, unit aggregation, and score conversion. The largest operational loss is from correlated unit/matchup features to expected points; RSM-v1 has no explicit output clipping.
- The raw 2023 margin calibration slope is 1.318 (R-squared 0.101), while the total slope is 0.178 (R-squared 0.002). Margin has compressed directional signal; raw total variation is nearly unrelated to actual total variation.
- RSM-v1 probability is exactly a monotonic normal-CDF transform of absolute edge divided by one global residual SD. Therefore confidence ranking and raw-edge ranking are identical; the inversion begins in raw edge and the probability layer overstates its magnitude.
- No spread-sign, home/away orientation, CDF-direction, or total-comparison bug was found. New monotonicity and invalid-scale property tests pass.
- Validation residual SD varies materially across observable quartiles (margin 11.100-15.217; total 10.799-15.982), so one global uncertainty scale is incomplete.
- Training-only score calibration modestly changes validation score/margin/total MAE from 7.794/10.542/11.255 to 7.713/10.541/11.078. It expands margin SD and corrects margin slope, but contracts totals further rather than curing total compression.
- Training-only logistic probability recalibration improves validation Brier from 0.2636 to 0.2524 ATS and 0.2707 to 0.2542 O/U by shrinking probabilities toward 50%; it does not restore monotonic confidence ordering, and both remain worse than the 0.2500 constant-50% reference.
- The Stage 7A candidate artifact is diagnostic and non-production. It does not overwrite RSM-v1 or justify deployment without a newly untouched future test period.
- Stage 7B Model A increased validation margin dispersion from RSM-v1's 3.468 to 4.352 points (25.5% relative), but this is still only 30.2% of the actual 14.396 SD. Margin MAE improved only from 10.542 to 10.528; the existing predictor (10.435) and market (9.901) remained better.
- Stage 7B Model A calibration R-squared improved from 0.101 to 0.117. This is a partial structural improvement, not material practical superiority.
- Stage 7B Model B produced a 0.094 correlation and 0.004 predictive R-squared for validation market residual, with secondary ATS of 135-123-14 (52.33%, pushes excluded). Accuracy was not monotonic by predicted-residual magnitude, so no reliable betting threshold or market-independent edge was established.
- Receiver and pass-rush groups had the largest positive Model A ablation effects (+0.182 and +0.103 MAE on removal), while weakest-link features added a small +0.107 removal penalty. Removing the elite-player group improved validation MAE by 0.127, warning that peak features add noise in this specification.
- The direct-feature total candidate improved MAE from 11.255 to 10.928 but had calibration R-squared effectively 0.000 and lower predicted dispersion. Roster-based O/U development should remain suspended pending materially better inputs.
- Stage 7B is experimental and non-production. It does not include a confidence model, does not overwrite RSM-v1, and was not evaluated on the 2024-2025 locked outcomes.
- Stage 7C can identify explainable candidate anomalies against the single stored consensus line, but the missing sportsbook and timestamp metadata prevent true cross-book anomaly or closing-line-value analysis.
- Frozen Stage 7C rules require MEDIUM-or-better reconstructed-lineup confidence, at least two aligned feature groups contributing at least 0.25 points each, and anomaly-score thresholds of 4.683, 6.423, and 7.440. These thresholds represent the top 20%, 10%, and 5% among 264 structurally eligible 2021-2022 games.
- On 2023, the frozen rules flagged 32/272 (11.76%), 12/272 (4.41%), and 6/272 (2.21%) games. Results were 13-16-3 (44.83%, 95% Wilson CI 28.41%-62.45%), 8-3-1 (72.73%, CI 43.43%-90.25%), and 4-2-0 (66.67%, CI 30.00%-90.32%).
- Larger anomaly scores did not produce monotonically improving outcomes. The attractive middle-band result is a 12-game observation, was not used to select a rule, and is not evidence of a betting opportunity.
- The broad 2023 roster-only fair-line disagreement selected 122-136-14 (47.29%), versus 50% as a constant benchmark and 52.33% for the separate Stage 7B all-game residual model.
- OL was the primary contribution group for 16 of the 32 least-selective candidate anomalies, receivers for 15, and QB for 1. Group results were heterogeneous and too small for reliable feature-level claims.
- Stage 7C is an observation framework only. It did not refit RSM-v1 or Stage 7B Model A, build an O/U anomaly model, use 2024-2025 outcomes, deploy predictions, or label any candidate anomaly a betting opportunity.
- Stage 8 pins the frozen roster-only model (`679b088a...f5b1fe`), Stage 7C rules (`afbe5518...7746e8`), and anomaly definition (`1aeb5339...3d11`). Capture fails closed if any pinned artifact changes.
- Stage 8 accepts only the exact 18-feature frozen input set and a spread observation with sportsbook/source identity. Prediction receipt, feature, lineup, and market timestamps must be timezone-aware and strictly pre-kickoff.
- Stage 8 rejects outcome, result, wager, stake, bet, recommendation, non-spread, missing-feature, extra-feature, naive-time, and post-kickoff inputs. No API route or production UI was added.
- Accepted observations are immutable SQLite rows linked by a SHA-256 hash chain. Repeated observations for a game/book report movement toward, away from, or unchanged relative to the first captured fair margin; closing-line value is not computed.
- Stage 8 remains a shadow research system. Candidate-anomaly labels describe frozen-rule market disagreements and are not betting recommendations.
- Stage 8A's formal evaluation gate requires one complete prospective NFL regular season and at least 25 prospectively flagged candidate anomalies; fewer flags require unchanged collection into the next season. Operational audits cannot inspect outcomes or retune the frozen system.
