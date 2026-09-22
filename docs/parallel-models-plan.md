# Parallel NFL Models Plan: RSM, DSM, and PRM

Phase 0 repository/data audit completed on 2026-09-21. Phase 1 common-interface/RSM-wrapper work was started after the audit. No DSM, PRM, ensemble, or RSM behavior changes were made.

## Objective

Build a rigorous research architecture for three independent NFL prediction models:

- RSM — the existing roster/statistical model family.
- DSM — a future drive simulation model based on possessions/drives.
- PRM — a future opponent-adjusted power rating model.

The near-term research question is whether the three approaches make sufficiently different errors to justify later ensemble research. The objective is not to optimize betting performance or modify the frozen RSM baseline.

## Critical RSM protection rule

The existing RSM implementation and historical evaluation are a protected baseline.

Phase 0 did not:

- rebuild player ratings;
- refit RSM-v1;
- modify Stage 7B/7C artifacts;
- modify RSM display behavior;
- modify Stage 8 shadow observation logic;
- tune thresholds or coefficients.

Future phases that touch shared infrastructure must add regression tests proving existing RSM predictions remain identical within floating-point tolerance.

## Existing repository layout

Relevant files and directories:

| Area | Path |
| --- | --- |
| Main NFL web/API predictor | `backend/nfl_predictor.py` |
| NFL API routes | `backend/app.py` |
| NFL API v1 contract | `docs/nfl-api-v1.md` |
| RSM package | `backend/rsm/` |
| RSM CLI entry point | `backend/rsm/__main__.py` |
| RSM config/schema/data | `backend/rsm/config.py`, `backend/rsm/schema.py`, `backend/rsm/data.py` |
| RSM fitting/backtests/diagnostics | `backend/rsm/fitting.py`, `backend/rsm/locked_backtest.py`, `backend/rsm/stage6_diagnostics.py`, `backend/rsm/stage7a_diagnostics.py`, `backend/rsm/stage7b_candidate.py`, `backend/rsm/stage7c_anomaly.py` |
| RSM Stage 8 observation/evaluation | `backend/rsm/stage8_shadow.py`, `backend/rsm/stage8_evaluation.py`, `backend/rsm/stage8a_capture.py`, `backend/rsm/stage8b_public_sources.py` |
| NFL tests | `backend/test_nfl_predictor.py`, `backend/test_rsm.py`, `backend/test_rsm_total_observations.py`, `backend/test_rsm_stage8b.py` |
| NFL frontend | `frontend/nfl-predictor.html`, `frontend/nfl-predictor.js`, `frontend/nfl-upcoming.html`, `frontend/nfl-upcoming.js`, `frontend/nfl-algorithm-performance.html`, `frontend/nfl-algorithm-performance.js` |
| RSM reports/artifacts | `reports/rsm-*` |
| Main NFL game cache | `backend/data/nfl_games.csv` |
| RSM raw data cache | `backend/data/rsm/raw/` |

## Existing RSM architecture

There are several RSM generations/artifacts in the repository.

### RSM-v0 / RSM-v1 development path

The package under `backend/rsm/` contains the original roster-strength pipeline:

1. `backend/rsm/data.py`
   - downloads/loads nflverse players, rosters, weekly rosters, depth charts, weekly player stats, snap counts, and schedules.
   - loads games from nflverse `games.csv`.
   - enforces point-in-time player-stat loading through cutoff season/week helpers.
2. `backend/rsm/ratings.py`
   - builds player ratings and team unit ratings from roster/player/stat/snap inputs.
3. `backend/rsm/backtest.py`
   - generates checkpoint-two historical RSM-v0 score outputs.
4. `backend/rsm/fitting.py`
   - fits RSM-v1 on development seasons.
5. `backend/rsm/locked_backtest.py`
   - applies the frozen RSM-v1 artifact to locked seasons.
6. `backend/rsm/stage6_diagnostics.py`, `stage7a_diagnostics.py`, `stage7b_candidate.py`, `stage7c_anomaly.py`
   - perform post-lock diagnostics and later experimental architecture/anomaly analysis.

### Deployed/display RSM adapter

`backend/nfl_predictor.py` contains `RsmStage7CComparisonModel`, exposed as model profile `rsm_stage7c`.

This adapter:

- reads frozen team snapshot rows from `reports/rsm-team-ratings.csv`;
- reads the frozen Stage 7B artifact from `reports/rsm-v2-candidate-stage7b.json`;
- computes a roster-only margin from the 18-feature Stage 7B vector;
- computes a separately versioned Stage 7B total diagnostic from the same frozen feature vector;
- reports LOW lineup confidence for public display because verified prospective lineup data is unavailable;
- does not update online state;
- does not use bookmaker total as a model input.

Important: this is a public comparison/display adapter and is separate from the frozen Stage 7C anomaly ledger and thresholds.

### RSM model profile in current web predictor

`backend/nfl_predictor.py` defines:

```python
RSM_PROFILE = "rsm_stage7c"
MODEL_PROFILES = (
    "baseline",
    "enhanced",
    "market_blend",
    "mean_reversion",
    "rothstein",
    "rothstein_plus",
    RSM_PROFILE,
)
```

RSM is available in:

- `/api/v1/nfl/models`
- `/api/v1/nfl/upcoming`
- `/api/v1/nfl/predict`
- `/api/v1/nfl/history`
- `/api/v1/nfl/backtest`
- `/api/v1/nfl/week-performance`
- `/api/v1/nfl/week-performance-trend`

## Existing RSM training/evaluation periods

From `reports/rsm-v1-validation-summary.json` and `reports/rsm-backtest-summary.json`:

| Split | Seasons | Notes |
| --- | --- | --- |
| RSM-v1 training | 2021, 2022 | 543 regular-season development games in Stage 7B scope. |
| RSM-v1 validation | 2023 | 272 regular-season validation games. |
| Locked test | 2024, 2025 | 544 regular-season games plus 26 playoff games in Stage 5. |
| Stage 7B experimental candidate | fit/select 2021-2022, validate 2023 | Locked 2024-2025 artifacts not used. |
| Stage 7C anomaly framework | thresholds frozen on 2021-2022, validate 2023 | 2024-2025 outcomes not read. |

Representative locked Stage 5 regular-season result from `reports/rsm-backtest.md`:

- Regular-season games: 544.
- ATS: 275-264-5, 51.02%.
- O/U: 269-272-3, 49.72%.
- Score MAE: 7.702.
- Margin MAE: 10.558.
- Total MAE: 10.746.

Representative Stage 7B validation result from `reports/rsm-stage7b-v2-architecture.md`:

- RSM-v1 margin MAE: 10.542.
- Existing predictor margin MAE: 10.435.
- Market margin MAE: 9.901.
- RSM-v2 Model A margin MAE: 10.528.
- RSM-v1 margin SD: 3.468 versus actual margin SD 14.396.
- RSM-v2 Model A margin SD: 4.352 versus actual margin SD 14.396.

Representative Stage 7C anomaly result from `reports/rsm-stage7c-anomaly-analysis.md`:

- 2021-2022 development thresholding, 2023 validation only.
- Top 20% validation flags: 32 games, 13-16-3 ATS, 44.83%.
- Top 10% validation flags: 12 games, 8-3-1 ATS, 72.73%, wide interval.
- Top 5% validation flags: 6 games, 4-2-0 ATS, 66.67%, wide interval.
- Accuracy was not monotonic as anomaly score increased.
- Output is market disagreement/candidate anomaly research, not validated betting opportunity.

## Existing data sources

### Main NFL predictor data

`backend/nfl_predictor.py` uses:

```text
https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
```

Cached at:

```text
backend/data/nfl_games.csv
```

Header observed in the cached file:

```text
game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,location,result,total,overtime,old_game_id,gsis,nfl_detail_id,pfr,pff,espn,ftn,away_rest,home_rest,away_moneyline,home_moneyline,spread_line,away_spread_odds,home_spread_odds,total_line,under_odds,over_odds,div_game,roof,surface,temp,wind,away_qb_id,home_qb_id,away_qb_name,home_qb_name,away_coach,home_coach,referee,stadium_id,stadium
```

`load_games()` currently filters to completed regular-season games with final scores, spread lines, and totals.

Parsed game-level fields include:

- season, week, game_id, game_type;
- gameday/gametime when present;
- away/home team;
- away/home score;
- actual margin as `home_score - away_score`;
- actual total as `home_score + away_score`;
- spread line;
- total line;
- rest days;
- division game;
- roof, surface, temperature, wind;
- QB names/IDs are present in the source CSV but are not all promoted into every model path.

### RSM raw data

`backend/rsm/data.py` defines nflverse source URLs for:

- players;
- rosters;
- weekly rosters;
- depth charts;
- weekly player stats;
- snap counts;
- schedules/games.

Observed local RSM raw cache includes:

- `backend/data/rsm/raw/players.csv`
- `backend/data/rsm/raw/roster_2024.csv`, `roster_2025.csv`, `roster_2026.csv`
- `backend/data/rsm/raw/weekly_roster_2021.csv` through `weekly_roster_2025.csv`
- `backend/data/rsm/raw/depth_2026.csv`
- `backend/data/rsm/raw/stats_2017.csv` through `stats_2026.csv`
- `backend/data/rsm/raw/snaps_2017.csv` through `snaps_2026.csv`

Manifests:

- `backend/data/rsm/source-manifest.json`
- `backend/data/rsm/backtest-source-manifest.json`

### Play-by-play and drive data availability

Phase 0 found no checked-in local play-by-play or drive-level files under the bounded repository data checks.

Available locally:

- game-level `games.csv`;
- player weekly stats;
- snap counts;
- roster/depth-chart data;
- generated RSM feature/prediction artifacts.

Unavailable locally:

- play-by-play table with EPA/play, success rate, down/distance, yardline, drive IDs;
- drive-level table with possession outcomes, starting field position, drive points, drive EPA, plays per drive;
- explicit red-zone drive entries and red-zone TD rate;
- field-position-conditioned drive outcome history.

Conclusion: baseline PRM can start from existing game-level and possibly weekly team/player stats, but the requested DSM and play-by-play EPA-based PRM require adding a play-by-play/drive source, likely nflverse play-by-play or another permitted source. That would be a new external dependency unless a hidden/local dataset is later provided.

## Available fields by modeling family

### Game-level fields

Supported from `backend/data/nfl_games.csv`:

- game identity: `game_id`, `season`, `game_type`, `week`, `gameday`, `gametime`;
- teams: `away_team`, `home_team`;
- scores: `away_score`, `home_score`, result/total;
- market: moneylines, spread line, spread odds, total line, total odds;
- context: away/home rest, division game, roof, surface, temperature, wind, stadium;
- QB: away/home QB IDs and names;
- coach/referee/stadium metadata.

### Player/roster fields

Supported in RSM package from nflverse player/roster/depth/stat/snap sources:

- stable player IDs including GSIS/PFR enrichment;
- current roster and weekly roster snapshots;
- depth-chart snapshots;
- weekly player stats;
- snap counts;
- derived player ratings, unit ratings, lineup confidence, and roster features.

### Play-by-play fields

Not available locally in Phase 0.

Candidate future fields if nflverse PBP is added:

- play ID, drive ID, game ID;
- posteam/defteam;
- down, distance, yardline, game seconds remaining;
- EPA/WPA, success;
- rush/pass classification;
- air yards, yards gained;
- turnovers, sacks, penalties;
- score differential, home/away context;
- fixed drive fields such as drive start/end, result, points.

### Drive-level fields

Not available locally in Phase 0.

Candidate future fields if derived from PBP:

- offense, defense, drive start/end;
- starting field position;
- drive result;
- points;
- plays;
- yards;
- EPA;
- red-zone entry;
- red-zone TD;
- turnover probability;
- punt/FG/TD probabilities.

## Current model families outside RSM

`backend/nfl_predictor.py` also contains existing production/display models:

- `baseline`
- `enhanced`
- `market_blend`
- `mean_reversion`
- `rothstein`
- `rothstein_plus`
- `rsm_stage7c`

These are web predictor algorithms, not the proposed PRM/DSM architecture. They should remain unchanged while the parallel-model experiment is developed.

## Current feature engineering

### Main web predictor

The non-RSM web predictor models use game-level chronological updating and engineered statistics around:

- team scoring/allowed scoring;
- margins/totals;
- rest;
- divisional games;
- weather/roof;
- market blending for `market_blend`;
- mean reversion using prior seasons/current season;
- Rothstein-specific early-season safeguards and eligibility.

These features are implemented in `backend/nfl_predictor.py` and tested in `backend/test_nfl_predictor.py`.

### RSM

RSM feature engineering includes:

- player statistical ratings with replacement priors and uncertainty;
- roster/depth/snap aggregation;
- unit ratings: QB, RB, WR, TE, OL, DL, EDGE, LB, CB, S, kicker;
- matchup features for pass/run offense/defense and direct Stage 7B feature differences;
- rest differential;
- frozen Stage 7B 18-feature vector for display margin and total diagnostic.

Stage 7B selected features:

- `qb_quality_diff`
- `qb_vs_pass_rush_matchup`
- `qb_vs_coverage_matchup`
- `ol_pass_vs_pass_rush_matchup`
- `ol_run_vs_front_matchup`
- `receiving_vs_secondary_matchup`
- `rushing_vs_front_matchup`
- `ol_weakest_diff`
- `ol_strongest_diff`
- `ol_continuity_diff`
- `ol_replacement_starters_diff`
- `wr1_diff`
- `wr2_diff`
- `te1_diff`
- `receiver_replacements_diff`
- `pass_rusher1_diff`
- `weakest_coverage_diff`
- `rest_diff`

Unavailable and not synthesized in Stage 7B:

- verified pregame injuries;
- red-zone offense/defense;
- direct pass-block/run-block grades;
- pass-rush win rate;
- coverage grades.

## Current evaluation metrics

Existing evaluations report:

- ATS wins/losses/pushes and accuracy excluding pushes;
- O/U wins/losses/pushes and accuracy excluding pushes;
- score MAE;
- margin MAE;
- total MAE;
- RMSE where relevant;
- calibration/predictive R-squared;
- calibration slope;
- predicted SD versus actual SD;
- Wilson confidence intervals;
- breakdowns by season/week/favorite/spread bucket/total bucket/confidence/lineup confidence.

Recent weekly algorithm performance endpoints additionally report:

- spread wins/losses/pushes/bets/win rate;
- total wins/losses/pushes/bets/win rate;
- margin MAE displayed as Spread MAE;
- total MAE displayed as Total Score MAE.

## Current prediction outputs

Main predictor outputs commonly include:

- `model`
- `away_team`, `home_team`
- `pred_margin`
- `pred_total`
- `spread_line`
- `market_margin`
- `total_line`
- `spread_edge`
- `total_edge`
- `spread_threshold`
- `total_threshold`
- `eligible`
- `winner_pick`
- `spread_pick`
- `total_pick`
- `lineup_confidence`
- `total_model_version`
- `latest_training_season`
- `model_notes`

RSM does not currently expose calibrated win probabilities in the production display adapter. Future common interfaces must not fabricate probabilities.

## Existing CLI commands

Primary RSM commands from `python -m rsm`:

- `update-rosters`
- `checkpoint-one`
- `checkpoint-two`
- `checkpoint-three`
- `audit-history`
- `locked-backtest`
- `stage6-diagnostics`
- `stage7a-diagnostics`
- `stage7b-candidate`
- `stage7c-anomaly`
- `stage8-shadow-init`
- `stage8-shadow-capture`
- `stage8-shadow-status`
- `stage8a-baseline`
- `stage8a-capture`
- `stage8a-health`
- `stage8a-readiness`
- `stage8b-source-audit`
- `stage8b-live-dry-run`
- `stage8b-market-dry-run`
- `stage8b-apisports-dry-run`
- `stage8b-rehearsal`
- `stage8b-health`
- `stage8b-readiness`

Main NFL predictor CLI in `backend/nfl_predictor.py` supports command-line backtesting/model reporting for existing web predictor profiles.

## Relevant APIs

Stable mobile-oriented API contract is documented in `docs/nfl-api-v1.md`.

Current `/api/v1/nfl/*` endpoints:

- `GET /api/v1/nfl/models`
- `GET /api/v1/nfl/teams`
- `GET /api/v1/nfl/upcoming?scope=upcoming`
- `GET /api/v1/nfl/week-performance?season=YYYY&week=N`
- `GET /api/v1/nfl/week-performance-trend?model=baseline&season=YYYY`
- `GET /api/v1/nfl/predict`
- `GET /api/v1/nfl/history`
- `GET /api/v1/nfl/backtest`
- `GET /api/v1/nfl/dashboard`
- `GET /api/v1/nfl/live`
- `POST /api/v1/nfl/refresh`

RSM observation endpoints currently exist under legacy `/api/nfl/rsm-*` paths, not under the v1 mobile contract.

## Relevant databases/files

Persistent/generated NFL files:

- `backend/data/nfl_games.csv`
- `backend/data/nfl_upcoming_predictions.json`
- `backend/data/nfl_backtest_*.json`
- `backend/data/nfl_history_all_*.json`
- `backend/data/nfl_history_pair_*.json`
- `backend/data/nfl_weekly_performance_*.json`
- `backend/data/rsm/raw/*`
- `backend/data/rsm/source-manifest.json`
- `backend/data/rsm/backtest-source-manifest.json`
- `backend/data/rsm/shadow/*`

Key report artifacts:

- `reports/rsm-v1-artifact.json`
- `reports/rsm-v1-validation-summary.json`
- `reports/rsm-v1-validation-predictions.csv`
- `reports/rsm-backtest-summary.json`
- `reports/rsm-backtest-games.csv`
- `reports/rsm-backtest.md`
- `reports/rsm-v2-candidate-stage7b.json`
- `reports/rsm-stage7b-v2-architecture.md`
- `reports/rsm-stage7c-anomaly-analysis.md`
- `reports/rsm-stage7c-anomaly-games.csv`
- `reports/rsm-stage8-shadow-system.md`
- `reports/rsm-stage8-shadow-status.json`

## Website integration points

Current NFL UI pages:

- `frontend/nfl-predictor.html` / `frontend/nfl-predictor.js`
  - manual matchup predictions;
  - backtests/history/dashboard sections;
  - RSM experimental observation controls.
- `frontend/nfl-upcoming.html` / `frontend/nfl-upcoming.js`
  - Upcoming Week: All Algorithms;
  - rebuild timestamp;
  - weekly algorithm performance table;
  - algorithm links to trend page.
- `frontend/nfl-algorithm-performance.html` / `frontend/nfl-algorithm-performance.js`
  - per-algorithm weekly trend graph and table;
  - currently includes a synthetic `demo=1` frontend-only preview mode.

## DSM feasibility

DSM as specified requires drive/possession data. Phase 0 found no local checked-in drive or play-by-play data.

What can be done without a new data source:

- A crude game-level scoring simulation could be built from final scores and totals, but it would not satisfy the requested DSM concept of `P(drive outcome | offense, defense, field position, game state)`.
- It would be misleading to label such a model as a drive simulation model.

What is required for a defensible baseline DSM:

- Add a permitted play-by-play/drive source, preferably nflverse play-by-play if project policy permits it.
- Build a drive table from play-by-play with strict pregame cutoffs.
- Compute rolling offensive/defensive drive rates using only prior games.
- Simulate possessions with deterministic seeds in tests.

Phase 1 should therefore decide whether adding nflverse play-by-play/drive ingestion is in scope.

## PRM feasibility

PRM can start in two ways:

1. Game-level PRM without new data:
   - opponent-adjusted scoring margin, points for/against, simple success proxies unavailable;
   - feasible immediately using `backend/data/nfl_games.csv`;
   - weaker than requested EPA/play PRM, but still useful as a transparent opponent-adjusted power-rating baseline.
2. Play-by-play EPA PRM with new data:
   - requires nflverse play-by-play or equivalent;
   - supports offensive/defensive EPA/play, pass/rush EPA/play, early/late down, success/explosive/negative-play rates;
   - better aligned with the objective but requires a new source and more leakage controls.

Recommendation: start PRM with a no-new-dependency game-level opponent-adjusted baseline only if the project wants immediate progress; otherwise add a play-by-play source and build PRM and DSM from the same temporal data layer.

## Required leakage controls for future phases

Future DSM/PRM work must enforce:

- global margin convention: `home_score - away_score`;
- chronological game ordering by season/week/gameday/game_id or kickoff where available;
- feature cutoffs strictly before the target game;
- no same-game or future-game inclusion in rolling stats;
- no market line as a football-stat model input unless explicitly approved;
- separate training/validation/test windows;
- explicit early-season priors;
- deterministic random seeds for DSM simulations;
- dataset/source fingerprints recorded in every experiment.

Minimum tests to add before or during Phase 1:

- common prediction interface construction;
- home/away sign convention;
- RSM wrapper regression fixture;
- chronological walk-forward ordering;
- rolling stat exclusion of current/future games;
- missing-data behavior;
- no RSM prediction drift after infrastructure changes.

## Recommended implementation phases

### Phase 1 — Common interface and protected RSM wrapper

Deliverables:

- Add a small parallel-model package, likely under `backend/parallel_models/` rather than restructuring the existing app.
- Define `NFLPrediction` and model interface classes.
- Implement an RSM wrapper around existing `RsmStage7CComparisonModel` without changing it.
- Add frozen RSM regression tests.
- Add a minimal walk-forward harness that can call one wrapped model.

Stop condition:

- RSM wrapper predictions match current `rsm_stage7c` output within tolerance.

### Phase 2 — Data decision for DSM/PRM

Deliverables:

- Either approve a new nflverse play-by-play/drive ingestion source, or explicitly choose game-level-only PRM first.
- If play-by-play is approved, add source manifesting, file hashing, and a derived drive table.
- Add leakage tests for play-by-play/drive cutoffs.

Stop condition:

- Data layer produces point-in-time rows without using target/future games.

### Phase 3 — Baseline PRM

Deliverables:

- Implement transparent opponent-adjusted team ratings.
- Start with game-level margin/points if no play-by-play source is available; otherwise EPA/play.
- Add convergence diagnostics and tests.
- Add early-season priors and recency half-life controlled only by training/validation.

### Phase 4 — Baseline DSM

Deliverables:

- Implement drive outcome rates from prior-drive history.
- Simulate games with configurable simulation count and deterministic seeds.
- Return full score/margin/total distributions and percentiles.
- Add probability-sum and deterministic-seed tests.

### Phase 5 — Walk-forward comparison

Deliverables:

- Generate one row per game containing RSM, DSM, PRM predictions.
- Report score, margin, total, and win-probability metrics where legitimate.
- Separate Weeks 1-4, Weeks 5-9, Weeks 10-18, playoffs if sample sizes permit.

### Phase 6 — Error correlation and disagreement analysis

Deliverables:

- Pairwise error correlations for margin, total, home score, away score.
- Disagreement buckets.
- Equal-weight ensemble diagnostic only; no optimized weights.

### Phase 7 — Final research report

Deliverables:

- `reports/parallel_models/model_comparison.md`
- machine-readable prediction and metric artifacts under `reports/parallel_models/` or `data/predictions/`.

## Phase 0 conclusion

The repository is ready for Phase 1 common-interface/RSM-wrapper work without changing RSM. The repository is not yet ready for a defensible DSM because required drive/play-by-play data is not present locally. A baseline PRM can be implemented from existing game-level data, but the requested EPA/play PRM requires a new play-by-play source.

Recommended next action:

Proceed with Phase 1 only:

1. create common prediction interface;
2. wrap existing RSM;
3. add RSM regression tests;
4. do not add DSM/PRM logic until the play-by-play/drive data decision is explicitly made.

## Phase 1 status

Implemented on 2026-09-21:

- Added research-only package `backend/parallel_models/`.
- Added `NFLGameContext` and `NFLPrediction` in `backend/parallel_models/interface.py`.
- Added `RSMParallelModel` in `backend/parallel_models/rsm_wrapper.py`.
- The RSM wrapper delegates to the existing `RsmStage7CComparisonModel`.
- The wrapper derives expected home/away scores only by the legitimate identity:
  - `home_score = (total + margin) / 2`
  - `away_score = (total - margin) / 2`
- The wrapper leaves `home_win_probability` as `None`; RSM display output is not a calibrated win-probability model.
- Added `backend/test_parallel_models.py` regression tests confirming wrapper output matches the existing RSM adapter and current `predict_matchup(..., model_profile="rsm_stage7c")` core projection.

Still not started:

- DSM implementation.
- PRM implementation.
- ensemble diagnostics.
- walk-forward parallel-model comparison.

Next required decision remains whether to add a play-by-play/drive data source for DSM and EPA-based PRM.

## Phase 2 status: nflverse PBP source scaffolding

Implemented on 2026-09-21 after explicit approval to use nflverse play-by-play data:

- Added `backend/parallel_models/nflverse_pbp.py`.
- Added nflverse release URL template:
  - `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv`
- Added explicit, dependency-free CSV downloader/manifest functions:
  - `download_pbp_season`
  - `update_pbp_sources`
  - `pbp_path`
  - `pbp_manifest_path`
- Added source manifest schema with URL template, seasons, bytes, SHA-256, and retrieval timestamp.
- Added `read_pbp_rows` for local CSV rows.
- Added strict pregame filter:
  - `filter_pbp_strictly_before_game`
  - excludes target-game and future-game plays using chronological game order.
- Added baseline drive summary derivation:
  - `DriveSummary`
  - `derive_drive_summaries`
  - groups by game, drive, and offense;
  - computes plays, summed EPA, drive points, drive result, starting yardline, and red-zone entry.
- Added `backend/test_parallel_pbp.py`.

Important boundaries:

- No large play-by-play files were downloaded during implementation or tests.
- No DSM model was implemented yet.
- No PRM model was implemented yet.
- Existing RSM and production NFL predictor behavior were not changed.

Next Phase 2 work:

1. Run `update_pbp_sources` for selected seasons only when ready to download large files.
2. Inspect real nflverse PBP columns in the downloaded files and lock a required-field contract.
3. Add derived drive-table persistence and fingerprinting.
4. Add broader leakage tests against real schedule ordering.
5. Only then begin DSM baseline implementation.

## Phase 2 update: local PBP/drive-table workflow

Implemented on 2026-09-21:

- Added research-only CLI entry point under `backend/parallel_models/__main__.py`.
- Supported commands, run from the `backend/` directory:
  - `python -m parallel_models update-pbp --seasons 2024 2025`
  - `python -m parallel_models inspect-pbp --seasons 2024 2025`
  - `python -m parallel_models derive-drives --seasons 2024 2025`
- Added required nflverse PBP field contract:
  - `game_id`
  - `season`
  - `week`
  - `drive`
  - `posteam`
  - `defteam`
  - `epa`
  - `yardline_100`
- Added schema inspection and validation before derived drive-table creation.
- Added persisted derived drive summaries:
  - default raw PBP location: `backend/data/parallel_models/raw/pbp/play_by_play_{season}.csv`
  - default derived drive table: `backend/data/parallel_models/derived/drive_summaries.csv`
  - default drive manifest: `backend/data/parallel_models/derived/drive-summary-manifest.json`
- The drive manifest records source file fingerprints, schema inspection, output row count, output bytes, and output SHA-256.
- Added tests for malformed schema rejection and drive-summary persistence.

Boundaries remain unchanged:

- No large nflverse PBP files were downloaded during tests.
- No DSM model was implemented yet.
- No EPA-based PRM model was implemented yet.
- Existing RSM and production NFL predictor behavior were not changed.

Recommended next Phase 2 step:

1. Download selected seasons into the research data root.
2. Inspect the real nflverse schema/field availability.
3. Generate the drive summary table.
4. Then add the first DSM/PRM feature builders from the persisted drive/PBP sources.

## Phase 2 update: local nflverse corpus and initial PBP features

Implemented on 2026-09-21:

- Downloaded local research-only nflverse PBP CSVs for seasons 2024, 2025, and 2026.
- Confirmed each downloaded file has the required 372-column schema, including all required fields for the current drive workflow.
- Generated local derived drive summaries:
  - rows: 12,841
  - output: `backend/data/parallel_models/derived/drive_summaries.csv`
  - manifest: `backend/data/parallel_models/derived/drive-summary-manifest.json`
- The raw PBP and derived drive-table artifacts remain ignored local data; they are not committed to the repository.
- Added `season_type` to derived drive summaries so regular-season and postseason records can be separated before modeling.
- Added `backend/parallel_models/pbp_features.py` with reusable, leakage-safe feature builders:
  - load persisted drive summaries;
  - filter drives strictly before a target game;
  - aggregate team offense/defense EPA per drive;
  - aggregate team offense/defense points per drive;
  - aggregate offensive and defensive red-zone-entry rates;
  - build matchup-level DSM/PRM-ready feature signals.
- The conservative pregame filter excludes the target week by default because the shared `NFLGameContext` does not yet guarantee full kickoff ordering within a week.
- Added tests proving:
  - current-week games are excluded from PBP features;
  - postseason records are excluded from regular-season features;
  - team drive metrics aggregate correctly;
  - matchup features expose DSM margin and PRM total signals.

Boundaries remain unchanged:

- No production API/UI behavior changed.
- No RSM behavior changed.
- No DSM or EPA-based PRM prediction model was exposed yet.
- The new signals are uncalibrated research features only.

Recommended next Phase 2 step:

1. Add a schedule-aware kickoff ordering source to safely include same-week games that are completed before the target kickoff.
2. Create frozen train/validation splits for DSM and EPA-based PRM.
3. Build baseline DSM/PRM candidate models from the feature layer without using market spread/total as model inputs.

## Phase 2 update: DSM/PRM research baselines

Implemented on 2026-09-21:

- Extended PBP feature filtering to accept an optional schedule-aware `game_order` plus target `game_id`.
- The default remains conservative: if no game order is supplied, all target-week games are excluded.
- When schedule order is supplied, same-week games are included only when their known kickoff/order is strictly before the target game.
- Added frozen research split helper in `backend/parallel_models/evaluation.py`:
  - training: 2024
  - validation: 2025
  - prospective/current observation: 2026
- Added research-only baseline model classes in `backend/parallel_models/drive_models.py`:
  - `DriveSuccessModel` / DSM baseline from drive-level EPA margin signal;
  - `EPAPointsModel` / PRM baseline from drive-level points/EPA signal.
- Both baseline classes:
  - use injected drive summaries;
  - use only pregame historical drive data;
  - do not use market spread or market total as model inputs;
  - shrink toward league priors when sample drive counts are low;
  - emit `NFLPrediction` objects through the common research interface;
  - are not wired into production API/UI.
- Added tests proving:
  - same-week prior games are included only with known schedule order;
  - target-week future/current games are excluded;
  - split assignment is chronological and frozen;
  - DSM/PRM predictions are marked research-only;
  - PRM output is unchanged by supplied market spread/total.

Boundaries remain unchanged:

- No production algorithm behavior changed.
- No existing RSM, baseline, enhanced, market-blend, Rothstein, Rothstein+, or mean-reversion behavior changed.
- DSM and PRM are still research candidates, not production recommendations.

Recommended next Phase 2 step:

1. Build a walk-forward evaluator for DSM/PRM using the frozen 2024 train / 2025 validation split.
2. Compare DSM/PRM against RSM through the shared `NFLPrediction` interface.
3. Only after validation, decide whether either candidate deserves a non-production UI/API preview.

## Phase 2 update: DSM/PRM validation evaluator

Implemented on 2026-09-21:

- Added `backend/parallel_models/backtest.py`.
- Added CLI command:
  - `python -m parallel_models evaluate-drive-models --period validation`
- Added validation artifact generation:
  - superseded by the RSM/DSM/PRM comparison artifacts below
- Added tests covering evaluator season selection, metric generation, and artifact writing.

Frozen validation run:

- Training period remains 2024.
- Validation period is 2025 regular season.
- Prospective/current observation period remains 2026.
- Games evaluated: 272.
- Prediction rows: 544.

Validation metrics:

| Model | Games | Spread MAE | Total Score MAE | Spread RMSE | Total Score RMSE | Avg sample drives |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DSM | 272 | 11.194 | 10.648 | 14.018 | 13.480 | 535.952 |
| PRM | 272 | 10.803 | 10.648 | 13.728 | 13.480 | 535.952 |

Interpretation:

- PRM is slightly better than DSM on 2025 spread/margin error in this baseline run.
- DSM and PRM have identical total-score metrics because the current DSM total estimate is intentionally using the same drive-level points/drive total signal path as the PRM baseline.
- Neither DSM nor PRM is production-ready yet.
- These results validate the evaluation pipeline more than they validate a final predictive model.
- Market spread and market total remain excluded as model inputs.

Recommended next Phase 2 step:

1. Add RSM comparison rows to the same validation artifact.
2. Decide whether DSM and PRM should diverge more clearly:
   - DSM focused on drive success and margin only;
   - PRM focused on EPA/points and total/score only.
3. Only after RSM/DSM/PRM comparison, decide whether a non-production preview endpoint is warranted.

## Phase 2 update: RSM / DSM / PRM validation comparison

Implemented on 2026-09-21:

- Added RSM comparison rows to the existing validation evaluator.
- RSM is evaluated through `RSMParallelModel`; no production RSM code or artifacts were changed.
- Added market baseline rows when `spread_line` and `total_line` are available.
- The market baseline is clearly labeled `market_baseline` and is not treated as an algorithmic model.
- Replaced the DSM/PRM-only artifacts with unified comparison artifacts:
  - `reports/parallel_models/rsm-dsm-prm-validation-predictions.csv`
  - `reports/parallel_models/rsm-dsm-prm-validation-metrics.json`
  - `reports/parallel_models/rsm-dsm-prm-validation-summary.md`
- Added tests proving:
  - RSM is included through the wrapper path;
  - all compared rows use the same eligible validation game set;
  - market baseline rows are included separately;
  - output artifact names and shapes are stable.

Frozen validation comparison:

- Training period remains 2024.
- Validation period is 2025 regular season.
- Prospective/current observation period remains 2026.
- Games evaluated: 272.
- Prediction rows: 1,088.

| Row | Games | Spread MAE | Total Score MAE | Spread RMSE | Total Score RMSE | Avg sample drives |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RSM | 272 | 10.877 | 11.090 | 13.889 | 13.951 | - |
| DSM | 272 | 11.194 | 10.648 | 14.018 | 13.480 | 535.952 |
| PRM | 272 | 10.803 | 10.648 | 13.728 | 13.480 | 535.952 |
| market_baseline | 272 | 9.722 | 10.393 | 12.271 | 13.186 | - |

Interpretation:

- The market baseline is best on both spread and total error, which is expected and is not a model claim.
- PRM is slightly better than RSM and DSM on 2025 spread MAE/RMSE in this baseline validation.
- DSM and PRM share the same total-score path in the current baseline, so their total metrics are identical.
- RSM has worse total-score MAE than DSM/PRM here, but RSM remains the only production/frozen model in this comparison.
- DSM/PRM are still research candidates and are not production recommendations.

Recommended next Phase 2 step:

1. Separate DSM and PRM responsibilities more cleanly:
   - DSM: margin/spread from drive success only;
   - PRM: score/total from EPA/points only.
2. Add a controlled ablation to test whether PRM’s slight spread improvement is stable or just noise.
3. Keep production exposure blocked until a future validation pass shows a durable advantage or a clear complementary use case.
