# NFL Pre-Game Predictability Model

Phase A repository investigation and Phase B baseline implementation notes for the proposed **PGP** research system: **Pre-Game Predictability**.

This document records what the current repository can support, what must remain protected, and how the initial Tier 0/Tier 1 research implementation is structured.

## Scope

PGP is a new experimental NFL modeling capability for `nfl-predictor.html`, not the `nfl-upcoming.html` all-algorithm board.

Research question:

> Given information that was reasonably knowable before kickoff, how much of an NFL game's scoring outcome can be predicted?

The target object is a joint pregame score distribution:

```text
P(home_score, away_score | pregame_information)
```

The expected score is only a summary of that distribution. PGP should eventually expose score, total, margin, win-probability, interval, and calibration outputs without reducing the model internally to one score.

## Current NFL Architecture

### Main Website Predictor

Primary files:

| Area | Path |
| --- | --- |
| Core NFL predictor | `backend/nfl_predictor.py` |
| NFL routes | `backend/app.py` |
| Main NFL UI | `frontend/nfl-predictor.html` |
| Main NFL UI logic | `frontend/nfl-predictor.js` |
| Upcoming all-model board | `frontend/nfl-upcoming.html`, `frontend/nfl-upcoming.js` |
| Algorithm performance UI | `frontend/nfl-algorithm-performance.html`, `frontend/nfl-algorithm-performance.js` |
| Main tests | `backend/test_nfl_predictor.py`, `backend/test_nfl_refresh.py` |
| API contract | `docs/nfl-api-v1.md` |
| Existing user docs | `backend/NFL_PREDICTOR.md` |

`backend/nfl_predictor.py` owns the production-style model profiles:

```text
baseline
enhanced
market_blend
mean_reversion
rothstein
rothstein_plus
rsm_stage7c
rsm_plus
```

These are exposed through `MODEL_PROFILES` and used by backtests, matchup prediction, weekly performance, upcoming cache generation, and model-signal rendering.

PGP should not be added to `MODEL_PROFILES` during early research. That tuple feeds the expensive Upcoming Week cache path and production comparison screens. PGP should remain under its own API and CLI until explicitly approved for broader integration.

### Existing Website Surfaces

`nfl-predictor.html` currently contains:

- model selector and backtest controls;
- team dashboard;
- link to the separate Upcoming Week page;
- matchup predictor form;
- historical casino-line table;
- RSM manual observation forms;
- backtest result tables.

This is the correct future location for an isolated **NFL Pre-Game Predictability Lab** section. The section should be below or near the matchup predictor and should call PGP-specific endpoints only.

`nfl-upcoming.html` is intentionally separate and should not receive this experiment.

## Available Data

### Game-Level nflverse Schedule Data

The main predictor downloads:

```text
https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
```

Default local cache:

```text
backend/data/nfl_games.csv
```

Relevant available fields include:

- game identity: `game_id`, `season`, `game_type`, `week`, `gameday`, `gametime`;
- teams: `away_team`, `home_team`;
- final scores: `away_score`, `home_score`;
- rest/context: `away_rest`, `home_rest`, `div_game`, `roof`, `surface`, `temp`, `wind`, `stadium`;
- market fields: `spread_line`, spread odds, `total_line`, total odds, moneylines;
- QB/coaching metadata: `away_qb_id`, `home_qb_id`, `away_qb_name`, `home_qb_name`, coaches, referee.

Current `load_games()` filters to completed regular-season games with scores, spread lines, and totals for existing model backtests. PGP will need a loader mode that can include games without market lines for non-market baselines and can preserve postseason separation.

### Drive / Play-By-Play Research Data

The repo already contains research-only parallel model infrastructure:

| File | Purpose |
| --- | --- |
| `backend/parallel_models/nflverse_pbp.py` | downloads nflverse PBP, validates schema, derives drive summaries |
| `backend/parallel_models/pbp_features.py` | point-in-time drive features with leakage controls |
| `backend/parallel_models/drive_models.py` | DSM/PRM research baselines |
| `backend/parallel_models/backtest.py` | RSM/DSM/PRM research evaluation |
| `backend/parallel_models/__main__.py` | CLI for `update-pbp`, `derive-drives`, `evaluate-drive-models` |

The derived drive schema already includes:

```text
game_id
season
season_type
week
drive
offense
defense
plays
epa
points
result
start_yardline_100
red_zone_entry
```

This is directly reusable for later PGP possession simulation. It is not currently used in normal page requests.

### Roster / Player Data

The RSM package already defines nflverse source loaders for:

- players;
- season rosters;
- weekly rosters;
- depth charts;
- weekly player stats;
- snap counts;
- schedules/games.

Primary files:

| File | Purpose |
| --- | --- |
| `backend/rsm/data.py` | source downloads, manifests, point-in-time loaders |
| `backend/rsm/ratings.py` | player ratings, expected lineups, team ratings |
| `backend/rsm/backtest.py` | RSM checkpoint historical scoring |
| `backend/rsm/fitting.py` | RSM-v1 fitting |
| `backend/rsm/locked_backtest.py` | frozen locked-period evaluation |
| `backend/rsm/stage8_shadow.py` | prospective observation ledger |

Important reusable concepts:

- `load_player_stats(..., cutoff_season, cutoff_week)` excludes rows from the target week and future weeks.
- `load_snap_counts(..., cutoff_season, cutoff_week)` applies the same cutoff.
- `load_roster_snapshot_rows(rows, week)` selects the latest weekly roster snapshot at or before the target week.
- `load_latest_depth_chart(path, as_of)` supports timestamp-bounded current depth charts.
- RSM tests already cover historical roster leakage and lineup reconstruction risks.

PGP Tier 3 can reuse RSM loaders and derived ratings only by treating RSM as frozen infrastructure and preserving its existing artifacts and tests.

## Existing Team-Level Features

The main online models in `backend/nfl_predictor.py` already compute chronological team features such as:

- margin rating;
- offensive scoring tendency;
- defensive points allowed tendency;
- home-field adjustment;
- rest-days adjustment;
- league scoring baseline;
- enhanced contextual fields including rest, division, roof/weather-style inputs;
- Rothstein rolling points-for/points-against averages;
- market-blend margin/total comparisons.

The parallel models provide drive-level team features:

- offensive EPA per drive;
- defensive EPA allowed per drive;
- offensive points per drive;
- defensive points allowed per drive;
- red-zone entry rates;
- sample drive counts;
- shrinkage toward league priors.

These are good Tier 1 and Tier 2 candidates if computed strictly before the target game.

## Existing RSM / DSM / PRM Interfaces

The research interface in `backend/parallel_models/interface.py` is a good starting point:

- `NFLGameContext`
- `NFLPrediction`
- `NFLPredictionModel`

Current `NFLPrediction` is point-estimate oriented, but its `uncertainty` and `metadata` fields can inspire a separate PGP distribution object. PGP should not overload `NFLPrediction` if doing so would blur point predictions and distributions.

Recommended PGP-specific equivalents:

```text
PGPGameContext
PGPInformationTier
PGPDistributionPrediction
PGPSimulationConfig
PGPEvaluationResult
```

Existing RSM comparison wrapper:

- `backend/parallel_models/rsm_wrapper.py`
- delegates to `RsmStage7CComparisonModel`;
- does not refit or recalibrate RSM;
- algebraically derives scores from frozen RSM margin and total diagnostic.

PGP should follow this pattern when comparing against RSM: call the wrapper or saved artifacts, never modify RSM internals.

## Reusable Components

Strong reuse candidates:

- `backend/parallel_models/nflverse_pbp.py` for PBP download, schema validation, and drive summaries.
- `backend/parallel_models/pbp_features.py` for no-leakage drive filtering.
- `backend/parallel_models/evaluation.py` for frozen train/validation/prospective split vocabulary.
- `backend/parallel_models/backtest.py` for machine-readable CSV/JSON plus Markdown report structure.
- `backend/rsm/data.py` for point-in-time roster/stat/snap loaders.
- `backend/rsm/ratings.py` for future Tier 3 frozen roster-strength features, if approved.
- `backend/app.py` route patterns for small read-only JSON endpoints.
- `frontend/nfl-predictor.html` and `frontend/nfl-predictor.js` for matchup selection and static UI conventions.

Do not reuse:

- Upcoming Week cache generation for PGP.
- `MODEL_PROFILES` for PGP Phase B/C.
- RSM fitting or diagnostic commands as PGP implementation internals.
- Market-derived features as fundamental PGP inputs, except for explicit market-baseline comparisons.

## Leakage Risks

The main leakage risks are:

1. **Season aggregates**: using end-of-season team/player rates to predict earlier games.
2. **Target-game stats**: including the game being predicted in rolling team/drive/player features.
3. **Same-week ordering**: including Sunday/Monday game data when predicting an earlier same-week game.
4. **Future roster state**: using roster/depth/injury status published after kickoff.
5. **Market timing**: treating closing lines as pregame inputs without a line timestamp.
6. **RSM artifact contamination**: evaluating new PGP work against frozen RSM artifacts while accidentally refitting or retuning them.
7. **Upcoming cache coupling**: putting PGP into `MODEL_PROFILES` or the upcoming all-algorithm board, causing expensive rebuilds and unstable production UI.

Existing safeguards worth preserving:

- `filter_drives_before_game()` excludes target-week data unless game order is explicitly known.
- RSM loaders use cutoff season/week for player stats and snaps.
- RSM documentation separates training, validation, locked test, and prospective observation.
- Tests already check no-leakage PBP filtering and RSM historical roster boundaries.

PGP should add a single cutoff object and require every feature builder to accept it:

```text
PGPCutoff(season, week, game_id, kickoff_at, allow_same_week_prior_games)
```

Feature builders should fail closed when they cannot determine whether an input was available before kickoff.

## Proposed PGP Module Structure

Recommended new package:

```text
backend/pgp/
  __init__.py
  schema.py
  data.py
  tiers.py
  distributions.py
  simulator.py
  features.py
  evaluation.py
  reports.py
  __main__.py
```

Suggested responsibilities:

- `schema.py`: dataclasses for context, cutoff, simulation config, score distributions, tier summaries, evaluation rows.
- `data.py`: adapters around existing game, drive, and optional roster data; no network calls in web request path.
- `tiers.py`: explicit Tier 0 through Tier 4 feature availability and isolation rules.
- `distributions.py`: empirical histograms, percentiles, interval extraction, joint-score grids, probability normalization.
- `simulator.py`: deterministic seeded possession/drive Monte Carlo engine.
- `features.py`: chronological team/league/drive feature builders.
- `evaluation.py`: out-of-sample scoring, calibration, information-gain curves.
- `reports.py`: JSON/CSV/Markdown outputs.
- `__main__.py`: research CLI.

Future API routes should live in `backend/app.py` but call this package, for example:

```text
GET /api/v1/nfl/pgp/predict
GET /api/v1/nfl/pgp/evaluation-summary
```

No route should rebuild historical experiments during normal page loads.

## Proposed Information Tiers

### Tier 0: League Baseline

Inputs:

- historical NFL game scores only;
- no team identity;
- no market data.

Initial implementation idea:

- estimate empirical distribution of team scores, totals, margins, and drive/possession counts from prior games;
- for Monte Carlo, sample from league drive outcome and possession-count distributions;
- enforce football score construction via drive outcomes rather than Gaussian score draws once the possession simulator is introduced.

Purpose:

- measure what is predictable knowing only that a game is an NFL game.

### Tier 1: Team Strength

Inputs available now:

- chronological team points for/against;
- chronological margin ratings;
- drive-level points/EPA rates if drive summaries are available;
- rest days and home field should be treated carefully as Tier 4 context unless the experiment defines them as team-strength-adjacent.

Initial implementation idea:

- build rolling team scoring and allowed distributions using only games before the target game;
- shrink early-season teams toward league priors;
- produce distribution parameters or drive-outcome weights, not just means.

### Tier 2: Matchup

Inputs available now if drive summaries exist:

- offense points/EPA per drive versus opponent defensive points/EPA allowed;
- red-zone entry rates;
- drive start and result distributions.

Initial implementation idea:

- combine home offense with away defense and away offense with home defense;
- allow possession count and score state to correlate the teams through the simulator.

### Tier 3: Roster / Personnel

Inputs available with safeguards:

- RSM weekly roster identity;
- prior player stats;
- snap counts;
- reconstructed expected lineups;
- current depth-chart snapshots where timestamped.

Limitations:

- public OL and coverage quality are weak;
- historical injury availability is incomplete;
- weekly roster snapshots may not include precise publication timestamps;
- current RSM display lineup confidence is LOW/unverified for prospective public use.

Initial recommendation:

- do not implement Tier 3 in Phase B;
- define interfaces and tests now;
- only activate after Tier 0/1/2 evaluation and a separate point-in-time data-quality review.

### Tier 4: Environment / Context

Inputs available in `games.csv`:

- home/away rest;
- division game;
- roof;
- surface;
- temperature;
- wind;
- stadium.

Limitations:

- historical weather fields may be source-populated after the game; confirm publication timing before treating them as pregame.
- no precipitation detail is currently surfaced in the main model.

Initial recommendation:

- reserve Tier 4 for a later phase;
- add explicit provenance notes for each environmental field.

### Tier 5: Advanced Pregame State

Not currently available:

- tracking data;
- formations;
- personnel packages;
- coaching tendencies with timestamped pregame availability;
- verified tactical tendencies.

Tier 5 should remain architectural only.

## Proposed Tier 0 / Tier 1 Implementation

Phase B should implement:

1. `PGPScoreDistribution` from empirical Monte Carlo samples.
2. Deterministic seed handling.
3. Tier 0 league-only distribution from historical games strictly before target season/week.
4. Tier 1 rolling team-strength distribution.
5. Research CLI evaluation over a chronological split.
6. No website UI yet unless the output is clearly marked experimental and backed by tests.

Recommended first simulation design:

- start with possession count sampled from historical game-level or drive-summary data;
- alternate possessions between teams;
- sample drive outcomes from discrete outcome probabilities:
  - touchdown;
  - field goal;
  - no score;
  - turnover/no score;
  - safety as a rare event if supported;
- convert outcomes to football scores using 7/3/2 point increments at first;
- later split touchdowns into PAT/two-point outcomes if data supports it;
- let game state adjust pace/aggression only after the base distribution passes calibration tests.

The first implementation should prefer correctness and auditability over sophistication.

## Proposed Research CLI

Add a future command in `backend/pgp/__main__.py`, not to `nfl_predictor.py`:

```powershell
python -m pgp evaluate --train-through 2024 --test-season 2025 --tiers 0 1 --simulations 25000 --seed 12345
```

Suggested outputs:

```text
reports/pgp/pgp-evaluation-summary.json
reports/pgp/pgp-evaluation-games.csv
reports/pgp/pgp-evaluation-summary.md
```

Record:

- model/tier;
- simulation count;
- seed;
- training window;
- test window;
- games evaluated;
- score MAE/RMSE;
- total MAE/RMSE;
- margin MAE/RMSE;
- Brier score for home win where available;
- interval coverage for 50/80/90/95 percent intervals;
- runtime;
- config hash;
- source file signatures.

## Proposed Tests

Add PGP tests without weakening existing NFL/RSM tests:

| Test Area | Proposed Coverage |
| --- | --- |
| Determinism | same game + same config + same seed returns identical samples/summaries |
| Probability | win/tie/loss probabilities sum to 1; histograms normalize |
| Percentiles | percentile and interval bounds are ordered |
| Football scoring | generated scores are nonnegative integers and plausible football totals |
| Tier isolation | Tier 0 cannot access team IDs; Tier 1 cannot access roster/environment fields |
| Leakage | target game and future games excluded from all feature builders |
| Same-week order | known prior same-week games may be included only when explicit order exists |
| Monte Carlo convergence | means stabilize within expected sampling tolerance as simulations increase |
| Calibration | interval coverage calculation is correct on synthetic fixtures |
| Existing behavior | focused `nfl_predictor`, RSM, and route tests still pass |

Existing relevant tests:

- `backend/test_parallel_pbp_features.py`
- `backend/test_parallel_drive_models.py`
- `backend/test_parallel_backtest.py`
- `backend/test_rsm.py`
- `backend/test_nfl_predictor.py`
- `backend/test_nfl_refresh.py`

## Missing Pieces / Blockers

The following do not prevent Phase B Tier 0/Tier 1, but they block later scientific claims:

- Verified pregame injury availability is not available from the current public pipeline.
- Historical market lines lack sportsbook identity and retrieval timestamps.
- Weather fields need provenance review before being treated as genuinely pre-kickoff.
- Drive summaries may need to be generated locally from large nflverse PBP files; they are research data, not normal web-request data.
- Player-level OL and coverage quality are weak in public stats.
- RSM artifacts are point estimates and diagnostics, not calibrated PGP distributions.
- Current PBP-derived drive points approximate outcomes and may need validation against final scores and official drive results.
- No UI should display information-gain or calibration tables until evaluations actually generate measured values.

## Experimental Findings

Initial Phase B validation was run against the real cached nflverse game file:

```powershell
cd backend
python -m pgp evaluate --train-through 2024 --test-season 2025 --tiers 0 1 --simulations 25000 --seed 12345
```

Scope:

- regular season only;
- train/history through 2024;
- held-out test season 2025;
- 272 games;
- 25,000 simulations per game/tier;
- no market, roster, injury, weather, or environment inputs.

Outputs:

```text
reports/pgp/pgp-evaluation-summary.json
reports/pgp/pgp-evaluation-games.csv
reports/pgp/pgp-evaluation-summary.md
```

Results:

| Tier | Games | Score MAE | Margin MAE | Total MAE | Home Win Brier | Total 80% Coverage | Margin 80% Coverage |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 272 | 7.952 | 11.155 | 11.001 | 0.252 | 0.809 | 0.776 |
| 1 | 272 | 7.775 | 10.680 | 11.083 | 0.239 | 0.805 | 0.765 |

Observed interpretation:

- Tier 1 improved score MAE, margin MAE, margin RMSE, and home-win Brier versus the league-only Tier 0 baseline.
- Tier 1 did not improve total MAE in this first implementation.
- The 80% total interval was close to calibrated in this split for both tiers.
- The 80% margin interval was slightly under-covering.
- These are preliminary research diagnostics, not production claims.

Follow-up drive-prior evaluation:

The simulator can now use local nflverse-derived drive summaries instead of final-score-derived event priors:

```powershell
cd backend
python -m pgp evaluate --train-through 2024 --test-season 2025 --tiers 0 1 --simulations 25000 --seed 12345 --prior-source drive --output-dir ..\reports\pgp-drive
```

For apples-to-apples comparison, the score-prior run was regenerated under:

```text
reports/pgp-score/
```

and the drive-prior run was written under:

```text
reports/pgp-drive/
```

Side-by-side 2025 regular-season results:

| Prior | Tier | Games | Score MAE | Margin MAE | Total MAE | Home Win Brier | Total 80% Coverage | Margin 80% Coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Score-derived | 0 | 272 | 7.952 | 11.155 | 11.001 | 0.252 | 0.809 | 0.776 |
| Score-derived | 1 | 272 | 7.775 | 10.680 | 11.083 | 0.239 | 0.805 | 0.765 |
| Drive-derived | 0 | 272 | 7.947 | 11.154 | 11.095 | 0.252 | 0.794 | 0.787 |
| Drive-derived | 1 | 272 | 7.718 | 10.905 | 10.752 | 0.244 | 0.809 | 0.794 |

Observed interpretation:

- Drive-derived Tier 1 improved score MAE and total MAE versus score-derived Tier 1.
- Score-derived Tier 1 remained better on margin MAE and home-win Brier in this split.
- Drive-derived Tier 1 had better 80% margin interval coverage and similar 80% total interval coverage.
- This suggests drive summaries are worth keeping, especially for total-score distribution research, but they do not automatically dominate the simpler score-derived prior.
- The next useful experiment is not more UI. It is a controlled source/tier ablation: score priors versus drive priors, with and without team-strength shrinkage, and with simulation count reduced or vectorized enough for faster iteration.

Score-structure spot check:

- A representative 2025 Week 1 simulation concentrated home scores around common NFL values such as 20, 17, 24, 27, 13, 23, 10, 16, 31, and 30.
- Rare low scores such as 4 or 5 can occur through safety combinations under the 7/3/2 event model. They are plausible but should be monitored.
- The current event prior cannot explicitly model missed PATs, two-point conversions, defensive two-point returns, or exact drive-end labels. nflverse drive summaries should be the next simulator input if the project proceeds.

Runtime:

- The first possession-by-possession Python loop was too slow for the default research run and was replaced with precomputed team score distributions.
- The optimized 25,000-simulation, two-tier, 272-game split completed in about 85 seconds on the local environment.

Do not infer a predictability floor, information-gain curve, or event-variance decomposition from existing point-estimate models. Existing RSM/DSM/PRM diagnostics are useful context only.

## Phase B Implementation

Implemented as a research-only package:

```text
backend/pgp/
```

Current files:

| File | Purpose |
| --- | --- |
| `backend/pgp/schema.py` | PGP dataclasses, simulation config, information-tier enum |
| `backend/pgp/data.py` | lightweight game CSV loader and chronological ordering helpers |
| `backend/pgp/features.py` | Tier 0/Tier 1 pregame-only outcome priors |
| `backend/pgp/distributions.py` | empirical score-distribution summaries and histograms |
| `backend/pgp/simulator.py` | deterministic seeded football-event Monte Carlo |
| `backend/pgp/evaluation.py` | chronological test-season evaluation metrics |
| `backend/pgp/reports.py` | CSV/JSON/Markdown research output writers |
| `backend/pgp/__main__.py` | research CLI |

The first simulator is intentionally conservative. It builds discrete drive-outcome priors from historical final-score structure and simulates possessions as touchdown, field-goal, safety, or no-score events. This preserves football-like score construction without claiming that the first model is a full drive physics simulator.

Current tiers:

- Tier 0: league-only historical scoring priors. Team identity is not used.
- Tier 1: rolling team scoring and allowed-scoring priors, shrunk toward league history.

Current exclusions:

- no market inputs;
- no roster/personnel inputs;
- no weather/environment inputs;
- no UI/API integration;
- no `MODEL_PROFILES` integration;
- no Upcoming Week integration.

Research CLI:

```powershell
cd backend
python -m pgp evaluate --train-through 2024 --test-season 2025 --tiers 0 1 --simulations 25000 --seed 12345
```

Default outputs:

```text
reports/pgp/pgp-evaluation-summary.json
reports/pgp/pgp-evaluation-games.csv
reports/pgp/pgp-evaluation-summary.md
```

Initial focused tests:

```powershell
python -m pytest backend/test_pgp.py -q
python -m pytest backend/test_parallel_pbp_features.py backend/test_parallel_drive_models.py backend/test_parallel_backtest.py -q
python -m compileall -q backend/pgp
```

## Recommended Next Step

After review and approval, the next phase should validate the Tier 0/Tier 1 outputs on a real historical split, inspect score-distribution realism, and decide whether to replace the current final-score-derived event priors with the existing nflverse drive-summary data. It should still not add PGP to `MODEL_PROFILES`, should not touch the Upcoming Week page, and should not modify RSM/DSM/PRM behavior.
