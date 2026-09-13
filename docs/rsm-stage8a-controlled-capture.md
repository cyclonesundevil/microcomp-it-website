# Stage 8A controlled prospective capture

## Scope and readiness

Stage 8A adds a CLI-only, research-shadow capture boundary around the frozen Stage 7B model and Stage 7C anomaly rules. It does not ingest results, grade predictions, calculate ATS/ROI, produce recommendations, expose an API/UI route, or activate a scheduler.

All three frozen pins pass:

- Stage 7B model: `679b088a793e0b3f56e946e3dc4c06e5d1b274827375b058bf03e85617f5b1fe`
- Stage 7C rules: `afbe5518089b3e9ed55e28063f8836b8c11c05abf509cd622deafe94717746e8`
- Anomaly definition: `1aeb53395566e4897dde44c72dfa47894e781687eede4b98f3f426f20b273d11`

The pinned model has exactly 18 features in its recorded order, ridge alpha 100, intercept `1.8453038674033149`, and thresholds `4.683393757922371`, `6.423059479366703`, and `7.44034078378945`. The generated machine-readable result is `reports/rsm-stage8a-baseline-verification.json`.

No real prospective provider is configured. The repository schedule cache lacks a source-observation timestamp; the optional ESPN display adapter has only a local receipt time; no defensibly timestamped consensus or individual-book feed exists; complete prospective starters/inactives and all 18 feature inputs are unavailable. Consequently the system is ready for fixture rehearsal, not live capture. No live record was written.

## Provider contracts

`backend/rsm/stage8a_capture.py` separates four provider interfaces: schedule, spread market, lineup/roster, and frozen-feature observations. The included `FixtureProvider` is offline test infrastructure, not a live-data substitute.

Every accepted capture must satisfy these rules:

- Team identifiers are normalized with the repository's deterministic NFL mapping.
- Kickoff, source observation, model-feature, lineup, market-retrieval, prediction, and local-receipt timestamps are timezone-aware and normalized to UTC.
- Provider/source timestamps are preserved separately from the local receipt timestamp.
- The immutable lineup snapshot preserves lineup confidence, source/as-of time, expected-starter entries, and inactive/injury entries; an unavailable live feed must fail instead of reconstructing these from postgame participation.
- Source inputs must be known by prediction time; prediction and local receipt must both be strictly before kickoff.
- The runner enforces a configurable minimum lead time and never falls back to post-kickoff or completed-game data.
- The market convention must explicitly be `HOME_SPREAD` or `HOME_MARGIN`. A home spread is negated to obtain market-implied home margin. Any other or missing convention is rejected.
- `CONSENSUS` observations must use sportsbook `CONSENSUS`. `INDIVIDUAL_BOOK` requires a non-consensus sportsbook identifier. These categories are never conflated.
- Only spread fields cross the adapter boundary. Totals, wager/stake fields, recommendations, and outcomes are discarded by the provider payload builder and prohibited by the ledger contract.
- Frozen feature names and ordering must exactly match all 18 recorded features. Missing, extra, or reordered values fail closed.

The fixture top level is exactly `{"provider":"fixture","games":[...]}`. Each game contains `schedule`, `markets`, `lineup`, and `features`; the schedule carries `source_observed_at`, each market carries `retrieved_timestamp`, and lineup/features carry `as_of`. A fixture cycle may contain one retrieval event per `(market_kind, sportsbook)`; update the fixture timestamps/values for a later retrieval cycle.

## Commands

Run from the repository root in PowerShell:

```powershell
$env:PYTHONPATH = "backend"
python -m rsm stage8a-baseline
python -m rsm stage8a-capture --fixture path\to\prospective-fixture.json --dry-run
python -m rsm stage8a-capture --fixture path\to\prospective-fixture.json --dry-run --game 2026_02_KC_LV
python -m rsm stage8a-capture --fixture path\to\prospective-fixture.json --write --game 2026_02_KC_LV
python -m rsm stage8a-health
python -m rsm stage8a-health --fixture path\to\prospective-fixture.json
python -m rsm stage8a-readiness
```

`--dry-run` never creates or writes the ledger. `--write` currently records only explicitly supplied fixture data; it is not a live-capture command and should use an isolated rehearsal store. There is no live-provider capture command until a provider passes the documented audit. `--observed-at` is permitted only for deterministic fixture dry-runs and is rejected with `--write`; writes always use the actual current UTC clock.

Successful output is structured JSON. Baseline failure exits 2, an unsuccessful completed capture cycle exits 3, unhealthy status exits 4, and validation/provider/lock exceptions exit nonzero. Capture events are JSON Lines.

## Configuration and scheduling example

Supported environment variables contain paths and operational settings only:

- `RSM_STAGE8A_STORE` (default `backend/data/rsm/shadow/stage8-shadow.sqlite3`)
- `RSM_STAGE8A_LOG` (default `backend/data/rsm/shadow/stage8a-capture.jsonl`)
- `RSM_STAGE8A_STATE` (default `backend/data/rsm/shadow/stage8a-operational-state.json`)
- `RSM_STAGE8A_LOCK` (default `backend/data/rsm/shadow/stage8a-capture.lock`)
- `RSM_STAGE8A_TIMEOUT_SECONDS` (default 10)
- `RSM_STAGE8A_MAX_ATTEMPTS` (default 3; hard maximum 5)
- `RSM_STAGE8A_BACKOFF_SECONDS` (default 0.25, exponential)
- `RSM_STAGE8A_HORIZON_HOURS` (default 30)
- `RSM_STAGE8A_MINIMUM_LEAD_MINUTES` (default 5)
- `RSM_STAGE8A_STALE_LOCK_SECONDS` (default 900)

Future provider credentials must be supplied through provider-specific environment variables and must never enter fixtures, logs, reports, or source control. No such credential variables are currently implemented because no live provider is selected.

A scheduler-safe local command template is:

```powershell
powershell.exe -NoProfile -NonInteractive -Command "Set-Location 'C:\path\to\repository'; `$env:PYTHONPATH='backend'; python -m rsm stage8a-capture --fixture 'C:\protected\prospective-fixture.json' --dry-run"
```

This is an example only; Stage 8A does not register or activate it. Once a genuine provider exists, schedule provider retrievals around 24 hours, 6 hours, 90 minutes, and 30 minutes before kickoff. A 15-minute polling cadence with provider-side snapshot selection can support those windows. Every snapshot remains subject to strict pre-kickoff and minimum-lead checks. Maximum acceptable scheduler lateness is five minutes relative to a target snapshot; a late cycle must wait for the next valid target rather than relabel its observation.

The exclusive lock prevents overlapping cycles. A lock younger than 15 minutes rejects the new run; an older lock is considered stale and recoverable. SQLite transactions prevent partial observation rows. Each append is immediately followed by hash-chain verification. Provider calls use bounded exponential retries and never substitute stale, historical, or postgame inputs.

## Idempotency and line movement

The deterministic observation ID hashes the normalized complete source retrieval payload except `prediction_timestamp`. Local receipt/retry time is not part of the identity.

- The same game, market retrieval timestamp/value/source/book, lineup snapshot, and feature snapshot is an exact retry. It returns the original ledger event as an explicit duplicate no-op and does not append.
- A changed source retrieval timestamp, spread, source, sportsbook, lineup snapshot, or feature snapshot represents a new retrieval event and appends a new immutable row.
- Rows are never updated or deleted. Database triggers enforce append-only behavior.
- Multiple accepted rows for a game/book preserve line movement relative to the first captured frozen-model margin. Closing-line value is not calculated.

## Read-only health

`stage8a-health` does not initialize the database, update state, or write reports. It returns ledger validity/count, earliest/latest timestamps, upcoming fixture games, missing market/lineup captures, late/malformed rejection counters, provider failures, duplicate attempts, source/book/window counts, candidate-anomaly count, provider health, and frozen-baseline status. It intentionally contains no results, win rate, ATS, ROI, or financial statistics.

## Predeclared evaluation gate

Formal outcome evaluation is forbidden before one complete NFL regular season of prospective capture and at least 25 prospectively flagged candidate anomalies. If a complete season produces fewer than 25 flags, collection continues unchanged into the next season. Operational audits may inspect only completeness, timestamps, provider reliability, and ledger integrity. They may not inspect outcomes or alter thresholds, coefficients, features, anomaly scoring, or explanation rules during collection. The same gate is stored in `reports/rsm-stage8a-readiness.json`.

## Verification and unresolved risks

The offline suite covers frozen mismatch and feature-order failures; timezone/source/receipt/kickoff rules; spread signs and ambiguous conventions; consensus/book identity; exact duplicates and later observations; line preservation; deterministic IDs; append-only/hash integrity; failed-write recovery; concurrency locking; dry-run isolation; retry bounds; health read-only behavior; prohibited totals/wager/outcome fields; and absence from production API/UI.

The principal blocker is data provenance, not runner logic. A future live adapter must demonstrate licensed/allowed access, provider observation semantics, reliable update cadence, stable sportsbook identity, complete pregame lineup/inactive coverage, and point-in-time construction of all frozen features. Until then `ready_for_live_capture` remains false.
