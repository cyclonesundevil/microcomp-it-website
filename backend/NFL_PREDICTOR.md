# NFL Predictor

This is a first-pass NFL spread and over/under predictor built from nflverse historical schedule data.

## Data

The script downloads `games.csv` from nflverse and caches it locally in `backend/data/`. The cache is intentionally ignored by git.

The dataset includes regular-season scores, teams, rest days, closing spread lines, and closing total lines. The model only grades games with a final score, spread line, and total line.

The website API automatically refreshes the nflverse cache when it gets stale. The default cache TTL is 6 hours and can be changed with:

```powershell
$env:NFL_GAMES_CACHE_TTL_SECONDS="21600"
```

During the season, this makes the public dashboard suitable for post-game/current-season updates as nflverse publishes new final-score data. It is not an in-game feed; games without final scores are excluded from model training.

## Model

`nfl_predictor.py` uses an online team-rating model:

- margin rating for each team
- offensive points tendency
- defensive points allowed tendency
- home-field adjustment
- rest-days adjustment
- league scoring baseline

Before each game, the model predicts:

- expected home margin
- expected game total
- spread side when the model edge is large enough
- over/under side when the model edge is large enough

After each game, the model updates team ratings using only information that would have been available after that game. This keeps the backtest chronological and avoids looking ahead.

## Commands

Run the standard 5-year and 10-year backtest:

```powershell
cd backend
.\venv\Scripts\python.exe nfl_predictor.py
```

Run the detailed report and export the 10-year prediction rows:

```powershell
cd backend
.\venv\Scripts\python.exe nfl_predictor.py --by-season --sweep --export data\nfl_backtest_10y.csv
```

Compare the default baseline profile against the experimental enhanced profile:

```powershell
cd backend
.\venv\Scripts\python.exe nfl_predictor.py --compare-models
```

Refresh the source data:

```powershell
cd backend
.\venv\Scripts\python.exe nfl_predictor.py --refresh
```

Force-refresh the website API cache from a browser or script:

```text
/api/nfl/backtest?seasons=10&model=baseline&refresh=true
```

## Production Tuesday refresh

Production refreshes the nflverse feed every Tuesday at 6:00 AM America/Phoenix
(13:00 UTC) through `.github/workflows/nfl-data-refresh.yml`. The scheduler calls
the production web service so the data is replaced in that service's own cache.
The download is validated and atomically installed; a malformed response leaves
the previous cache intact, and overlapping refreshes are rejected.

Configure the same random value in both secret stores:

- Render web-service environment variable: `NFL_DATA_REFRESH_TOKEN`
- GitHub repository Actions secret: `NFL_DATA_REFRESH_TOKEN`

The default production endpoint is `https://www.microcompit.com/api/nfl/refresh`.
Set the GitHub Actions repository variable `NFL_REFRESH_URL` only if the public
production URL changes. The workflow can also be run manually from Actions.

## Upcoming Week cache behavior

The Upcoming Week: All Algorithms board uses a separate persistent cache
(`NFL_UPCOMING_CACHE_DIR`/`NFL_UPCOMING_CACHE_TTL_SECONDS`, or the backend data
directory by default). NFL week rollover is resolved at Tuesday 6:00 AM
America/Phoenix using `NFL_WEEK_ROLLOVER_TIMEZONE` and `NFL_WEEK_ROLLOVER_HOUR`.

On app startup the service attempts to warm the upcoming board immediately, then
aligns the recurring background refresh to the next configured rollover time
rather than simply sleeping 24 hours from process start.

If a cached board is still for the previous week after rollover, the API keeps
serving that last valid board with a cache-target warning while it schedules a
background rebuild for the current upcoming week. This avoids clearing the page
while the expensive all-algorithm forecast is being regenerated.

The upcoming board intentionally displays the full active football week from
Tuesday rollover until the next Tuesday rollover. Completed games from that
active week remain visible with final-score context instead of disappearing
from the table after they are played.

Daily scheduled upcoming refreshes fetch a fresh nflverse games file and then
force-rebuild the active-week board. As final scores are published after
Thursday, Sunday, and Monday games, the next refresh can add those finals to the
same active-week table. After the Tuesday 6:00 AM America/Phoenix rollover, the
board switches to the next NFL week and new final-score cells start blank again.

## Website Demo

The website exposes a demo page at:

```text
/nfl-predictor.html
```

The page calls:

```text
/api/nfl/backtest?seasons=10&model=baseline
```

Backtest summaries and season breakdowns are persisted in the configured backtest
cache directory (`NFL_BACKTEST_CACHE_DIR`, or the backend data directory by
default). The cache key includes the model, season window, thresholds, and the
graded game inputs, so a refreshed or changed games feed automatically produces
a new result. API responses include `backtest_cache_hit`.

The `market_blend` profile now reports total-market backtest results as well as
spread results. Its total projection deliberately blends the model estimate with
the published market total, so those O/U results are market-informed and should
not be interpreted as an independent market-beating signal.

It also supports all-team matchup projections:

```text
/api/nfl/teams
/api/nfl/predict?away_team=KC&home_team=PHI&spread_line=0&total_line=44.5&model=baseline
/api/nfl/live
```

Supported query values:

- `seasons`: `5` or `10`
- `model`: `baseline`, `enhanced`, `market_blend`, `rothstein`, or `rothstein_plus`
- `spread_line`: home-team spread line, where negative means the home team is favored
- `total_line`: market over/under line

## Live Data

The model continues to use nflverse as the canonical historical and current-season training source.

An optional live scoreboard adapter is available for display/status purposes:

```powershell
$env:NFL_LIVE_PROVIDER="espn"
```

When enabled, `/api/nfl/live` fetches the current ESPN scoreboard and returns live/upcoming/completed game status. This adapter does not feed odds, injuries, or in-game state into the prediction model. Keep `NFL_LIVE_PROVIDER` unset or set to `off` for the stable default demo.

Recommended source split:

- nflverse: model training, historical scores, schedules, closing lines, post-game updates
- ESPN/live scoreboard adapter: current live score/status display
- paid or contracted odds/injury provider: current spreads, totals, depth chart changes, and injury status

## Rothstein Algorithm

The Rothstein profile uses same-season rolling team scoring averages:

- `pf1`: team 1 rolling points for
- `pa1`: team 1 rolling points against
- `pf2`: team 2 rolling points for
- `pa2`: team 2 rolling points against

For a matchup:

```text
T1outcome = (pf1 + pa2) / 2
T2outcome = (pf2 + pa1) / 2
RothSpread = home outcome - away outcome
RothTotal = home outcome + away outcome
```

Spread picks are made when the model spread differs from the published spread by more than 2 points. Total picks are made when `RothTotal` differs from the published total by more than 4 points.

Before a team has played in the current season, the model seeds its rolling scoring averages with the current league scoring average.

## Current Baseline Results

These rolling windows include all graded games available through September 10, 2026 (2026 Week 1). During an active season, the current partial season is included in the window.

With the conservative default spread threshold of 6 points:

- 5-year spread picks: 54.5%
- 10-year spread picks: 58.4%
- 5-year totals picks: 51.0%
- 10-year totals picks: 49.8%

The baseline model shows useful separation on spreads when it strongly disagrees with the market. Totals need more work before they should be treated as a meaningful signal.

The enhanced model currently exists for research comparison. Its weather, venue, recent-form, and divisional features slightly reduced margin error, but did not improve spread-pick performance, so the public demo defaults to `baseline`.

The current baseline keeps the model simple, lowers rest-day influence, updates team margin ratings faster, and only issues spread picks when the model differs from the line by at least 6 points.

## Market Blend

Market Blend averages the chronological baseline projection with the closing market's expected margin. Its 3-point pick threshold is equivalent to the baseline's conservative 6-point disagreement threshold, so it preserves the same historical spread selections while producing less extreme score projections. Totals picks are disabled because the available total signal has not cleared the standard -110 break-even rate.

On the current dataset:

- 5-year margin MAE: 9.73 points, versus 10.23 for baseline
- 10-year margin MAE: 10.04 points, versus 10.47 for baseline
- 5-year spread picks: 54.5%
- 10-year spread picks: 58.4%

Backtest summaries also report a 95% Wilson confidence interval and hypothetical flat-stake ROI at -110 odds. These are research diagnostics, not a profitability guarantee.

First Rothstein results with the specified 2-point spread and 4-point total thresholds:

- 5-year spread picks: 48.6%
- 10-year spread picks: 48.6%
- 5-year totals picks: 46.0%
- 10-year totals picks: 46.4%

## Rothstein+

Rothstein+ keeps the same Rothstein scoring formula but adds two filters that improved the historical spread signal:

- only consider matchups where both teams have played 8 or 9 games entering the game
- skip games where either team's current starting quarterback does not match its recent primary quarterback

Rothstein+ is treated as a spread-only model. The totals signal did not improve enough to include.

First Rothstein+ results:

- 5-year spread picks: 64.4%
- 10-year spread picks: 61.6%

## Next Steps

Good next improvements:

- add postseason and current-season prediction modes
- add quarterback availability/injury inputs
- add recent-form weighting by last 4 games
- split home/away team strength
- add weather and dome/outdoor flags for totals
- expose a website demo page once the backend model is stable
