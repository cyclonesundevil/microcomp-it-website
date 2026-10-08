# Pregame Edge Ledger

Experimental research surface only. The pregame ledger does not alter production picks, model math, Market Blend, CS Matrix, RSM, or RSM+.

## What It Records

The ledger stores durable snapshots of what the predictor knew before kickoff:

- game, season, week, teams, and scheduled time
- model name
- market type: `ATS` or `OU`
- captured market line
- model projection
- model edge versus the captured market line
- model pick
- threshold
- roster overlay/context metadata
- optional Kalshi context when available
- source view and observed timestamp

Snapshots are deduplicated by season, week, game, model, market type, and observation timestamp. They are stored locally under the experimental cache/data directory.

## Grading

ATS grading is market-actionable. The model pick is created by comparing model margin expectation against the captured market spread, and the final score grades whether that pick beat the captured market spread.

Example:

- model says favorite by 5.5
- market says favorite by 9
- final margin is favorite by 7

The model side is the underdog against the market, and that pick wins because the underdog covered +9. This is separate from projection accuracy.

O/U grading works the same way: the model total pick is graded against the captured market total, using the final total score.

## Projection Error

Projection error is stored separately:

- `margin_error`: final margin minus model margin projection
- `total_error`: final total minus model total projection

These fields measure forecast accuracy, not betting-result grading.

## Edge Buckets

The analysis groups rows into edge-size buckets:

- `0 to 1`
- `1 to 2`
- `2 to 3`
- `3+`

For each model, market, and bucket, the report returns bets, wins, losses, pushes, win rate, estimated ROI at -110, average edge, average projection error, and average minutes to kickoff.

## Agreement Groups

The report also analyzes model-agreement groups:

- CS Matrix + RSM
- RSM + RSM+
- CS Matrix + RSM + RSM+

Agreement is counted only when all models in the group produce the same side for the same game and market.

## Closing Line Value

If later snapshots exist for the same game and market, the latest captured line is treated as the closing-line proxy. CLV is computed relative to the model pick. If no later line exists, CLV fields remain null.

Do not interpret CLV as complete until a true pre-kickoff close line feed is available.

## API

```text
GET /api/nfl/experimental/pregame-ledger
GET /api/nfl/experimental/edge-quality
POST /api/nfl/experimental/pregame-ledger/snapshot
```

All endpoints require the existing admin secret. The snapshot endpoint creates ledger rows from the current Upcoming Week board.

## Limitations

Small samples are noisy. Edge buckets and agreement groups should be treated as research diagnostics until they accumulate enough graded rows across multiple weeks and line conditions.
