# Stage 8B public-source readiness

Frozen baseline: **passed**. Genuine prospective writes ready: **false**. Live ledger writes: **0**.

| Source | Accessible | Access policy | Fields | Timestamp quality | Sportsbook ID | Player-ID coverage | Update frequency | Parser confidence | Role |
|---|---|---|---|---|---|---|---|---|---|
| nflverse | True | public GitHub releases/downloads | schedule, GSIS IDs, rosters, depth snapshots, prior stats, prior snaps | release metadata plus retrieval; depth snapshot where supplied | not used for prospective lines | GSIS primary | daily rosters; pipeline-dependent releases | HIGH | REQUIRED |
| Sleeper | True | documented unauthenticated read-only API; noncommercial; players at most daily | active/injury status, depth order, fantasy positions, public IDs | RETRIEVAL_TIMESTAMP_ONLY | none | 20.40% of active/team/position records by explicit Sleeper ID | cached at least 24 hours | HIGH | SUPPLEMENTAL |
| ESPN | public endpoint observed; disabled by default | unofficial/contract uncertain; stop on blocking | schedule, pregame displayed spread when identifiable | provider time if present, else retrieval only | required from provider.name | crosswalk required | fixture validation only until access is approved | MEDIUM | OPTIONAL |
| Yahoo | False | BLOCKED_POLICY: automated collection requires express permission | redacted fixture parser only | not collected live | not collected live | fixture crosswalk only | none | FIXTURE_ONLY | SUPPLEMENTAL |
| NFL.com | False | CORROBORATION_ONLY until an expressly permitted public feed is identified | official injury-report fixture evidence | report date plus retrieval when permitted | none | GSIS crosswalk required | none automated | NOT_ENABLED | SUPPLEMENTAL |

## Readiness gates

- frozen pins: **true**
- kickoff verified: **false**
- identifiable spread: **false**
- all 18 features constructed: **false**
- crosswalk threshold passed: **false**
- prospective timestamps passed: **false**

## Public retrieval evidence

- nflverse: CACHED
- nflverse: CACHED_PUBLIC_RESPONSE, retrieved `2026-09-12T21:59:32.470536Z`, sha256 `774052e34cedf782c168e696d95e5a6870539d446af10859e75241e2e6dc950a`
- sleeper: CACHED_PUBLIC_RESPONSE, retrieved `2026-09-12T21:59:33.280215Z`, sha256 `3ba1c19b909b14a3766f7d7983ffc532b2598ef872ff695e9e6525cfc703262d`

## Explicit ID crosswalk

- Source: sleeper
- Population: 2676
- Matched by explicit ID/GSIS claim: 546
- Ambiguous: 0
- Unmatched: 2130
- Overall coverage: 20.40%
- Required threshold: 95.00%
- Passed: false
- Names auto-matched: false

## Decision

nflverse and Sleeper are the permitted public integration paths. ESPN is optional and disabled by default because its JSON interface is unofficial and contract status is uncertain. Yahoo live automation is policy-blocked; NFL.com remains manual/corroborative until an expressly permitted feed is identified. No source may be replaced with fabricated data.

The current layer cannot safely construct every frozen feature or demonstrate required crosswalk/market/timestamp gates, so genuine prospective writes remain disabled. Fixture rehearsals must use a separate ledger.

## Verification commands

- `python -m pytest backend/test_rsm_stage8b.py backend/test_rsm.py backend/test_nfl_predictor.py -q`
- `python -m compileall -q backend/rsm`
- `python -m rsm stage8a-baseline`
- `python -m rsm stage8b-source-audit`
- `python -m rsm stage8b-health`
