# Stage 8A readiness

Stage 8A is operational capture infrastructure only. It does not grade outcomes or produce betting recommendations.

## Decision

- Frozen baseline passed: **true**
- Real prospective provider configured: **false**
- Ready for live capture: **false**
- Fixture dry-run available: **true**
- Live records written: **false**
- Ledger: **0 records; integrity true**

## Frozen baseline

- Model SHA-256: `679b088a793e0b3f56e946e3dc4c06e5d1b274827375b058bf03e85617f5b1fe`
- Rules SHA-256: `afbe5518089b3e9ed55e28063f8836b8c11c05abf509cd622deafe94717746e8`
- Anomaly-definition SHA-256: `1aeb53395566e4897dde44c72dfa47894e781687eede4b98f3f426f20b273d11`
- Feature count: 18; exact order, coefficients, intercept, scales, and thresholds are covered by the pinned artifacts.
- Historical/backfilled records: 0.

## Provider audit

| Input | Source | Authentication | Timestamp semantics | Update frequency | Historical availability | Failure behavior | Provably pre-kickoff | Configured |
|---|---|---|---|---|---|---|---|---|
| Local receipt timestamp | Stage 8A runner UTC clock | none | local receipt/compute time, stored separately from source time | each capture cycle | prospective only | naive or at/post-kickoff receipt is rejected | True | True |
| NFL schedule/kickoff and teams | backend/data/nfl_games.csv (nflverse-style repository cache) | none | kickoff present; source observation timestamp absent | manual repository refresh | 1999-2026 schedule rows | fixture/live adapter must fail if kickoff or source timestamp is absent | False | False |
| Optional live schedule display | ESPN scoreboard adapter | none | local fetched_at receipt; no provider observation timestamp contract | on demand when NFL_LIVE_PROVIDER=espn | current scoreboard only | HTTP timeout/error; never fall back to scores or completed events | local receipt only | False |
| Consensus spread | no prospective provider configured | unknown/provider-dependent | unavailable | unavailable | one untimestamped consensus line in repository schedule | capture stops; no cached/postgame fallback | False | False |
| Individual sportsbook spread and identity | no provider configured | unknown/provider-dependent | unavailable | unavailable | none | capture stops | False | False |
| Expected starters/inactives/injuries | cached nflverse roster/depth files only | none for cached public files | depth snapshots timestamped; complete live inactive timing unavailable | manual refresh | rosters 2021-2026; injuries incomplete after 2024 | lineup adapter must fail or label LOW; never infer from post-kickoff participation | False | False |
| Frozen 18 model features | no complete prospective feature adapter configured | depends on future lineup/roster sources | every component requires an as-of timestamp | unavailable | Stage 7B historical artifact only; backfill prohibited | capture stops on any missing/reordered feature | False | False |
| Fixture/mock observations | operator-supplied local JSON fixture | none | explicit timezone-aware source timestamps | test/operator controlled | not a live source | strict validation error | validated fixture semantics only | True |

## Evaluation gate

No formal outcome evaluation is permitted until one complete prospectively captured NFL regular season and at least 25 prospectively flagged candidate anomalies exist. If one season has fewer than 25 flags, collection continues unchanged into the next season. Operational audits are limited to completeness, timestamps, provider reliability, and ledger integrity; the frozen model and rules remain unchanged.

## Remaining blockers

No configured source currently supplies defensibly timestamped consensus or individual-book spreads, sportsbook identity, complete expected starters/inactives, and all 18 frozen feature inputs. Live capture therefore remains disabled by readiness policy.

## Tests performed

- `python -m pytest backend/test_rsm.py backend/test_nfl_predictor.py -q`: 75 passed.
- `python -m compileall -q backend/rsm`: passed.
- `python -m rsm stage8a-health`: healthy, read-only, zero records.

## Commands

```powershell
$env:PYTHONPATH = "backend"
python -m rsm stage8a-baseline
python -m rsm stage8a-capture --fixture path\to\prospective-fixture.json --dry-run
python -m rsm stage8a-capture --fixture path\to\prospective-fixture.json --write --game GAME_ID
python -m rsm stage8a-health
```
