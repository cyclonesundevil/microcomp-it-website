# Phase 6 — Entanglement Lab

## Objective

Add a photon-polarization entanglement experiment using Born-rule projection of a singlet state. Each emitted pair must be sampled as one joint four-outcome event, with visibly random local marginals and angle-dependent correlations that become available only by comparing paired records.

## Implementation summary

- Marked Phase 5 approved and Phase 6 current in the status file before implementation, without duplicating status sections.
- Made Photon Polarization Entanglement a live experiment in the existing shell.
- Added Alice and Bob polarization-analyzer controls from `0°` through `180°` in `0.5°` increments.
- Reused single-event, batch, seeded reproducibility, run/pause, and reset shell controls with pair-specific labels.
- Added a browser-independent photon-polarization singlet state, analyzer basis, Born-rule projection engine, normalized four-outcome distribution, joint sampler, and experiment accumulator.
- Added `++`, `+−`, `−+`, and `−−` counts, Alice/Bob measured local marginals, measured correlation, theoretical correlation, and emitted-pair count.
- Added a dedicated Canvas view with central source, Alice/Bob analyzers, theoretical joint-probability bars, and observed joint-count bars.
- Changing either analyzer reconstructs the physical distribution and clears prior statistics.
- Added explicit no-signaling education and a prominent local-50/50 explanation.

## Physics model used

Phase 6 consistently uses photon polarization, not spin-1/2. The state is

`|Ψ−⟩ = (|H⟩A|V⟩B − |V⟩A|H⟩B) / sqrt(2)`.

In the ordered basis `HH, HV, VH, VV`, the real amplitudes are

`(0, 1/sqrt(2), −1/sqrt(2), 0)`.

For analyzer orientation `θ`, the basis is

`|+θ⟩ = cosθ|H⟩ + sinθ|V⟩`

`|−θ⟩ = −sinθ|H⟩ + cosθ|V⟩`.

For each outcome `sA,sB`, the engine computes the projection amplitude directly:

`A(sA,sB|a,b) = ⟨sA_a,sB_b|Ψ−⟩`

and its Born weight

`P(sA,sB|a,b) = |A(sA,sB|a,b)|²`.

The four Born weights are normalized together as one joint distribution in the fixed order `++,+−,−+,−−`. This recovers

`P(++) = P(−−) = 1/2 sin²(a−b)`

`P(+−) = P(−+) = 1/2 cos²(a−b)`

and

`E(a,b) = P(++) − P(+−) − P(−+) + P(−−) = −cos[2(a−b)]`.

Alice and Bob’s local theoretical marginals are each exactly `1/2,1/2` for every remote analyzer setting.

## Joint Monte Carlo architecture

`sampleEntangledPairs` draws once from the single cumulative four-outcome distribution. That draw produces the complete pair outcome. Alice and Bob are not sampled independently, and no later adjustment manufactures the correlation.

`EntanglementExperiment` stores one four-bin typed count array. Measured `E` and local marginals are derived only from those joint counts.

The Phase 6 Born-rule distribution and joint sampler are intentionally reusable as the basis for Phase 7, but no CHSH aggregation or alternative physical model is implemented yet.

## Tests performed

### Phase 6 automated tests

`tests/quantum-playground-entanglement.test.js` verifies:

- singlet-state normalization and antisymmetric `HV/VH` amplitudes;
- analyzer-basis normalization and orthogonality;
- Born-probability non-negativity and four-outcome normalization;
- Alice marginals remain `1/2` across Bob settings;
- Bob marginals remain `1/2` across Alice settings;
- equal settings give perfect anticorrelation;
- `|a−b|=45°` gives `E=0`;
- `|a−b|=90°` gives perfect correlation in the photon-polarization convention;
- arbitrary angles reproduce all four closed forms and `E=−cos[2(a−b)]`;
- simultaneous analyzer rotations leave probabilities and correlation unchanged;
- `180°` polarization periodicity for either analyzer;
- seeded joint-pair sampling is reproducible and uses one cumulative joint variable;
- 300,000-pair convergence to all four probabilities and `E`;
- sampled Alice marginals stay approximately 50/50 as Bob’s setting changes;
- either analyzer change clears prior statistics;
- Phase 6 UI and educational copy use photon-polarization/no-signaling language and omit Phase 7 features.

For the 300,000-pair convergence case `a=13°`, `b=71°`:

- maximum absolute four-outcome probability error: `0.00112612`;
- theoretical `E = 0.43837115`;
- measured `E = 0.43602667`;
- absolute correlation error: `0.00234448`.

### Results

- Focused Quantum, theme, and public-page suite: **69 passed, 0 failed**.
- Phase 6-specific physics/state/page tests: **15 passed, 0 failed**.
- Full Node suite: **244 passed, 1 failed**.
- Backend contact regression suite: **5 passed, 0 failed** using the project virtual environment.
- JavaScript syntax checks: passed.
- `git diff --check`: passed.
- The static frontend has no separate bundler or production-build command.

### Browser verification

Playwright against the local Quart server verified:

- live Entanglement selection and pair-specific controls;
- no slit controls in the entanglement experiment;
- 1,000 pair events populate exactly one of four joint bins each;
- default-seed counts `60, 434, 438, 68` reproduce after reset;
- measured `E = −0.744` approaches theoretical `E = −0.707` at `a=0°`, `b=22.5°`;
- changing Bob to `90°` clears all counts and updates theoretical `E` to `1.000`;
- Alice/Bob local marginal readouts remain visible;
- single-pair emission works at mobile size;
- desktop and mobile checks produced no console or page errors.

Screenshots:

- `docs/quantum-playground/phase-6-desktop.png`
- `docs/quantum-playground/phase-6-mobile.png`

## No-signaling presentation

The public interface states that each party sees an approximately random 50/50 local stream regardless of the remote angle. The correlation becomes visible only after comparing paired records. It explicitly states:

- neither photon signals the other;
- Alice’s measurement does not send Bob an outcome;
- the correlations cannot enable faster-than-light communication.

## Phase 5 clarification preserved

The slight Phase 5 `P(+)/P(−)` imbalance is caused by conditioning on the finite modeled detector window. In the ideal complete-domain symmetric limit, `P(+)=P(−)=1/2`.

## Files changed

### Added

- `tests/quantum-playground-entanglement.test.js`
- `docs/quantum-playground/06_PHASE_6_ENTANGLEMENT.md`
- `docs/quantum-playground/phase-6-desktop.png`
- `docs/quantum-playground/phase-6-mobile.png`

### Modified

- `frontend/quantum-playground-model.mjs`
- `frontend/quantum-playground.js`
- `frontend/quantum-playground.html`
- `frontend/quantum-playground.css`
- `QUANTUM_PLAYGROUND_STATUS.md`

No unrelated branded-email/contact analytics implementation was modified for Phase 6.

## Known limitations

- The source is an ideal pure photon-polarization singlet.
- Analyzer measurements are ideal projective two-outcome measurements.
- No noise, loss, detector inefficiency, accidental counts, timing windows, or loopholes are modeled.
- No CHSH `S`, hidden-variable comparison, or detector-setting schedule is implemented.
- The visualization is schematic; pair probabilities, outcomes, counts, marginals, and correlations are calculated.

## Bugs discovered

- The first Phase 6 page-contract assertion searched the entire controller for the term `CHSH`, which legitimately exists in the Phase 7 selector placeholder. It was narrowed to the Phase 6 educational block; no product behavior was changed or bypassed.

## Known unrelated full-suite failure

`tests/homepage-agent-analytics.test.js` expects the old contact event status `"delivered"`, while pending unrelated branded-email/contact work records `"verified_delivered"`. This remains the only full-suite failure and was not changed.

## Decisions made

- Use photon polarization consistently through state, basis, equations, UI, and tests.
- Compute probabilities from Born projections rather than entering only the closed forms.
- Sample one complete joint outcome per pair.
- Make local no-signaling marginals and paired-record comparison visually prominent.
- Keep the Phase 6 engine reusable for Phase 7 without implementing Phase 7 behavior.
- Add no dependencies, backend endpoints, storage, or telemetry.

## Next phase recommendation

Stop for physics review. Before Phase 7, review the polarization convention, Born projections, joint sampler, local-marginal/no-signaling presentation, periodicity, and Monte Carlo convergence. Do not begin CHSH aggregation or classical comparison until approved.
