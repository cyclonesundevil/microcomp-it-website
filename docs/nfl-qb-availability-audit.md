# NFL QB Availability Audit Workflow

The QB availability audit is semi-automated by design. It inventories every team in the upcoming week and creates review rows, but it does not automatically change predictions.

## Generate the audit

```bash
python backend/qb_availability_audit.py
```

Optional:

```bash
python backend/qb_availability_audit.py --season 2026 --week 2
```

Monday-night roster review:

```bash
python backend/qb_availability_audit.py --monday-night-only
```

To also apply approved rows into the live upcoming model overlay config:

```bash
python backend/qb_availability_audit.py --monday-night-only --apply-ready-adjustments
```

Outputs:

- `reports/nfl-qb-availability-audit.json`
- `reports/nfl-qb-availability-audit.md`

Monday-night mode writes:

- `reports/nfl-monday-night-roster-audit.json`
- `reports/nfl-monday-night-roster-audit.md`

The production workflow also calls `/api/v1/nfl/monday-night-roster-audit` on Monday afternoon before typical Monday Night Football kickoff windows. That endpoint is protected by the same `NFL_DATA_REFRESH_TOKEN` header used by the NFL data refresh job. The endpoint writes approved `overlay_ready: true` rows with nonzero deltas into `backend/config/nfl_upcoming_availability_adjustments.json`, then refreshes the upcoming prediction cache so model outputs include the adjustments.

## Review process

For each team, a human reviewer should fill or verify:

- expected starter
- current starter
- QB1 status
- QB2 status
- whether a material depth-chart change exists
- Monday-night skill-position, offensive-line, defensive-impact, and final-inactive notes
- source URL/text and timestamp
- recommended margin/total deltas, if any

Candidate rows start with zero deltas and `overlay_ready: false`. They are review inventory until a reviewer sets:

- `overlay_ready: true`
- a verified `source`
- at least one nonzero recommended delta

Only then will the Monday-night endpoint or `--apply-ready-adjustments` CLI flag upsert the row into the active model adjustment config.

## Activating an overlay

Approved records are stored in:

`backend/config/nfl_upcoming_availability_adjustments.json`

That config is the only source consumed by live upcoming predictions. Changing it invalidates the upcoming prediction cache through the availability-config fingerprint.
