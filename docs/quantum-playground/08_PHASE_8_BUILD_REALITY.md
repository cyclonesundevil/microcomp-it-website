# Phase 8 — Build Your Own Reality / Can You Reproduce Quantum Mechanics?

## Review State

Implementation complete. Stop before Phase 9 for owner/physics review.

## Objective

Phase 8 turns the Phase 7 Bell comparison into a constrained model-building laboratory. A candidate must generate every outcome from an explicit mechanism and is evaluated against:

1. equal-angle anticorrelation;
2. the complete photon-polarization target `E_Q(a,b) = -cos[2(a-b)]` on a predetermined angle grid;
3. the maximum-violation CHSH configuration;
4. Alice and Bob conditional local marginals;
5. operational no-signaling;
6. the assumptions actually used by its API.

There is no control that directly sets `S`, correlation strength, or a verdict, and no arbitrary executable-code input.

## Reference Physics Preservation

The approved Phase 6/7 engine remains in `frontend/quantum-playground-model.mjs` and was not changed for Phase 8. The new candidate laboratory lives in `frontend/quantum-reality-model.mjs` and imports the approved singlet Born distribution, joint sampler, CHSH cohorts, preset, and sign convention.

Regression fixtures verify:

- `P(++), P(+-), P(-+), P(--)` remain normalized Born probabilities;
- `E(a,b) = -cos[2(a-b)]`;
- the approved quantum preset gives `S = -2sqrt(2)`;
- the approved Phase 7 local reference gives `S = -2`.

## Predetermined Benchmark

The full correlation benchmark is the Cartesian product

`a,b in {0°, 15°, 30°, 45°, 60°, 75°, 90°}`,

for 49 analyzer pairs. Four additional cohorts use the approved maximum-violation CHSH angles:

- `a=0°`;
- `a'=45°`;
- `b=22.5°`;
- `b'=157.5°`, polarization-equivalent to `-22.5°`.

A balanced browser benchmark emits 500 trials for each of the 53 scenarios, or 26,500 total trials. Full-curve RMSE includes every one of the 49 grid cells; missing cells return an incomplete verdict.

## Explicit Candidate Mechanisms

### Local hidden-variable builder

Locality is enforced structurally through separate response APIs:

- Alice receives only `(a, lambda, random)`;
- Bob receives only `(b, lambda, random)`;
- there is no joint response API with both settings.

When measurement independence is preserved, the hidden-variable generator receives only `random`, implementing `p(lambda|a,b)=p(lambda)` by construction.

Bounded controls select:

- uniform or axially biased hidden-variable distributions;
- deterministic threshold or normalized stochastic soft responses;
- independent local output noise;
- a shared-source flip process.

All response probabilities are checked for non-negativity and normalization.

### Setting-dependent hidden source

This explicit mode allows the hidden-variable generator to receive both settings. Its Assumption Ledger therefore reports measurement independence relaxed. The UI does not automatically call this superdeterminism.

### Quantum Born Joint Reference

This explicit mode samples one four-outcome joint result from the approved photon-polarization singlet Born distribution. Bell-local hidden-variable factorization is not imposed, measurement independence is preserved, and operational no-signaling is evaluated independently from generated conditional marginals. It does not simulate a physical influence or message between Alice and Bob.

## Trial Integrity and Auditability

Every trial records:

- sequence number and predetermined scenario ID;
- analyzer settings;
- hidden variable when used;
- one jointly recorded `++`, `+-`, `-+`, or `--` outcome;
- outcome product;
- candidate configuration identity;
- immutable assumption metadata.

The complete audit trail is retained for the simulated run. Seeded reset-and-rerun sequences reproduce exactly. Any candidate parameter change replaces the candidate and clears all incompatible observations.

## Assumption Ledger

The ledger is derived from candidate capabilities, not supplied as editable descriptive text. It reports:

- locality preserved or relaxed;
- measurement independence preserved or relaxed;
- no-signaling as a conditional-marginal test result;
- deterministic or stochastic response mechanism;
- additional distribution, response, noise, singlet, and Born-rule assumptions.

Locality and operational no-signaling are deliberately separate. The no-signaling evaluator compares `P(A+|a,b)` across Bob settings and `P(B+|a,b)` across Alice settings. It reports the largest observed conditional-marginal changes and a documented finite-sample tolerance.

## Verdict Logic

The verdict is computed from sampled statistics. It requires all grid and CHSH cohorts and explains specific failures:

- equal-angle anticorrelation missed;
- maximum-CHSH target missed;
- full-curve RMSE too large;
- operational no-signaling check failed.

Matching only the maximum-CHSH configuration is explicitly rejected as insufficient. A model that matches the full benchmark only when Bell-local hidden-variable factorization is not imposed or measurement independence is relaxed receives a qualified explanation naming that assumption boundary.

Challenge 3 is not keyed to a model name. Its displayed outcome follows from the sampled `S` and the mechanism-derived ledger. Finite `S` uses an approximate standard error only; the page does not report a p-value or an “N-sigma proof.”

## Automated Verification

Phase 8 adds 16 tests covering:

- unchanged Phase 6/7 numerical fixtures;
- structural local-setting isolation;
- structural measurement independence;
- explicit measurement-dependence disclosure;
- conditional-marginal no-signaling calculation;
- exact full-grid RMSE calculation;
- rejection of CHSH-only success;
- independent testing of local marginals;
- probabilistic normalization and non-negativity;
- exact seeded reproducibility and complete audit trails;
- reset after parameter changes;
- ledger/API agreement;
- baseline local-model behavior;
- Quantum Born Joint Reference convergence and operational no-signaling evidence;
- fixed benchmark coverage;
- UI safeguards and absence of arbitrary code execution.

Results:

- Phase 8 tests: 16/16 passed.
- Focused Quantum/theme/public-page suite: 102/102 passed.
- Full Node suite: 277/278 passed.
- Backend contact regression suite: 5/5 passed with `unittest`.
- JavaScript syntax and whitespace checks passed.

The sole full-suite failure remains the unrelated contact-analytics assertion that expects `"delivered"` while the pending branded-email/contact implementation records `"verified_delivered"`.

## Browser Verification

Headless Chrome was exercised at desktop and mobile viewports against the local Quart server.

Verified:

- Phase 8 selection and controls;
- assumption-ledger changes for all three modes;
- balanced benchmark execution;
- exact seeded reset reproducibility;
- parameter-change clearing;
- local failure explanation;
- Quantum Born Joint Reference qualified success explanation;
- operational no-signaling result;
- zero page errors;
- zero desktop and mobile horizontal overflow.

Representative seeded 26,500-trial browser results:

- baseline local candidate: `S=-1.956`, approximate `sigma_S=0.078`, full-curve RMSE `0.148`;
- Quantum Born Joint Reference: full-curve RMSE `0.036`; finite sampled marginals were consistent with its exact theoretical no-signaling prediction.

Screenshots:

- `docs/quantum-playground/phase-8-desktop.png`
- `docs/quantum-playground/phase-8-mobile.png`

## Known Limits

- This is an educational finite-grid benchmark, not an exhaustive theorem prover over all possible models.
- Verdict tolerances are practical educational convergence criteria, not experimental confidence claims.
- Ideal analyzers, complete detection, and the approved photon-polarization convention remain in force.
- The Quantum Born Joint Reference is an explicit quantum reference calculation, not a proposed deeper hidden-variable account or a modeled superluminal mechanism.
- No detector loopholes, inefficiency, delayed-choice timing, or Phase 9 feature is implemented.

## Files

Added:

- `frontend/quantum-reality-model.mjs`
- `tests/quantum-playground-build-reality.test.js`
- `docs/quantum-playground/08_PHASE_8_BUILD_REALITY.md`
- `docs/quantum-playground/phase-8-desktop.png`
- `docs/quantum-playground/phase-8-mobile.png`

Updated:

- `frontend/quantum-playground.html`
- `frontend/quantum-playground.js`
- `frontend/quantum-playground.css`
- `tests/quantum-playground-chsh.test.js`
- `QUANTUM_PLAYGROUND_STATUS.md`

## Review Questions

1. Approve the fixed 7x7 analyzer grid and separate four-cohort CHSH benchmark.
2. Approve the three bounded candidate mechanism families and capability-derived ledger.
3. Approve the operational no-signaling estimator and finite-sample tolerance presentation.
4. Approve the explanatory verdict thresholds and qualified-success wording.
5. Confirm Phase 8 approval before any Phase 9 work begins.
