# Phase 2 — Double-Slit Interference

## Objective

Add a physically meaningful double-slit/Fraunhofer experiment in which interference emerges from independent detector events sampled from a normalized complex-amplitude calculation. Preserve the Phase 1 separation between physics, experiment state, and rendering.

## Implementation

- Added a live Double-Slit selector to the existing Quantum Playground shell.
- Added controls for slit width, center-to-center slit separation, wavelength, and source-to-detector screen distance.
- Reused the seeded event sampler, aggregate histogram, run/pause/reset lifecycle, detector readouts, and bounded recent-event visualization.
- Added a schematic double-slit barrier. It is illustrative; detector probabilities and event locations come exclusively from the independent physics module.
- Added experiment-specific observation, physics-scope, and mathematical explanations.
- Changing geometry rebuilds the probability distribution and resets accumulated observations so samples from incompatible configurations are never combined.

## Physics model

The detector uses coordinate `x` in metres, screen distance `L`, slit width `a`, center-to-center separation `d`, and wavelength `λ`. The observation angle is calculated without the paraxial substitution:

`sin(θ) = x / sqrt(L² + x²)`

Each rectangular slit contributes the complex Fraunhofer amplitude

`ψ_j(x) = sinc(π a sin(θ) / λ) exp(i 2π y_j sin(θ) / λ)`

where `y_j = ±d/2` and `sinc(z) = sin(z)/z`. The two complex amplitudes are added before taking the magnitude squared:

`I(x) = |ψ_1(x) + ψ_2(x)|²`

The discrete detector-bin weights are normalized to produce `P(x)`. Every displayed detector impact is then independently sampled from that cumulative distribution. Rendering never receives or stores fringe locations.

Default geometry is `a = 12 μm`, `d = 40 μm`, `λ = 550 nm`, `L = 1 m`, with a detector spanning `-50 mm` to `+50 mm` in 401 bins. The model is monochromatic, coherent, scalar, one-dimensional, and in the Fraunhofer regime.

## Automated physics tests

`tests/quantum-playground-double-slit.test.js` explicitly verifies:

- probability normalization to numerical precision;
- non-negative intensities and probabilities;
- left/right symmetry for symmetric geometry;
- the independent-aperture domain rejects overlap (`d < a`) and accepts the touching boundary (`d = a`);
- narrower slit produces a broader envelope, measured from numerical intensity minima;
- larger slit separation produces smaller numerically measured fringe spacing;
- larger wavelength produces larger numerically measured fringe spacing;
- seeded Monte Carlo convergence to the analytical distribution;
- renderer has no stored fringe locations, plus an arbitrary-geometry numerical spacing check.

The convergence test draws 250,000 seeded events over 401 bins. Its measured probability RMSE was `0.0001045865`, below the required `0.00015` threshold.

## Verification results

- Focused Quantum, theme, and public-page checks: **25 passed, 0 failed**.
- Full Node suite: **200 passed, 1 failed**.
- Backend contact regression tests using the project virtual environment: **5 passed, 0 failed**.
- JavaScript syntax and whitespace checks: passed.
- Desktop and mobile browser interactions: passed with no console or page errors.

Browser verification covered live experiment switching, geometry controls, 1-event and 1,000-event emission, reset-on-geometry-change, fixed-seed reproducibility, responsive rendering, and accessible live readouts.

Screenshots:

- `docs/quantum-playground/phase-2-desktop.png`
- `docs/quantum-playground/phase-2-mobile.png`

## Known unrelated failure

The single full-suite failure remains in `tests/homepage-agent-analytics.test.js`. It expects the old contact status `"delivered"`, while the unrelated branded-email/contact-verification work currently records `"verified_delivered"`. Phase 2 did not modify those files or that behavior.

The first backend regression invocation used the system Python and could not import Quart. Re-running with `backend/venv/Scripts/python.exe` passed all five tests; this was a test-harness interpreter issue.

## Post-review parameter-domain correction

Before Phase 3, owner review identified that independent rectangular slits must not overlap. The pure physics validator now enforces center separation `d ≥ a`, where `a` is slit width. The coupled UI controls preserve this invariant in either adjustment direction, and an automated boundary/rejection test replaces the formerly mathematical `d → 0` check because that limit lies outside this model's declared independent-aperture domain.

## Files added

- `tests/quantum-playground-double-slit.test.js`
- `docs/quantum-playground/02_PHASE_2_DOUBLE_SLIT.md`
- `docs/quantum-playground/phase-2-desktop.png`
- `docs/quantum-playground/phase-2-mobile.png`

## Files updated

- `frontend/quantum-playground-model.mjs`
- `frontend/quantum-playground.js`
- `frontend/quantum-playground.html`
- `frontend/quantum-playground.css`
- `QUANTUM_PLAYGROUND_STATUS.md`

Unrelated branded-email/contact analytics changes were preserved and not edited for Phase 2.

## Review gate

Phase 2 is complete. Stop here for owner/physics review before beginning Phase 3. Review should focus on the Fraunhofer assumptions, parameter ranges, detector orientation, event convergence, and the distinction between the schematic apparatus and calculated detector distribution.
