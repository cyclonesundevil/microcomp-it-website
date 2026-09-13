# Stage 8 Prospective Shadow Observation Contract

## Purpose

Stage 8 is a research-only, prospective observation system. It records the frozen Stage 7C roster fair margin beside timestamped sportsbook spread observations, lineup confidence, deterministic explanations, candidate-anomaly status, and later pre-kickoff line movement.

It does not generate betting recommendations, suggest stake sizes, place wagers, evaluate totals, ingest outcomes, or retune any model component.

## Frozen inputs

Runtime hash checks pin:

- the Stage 7B roster-only Model A coefficients, feature order, standardization values, ridge alpha, and 2021-2022 fitting period;
- the Stage 7C anomaly-score definition and confidence weights;
- the Stage 7C top-20%, top-10%, and top-5% development thresholds.

Capture fails closed if any pinned artifact changes. Stage 8 never reads Stage 7C validation results except to extract and verify the separately hashed frozen rule and anomaly-definition objects. No 2023-2025 outcome field exists in the capture or ledger schema.

## Observation JSON

Every timestamp must be ISO-8601 and timezone-aware. Prediction receipt, model features, lineup information, and the market observation must all be strictly before scheduled kickoff.

```json
{
  "game_id": "2026_03_EXAMPLE",
  "season": 2026,
  "week": 3,
  "kickoff": "2026-09-24T20:15:00-04:00",
  "prediction_timestamp": "2026-09-24T16:05:00-04:00",
  "away_team": "AWAY",
  "home_team": "HOME",
  "schedule_source": "schedule source identifier",
  "schedule_observed_at": "2026-09-24T12:00:00-04:00",
  "features_as_of": "2026-09-24T16:00:00-04:00",
  "features_source": "feature source identifier",
  "features": {
    "qb_quality_diff": 0.0,
    "qb_vs_pass_rush_matchup": 0.0,
    "qb_vs_coverage_matchup": 0.0,
    "ol_pass_vs_pass_rush_matchup": 0.0,
    "ol_run_vs_front_matchup": 0.0,
    "receiving_vs_secondary_matchup": 0.0,
    "rushing_vs_front_matchup": 0.0,
    "ol_weakest_diff": 0.0,
    "ol_strongest_diff": 0.0,
    "ol_continuity_diff": 0.0,
    "ol_replacement_starters_diff": 0.0,
    "wr1_diff": 0.0,
    "wr2_diff": 0.0,
    "te1_diff": 0.0,
    "receiver_replacements_diff": 0.0,
    "pass_rusher1_diff": 0.0,
    "weakest_coverage_diff": 0.0,
    "rest_diff": 0.0
  },
  "lineup": {
    "confidence": "HIGH",
    "as_of": "2026-09-24T15:55:00-04:00",
    "source": "source identifier",
    "expected_starters": [],
    "inactive_or_injured": []
  },
  "market": {
    "sportsbook": "book identifier",
    "retrieved_timestamp": "2026-09-24T16:04:00-04:00",
    "line_type": "SPREAD",
    "line_stage": "CURRENT",
    "market_kind": "INDIVIDUAL_BOOK",
    "spread": -3.0,
    "spread_convention": "HOME_SPREAD",
    "home_price": -110,
    "away_price": -110,
    "source": "source identifier"
  }
}
```

`HOME_SPREAD` is conventional sportsbook notation, so Home -3 becomes an internal expected home margin of +3. `HOME_MARGIN` may be used when the source already supplies positive values for home favoritism.

`market_kind` may be `INDIVIDUAL_BOOK`, provider-published `CONSENSUS`, or explicitly computed `DERIVED_CONSENSUS`. Derived consensus observations must use sportsbook `DERIVED_CONSENSUS` and remain separate from any provider-published consensus label.

The feature object must contain exactly the frozen feature set. Extra, missing, or nonnumeric features are rejected. Outcome, result, betting, wager, stake, and recommendation fields are rejected.

## Commands

From the repository root with `backend` on `PYTHONPATH`:

```powershell
$env:PYTHONPATH = "backend"
python -m rsm stage8-shadow-init
python -m rsm stage8-shadow-capture path/to/observation.json
python -m rsm stage8-shadow-status
```

The default runtime ledger is `backend/data/rsm/shadow/stage8-shadow.sqlite3`. That runtime data directory is intentionally ignored by Git. A different ledger can be selected with `--store PATH`.

## Append-only and movement behavior

Each accepted observation stores its raw-payload hash, frozen configuration hashes, computed fair margin, market disagreement, anomaly score, rule-qualified candidate-anomaly label, lineup provenance, and three deterministic explanation fields. Records form a SHA-256 hash chain. SQLite triggers reject updates and deletes.

Capture another observation for the same game and sportsbook to record subsequent movement. Status reporting compares the later market-implied home margin with the first captured fair margin and labels movement `TOWARD_MODEL`, `AWAY_FROM_MODEL`, or `UNCHANGED`. This is descriptive movement, not closing-line value and not a betting recommendation.

## Operational boundary

No network poller, scheduler, production API, user-facing prediction route, alert, or wagering integration is included. A future data adapter may submit observations only through the same validation and append-only capture boundary.
