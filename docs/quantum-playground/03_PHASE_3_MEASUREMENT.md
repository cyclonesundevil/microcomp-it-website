# Phase 3 — Which-Path Measurement

## Objective

Add a binary which-path detector without replacing the interference calculation with a visual toggle. Model loss of accessible interference through correlations between path and marker states, preserve event-by-event sampling, and close the Phase 2 independent-slit parameter-domain review condition.

## Implementation summary

- Made Which-Path Measurement a live experiment in the existing shell.
- Added a binary **Which-Path Detector** control. OFF uses indistinguishable marker states; ON uses orthogonal, perfectly distinguishable marker states.
- Preserved slit width, separation, wavelength, and screen-distance controls.
- Generalized the pure two-path physics calculation to expose marker overlap, incoherent intensity, interference cross term, total intensity, normalized probability, and cumulative probability.
- Moved reusable detection accumulation into the browser-independent model module so distribution changes and state clearing can be tested directly.
- Rebuilds and clears the accumulator whenever measurement state or slit geometry changes, preventing observations from incompatible distributions from mixing.
- Reused the same renderer for coherent and measured modes. It receives probability bins and sampled events; it has no which-path pattern rule.
- Added responsive desktop/mobile verification screenshots.

## Phase 2 parameter-domain verification

The two-slit model represents independent rectangular apertures of width `a` and center-to-center separation `d`. It now enforces:

`d ≥ a`

The pure model rejects `d < a` with a range error and accepts the touching boundary `d = a`. The coupled controls preserve the same invariant: reducing separation below width reduces width, while increasing width beyond separation increases separation. The earlier mathematical `d → 0` test was replaced because that limit is outside this model's independent-aperture domain.

## Physics model used

The Phase 2 complex slit amplitudes remain authoritative:

`ψ_j(x) = sinc(π a sinθ / λ) exp(i 2π y_j sinθ / λ)`

with `sinθ = x/sqrt(L²+x²)` and `y_j = ±d/2`.

Phase 3 associates normalized marker states `|M₁⟩` and `|M₂⟩` with the alternatives and calculates

`γ = ⟨M₁|M₂⟩`

then

`P(x) ∝ |ψ₁|² + |ψ₂|² + 2 Re[γ ψ₁*ψ₂]`.

The binary states are:

- detector OFF: `|M₁⟩ = |M₂⟩ = (1,0)`, therefore `γ = 1`;
- detector ON: `|M₁⟩ = (1,0)` and `|M₂⟩ = (0,1)`, therefore `γ = 0`.

For ON, the cross term is consequently zero at every detector bin and the result is the incoherent sum of the two finite-width slit intensities. The single-slit diffraction envelope remains. Continuous intermediate overlap is intentionally not exposed; that belongs to Phase 4.

The educational text describes correlation/entanglement with a marker or measurement system and explicitly states that human consciousness is not part of the calculation.

## Tests performed

### Phase 3 automated tests

`tests/quantum-playground-which-path.test.js` verifies:

- detector OFF exactly reproduces Phase 2 coherent probabilities;
- detector ON equals the incoherent slit-intensity sum;
- orthogonal marker states give `γ = 0` and a zero cross term in every bin;
- the finite single-slit diffraction envelope remains;
- both binary modes are normalized and non-negative;
- seeded sampled events are reproducible and occupy calculated detector bins;
- changing distributions clears counts and recent observations in tested state code;
- the controller rebuilds state when measurement changes;
- the UI exposes only a binary checkbox, not continuous `γ`;
- educational language uses marker entanglement and rejects consciousness-based collapse.

The Phase 2 test suite now also verifies rejection of `d < a` and acceptance of `d = a`.

### Results

- Focused Quantum, theme, and public-page suite: **33 passed, 0 failed**.
- Full Node suite: **208 passed, 1 failed**.
- Backend contact regression suite: **5 passed, 0 failed** using the project virtual environment.
- JavaScript syntax checks: passed.
- `git diff --check`: passed.
- Static frontend has no separate bundler/production-build command.

### Browser verification

Playwright against the local Quart server verified:

- Which-Path selector and controls load;
- detector OFF and ON both emit sampled events;
- switching detector state clears 1,000 accumulated events before using the new distribution;
- geometry controls preserve `d ≥ a` in both adjustment directions;
- identical seeded ON reset-and-run sequences reproduce the same spread;
- desktop and mobile layouts render without console or page errors.

Screenshots:

- `docs/quantum-playground/phase-3-desktop.png`
- `docs/quantum-playground/phase-3-mobile.png`

## Files changed

### Added

- `tests/quantum-playground-which-path.test.js`
- `docs/quantum-playground/03_PHASE_3_MEASUREMENT.md`
- `docs/quantum-playground/phase-3-desktop.png`
- `docs/quantum-playground/phase-3-mobile.png`

### Modified

- `frontend/quantum-playground-model.mjs`
- `frontend/quantum-playground.js`
- `frontend/quantum-playground.html`
- `tests/quantum-playground-model.test.js`
- `tests/quantum-playground-double-slit.test.js`
- `docs/quantum-playground/02_PHASE_2_DOUBLE_SLIT.md`
- `QUANTUM_PLAYGROUND_STATUS.md`

No unrelated branded-email/contact analytics implementation was modified for Phase 3.

## Known limitations

- Measurement is idealized: marker states are either identical or perfectly orthogonal.
- The model does not simulate detector dynamics, time evolution, energy exchange, or a microscopic environment.
- The displayed apparatus and flight pulse remain schematic; only the detector distribution and samples are calculated.
- Partial distinguishability is deliberately deferred to Phase 4.

## Bugs discovered

- Phase 2 allowed `d < a`; this is now prevented in both model and controls.
- Moving the accumulator into the model invalidated a Phase 1 source-location assertion. The test was updated to inspect the module that now owns reset behavior; no product behavior regressed.

## Known unrelated full-suite failure

`tests/homepage-agent-analytics.test.js` still expects the old contact event status `"delivered"`, while pending unrelated branded-email/contact work records `"verified_delivered"`. This remains the only full-suite failure and was not changed or bypassed.

## Decisions made

- Use explicit normalized marker-state vectors and their inner product rather than a renderer boolean that hides fringes.
- Keep the public Phase 3 control binary and reserve intermediate overlap/coherence for Phase 4.
- Reset accumulated observations on every distribution-changing control.
- Preserve the existing complex Fraunhofer amplitudes and shared Monte Carlo sampler.
- Add no dependencies, backend APIs, storage, or telemetry.

## Next phase recommendation

Stop for physics review. Before Phase 4, review the marker-overlap convention, ideal orthogonal-marker endpoint, state-isolation behavior, educational language, and the corrected independent-slit domain. Do not expose continuous `γ` until Phase 4 is approved.
