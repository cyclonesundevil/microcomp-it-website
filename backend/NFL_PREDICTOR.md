# NFL Predictor

This is a first-pass NFL spread and over/under predictor built from nflverse historical schedule data.

## Data

The script downloads `games.csv` from nflverse and caches it locally in `backend/data/`. The cache is intentionally ignored by git.

The dataset includes regular-season scores, teams, rest days, closing spread lines, and closing total lines. The model only grades games with a final score, spread line, and total line.

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

## Website Demo

The website exposes a demo page at:

```text
/nfl-predictor.html
```

The page calls:

```text
/api/nfl/backtest?seasons=10&model=baseline
```

It also supports all-team matchup projections:

```text
/api/nfl/teams
/api/nfl/predict?away_team=KC&home_team=PHI&spread_line=0&total_line=44.5&model=baseline
```

Supported query values:

- `seasons`: `5` or `10`
- `model`: `baseline`, `enhanced`, `rothstein`, or `rothstein_plus`
- `spread_line`: home-team spread line, where negative means the home team is favored
- `total_line`: market over/under line

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

With the conservative default spread threshold of 6 points:

- 5-year spread picks: 56.8%
- 10-year spread picks: 58.3%
- 5-year totals picks: 50.9%
- 10-year totals picks: 49.6%

The baseline model shows useful separation on spreads when it strongly disagrees with the market. Totals need more work before they should be treated as a meaningful signal.

The enhanced model currently exists for research comparison. Its weather, venue, recent-form, and divisional features slightly reduced margin error, but did not improve spread-pick performance, so the public demo defaults to `baseline`.

The current baseline keeps the model simple, lowers rest-day influence, updates team margin ratings faster, and only issues spread picks when the model differs from the line by at least 6 points.

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
