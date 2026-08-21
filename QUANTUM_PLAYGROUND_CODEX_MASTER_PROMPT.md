# CODEX MASTER PROMPT — Quantum Playground / “Break Reality”

You are working inside an existing website repository.

Your mission is to design and implement an interactive browser-based quantum physics feature called:

# Quantum Playground — Break Reality

The experience should be educational, visually compelling, scientifically responsible, modular, and suitable for deployment on a public website.

The feature should be implemented incrementally. DO NOT attempt to build everything at once.

You must work in clearly defined phases, test after every phase, and produce Markdown progress reports after every completed phase so that the repository owner can review your work with another AI assistant.

---

# 1. PRIMARY GOAL

Create an interactive quantum physics playground that lets users experimentally explore:

1. Single-particle probabilistic detection
2. Double-slit interference
3. Which-path measurement
4. Decoherence
5. Quantum eraser concepts
6. Entanglement
7. Bell / CHSH tests
8. Classical local-hidden-variable comparison
9. A “Build Your Own Reality” mode allowing users to modify assumptions and compare outcomes with quantum predictions

The most important design principle:

> The user should learn quantum mechanics by running experiments, not by reading long explanations.

This is not intended to be a professional quantum research package. It is an educational physics simulator whose mathematics should nevertheless be physically meaningful and clearly distinguish exact quantum predictions from simplified visualization models.

---

# 2. BEFORE WRITING CODE

First inspect the repository.

Determine:

- existing framework
- package manager
- routing approach
- styling system
- component structure
- build system
- test framework
- deployment assumptions
- existing simulator conventions
- existing navigation
- whether WebGL, Canvas, SVG, Three.js, D3, React, Vue, vanilla JS, or other visualization tooling is already present

Do not replace the site's existing architecture unnecessarily.

Reuse existing design patterns when practical.

Before implementing anything, create:

`quantum-playground/00_INITIAL_ASSESSMENT.md`

or, if a dedicated folder is inappropriate for the repo:

`docs/quantum-playground/00_INITIAL_ASSESSMENT.md`

The report must include:

- current architecture
- relevant files
- proposed implementation location
- dependencies already available
- dependencies you propose adding
- risks
- compatibility concerns
- testing strategy
- recommended phased implementation plan

If there is an obvious architectural problem that would make the project significantly harder, document it before proceeding.

---

# 3. PROJECT REPORTING REQUIREMENT

Create and maintain a project status file:

`QUANTUM_PLAYGROUND_STATUS.md`

It must always contain:

## Current Phase

## Completed Phases

## Tests Passing

## Tests Failing

## Known Issues

## Physics Assumptions

## Files Added

## Files Modified

## Next Recommended Step

## Questions / Decisions for Owner

After every phase, update this file.

Also create one detailed Markdown report per phase.

Naming convention:

`01_PHASE_1_FOUNDATION.md`
`02_PHASE_2_DOUBLE_SLIT.md`
`03_PHASE_3_MEASUREMENT.md`

etc.

Each phase report must contain:

- Objective
- Implementation summary
- Physics model used
- Files changed
- Tests performed
- Test results
- Screenshots or manual verification notes if relevant
- Known limitations
- Bugs discovered
- Decisions made
- Next phase recommendation

Do not delete previous reports.

These Markdown reports are part of the deliverable.

---

# 4. TEST-FIRST / CHECKPOINT RULE

After EVERY implementation phase:

1. Run relevant automated tests.
2. Run lint/type checks if available.
3. Run the production build.
4. Test the feature manually when practical.
5. Fix regressions caused by the phase.
6. Record results in the phase report.
7. Update `QUANTUM_PLAYGROUND_STATUS.md`.

Do NOT silently continue after serious test failures.

If a failure cannot be resolved without major architectural changes:

- document the failure
- explain the suspected cause
- propose the smallest reasonable fix
- stop that phase cleanly

Do not hide or bypass failing tests merely to continue.

---

# 5. PHYSICS INTEGRITY RULE

The simulator must distinguish between:

A. actual quantum probability calculations

and

B. illustrative animation choices.

Do not imply that a visual animation is a literal visualization of an unobservable physical process.

Where an interpretation is shown, label it clearly as an interpretation.

Avoid statements such as:

“the electron literally splits in half”

unless explicitly identified as an illustrative metaphor.

Use standard quantum mechanics wherever practical.

For the double-slit simulation, the preferred educational probability structure is based on coherent amplitudes:

P(x) = |psi_1(x) + psi_2(x)|^2

For an incoherent or fully measured case:

P(x) = |psi_1(x)|^2 + |psi_2(x)|^2

A useful simplified decoherence model is:

P(x) =
|psi_1|^2
+ |psi_2|^2
+ 2 gamma Re(psi_1* psi_2)

with coherence parameter:

0 <= gamma <= 1

where:

gamma = 1 -> fully coherent

gamma = 0 -> fully decohered

Document simplifications explicitly.

---

# 6. PHASED IMPLEMENTATION

==================================================
PHASE 1 — FOUNDATION / SHELL
==================================================

Goal:

Create the Quantum Playground page and architecture without yet implementing advanced quantum mechanics.

Requirements:

- page or route titled:
  `Quantum Playground — Break Reality`
- responsive layout
- experiment selector
- simulation viewport
- control panel
- explanation/status panel
- reset button
- run/pause capability if appropriate
- deterministic seeded random mode for testing
- reusable simulation architecture

Recommended experiment selector placeholders:

- Single Particle
- Double Slit
- Which-Path
- Decoherence
- Quantum Eraser
- Entanglement
- Bell Test
- Build Your Own Reality

Only Single Particle must work initially.

Single Particle behavior:

- user can emit one particle
- detector location is sampled from a probability distribution
- user can emit batches
- detector hit history is visualized
- seed can optionally be fixed for repeatable tests

Testing:

- page loads
- route works
- controls work
- reset works
- simulation does not leak state
- deterministic seeded test gives repeatable output
- build succeeds

Create:

`01_PHASE_1_FOUNDATION.md`

STOP AND VERIFY before Phase 2.

==================================================
PHASE 2 — DOUBLE-SLIT INTERFERENCE
==================================================

Goal:

Implement a physically meaningful double-slit probability model.

Controls should include, where useful:

- particle count
- slit separation
- slit width
- wavelength or scaled equivalent
- screen distance
- run speed
- reset

User experience:

Individual detections should appear random.

As detections accumulate, an interference distribution should emerge.

Provide:

- live detector hits
- histogram/density view
- optional theoretical expected probability curve

Important:

Do not fake the final fringe pattern by simply drawing it.

The individual detections must be sampled from the probability distribution so the pattern emerges statistically.

Testing:

- probability distribution normalizes correctly
- sampled histogram approaches expected distribution
- symmetry checks where expected
- reset clears detections
- extreme but valid control values do not crash
- build succeeds

Create:

`02_PHASE_2_DOUBLE_SLIT.md`

STOP AND VERIFY before Phase 3.

==================================================
PHASE 3 — WHICH-PATH MEASUREMENT
==================================================

Goal:

Allow the user to turn on path information and watch interference diminish/disappear.

Add control:

`Which-Path Detector`

Expected behavior:

Detector OFF:
coherent two-slit interference

Detector ON:
incoherent sum of slit probabilities

Optional intermediate mode:

partial path distinguishability / partial measurement.

If implemented, clearly state that this represents reduced coherence.

Testing:

- OFF mode produces interference
- ON mode removes interference cross-term
- switching modes resets or safely transitions statistics
- expected curves match corresponding formulas
- build succeeds

Create:

`03_PHASE_3_MEASUREMENT.md`

STOP AND VERIFY before Phase 4.

==================================================
PHASE 4 — DECOHERENCE
==================================================

Goal:

Implement a continuous quantum-to-classical transition.

Add slider:

`Coherence / Environmental Coupling`

Suggested mathematical model:

P(x) =
|psi_1|^2
+ |psi_2|^2
+ 2 gamma Re(psi_1* psi_2)

where gamma ranges from 0 to 1.

Visual behavior:

gamma = 1:
maximum interference

gamma -> 0:
fringes progressively disappear

Explain that the slider is a simplified phenomenological coherence parameter rather than a full microscopic open-quantum-system simulation.

Testing:

- gamma endpoints match Phase 2 and Phase 3 distributions
- intermediate values interpolate interference visibility
- probability remains non-negative within numerical tolerance
- normalization preserved
- build succeeds

Create:

`04_PHASE_4_DECOHERENCE.md`

STOP AND VERIFY before Phase 5.

==================================================
PHASE 5 — QUANTUM ERASER EDUCATIONAL MODE
==================================================

Goal:

Add an educational quantum-eraser-style experiment.

Important physics warning:

Do NOT present the quantum eraser as:

“changing the past.”

Do NOT imply faster-than-light signaling.

Preferred implementation:

Represent path information using an entangled marker degree of freedom.

Show:

- total unsorted detections
- conditional subsets grouped by marker measurement outcome
- how complementary conditional interference patterns can appear
- why the combined distribution does not provide retrocausal signaling

Provide a concise explanatory panel.

Testing:

- aggregate distribution behaves correctly
- conditional subsets reproduce expected complementary correlations
- no UI copy implies causal influence backward in time
- build succeeds

Create:

`05_PHASE_5_QUANTUM_ERASER.md`

STOP AND VERIFY before Phase 6.

==================================================
PHASE 6 — ENTANGLEMENT LAB
==================================================

Goal:

Create pairs of entangled two-level systems / photon-polarization analogues.

UI layout:

Source in center.

Alice station on one side.

Bob station on the other.

Controls:

- Alice detector angle
- Bob detector angle
- pair count
- noise level
- entanglement visibility if useful
- run experiment

Show:

- individual pair outcomes
- accumulated counts
- correlation coefficient

Use a standard pedagogical quantum correlation model.

For a singlet-like spin model:

E(a,b) = -cos(theta_ab)

For photon polarization, if used:

correlations often involve cos(2 theta)

Choose one formulation and document it consistently.

Do not mix spin-1/2 and photon-polarization formulas.

Testing:

- same-angle and orthogonal-angle behavior matches selected model
- random marginal outcomes remain approximately unbiased
- correlations converge statistically
- build succeeds

Create:

`06_PHASE_6_ENTANGLEMENT.md`

STOP AND VERIFY before Phase 7.

==================================================
PHASE 7 — BELL / CHSH TEST
==================================================

Goal:

Allow visitors to run a Bell-test simulation and calculate CHSH S.

Use measurement settings capable of approaching the quantum Tsirelson bound:

|S| <= 2 sqrt(2)

Classical local-hidden-variable benchmark:

|S| <= 2

User should be able to choose:

- Quantum Model
- Classical Local Model

Display:

- E(a,b)
- E(a,b')
- E(a',b)
- E(a',b')
- S value
- sample count
- uncertainty / convergence indicator if practical

Educational message:

A violation of the CHSH bound rules out the relevant class of local-hidden-variable models under the experiment's assumptions.

Do NOT claim that Bell tests prove one philosophical interpretation of quantum mechanics.

Testing:

- classical model does not systematically exceed |S| = 2 except finite-sample statistical fluctuations
- quantum model approaches expected CHSH values with large sample count
- seeded simulations are reproducible
- build succeeds

Create:

`07_PHASE_7_BELL_CHSH.md`

STOP AND VERIFY before Phase 8.

==================================================
PHASE 8 — BUILD YOUR OWN REALITY
==================================================

Goal:

Turn the simulator into an interactive scientific reasoning game.

Allow users to modify a controlled set of model assumptions.

Possible controls:

- local predetermined outcomes
- hidden-variable distribution
- detector noise
- detector efficiency
- correlation strength
- coherence
- measurement dependence toggle ONLY if carefully explained
- entanglement visibility

Challenge:

`Can your model reproduce the quantum correlations while remaining local?`

Compare user model against:

- quantum prediction
- classical local bound
- simulated dataset

Generate a score or comparison such as:

- Bell bound satisfied?
- quantum data matched?
- locality retained?
- parameter cost / assumptions changed?

Do not imply that arbitrary sliders constitute a rigorous alternative physical theory.

The simulator should explicitly identify what assumption was relaxed.

Testing:

- parameter bounds respected
- classical-local preset respects Bell bound
- quantum preset reproduces quantum model
- invalid combinations handled gracefully
- no NaN/Infinity values
- build succeeds

Create:

`08_PHASE_8_BUILD_REALITY.md`

STOP AND VERIFY before Phase 9.

==================================================
PHASE 9 — POLISH / EDUCATION / ACCESSIBILITY
==================================================

Goal:

Make the feature feel like a finished public-facing simulator.

Add where appropriate:

- short experiment introduction
- expandable “What am I seeing?”
- expandable “Show the math”
- glossary
- tooltips
- mobile support
- keyboard accessibility
- reduced-motion support
- accessible contrast
- loading states
- empty states
- error states
- experiment reset
- shareable URL experiment state if straightforward

Avoid walls of text.

Prefer:

experiment -> observation -> explanation -> mathematics

Testing:

- mobile viewport
- desktop viewport
- keyboard navigation
- no major console errors
- build succeeds
- lint passes
- accessibility checks if tooling exists

Create:

`09_PHASE_9_POLISH.md`

STOP AND VERIFY before Phase 10.

==================================================
PHASE 10 — FINAL VERIFICATION
==================================================

Perform a complete project review.

Run:

- full automated test suite
- lint
- type checking
- production build
- simulator-specific physics tests
- major browser/manual checks possible in the environment

Create:

`10_FINAL_VERIFICATION.md`

Include:

## Feature Inventory

## Physics Models

## Simplifications

## Test Results

## Known Limitations

## Known Bugs

## Performance Concerns

## Security Concerns

## Accessibility Status

## Deployment Notes

## Suggested Future Improvements

## Recommended Next Feature

Update:

`QUANTUM_PLAYGROUND_STATUS.md`

to indicate final project status.

---

# 7. PHYSICS TEST SUITE

Create automated physics-oriented tests where practical.

At minimum test mathematical properties such as:

### Probability normalization

Integral / discrete sum of P(x) approximately equals 1.

### Non-negativity

P(x) >= 0 within numerical tolerance.

### Decoherence endpoints

gamma = 1 reproduces coherent pattern.

gamma = 0 reproduces incoherent sum.

### Sampling convergence

Large seeded samples approximately reproduce theoretical distribution.

### Bell classical bound

Classical-local benchmark approaches:

|S| <= 2

### Bell quantum benchmark

Selected quantum settings approach expected S, potentially near:

2 sqrt(2)

within statistical tolerance.

Physics calculations should preferably live separately from rendering code.

Example conceptual structure:

`physics/`
- doubleSlit
- decoherence
- entanglement
- bell
- randomSampling

This is only a suggestion. Adapt to the repository.

---

# 8. ARCHITECTURE GUIDANCE

Prefer separation between:

1. Physics engine
2. Simulation state
3. Rendering
4. UI controls
5. Educational content

Do not bury physics equations inside event handlers or canvas drawing code.

Favor pure functions for physics calculations so they can be independently tested.

Avoid unnecessary dependencies.

If an additional library is proposed, explain why in the phase report.

---

# 9. PERFORMANCE

The simulator may generate hundreds of thousands of detections.

Avoid rendering one permanent DOM node per particle.

Prefer techniques such as:

- Canvas
- WebGL
- efficient SVG aggregation
- histogram binning
- typed arrays
- batched rendering

depending on the existing architecture.

Keep the UI responsive during large runs.

If necessary, use worker threads / Web Workers, but only if justified.

---

# 10. VISUAL STYLE

Aim for:

- dark scientific-lab aesthetic if compatible with the site
- clean instrumentation
- clear detector visualization
- animated particle emission used sparingly
- probability distribution overlay
- obvious experiment controls
- clear distinction between measured events and theoretical predictions

Avoid gimmicks that compromise physics clarity.

Do not redesign unrelated parts of the website.

---

# 11. SECURITY / WEBSITE SAFETY

This feature should be entirely client-side unless there is a compelling reason otherwise.

Do not introduce:

- arbitrary code execution
- unsafe HTML injection
- unnecessary backend endpoints
- secrets
- external tracking
- telemetry

without explicit justification.

---

# 12. GIT / CHANGE MANAGEMENT

Work in small logical changes.

If git access is available:

- inspect `git status` before beginning
- do not overwrite unrelated uncommitted work
- keep modifications scoped to the feature
- do not force-reset user changes

If commits are being created, prefer one logical commit per completed phase.

Example:

`feat: add quantum playground foundation`

`feat: add double slit experiment`

`feat: add decoherence controls`

Do not push or deploy unless explicitly authorized by the repository owner.

---

# 13. FAILURE POLICY

If a phase fails:

DO NOT pretend it succeeded.

Create a report such as:

`XX_PHASE_N_BLOCKED.md`

Include:

- exact failure
- reproduction steps
- logs or error summary
- suspected root cause
- attempted fixes
- recommended next action

Update:

`QUANTUM_PLAYGROUND_STATUS.md`

with:

`STATUS: BLOCKED`

A scientifically incorrect implementation counts as a failed phase even if the software runs.

---

# 14. DO NOT OVER-ENGINEER

The first objective is a working, testable educational simulator.

Do not introduce:

- microservices
- databases
- authentication
- server-side simulation clusters
- unnecessary state management frameworks

unless the existing website already requires them.

---

# 15. HANDOFF PROTOCOL

At the end of each phase, the repository owner may send the phase Markdown report to another AI assistant for review.

Therefore reports must contain enough context for an outside reviewer to understand:

- what existed before
- what was changed
- what equations were used
- what passed
- what failed
- what should happen next

Never write vague reports such as:

“Phase 3 complete. Everything works.”

Give concrete technical and physics details.

---

# 16. OWNER REVIEW CHECKPOINTS

The following phases are especially important review points:

After Phase 2:
Verify the double-slit model before building on it.

After Phase 4:
Verify the measurement/decoherence interpretation.

After Phase 7:
Verify Bell / CHSH implementation carefully.

After Phase 8:
Review whether “Build Your Own Reality” is scientifically clear and not misleading.

The owner may pause the project at these points.

---

# 17. OPTIONAL FUTURE FEATURES — DO NOT IMPLEMENT YET

Do not build these during the initial project unless explicitly instructed later.

Potential follow-on modules:

- wavepacket evolution
- tunneling
- finite potential wells
- harmonic oscillator
- spin measurement
- Bloch sphere
- delayed-choice demonstrations
- Mach-Zehnder interferometer
- quantum teleportation
- quantum computing gates
- quantum field visualization
- vacuum fluctuations
- particle creation / annihilation visualization
- simplified Feynman diagrams
- QFT field-excitation playground

Document worthwhile ideas in the final report.

---

# 18. START NOW

Begin with repository inspection and Phase 1 only.

Your immediate tasks are:

1. inspect the repository
2. create `00_INITIAL_ASSESSMENT.md`
3. create `QUANTUM_PLAYGROUND_STATUS.md`
4. implement Phase 1
5. test Phase 1
6. create `01_PHASE_1_FOUNDATION.md`
7. update status
8. stop after Phase 1 unless explicitly instructed to continue automatically

IMPORTANT:

If the repository owner has explicitly told you to proceed through all phases without waiting for approval, then continue sequentially, but still perform every checkpoint, test suite, and Markdown report.

Otherwise STOP after Phase 1 and report completion.

Do not skip directly to the visually impressive parts.

Build the physics foundation correctly first.
