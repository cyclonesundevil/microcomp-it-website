# Phase 7 — Bell / CHSH Test

## Objective

Add an actual CHSH trial experiment using the approved Phase 6 photon-polarization Born-rule engine and an explicit example local hidden-variable comparison. Each trial independently chooses Alice and Bob settings, generates one joint physical outcome, and contributes to one of four simultaneously accumulated setting cohorts.

## Implementation summary

- Marked Phase 6 approved and Phase 7 current before implementation.
- Made Bell / CHSH Test a live experiment in the existing shell.
- Added Quantum Model and Local Hidden-Variable Model options.
- Added four analyzer controls `a`, `a′`, `b`, `b′` and a maximum-violation preset.
- Added one setting-choice/trial engine shared by both physical models.
- Added simultaneous `E(a,b)`, `E(a,b′)`, `E(a′,b)`, and `E(a′,b′)` cohort accumulation.
- Added cohort trial counts and Alice/Bob local-plus marginals.
- Added measured `S`, measured `|S|`, expected/model `S`, approximate `σS`, total trials, local bound, and Tsirelson bound.
- Added a Canvas cohort visualization comparing measured and expected correlations, plus a measured-`|S|` bound gauge.
- Changing model or any analyzer setting clears all incompatible cohorts.
- Reused pair-specific single, batch, seeded, run/pause, and reset shell controls.

## CHSH convention

The implementation uses exactly

`S = E(a,b) + E(a,b′) + E(a′,b) − E(a′,b′)`.

This convention is stored in the physics module and used for expected and measured results.

The local hidden-variable bound is

`|S| ≤ 2`,

and the quantum Tsirelson bound is

`|S| ≤ 2sqrt(2) ≈ 2.828427`.

The standard photon-polarization preset is

- `a = 0°`;
- `a′ = 45°`;
- `b = 22.5°`;
- `b′ = 157.5°`, explicitly identified as polarization-equivalent to `−22.5°`.

The quantum expected correlations are approximately `−0.7071, −0.7071, −0.7071, +0.7071`, producing `S = −2sqrt(2)` and `|S| = 2sqrt(2)`.

## Trial architecture

For every pair, `sampleChshTrial`:

1. draws Alice’s setting independently from `a,a′`;
2. draws Bob’s setting independently from `b,b′`;
3. identifies the corresponding cohort;
4. generates one joint outcome from the selected physical model;
5. records exactly one trial in exactly one cohort.

The two setting draws occur before the outcome/hidden-variable draw. Automated tests verify approximate uniformity, Alice/Bob setting independence, stable settings when the later outcome draw changes, and equal hidden-variable distributions across cohorts.

## Quantum model

The quantum option directly reuses Phase 6:

`P(sA,sB|a,b) = |⟨sA_a,sB_b|Ψ−⟩|²`

for the photon-polarization singlet. No correlation curve or `S` value is hard-coded into the sampler. Each selected cohort obtains its own Phase 6 four-outcome distribution, and one joint outcome is sampled.

The approved Phase 6 Born probabilities are protected by an unchanged numerical regression fixture.

## Example local hidden-variable model

The comparison model uses

`λ ~ U(0,π)`

`A(a,λ) = sgn[cos 2(a−λ)]`

`B(b,λ) = −sgn[cos 2(b−λ)]`.

Alice’s function accepts only Alice’s local setting and `λ`. Bob’s function accepts only Bob’s local setting and `λ`. Neither receives the remote setting or outcome. Source-level locality tests enforce this API boundary.

This is clearly labeled as one example local hidden-variable model, not every classical theory. The educational text explains that CHSH applies more broadly to local hidden-variable models satisfying assumptions including locality and measurement independence.

## Statistical uncertainty

For each nonempty cohort the implementation estimates

`σE = sqrt[(1−E²)/N]`.

When all four cohorts are populated,

`σS = sqrt[Σi σEi²]`.

Measured finite-sample values and expected/asymptotic values are displayed separately. The UI explicitly notes that finite estimates may fluctuate around a bound. It does not clamp local `S` to 2 or quantum `S` to `2sqrt(2)`.

For example, the deterministic 100,000-trial local run measured `|S| = 2.009098` with `σS = 0.010937`, while its expected value is exactly `2`. This is a permitted finite-sample fluctuation, not a modeled Bell violation.

## Tests performed

### Phase 7 automated tests

`tests/quantum-playground-chsh.test.js` verifies:

- Phase 6 Born probabilities remain unchanged;
- the stated CHSH sign convention is used consistently;
- the maximum-violation quantum preset gives `2sqrt(2)`;
- calculated quantum expectation values do not exceed Tsirelson’s bound;
- every trial has one Alice setting, one Bob setting, one cohort, and one joint outcome;
- all four settings are sampled approximately uniformly;
- Alice and Bob setting selections are statistically independent;
- settings are independent of local hidden variables;
- changing the later outcome draw cannot change already selected settings;
- one complete quantum run converges in all four cohorts and in `S`;
- local response functions cannot access remote settings/outcomes;
- the large local run converges to the bound without clamping a finite `|S|>2` fluctuation;
- varied expected local-model settings respect `|S|≤2`;
- quantum and local sampled marginals remain independent of remote settings;
- seeded complete Bell runs are exactly reproducible;
- reset, model changes, and setting changes clear all cohorts;
- cohort and aggregate uncertainty formulas;
- UI bounds, convention, preset equivalence, model scope, and educational safeguards.

For the seeded 400,000-trial quantum preset:

- cohort counts: `100104, 99925, 100429, 99542`;
- measured correlations: `−0.704367, −0.704538, −0.704786, +0.706094`;
- measured `S = −2.819786`;
- expected `S = −2.828427`;
- approximate `σS = 0.004486`.

### Results

- Focused Quantum, theme, and public-page suite: **86 passed, 0 failed**.
- Phase 7-specific physics/state/page tests: **17 passed, 0 failed**.
- Full Node suite: **261 passed, 1 failed**.
- Backend contact regression suite: **5 passed, 0 failed** using the project virtual environment.
- JavaScript syntax checks: passed.
- `git diff --check`: passed.
- The static frontend has no separate bundler or production-build command.

### Browser verification

Playwright against the local Quart server verified:

- live Bell Test selection and pair-specific controls;
- quantum maximum-violation preset with expected `S = −2.828`;
- all four cohorts populated in one 1,000-trial run;
- measured cohort correlations, local marginals, `S`, `|S|`, and `σS` readouts;
- exact seeded cohort reproduction after reset;
- local-model selection clears all quantum statistics and updates expected `S` to `−2.000`;
- analyzer changes clear all cohorts;
- preset restores `b′=157.5°`;
- mobile 100-pair emission;
- no browser console or page errors.

The 1,000-trial screenshot has measured `S = −2.978` with `σS = 0.085`. The interface distinguishes this finite estimate from expected `−2.828` and states that asymptotic bounds can be crossed by finite estimators.

Screenshots:

- `docs/quantum-playground/phase-7-desktop.png`
- `docs/quantum-playground/phase-7-mobile.png`

## Educational safeguards

The public text states that CHSH violations rule out the relevant class of local preassigned-outcome explanations under Bell assumptions. It does not claim that Bell tests:

- prove one quantum interpretation;
- prove faster-than-light communication;
- prove consciousness causes collapse;
- rule out every conceivable hidden-variable theory;
- prove instantaneous information transfer between particles.

It reiterates that the approved quantum and Bell-local reference models predict remote-setting-independent local marginals; finite sampled marginals are evidence subject to sampling uncertainty.

## Prior-phase clarification preserved

Phase 5’s slight `P(+)/P(−)` imbalance is caused by conditioning on the finite modeled detector window. The ideal complete-domain symmetric limit remains `P(+)=P(−)=1/2`.

## Files changed

### Added

- `tests/quantum-playground-chsh.test.js`
- `docs/quantum-playground/07_PHASE_7_BELL_CHSH.md`
- `docs/quantum-playground/phase-7-desktop.png`
- `docs/quantum-playground/phase-7-mobile.png`

### Modified

- `frontend/quantum-playground-model.mjs`
- `frontend/quantum-playground.js`
- `frontend/quantum-playground.html`
- `frontend/quantum-playground.css`
- `QUANTUM_PLAYGROUND_STATUS.md`

No unrelated branded-email/contact analytics implementation was modified for Phase 7.

## Known limitations

- The quantum source and analyzers remain ideal.
- The local comparison is one explicit deterministic-response model, not a survey of classical theories.
- The uncertainty is an approximate independent-cohort estimator.
- No detector inefficiency, loss, accidental counts, timing windows, locality loophole, or measurement-dependence model is included.
- No Build Your Own Reality controls are implemented.

## Bugs discovered

- No Phase 7 product defect remained after verification. Browser results highlighted the importance of labeling bounds as expectation/asymptotic constraints because a 1,000-trial quantum estimator measured `|S|>2sqrt(2)`; the UI disclosure was strengthened accordingly.

## Known unrelated full-suite failure

`tests/homepage-agent-analytics.test.js` expects the old contact event status `"delivered"`, while pending unrelated branded-email/contact work records `"verified_delivered"`. This remains the only full-suite failure and was not changed.

## Decisions made

- Reuse photon-polarization Born distributions unchanged.
- Choose both settings independently before generating the physical outcome.
- Sample one complete pair outcome per trial.
- Implement an explicit local response model instead of artificially bounding `S`.
- Show finite estimates, uncertainty, and expected values separately.
- Keep Phase 8 entirely unimplemented.
- Add no dependencies, backend endpoints, storage, or telemetry.

## Next phase recommendation

Stop for physics review. Before Phase 8, review the CHSH sign convention, photon preset, setting independence, local response boundaries, finite-sample disclosures, no-signaling marginals, and convergence results.
