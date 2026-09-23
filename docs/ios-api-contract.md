# NFL iPhone API Contract

This contract prepares the NFL predictor backend for a future iPhone client. It is intentionally read-only and does not change model formulas, thresholds, RSM behavior, DSM/PRM research code, prediction outputs, or the existing website UI.

Base path:

```text
/api/v1/nfl/mobile
```

Common fields:

- `api_version`: currently `v1`.
- `client_contract`: currently `nfl-mobile-1`.
- `source`: upstream NFL data source.
- `cache`: source-game cache metadata.
- `cache_hit`: whether the endpoint reused a cached derived object when applicable.
- `generated_at`: when the derived object was generated.
- `last_rebuild_at`: alias for the upcoming-board rebuild timestamp.
- `football_week_start`: Tuesday date for the displayed football week when it can be derived from schedule dates.

## Spread sign convention

The backend schedule feed stores `spread_line` as a home-team margin reference:

- `spread_line > 0`: home team is favored.
- `spread_line < 0`: away team is favored.
- `spread_line = 0`: pick'em.

The mobile contract also exposes `market_favorite_relative_spread` for each model. This is the model's projected spread from the current market favorite's perspective:

- Negative means the model favors the market favorite.
- Positive means the model leans toward the market underdog.

Example: `CAR at ATL`, market `spread_line = -2.5`.

- The away team, CAR, is the market favorite by 2.5.
- If a model predicts home margin `-4.0`, then `market_favorite_relative_spread = -4.0`; the model favors CAR by 4.
- If a model predicts home margin `+3.0`, then `market_favorite_relative_spread = +3.0`; the model favors ATL by 3, opposite the market favorite.

Example: `SEA at ARI`, market `spread_line = -3.5`.

- SEA is the market favorite by 3.5.
- RSM displaying `SEA +5.6` means RSM's raw home margin is approximately `+5.6`, so it favored home ARI by 5.6.

## Endpoints

### Upcoming all-algorithm board

```http
GET /api/v1/nfl/mobile/upcoming
GET /api/v1/nfl/mobile/upcoming?season=2026&week=3
```

Read-only. This endpoint uses the existing upcoming prediction cache and does not schedule or run an expensive rebuild during normal mobile reads.

Important response fields:

- `season`
- `week`
- `football_week_start`
- `last_rebuild_at`
- `games[].game_status`
- `games[].kickoff_date`
- `games[].kickoff_time`
- `games[].away_team`
- `games[].home_team`
- `games[].away_score`
- `games[].home_score`
- `games[].market.spread_line`
- `games[].market.total_line`
- `games[].market.favorite`
- `games[].algorithms.<model>.predicted_home_margin`
- `games[].algorithms.<model>.predicted_total`
- `games[].algorithms.<model>.market_favorite_relative_spread`
- `games[].algorithms.<model>.status_label`
- `games[].algorithms.<model>.notes`
- `games[].model_signals`

Model status labels:

- `Market baseline`
- `Production`
- `Experimental`
- `Research only`

### Model Signals

```http
GET /api/v1/nfl/mobile/model-signals
GET /api/v1/nfl/mobile/model-signals?season=2026&week=3
```

Read-only. Returns display-only matchup signal metadata from the cached upcoming board.

Model Signals are matchup comparison tools, not betting recommendations. They should not be displayed with staking, lock, wagering, or recommendation language.

### Weekly algorithm performance

```http
GET /api/v1/nfl/mobile/weekly-performance?season=2026&week=2
```

Returns the cached/reusable weekly algorithm performance shape for all models.

Mobile field names use:

- `spread_mae`
- `total_score_mae`

These correspond to the website labels “Spread MAE” and “Total Score MAE.”

### Per-algorithm performance trend

```http
GET /api/v1/nfl/mobile/algorithm-performance/baseline?season=2026
```

Returns week-by-week chart data for one algorithm. The response is suitable for a single algorithm performance chart with spread win rate and total win rate series.

## Non-goals

- No iPhone app is built in this step.
- No model formulas or thresholds are changed.
- No prediction output is changed.
- No DSM/PRM production promotion is implied.
- No betting recommendation language is introduced.

