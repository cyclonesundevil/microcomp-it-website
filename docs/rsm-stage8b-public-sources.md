# Stage 8B public-source integration

Stage 8B adds a research-only public-source adapter layer around the Stage 8/8A shadow capture contract. It freezes the Stage 7C model, coefficients, 18-feature set, anomaly score, and thresholds. It does not retrain, backfill observations, inspect outcomes, expose predictions through production APIs, activate a scheduler, or generate betting recommendations.

## Enabled sources

- nflverse: required source for schedules, GSIS identity, rosters, depth-chart snapshots, prior stats, and prior snaps. Access is through public GitHub/download artifacts described by the nflverse project.
- Sleeper: supplemental source for public player status, injury-status text, depth-chart fields, and public IDs. Access uses the documented unauthenticated read-only API and is cached at least once per 24 hours.

Only nflverse and Sleeper are contacted by `stage8b-live-dry-run`. Both responses are archived under the ignored shadow-data directory with retrieval timestamp, raw SHA-256, and cache metadata. Retrieval time is never relabeled as publisher time.

## Disabled or fixture-only sources

- ESPN: a parser exists for redacted scoreboard fixtures and rejects live, post-kickoff, alternate, unidentified-book, and conflicting spread rows. The live endpoint is disabled by default because its JSON interface is unofficial and contract status is uncertain.
- Yahoo: live automation is disabled because Yahoo terms require express permission for automated collection. Only a redacted fixture parser is included.
- NFL.com: official injury evidence is represented by a redacted fixture parser only. No live NFL.com injury feed is enabled until an expressly permitted automatable feed is identified.

## Market-line policy

Stage 8B accepts full-game pregame spread rows only. It rejects totals, props, completed games, live games, alternate lines, unidentified sportsbooks, and conflicting home/away spreads. If at least two identifiable individual-book spreads for the same game are available, the adapter can deterministically compute a median `DERIVED_CONSENSUS` row. Derived consensus is explicitly labeled and is never conflated with a provider-published consensus.

## Identity and lineup policy

GSIS remains the primary player identity. Crosswalks use explicit ID fields and accepted public GSIS claims only when the claimed GSIS exists in nflverse. Player names are review candidates only and are not auto-matched. Missing injury status is treated as `UNKNOWN`, never as healthy.

Current Sleeper-to-GSIS coverage from the cached public response is below the required 95% threshold, so player-source readiness fails closed.

## Commands

Run from the repository root in PowerShell:

```powershell
$env:PYTHONPATH = "backend"
python -m rsm stage8b-source-audit
python -m rsm stage8b-live-dry-run
python -m rsm stage8b-health
python -m rsm stage8b-readiness
python -m rsm stage8b-rehearsal --fixture path\to\stage8a-fixture.json --store backend\data\rsm\shadow\stage8b-rehearsal.sqlite3 --game GAME_ID
```

`stage8b-source-audit`, `stage8b-health`, and `stage8b-readiness` are read-only with respect to the production shadow ledger. `stage8b-live-dry-run` fetches only permitted public endpoints and writes no ledger records. `stage8b-rehearsal` requires a non-default ledger path and is fixture-only.

## Current readiness

Prospective capture is not operational. Frozen pins and ledger integrity pass, but the system still lacks a complete public path for all 18 frozen features, defensibly timestamped identifiable market spreads, full pre-kickoff lineup/inactive confidence, and an explicit player crosswalk meeting the configured threshold. The deployed code is infrastructure only; no scheduler, production API route, UI exposure, or automated wagering is enabled.
