# NFL API v1 Contract

The `/api/v1/nfl/*` endpoints are the stable client contract for future mobile clients. They currently preserve the response shape of the existing web endpoints while giving app clients a versioned path.

Base URL in production:

```text
https://www.microcompit.com
```

Common response conventions:

- Success responses include `success: true`.
- Error responses include `success: false` and `error`.
- Most data-backed endpoints include `source` and `cache`.
- Percentages are decimals, not whole percentages. Example: `0.5625` means `56.25%`.
- Spread lines use the existing backend convention unless otherwise labeled: `spread_line` is the home-team spread/margin reference used by the predictor.
- Public read endpoints are safe for mobile clients. Admin refresh requires `X-NFL-Refresh-Token`.

## Read endpoints

### Models

```http
GET /api/v1/nfl/models
```

Returns the available algorithm IDs and default thresholds.

Example response:

```json
{
  "success": true,
  "api_version": "v1",
  "default_model": "market_blend",
  "models": [
    {
      "id": "baseline",
      "spread_threshold": 1.5,
      "total_threshold": 3.0,
      "experimental": false
    },
    {
      "id": "rsm_stage7c",
      "spread_threshold": 999.0,
      "total_threshold": 0.0,
      "experimental": true
    }
  ]
}
```

### Teams

```http
GET /api/v1/nfl/teams
```

Returns the current team list and available seasons.

Example response:

```json
{
  "success": true,
  "source": "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
  "cache": {
    "exists": true,
    "age_seconds": 120,
    "stale": false
  },
  "teams": ["ARI", "ATL", "BAL"],
  "available_seasons": {
    "start": 1999,
    "end": 2026
  }
}
```

### Upcoming Week: All Algorithms

```http
GET /api/v1/nfl/upcoming?scope=upcoming
GET /api/v1/nfl/upcoming?scope=upcoming&season=2026&week=2
```

Public reads are cache-first and do not trigger expensive rebuilds. Manual refresh/rebuild requires the admin refresh token and `refresh=1`.

Important fields:

- `generated_at`: when the upcoming prediction board was rebuilt.
- `cache_age_seconds`: age of the upcoming prediction cache.
- `games[].schedule`: scheduled matchup and market lines.
- `games[].models`: per-algorithm prediction objects keyed by model ID.

Example response, abbreviated:

```json
{
  "success": true,
  "ready": true,
  "season": 2026,
  "week": 2,
  "generated_at": "2026-09-21T01:16:20.991847+00:00",
  "cache_age_seconds": 3600,
  "models": [
    "baseline",
    "enhanced",
    "market_blend",
    "mean_reversion",
    "rothstein",
    "rothstein_plus",
    "rsm_stage7c"
  ],
  "games": [
    {
      "schedule": {
        "game_id": "2026_02_CAR_ATL",
        "season": 2026,
        "week": 2,
        "away_team": "CAR",
        "home_team": "ATL",
        "gameday": "2026-09-20",
        "gametime": "13:00",
        "spread_line": -2.5,
        "total_line": 44.5
      },
      "models": {
        "baseline": {
          "model": "baseline",
          "away_team": "CAR",
          "home_team": "ATL",
          "pred_margin": 1.2,
          "pred_total": 43.7,
          "spread_edge": 3.7,
          "total_edge": -0.8,
          "spread_pick": "home",
          "total_pick": null,
          "eligible": true,
          "availability_adjusted": false
        }
      }
    }
  ]
}
```

### Weekly Algorithm Performance

```http
GET /api/v1/nfl/week-performance?season=2026&week=1
```

Grades completed games for the requested week across every algorithm. This powers the Weekly Algorithm Performance table. Results are cached by season, week, model set, thresholds, source-game fingerprint, and games source signature.

Important fields:

- `cache_hit`: whether the performance table came from cache.
- `performance.generated_at`: when the cached performance object was generated.
- `performance.models[]`: one row per algorithm.
- `spread_win_rate` and `total_win_rate` exclude pushes through the backend summary logic.
- `margin_mae` is displayed as “Spread MAE” in the UI.
- `total_mae` is displayed as “Total Score MAE” in the UI.

Example response:

```json
{
  "success": true,
  "cache_hit": true,
  "performance": {
    "season": 2026,
    "week": 1,
    "completed_games": 16,
    "generated_at": "2026-09-21T05:00:00+00:00",
    "models": [
      {
        "model": "baseline",
        "completed_games": 16,
        "spread_wins": 8,
        "spread_losses": 7,
        "spread_pushes": 1,
        "spread_bets": 16,
        "spread_win_rate": 0.5333333333,
        "total_wins": 9,
        "total_losses": 7,
        "total_pushes": 0,
        "total_bets": 16,
        "total_win_rate": 0.5625,
        "margin_mae": 8.4,
        "total_mae": 9.7
      }
    ]
  }
}
```

### Algorithm Performance Trend

```http
GET /api/v1/nfl/week-performance-trend?model=baseline&season=2026
```

Returns week-by-week performance for one algorithm. This powers the algorithm trend graph page. Results are cached by season, model, thresholds, source-game fingerprint, and games source signature.

Example response:

```json
{
  "success": true,
  "cache_hit": true,
  "trend": {
    "season": 2026,
    "model": "baseline",
    "generated_at": "2026-09-21T05:05:00+00:00",
    "weeks": [
      {
        "week": 1,
        "completed_games": 16,
        "spread_wins": 8,
        "spread_losses": 7,
        "spread_pushes": 1,
        "spread_bets": 16,
        "spread_win_rate": 0.5333333333,
        "total_wins": 9,
        "total_losses": 7,
        "total_pushes": 0,
        "total_bets": 16,
        "total_win_rate": 0.5625,
        "margin_mae": 8.4,
        "total_mae": 9.7
      }
    ]
  }
}
```

### Manual Matchup Prediction

```http
GET /api/v1/nfl/predict?away_team=CAR&home_team=ATL&model=market_blend&spread_line=-2.5&total_line=44.5
```

Optional query parameters:

- `model`
- `spread_line`
- `total_line`
- `home_rest`
- `away_rest`
- `div_game`
- `roof`
- `temp`
- `wind`
- `market_source`
- `market_observed_at`

When the requested teams exactly match a scheduled upcoming game, upcoming-only safeguards and availability overlays may be applied to the manual display.

Example response, abbreviated:

```json
{
  "success": true,
  "prediction": {
    "model": "market_blend",
    "away_team": "CAR",
    "home_team": "ATL",
    "pred_margin": 1.8,
    "pred_total": 43.9,
    "spread_line": -2.5,
    "total_line": 44.5,
    "spread_edge": 4.3,
    "total_edge": -0.6,
    "winner_pick": "home",
    "spread_pick": "home",
    "total_pick": null,
    "model_notes": [
      "Matched upcoming schedule game 2026_02_CAR_ATL; upcoming-only safeguards were applied to this manual matchup display."
    ],
    "upcoming_schedule_match": {
      "game_id": "2026_02_CAR_ATL",
      "season": 2026,
      "week": 2
    }
  }
}
```

### Historical Matchup / Casino Lines

```http
GET /api/v1/nfl/history?away_team=CAR&home_team=ATL&model=baseline
```

Returns historical matchup rows. The historical matchup cache is persistent and reusable across requests.

Example response, abbreviated:

```json
{
  "success": true,
  "away_team": "CAR",
  "home_team": "ATL",
  "model": "baseline",
  "history_cache_hit": true,
  "games": [
    {
      "season": 2025,
      "week": 8,
      "away_team": "CAR",
      "home_team": "ATL",
      "home_score": 24,
      "away_score": 20,
      "home_spread": -3.0,
      "selected_home_spread": -3.0,
      "pred_margin": 1.5,
      "pred_total": 43.2
    }
  ]
}
```

### Backtest

```http
GET /api/v1/nfl/backtest?model=baseline&seasons=5
```

Query parameters:

- `model`: one of the model IDs from `/models`
- `seasons`: `5` or `10`
- `spread_threshold`: optional override
- `total_threshold`: optional override

Example response, abbreviated:

```json
{
  "success": true,
  "model": "baseline",
  "seasons": 5,
  "thresholds": {
    "spread": 1.5,
    "total": 3.0
  },
  "summary": {
    "games": 1360,
    "spread_bets": 740,
    "spread_wins": 380,
    "spread_losses": 350,
    "spread_pushes": 10,
    "spread_win_rate": 0.5205479452,
    "total_bets": 690,
    "total_wins": 350,
    "total_losses": 335,
    "total_pushes": 5,
    "total_win_rate": 0.5109489051,
    "margin_mae": 9.8,
    "total_mae": 10.6
  },
  "by_season": [],
  "backtest_cache_hit": true
}
```

### Dashboard

```http
GET /api/v1/nfl/dashboard?model=baseline
```

Optional query parameters:

- `model`
- `playoff_mode`
- `injury_team`
- `injury_impact`
- `injury_position`

Returns the NFL dashboard snapshot used by the website. This endpoint is useful for app dashboard screens, but clients should treat the nested `dashboard` object as display data unless a stricter schema is later published.

Example response:

```json
{
  "success": true,
  "dashboard": {
    "model": "baseline",
    "teams": [],
    "rankings": [],
    "summary": {}
  }
}
```

### Live Scores

```http
GET /api/v1/nfl/live
```

Returns live scoreboard data when the live source is enabled.

Example response:

```json
{
  "success": true,
  "enabled": true,
  "events": [
    {
      "id": "401000000",
      "name": "CAR at ATL",
      "status": "STATUS_FINAL",
      "competitions": []
    }
  ]
}
```

## Admin endpoint

```http
POST /api/v1/nfl/refresh
X-NFL-Refresh-Token: <admin token>
```

Refreshes nflverse game data, rebuilds the upcoming cache, and schedules historical cache warmup when appropriate.

Example response:

```json
{
  "success": true,
  "source": "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
  "graded_regular_season_games": 7000,
  "latest_season": 2026,
  "latest_week": 2,
  "upcoming_cache_generated_at": "2026-09-21T05:56:11.066529+00:00",
  "history_cache_warmup_scheduled": true
}
```

```http
POST /api/v1/nfl/refresh/final-scores
X-NFL-Refresh-Token: <admin token>
```

Refreshes nflverse game data and updates only the active-week final-score fields
in the existing upcoming cache. It does not rerun the all-algorithm forecast.
If schedule or market inputs changed, the response flags that a full rebuild is
required.

Example response:

```json
{
  "success": true,
  "source": "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
  "final_score_refresh": {
    "success": true,
    "updated_games": 1,
    "season": 2026,
    "week": 2,
    "requires_full_rebuild": false
  }
}
```

## Compatibility notes

- Legacy `/api/nfl/*` routes remain available for the website.
- Public upcoming reads are cache-first and do not trigger expensive rebuilds.
- Weekly performance grades completed games only after final scores are present in the NFL results feed, and the all-algorithm weekly table is cached by season, week, model set, thresholds, and source-game fingerprint.
- Weekly performance trends are cached by season, model, thresholds, and source-game fingerprint.
- Manual refresh/rebuild requires the admin refresh token.
- Upcoming manual matchup predictions may apply upcoming-only safeguards when the selected teams exactly match a scheduled upcoming game.
- RSM observation capture endpoints currently exist under legacy `/api/nfl/rsm-*` paths, not the `/api/v1/nfl/*` mobile contract. Add v1 aliases before exposing those workflows to an iPhone app.

## iPhone client implementation notes

Recommended first Codable model groups:

1. `NFLModelDescriptor` from `/models`.
2. `UpcomingBoardResponse`, `UpcomingGame`, and `ModelPrediction` from `/upcoming`.
3. `WeeklyPerformanceResponse` and `WeeklyModelPerformance` from `/week-performance`.
4. `PerformanceTrendResponse` and `PerformanceTrendWeek` from `/week-performance-trend`.
5. `PredictionResponse` for manual matchup predictions.

Suggested client behavior:

- Load `/models` once at app start and cache model metadata locally.
- Load `/upcoming` for the main forecast board.
- Load `/week-performance` lazily when the performance section appears.
- Load `/week-performance-trend` only after the user taps an algorithm.
- Treat `null` picks and percentages as “unavailable,” not as zero.
- Display `generated_at` and `cache_hit` where useful so users understand stale-vs-rebuilt data.
