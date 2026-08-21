# Phase 4 — Decoherence / Partial Coherence

## Objective

Generalize the Phase 3 binary marker overlap to a continuous public coherence parameter while preserving normalized Hilbert-space marker states, complex Fraunhofer path amplitudes, event-by-event detector sampling, and separation between physics and rendering.

## Implementation summary

- Made Decoherence / Partial Coherence a live experiment in the shared Quantum Playground shell.
- Added a public coherence/environmental-overlap slider from `γ = 0` to `γ = 1` in increments of `0.05`.
- Constructed normalized marker states for every slider value instead of inserting a renderer-side visibility multiplier.
- Reused the same two-path amplitude engine, cumulative sampler, detector histogram, expected-probability curve, geometry controls, and seeded experiment state.
- Added visibility `V` and distinguishability `D` readouts with ideal-model equality and general complementarity inequality disclosures.
- Changing `γ` or slit geometry reconstructs the probability distribution and clears accumulated observations.
- Added reduced-density-matrix educational language focused on suppression of off-diagonal coherence.
- Explicitly distinguishes partial measurement from environmental decoherence at the microscopic level while noting that both can suppress the same reduced-description coherence.

## Physics model used

The complex slit amplitudes remain

`ψ_j(x) = sinc(π a sinθ / λ) exp(i 2π y_j sinθ / λ)`

with `sinθ = x/sqrt(L²+x²)` and the established independent-aperture constraint `d ≥ a`.

For requested real overlap `0 ≤ γ ≤ 1`, the model constructs

`|M₁⟩ = (1, 0)`

`|M₂⟩ = (γ, sqrt(1 - γ²))`.

Both states are normalized and

`⟨M₁|M₂⟩ = γ`.

The detector marginal is calculated from

`P(x) ∝ |ψ₁|² + |ψ₂|² + 2 Re[γ ψ₁*ψ₂]`

and normalized over the discrete detector bins before every event is sampled.

Endpoints:

- `γ = 1`: identical marker states, fully coherent Phase 2 / Phase 3 detector-OFF distribution;
- `0 < γ < 1`: partial marker overlap and reduced cross-term magnitude;
- `γ = 0`: orthogonal markers, zero cross term, Phase 3 detector-ON distribution.

For the ideal pure symmetric two-path model, the UI displays

`V = |γ|`

`D = sqrt(1 - |γ|²)`

so `V² + D² = 1`. The page explicitly states that the more general complementarity relation is `V² + D² ≤ 1`.

No microscopic bath, collision process, master equation, time evolution, or environmental dynamics is implemented.

## Tests performed

### Phase 4 automated tests

`tests/quantum-playground-decoherence.test.js` verifies:

- `γ = 1` exactly reproduces Phase 2 and Phase 3 detector-OFF probabilities;
- `γ = 0` exactly reproduces Phase 3 detector-ON probabilities and cross terms;
- intermediate `γ` continuously and linearly scales the interference cross term;
- normalization and non-negativity at all 21 public slider values;
- normalized marker states and requested inner products at representative values;
- rejection of overlap values outside `[0,1]`;
- monotonic physical interference visibility for default symmetric geometry;
- numerical `V² + D² = 1` across the slider;
- distribution changes clear accumulated and recent observations;
- seeded partial-coherence sampling is reproducible and distribution-driven;
- UI, reduced-density-matrix language, ideal/general complementarity qualifications, and microscopic distinction.

### Results

- Focused Quantum, theme, and public-page suite: **43 passed, 0 failed**.
- Full Node suite: **218 passed, 1 failed**.
- Backend contact regression suite: **5 passed, 0 failed** using the project virtual environment.
- JavaScript syntax checks: passed.
- `git diff --check`: passed.
- The static frontend has no separate bundler or production-build command.

### Browser verification

Playwright against the local Quart server verified:

- live Decoherence experiment selection;
- visibility of slit and coherence controls without the Phase 3 binary control;
- endpoint readouts `V=1, D=0` and `V=0, D=1`;
- intermediate `γ=0.50` readouts and detector sampling;
- clearing 1,000 accumulated observations when `γ` changes;
- reproducible seeded reset-and-run sampling;
- mobile interaction at `γ=0.35`;
- no browser console or page errors in the completed desktop and mobile checks.

Screenshots:

- `docs/quantum-playground/phase-4-desktop.png`
- `docs/quantum-playground/phase-4-mobile.png`

## Files changed

### Added

- `tests/quantum-playground-decoherence.test.js`
- `docs/quantum-playground/04_PHASE_4_DECOHERENCE.md`
- `docs/quantum-playground/phase-4-desktop.png`
- `docs/quantum-playground/phase-4-mobile.png`

### Modified

- `frontend/quantum-playground-model.mjs`
- `frontend/quantum-playground.js`
- `frontend/quantum-playground.html`
- `frontend/quantum-playground.css`
- `tests/quantum-playground-which-path.test.js`
- `QUANTUM_PLAYGROUND_STATUS.md`

No unrelated branded-email/contact analytics implementation was modified for Phase 4.

## Known limitations

- `γ` is a real non-negative overlap; complex overlap phase is not exposed.
- Marker states are an ideal pure two-dimensional construction.
- The displayed `V` and `D` equality assumes symmetric pure two-path conditions; it is not asserted as universal.
- Partial measurement and environmental decoherence are represented only through their common reduced-coherence factor, not through identical microscopic dynamics.
- The model has no explicit environment, bath spectrum, interaction Hamiltonian, or time-dependent decoherence rate.
- Apparatus graphics remain schematic, while the probability curve and events remain calculated.

## Bugs discovered

- The Phase 3 page-contract test originally prohibited a coherence slider anywhere on the page. Phase 4 legitimately adds one in its own hidden experiment group, so the assertion was narrowed to ensure only the Phase 3 Which-Path group remains binary.

## Known unrelated full-suite failure

`tests/homepage-agent-analytics.test.js` expects the old contact event status `"delivered"`, while pending unrelated branded-email/contact work records `"verified_delivered"`. This remains the only full-suite failure and was not changed or bypassed.

## Decisions made

- Generate `γ` from normalized marker vectors in the physics layer.
- Keep the Phase 3 control binary and place continuous overlap only in the Phase 4 experiment.
- Present ideal equality and general inequality together.
- Explain reduced density-matrix coherence without adding unsupported microscopic environmental dynamics.
- Reset observations on every probability-distribution change.
- Add no dependencies, backend endpoints, storage, or telemetry.

## Next phase recommendation

Stop for physics review. Before Phase 5 Quantum Eraser, review the marker-state construction, endpoint equivalence, complementarity framing, reduced-description explanation, and explicit microscopic limitations. Do not begin conditional marker-basis sorting or eraser behavior until approved.
