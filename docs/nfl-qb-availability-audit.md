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

Outputs:

- `reports/nfl-qb-availability-audit.json`
- `reports/nfl-qb-availability-audit.md`

## Review process

For each team, a human reviewer should fill or verify:

- expected starter
- current starter
- QB1 status
- QB2 status
- whether a material depth-chart change exists
- source URL/text and timestamp
- recommended margin/total deltas, if any

Candidate rows start with zero deltas and `overlay_ready: false`. They are review inventory, not active model inputs.

## Activating an overlay

Only manually approved records should be copied into:

`backend/config/nfl_upcoming_availability_adjustments.json`

That config is the only source consumed by live upcoming predictions. Changing it invalidates the upcoming prediction cache through the availability-config fingerprint.
