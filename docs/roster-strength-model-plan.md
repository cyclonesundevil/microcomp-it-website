# NFL Roster Strength Model Plan

## Phase 0 architecture assessment

The production predictor is implemented in `backend/nfl_predictor.py`. It downloads nflverse schedule data, retains regular-season games with final scores and closing spread/total lines, and updates team ratings chronologically after each game. Its profiles are `baseline`, `enhanced`, `market_blend`, `rothstein`, and `rothstein_plus`. `backend/app.py` exposes teams, dashboard, matchup, history, live-score, and backtest endpoints. `frontend/nfl-predictor.html` and `frontend/nfl-predictor.js` provide the model selector, matchup form, dashboard, and backtest tables. Python regression tests live in `backend/test_nfl_predictor.py`.

The schedule source stores `spread_line` as expected home margin (positive means the home team is favored). The public matchup API accepts conventional sportsbook notation (home favorite is negative) and converts at the boundary. That distinction must remain explicit in all RSM schemas and tests.

There is no existing player-rating, historical-lineup, roster-version, model-artifact, or football Monte Carlo subsystem. The dashboard's manual injury adjustment is not a player replacement model. RSM therefore belongs in a separate package and should not be embedded into the existing predictor module.

## Proposed architecture

`backend/rsm/` owns the new system:

- `config.py`: versioned, immutable model parameters and position mappings.
- `schema.py`: normalized players, player-game observations, games, lineups, player ratings, and team ratings.
- `data.py`: source downloads, atomic cache updates, schema adapters, provenance manifests, and cutoff filtering.
- `ratings.py`: position-season normalization, sample shrinkage, five-season PSR, offensive-line and team units.
- `reports.py`: deterministic team tables and data-quality reports.
- Later phases add `historical_lineups.py`, `matchup.py`, `score_model.py`, `simulation.py`, `calibration.py`, and `backtest.py` only after the first checkpoint passes.

The first production integration point will be an RSM adapter added to `MODEL_PROFILES` after roster ratings and historical cutoff tests pass. Until then, RSM remains callable through `python -m rsm` and cannot alter existing predictions.

## Data sources and normalized storage

Primary data comes from the nflverse release assets documented by nflreadr:

- [player weekly statistics](https://nflreadr.nflverse.com/reference/load_player_stats)
- [season and weekly rosters](https://nflreadr.nflverse.com/articles/dictionary_rosters.html), using the dedicated `weekly_rosters` release for historical reconstruction
- [depth charts](https://nflreadr.nflverse.com/articles/dictionary_depth_charts.html)
- [snap counts](https://github.com/nflverse/nflreadr/blob/main/R/load_snap_counts.R)
- the existing nflverse schedules file for games and closing consensus lines

Raw files are cached under ignored `backend/data/rsm/raw/`. Every refresh writes a manifest with source URL, UTC retrieval time, byte count, and SHA-256 digest. Derived snapshots go under `backend/data/rsm/derived/`. Stable GSIS IDs are primary; ESPN or PFR IDs are retained only as source-specific join keys. Team abbreviations pass through one normalization function.

Current depth charts include an ISO timestamp and stable GSIS ID. From 2025 onward they are timestamped snapshots rather than week-labelled records. Historical injury data is unavailable from nflverse after 2024, so post-2024 injury completeness must be marked missing until a licensed source is configured.

## Rating design for checkpoint one

PSR uses only observations strictly earlier than the rating cutoff. Player-season components are normalized within position group and season, mapped to the documented 0-100 scale, and shrunk toward replacement level according to opportunity. Up to five seasons are combined with configurable weights `[0.35, 0.27, 0.18, 0.12, 0.08]`, renormalized when fewer seasons exist. Missing statistics remain explicit in the explanation and confidence level.

Offensive skill ratings use efficiency plus non-duplicative volume/availability measures. Defensive ratings use per-snap disruption, coverage-event, tackling, and turnover measures available in the public feed. Public data does not contain robust individual offensive-line block quality, so checkpoint-one OL PSR is deliberately limited to availability, snap share, starter status, and experience. It must be labelled low confidence and must not be presented as pass-block win rate.

OLR uses position weights, a weakest-link penalty, and a continuity field that remains zero until historical co-start data exists. Offensive, defensive, kicking, and overall roster ratings use configured group weights. They are initial priors for sanity checking, not fitted score coefficients.

## Leakage-prevention rules

For a prediction cutoff `(season, week, kickoff)`, eligible statistics satisfy `observation_time < cutoff`. Same-season rows require `observation_week < prediction_week`. Depth-chart snapshots require `snapshot_timestamp <= prediction_as_of`; later snapshots are forbidden. Historical lineup reconstruction may use previous-game participation but never later-game starters, final-season totals, or today's roster.

Training, validation, and locked testing will use contiguous time blocks. Hyperparameters and ensemble weights freeze before the two most recent complete seasons are evaluated. Regular season and postseason are stored and reported separately. Closing lines may calculate edge after score prediction but cannot enter the fundamental RSM score model.

Automated tests cover cutoff boundaries, season weighting, shrinkage, replacement, position units, spread signs, game-type separation, and deterministic output. A future locked-test command will refuse to run if its artifact records any training row from the locked period.

## Implementation phases

1. Normalize sources and produce PSR plus OL/offense/defense/kicking/overall ratings for a known 32-team snapshot.
2. Reconstruct point-in-time historical lineups and create RSM-v0 deterministic scores without optimization.
3. Fit regularized score mappings on training data, tune once on validation data, freeze RSM-v1, and run the locked two-season test once.
4. Add probability calibration, residual simulation, playoff-only evaluation, ablations, feature importance, and the existing-model/RSM ensemble.
5. Add API/UI integration only after model artifacts, provenance, and reports are reproducible.

## Risks and controls

- Public player metrics are uneven by position, especially OL and coverage. Confidence and missingness are first-class outputs.
- Depth-chart source/schema changes require versioned adapters and fixture tests.
- Current injury coverage is incomplete. No generic hidden injury deduction is allowed.
- Player ratings can double-count correlated box-score statistics. Component groups are capped and correlation diagnostics precede fitting.
- Two seasons are a small final sample. Every percentage includes attempts and a confidence interval.
- A 60% result is a target, never a tuning constraint. Failed or unstable results are reported unchanged.

## Testing strategy

Checkpoint-one unit tests use small synthetic fixtures with fixed IDs and timestamps. Integration tests use cached source headers and a generated 32-team table. Later backtests must include market pushes, ties, incomplete records, trades, rookies, byes, injuries, and postseason separation. Every report embeds model version, config digest, roster timestamp, and source manifest digest.
