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
- `model`: `baseline` or `enhanced`
- `spread_line`: home-team spread line, where negative means the home team is favored
- `total_line`: market over/under line

## Current Baseline Results

With the conservative default spread threshold of 6 points:

- 5-year spread picks: 56.8%
- 10-year spread picks: 58.3%
- 5-year totals picks: 50.9%
- 10-year totals picks: 49.6%

The baseline model shows useful separation on spreads when it strongly disagrees with the market. Totals need more work before they should be treated as a meaningful signal.

The enhanced model currently exists for research comparison. Its weather, venue, recent-form, and divisional features slightly reduced margin error, but did not improve spread-pick performance, so the public demo defaults to `baseline`.

The current baseline keeps the model simple, lowers rest-day influence, updates team margin ratings faster, and only issues spread picks when the model differs from the line by at least 6 points.

## Next Steps

Good next improvements:

- add postseason and current-season prediction modes
- add quarterback availability/injury inputs
- add recent-form weighting by last 4 games
- split home/away team strength
- add weather and dome/outdoor flags for totals
- expose a website demo page once the backend model is stable
