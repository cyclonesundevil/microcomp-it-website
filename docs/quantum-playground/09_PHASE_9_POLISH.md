# Phase 9 — Polish / Education / Accessibility

## Review State

Implementation complete. Stop before Phase 10 Final Verification for owner review.

## Objective

Phase 9 improves the usability, educational sequence, scientific language, accessibility, and responsive presentation of the approved Phase 1–8 experiments. It does not add new physics.

The approved Phase 6–8 outcome engines and numerical reference fixtures remain unchanged. Phase 9 changes to the Phase 8 support module are limited to evidence metadata and explanatory Assumption Ledger wording.

## Scientific-Language Refinements

### Finite-sample no-signaling evidence

The interface no longer describes finite Monte Carlo samples as proving that no-signaling is satisfied.

For sampled candidates without detectable remote-setting dependence, it reports:

> Observed marginals are consistent with no-signaling within sampling uncertainty.

If the operational estimator detects statistically meaningful remote-setting variation under the educational finite-sample criterion, it reports:

> Detectable remote-setting dependence appears in the sampled local marginals.

Alice and Bob maximum conditional-marginal differences remain visible. Each is accompanied by an approximate worst-case standard error for a difference of two finite Bernoulli marginal estimates:

`approximate sigma_delta = sqrt(0.5 / N_min)`.

The existing practical display criterion uses four times that approximate uncertainty, with the existing minimum tolerance retained. This is explicitly not presented as a p-value or a formal experimental hypothesis test.

For the analytically known Born reference, the UI distinguishes theory from finite evidence:

> The Born-rule reference is theoretically no-signaling; this finite sample is consistent with that prediction.

### Quantum Born Joint Reference

The approved user-facing label is **Quantum Born Joint Reference**.

The internal mode identifier remains stable to avoid changing approved state and sampling behavior.

The Assumption Ledger now explains that:

- Bell-local hidden-variable factorization is not imposed;
- operational no-signaling is evaluated independently;
- no physical influence or message between Alice and Bob is simulated.

The qualified verdict uses the same neutral language and does not suggest a superluminal mechanism.

## Guided Educational Progression

A keyboard-accessible guided path presents the experiments in this order:

1. Single Particle
2. Double Slit
3. Which-Path
4. Decoherence
5. Quantum Eraser
6. Entanglement
7. Bell / CHSH
8. Build Your Own Reality

The introduction explains that the sequence moves from probability, through interference and information, to correlations and tests of classes of physical explanations.

Each experiment now follows the structure:

`Experiment introduction → Observation → Explanation → Mathematics`.

Every experiment has:

- a concise stage introduction;
- an expandable “What am I seeing?” explanation;
- an Observation panel;
- an Explanation panel;
- an expandable Show the math panel.

The “What am I seeing?” text distinguishes calculated probabilities and sampled observations from illustrative pulses, apparatus, and motion cues.

## Glossary and Tooltips

An expandable glossary contains keyboard-focusable definitions for:

- superposition;
- coherence;
- decoherence;
- entanglement;
- Bell locality;
- measurement independence;
- CHSH;
- no-signaling;
- hidden variable;
- Born rule.

Each term has both a visible expanded definition and a focus/hover tooltip. Tooltips remain supplemental; their content is not available only through pointer hover.

## Accessibility and Interaction

Added or improved:

- skip link to the active experiment;
- Arrow-key navigation through the experiment selector;
- guided-path buttons with `aria-current` state;
- focus movement to the selected experiment heading;
- visible high-contrast `:focus-visible` outlines;
- live experiment status announcements;
- explicit Ready, Running, Paused, Measured, and Error states;
- clear empty-state instructions;
- recoverable simulation error text;
- `aria-live` and atomic numerical result groups;
- dynamic Canvas accessible labels;
- textual Canvas fallback and live summaries;
- accessible slider labels and dynamically updated `aria-valuetext` with units;
- forced-colors support;
- expanded reduced-motion rules and removal of flight animation when reduced motion is requested.

Shareable URL configuration was deliberately not added because it was optional and not necessary to meet Phase 9 goals. Existing deterministic seeds already support reproducible configurations without expanding state-management risk.

## Responsive and Visual Polish

- Added a responsive guided-progression layout.
- Kept the full-width candidate curve on narrow screens while moving detailed values into accessible readouts.
- Improved tablet control-group sizing.
- Added responsive glossary layout.
- Verified the moderate theme, focus presentation, panel contrast, and readable Canvas/readout separation.
- Verified no desktop or mobile horizontal overflow.

## Scientific Safeguards

Automated wording checks guard against accidental claims that:

- consciousness causes collapse;
- measurement sends faster-than-light information;
- quantum erasure changes the past;
- Bell proves one interpretation;
- the Quantum Born Joint Reference is a superluminal signaling model;
- finite Monte Carlo results provide rigorous experimental significance.

Existing educational text continues to state that the quantum eraser does not change the past, Bell violations constrain a specified class of models under stated assumptions, and entanglement cannot be used for faster-than-light communication.

No delayed choice, detector loopholes, quantum computing, QFT, new interpretation, or other new physics was introduced.

## Automated Verification

Phase 9 adds 11 tests covering:

- unchanged Phase 6–8 numerical fixtures;
- finite-sample marginal deltas and uncertainty metadata;
- neutral Born-reference terminology and ledger semantics;
- finite-evidence wording safeguards;
- guided experiment order;
- experiment introductions and educational structure;
- complete keyboard-accessible glossary coverage;
- control/result/Canvas/error accessibility;
- keyboard, focus, reduced-motion, forced-colors, and state feedback;
- misleading scientific claim regressions;
- absence of prohibited Phase 9 physics additions.

Results:

- Phase 9 tests: 11/11 passed.
- Focused Quantum/theme/public-page suite: 113/113 passed.
- Full Node suite: 288/289 passed.
- Backend contact regression suite: 5/5 passed with `unittest`.
- JavaScript syntax and whitespace checks passed.

The sole full-suite failure remains the separately documented unrelated contact-analytics assertion expecting `"delivered"` while pending branded-email/contact work records `"verified_delivered"`.

## Browser Verification

Headless Chrome was exercised against the local Quart server at desktop and mobile viewports.

Verified:

- all eight guided steps;
- guided selection and heading focus;
- Arrow-key experiment navigation;
- empty state, emission, reset, run, and pause behavior;
- dynamic Canvas description;
- slider `aria-valuetext` updates;
- glossary tooltip display on keyboard focus;
- Quantum Born Joint Reference selection and ledger;
- theoretical-versus-finite no-signaling language;
- Alice/Bob marginal differences and approximate uncertainty;
- moderate theme rendering;
- reduced-motion suppression of the illustrative flight pulse;
- zero page errors;
- zero desktop/mobile horizontal overflow.

Screenshots:

- `docs/quantum-playground/phase-9-desktop.png`
- `docs/quantum-playground/phase-9-mobile.png`

## Files

Added:

- `tests/quantum-playground-polish.test.js`
- `docs/quantum-playground/09_PHASE_9_POLISH.md`
- `docs/quantum-playground/phase-9-desktop.png`
- `docs/quantum-playground/phase-9-mobile.png`

Updated:

- `frontend/quantum-playground.html`
- `frontend/quantum-playground.js`
- `frontend/quantum-playground.css`
- `frontend/quantum-reality-model.mjs`
- `tests/quantum-playground-build-reality.test.js`
- `QUANTUM_PLAYGROUND_STATUS.md`

## Review Questions

1. Approve the finite-sample no-signaling evidence and uncertainty language.
2. Approve “Quantum Born Joint Reference” and its Assumption Ledger wording.
3. Approve the guided progression and Experiment → Observation → Explanation → Mathematics structure.
4. Approve the glossary, keyboard behavior, responsive layout, and accessibility states.
5. Authorize Phase 10 Final Verification only after Phase 9 review.
