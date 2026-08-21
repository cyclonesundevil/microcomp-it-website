# Phase 5 — Quantum Eraser

## Objective

Demonstrate conditional interference from orthogonal path markers measured in a path-hiding basis, while preserving a non-interfering unsorted detector marginal. Every event must be sampled as one calculated joint marker/detector outcome, with no detector position generated first and labeled afterward.

## Implementation summary

- Made Quantum Eraser a live experiment in the shared Quantum Playground shell.
- Added three views over one sampled ensemble: **All events**, **Marker +**, and **Marker −**.
- Added branch counts so the conditioned subsets visibly retain their actual share of the full ensemble.
- Added a globally normalized joint distribution over `(x,+)` and `(x,−)`.
- Added a dedicated joint cumulative sampler whose one random draw selects both marker outcome and detector bin.
- Derived separately normalized conditional curves for educational comparison while retaining joint branch probabilities as the authoritative internal representation.
- Reused the complex Fraunhofer slit amplitudes, physical geometry controls, seeded random architecture, aggregate Canvas renderer, and bounded recent-event history.
- View switching sorts the same compatible joint ensemble without resetting or fabricating events. Geometry or experiment changes clear incompatible accumulated state.
- Added explicit non-retrocausal, no-signaling, and path-hiding-basis education.

## Physics model used

The initial state uses orthogonal path markers:

`|Ψ⟩ = [ψ₁(x)|M₁⟩ + ψ₂(x)|M₂⟩] / sqrt(2)`

with `⟨M₁|M₂⟩ = 0`. The eraser basis is

`|+⟩ = (|M₁⟩ + |M₂⟩) / sqrt(2)`

`|−⟩ = (|M₁⟩ − |M₂⟩) / sqrt(2)`.

Projecting the joint state gives raw joint detector weights

`w(x,+) = |ψ₁(x) + ψ₂(x)|² / 4`

`w(x,−) = |ψ₁(x) − ψ₂(x)|² / 4`.

The factor `1/4` contains both the initial path factor and marker-basis projection. The `+` and `−` arrays are concatenated and normalized once over the full joint sample space. Thus

`P(x) = P(x,+) + P(x,−)`

is reconstructed bin by bin from the stored joint probabilities and is proportional to

`|ψ₁(x)|² + |ψ₂(x)|²`.

The conditional display curves are derived afterward:

`P(x|+) = P(x,+) / P(+)`

`P(x|−) = P(x,−) / P(−)`.

They are normalized separately only for shape comparison. The UI branch counts and underlying joint arrays preserve their actual ensemble weights, so neither conditional branch is presented as containing the entire ensemble.

For the finite default detector window, calculated marker marginals are `P(+) = 0.4995374644` and `P(−) = 0.5004625356`, close to the ideal symmetric value `1/2`. The small deviation reflects truncation to the finite detector interval.

## Joint Monte Carlo architecture

`sampleQuantumEraserEvents` searches one joint cumulative array of length `2 × binCount`. The selected flat index determines both:

- channel: `+` for the first half, `−` for the second half;
- detector bin: flat index modulo `binCount`.

It does not call the ordinary detector-position sampler, and it never samples `x` before assigning a marker label.

`QuantumEraserExperiment` maintains all-event, plus-event, and minus-event typed histograms from those same joint events. Switching the displayed subset changes only getters for the expected curve, histogram, and recent-event filter.

## Tests performed

### Phase 5 automated tests

`tests/quantum-playground-quantum-eraser.test.js` verifies:

- orthogonal markers reproduce the Phase 3 non-interfering detector marginal;
- the `+` joint channel contains the positive coherent cross term;
- the `−` joint channel contains the negative coherent cross term;
- conditional patterns are complementary at calculated peak/trough locations;
- joint `+`/`−` sums reconstruct the marginal bin by bin;
- global joint normalization and non-negativity;
- approximately equal marker marginals for default symmetric geometry;
- seeded joint-event reproducibility;
- one joint cumulative draw determines marker and detector bin, with no position-first sampler call;
- 300,000-event convergence of both conditional histograms and recombined marginal;
- incompatible distribution changes clear every histogram and recent event;
- compatible view switching preserves the joint ensemble and actual branch weights;
- all three UI views, required educational statements, and absence of stored fringe locations or delayed-choice claims.

Measured 300,000-event seeded RMSE values were:

- Marker + conditional: `0.0001291078`;
- Marker − conditional: `0.0001338385`;
- recombined unsorted marginal: `0.0000960783`.

### Results

- Focused Quantum, theme, and public-page suite: **54 passed, 0 failed**.
- Phase 5-specific physics/state/page tests: **11 passed, 0 failed**.
- Full Node suite: **229 passed, 1 failed**.
- Backend contact regression suite: **5 passed, 0 failed** using the project virtual environment.
- JavaScript syntax checks: passed.
- `git diff --check`: passed.
- The static frontend has no separate bundler or production-build command.

### Browser verification

Playwright against the local Quart server verified:

- live Quantum Eraser selection and controls;
- 1,000 jointly sampled events split into 494 `+` and 506 `−` outcomes for the default seed;
- All, Marker +, and Marker − views show the appropriate retained subset counts;
- switching views preserves the same 1,000-event ensemble;
- seeded reset-and-run reproduces both branch counts;
- changing wavelength clears all branch counts;
- desktop Marker + and mobile Marker − rendering;
- no browser console or page errors.

Screenshots:

- `docs/quantum-playground/phase-5-desktop.png`
- `docs/quantum-playground/phase-5-mobile.png`

## Educational safeguards

The public explanation explicitly states:

- the quantum eraser does not change the past;
- no information travels backward in time;
- no faster-than-light signaling occurs;
- interference appears only after correlating/sorting detector events by marker outcome;
- the unsorted detector record remains non-interfering;
- measuring in the eraser basis does not reveal the original path;
- this is not physical deletion of a previously recorded classical fact.

## Files changed

### Added

- `tests/quantum-playground-quantum-eraser.test.js`
- `docs/quantum-playground/05_PHASE_5_QUANTUM_ERASER.md`
- `docs/quantum-playground/phase-5-desktop.png`
- `docs/quantum-playground/phase-5-mobile.png`

### Modified

- `frontend/quantum-playground-model.mjs`
- `frontend/quantum-playground.js`
- `frontend/quantum-playground.html`
- `frontend/quantum-playground.css`
- `QUANTUM_PLAYGROUND_STATUS.md`

No unrelated branded-email/contact analytics implementation was modified for Phase 5.

## Known limitations

- Only the fixed `+`/`−` eraser basis is implemented.
- Continuously rotated marker bases are deferred as a possible future enhancement.
- Delayed-choice timing is not implemented.
- The experiment uses ideal orthogonal path markers and projective marker measurement.
- The finite detector window introduces a small branch-marginal deviation from exactly `1/2`.
- The apparatus and pulse remain schematic; joint probabilities and sampled detector events are calculated.

## Bugs discovered

- No product bug was found during Phase 5. The implementation explicitly avoided the reviewed invalid approach of sampling detector position first and assigning a random marker outcome afterward.

## Known unrelated full-suite failure

`tests/homepage-agent-analytics.test.js` expects the old contact event status `"delivered"`, while pending unrelated branded-email/contact work records `"verified_delivered"`. This remains the only full-suite failure and was not changed or bypassed.

## Decisions made

- Use one globally normalized joint distribution and one joint event draw.
- Preserve separately normalized conditional curves only as derived educational views.
- Keep branch counts and joint probabilities visible/retained so conditional subsets cannot imply full-ensemble weight.
- Sort one compatible ensemble without resetting when changing All/+/− views.
- Reset on physical-distribution changes.
- Exclude delayed choice and rotated marker bases from Phase 5.
- Add no dependencies, backend endpoints, storage, or telemetry.

## Next phase recommendation

Stop for physics review. Before Phase 6 Entanglement, review joint normalization, conditional reconstruction, finite-window marker marginals, Monte Carlo convergence, no-signaling language, and the strict joint-sampling architecture.
