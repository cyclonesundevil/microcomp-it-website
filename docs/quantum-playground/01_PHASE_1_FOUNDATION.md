# Phase 1 — Foundation / Shell

## Objective

Create the public Quantum Playground shell and one working single-particle detection experiment. Establish reusable separation between physics, state, rendering, controls, and educational copy without implementing later quantum experiments.

## Implementation summary

- Added a responsive public page titled **Quantum Playground — Break Reality**.
- Added an experiment selector covering all planned phases. Only Single Particle is live; selecting a later experiment displays its planned phase and disables emission controls.
- Added one-particle, batch, continuous run/pause, and reset controls.
- Added optional deterministic seed input. Reset reconstructs the random stream, so an identical interaction sequence produces identical detections.
- Added a Canvas detector view with an expected probability curve, aggregate observed histogram, and a bounded recent-hit trail.
- Added total-count, sample-mean, sample-spread, and random-mode readouts plus an accessible live summary.
- Added a reduced-motion-aware illustrative source pulse.
- Added concise observation, physics-scope, mathematical, and visual-model disclosures.
- Linked the experience from Demo Lab and registered it in the sitemap and shared public-page tests.
- Added desktop and mobile browser-verification screenshots.

## Physics model used

Phase 1 uses a dimensionless one-dimensional detector coordinate from `x = -1` to `x = 1`. The prepared single-particle detection distribution is

`P(x) ∝ exp[-(x - μ)² / (2σ²)]`

with defaults `μ = 0` and `σ = 0.24`. Discrete bin weights are normalized so their sum is one. A seeded pseudorandom draw is mapped through the cumulative distribution to select each detector bin.

This Gaussian intensity is presented as a pedagogical prepared-wavepacket `|ψ(x)|²`. It is a probability model, not a literal animation of a particle trajectory. The source-to-detector pulse, glow, dot jitter, and visual timing are explicitly labeled as illustrative interface choices. Detector positions, histogram counts, moments, and the expected curve are calculated.

## Architecture

- `quantum-playground-model.mjs`: pure validation, normalization, seeded PRNG, cumulative sampling, and moment functions.
- `quantum-playground.js`: experiment state, control lifecycle, Canvas rendering, live summaries, and placeholder switching.
- `quantum-playground.html`: semantic UI and educational content.
- `quantum-playground.css`: scoped responsive/theme-aware presentation.
- `quantum-playground-model.test.js`: physics and page-contract tests.

The event history uses typed aggregate counts and retains only 220 recent visual impacts, avoiding one permanent DOM node per particle.

## Files changed

### Added

- `frontend/quantum-playground.html`
- `frontend/quantum-playground.css`
- `frontend/quantum-playground.js`
- `frontend/quantum-playground-model.mjs`
- `tests/quantum-playground-model.test.js`
- `docs/quantum-playground/00_INITIAL_ASSESSMENT.md`
- `docs/quantum-playground/01_PHASE_1_FOUNDATION.md`
- `docs/quantum-playground/phase-1-desktop.png`
- `docs/quantum-playground/phase-1-mobile.png`
- `QUANTUM_PLAYGROUND_STATUS.md`

### Modified

- `frontend/demo-lab.html`
- `frontend/sitemap.xml`
- `tests/site-credibility.test.js`
- `tests/theme.test.js`

Unrelated pending branded-email files were preserved and are not part of the Phase 1 implementation.

## Tests performed

### Focused automated tests

Command:

`node --test tests/quantum-playground-model.test.js tests/theme.test.js tests/site-credibility.test.js`

Result: **16 passed, 0 failed**.

Covered:

- discrete probability normalization;
- non-negativity;
- symmetric default distribution;
- cumulative endpoint equals one;
- seeded reproducibility;
- different-seed divergence;
- 100,000-sample convergence to configured mean and spread;
- invalid physics input rejection;
- required page shell and experiment placeholders;
- reset clearing aggregate and recent state;
- physics/illustration disclosure;
- shared theme and public-page integration;
- sitemap completeness.

### Syntax checks

- `node --check frontend/quantum-playground-model.mjs` — passed.
- `node --check frontend/quantum-playground.js` — passed.
- `python -m py_compile backend/app.py` — passed.
- `git diff --check` — passed.

### Backend regression check

`python -m unittest backend.test_contact_privacy` — **5 passed, 0 failed**.

### Full Node suite

`node --test tests/*.test.js` — **191 passed, 1 failed**.

The single failure is outside Quantum Playground. `tests/homepage-agent-analytics.test.js` still expects the older contact audit status string `"delivered"`; the unrelated pending email-verification work now records `"verified_delivered"`. Quantum changes did not modify `backend/app.py` or that test. The failure is recorded rather than hidden or bypassed.

### Production build

There is no root bundler or production-build command for this static frontend. Static asset resolution, JavaScript syntax, public-page integration, and live Quart serving were used as the deployment-equivalent checks. No dependency installation was required.

## Manual verification notes

Playwright against `http://127.0.0.1:5000/quantum-playground.html` verified:

- HTTP 200;
- desktop batch emission produced 100 detections;
- mobile one-particle emission produced one detection;
- identical seeded reset-and-batch runs both produced sample mean `0.028`;
- continuous run reached 400 detections and remained at 400 after pause;
- Double Slit selection disabled live controls and showed `PREVIEW`;
- returning to Single Particle reset total detections to zero;
- keyboard Enter on **Emit one** produced one detection;
- dark, moderate, and light themes all loaded with a visible Canvas;
- no browser console or page errors.

Screenshots:

- `docs/quantum-playground/phase-1-desktop.png`
- `docs/quantum-playground/phase-1-mobile.png`

## Known limitations

- Only Single Particle is implemented; later selectors are functional placeholders.
- Detector coordinates and Gaussian width are dimensionless.
- The Gaussian is static and does not model time-dependent wavepacket evolution.
- Canvas content is summarized textually, but no automated accessibility-audit tool was run.
- Continuous mode intentionally caps each timer tick at 100 samples to keep the UI responsive.
- A pre-existing unrelated Node test remains stale after the pending contact-verification status rename.

## Bugs discovered

- The first browser-test attempt invoked a Python interpreter without Playwright. Re-running with the installed Python 3.13 Playwright environment passed; this was a harness selection issue.
- Full-suite inspection identified the unrelated stale contact analytics assertion described above.

## Decisions made

- No new dependencies.
- Canvas 2D instead of DOM-per-particle rendering.
- Pure ES-module physics functions to support later phases and direct Node testing.
- Gaussian `|ψ(x)|²` model for Phase 1, with explicit dimensionless and illustrative-model disclosures.
- Future experiment controls remain visible to establish information architecture but cannot be mistaken for implemented physics.
- No backend endpoint, telemetry, or server-side simulation.

## Next phase recommendation

Stop for owner review, as required. Before Phase 2, review:

1. the detector orientation and visual hierarchy;
2. the distinction between calculated detections and illustrative pulse animation;
3. the Gaussian model and seeded sampling tests;
4. whether the full-suite contact analytics assertion should be repaired separately.

After approval, Phase 2 should add a separately tested coherent double-slit amplitude model and statistical sampling without changing the Phase 1 engine boundaries.
