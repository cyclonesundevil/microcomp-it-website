# Quantum Playground Initial Assessment

## Current architecture

The public website is a vanilla HTML, CSS, and JavaScript application served from `frontend/` by a Quart application in `backend/app.py`. Quart mounts the frontend directory at the site root, so a new HTML file automatically becomes a public route without a backend endpoint. The repository does not use a root JavaScript package manager, bundler, component framework, or compilation step.

Existing scientific experiences use standalone pages, ES modules for pure scientific calculations, Canvas or vendored Three.js for efficient rendering, and controller scripts for UI state. Shared visual tokens and three color schemes (`dark`, `moderate`, and `light`) live in `frontend/styles.css` and `frontend/theme.js`.

Tests under `tests/` use Node's built-in `node:test` runner and import browser-independent `.mjs` modules directly. Python backend tests use `unittest`.

## Relevant files

- `backend/app.py`: Quart server and static frontend mount.
- `frontend/demo-lab.html`: public directory of interactive experiences.
- `frontend/styles.css`: shared navigation, theme tokens, and common public-page styles.
- `frontend/theme.js`: persistent three-theme controller.
- `frontend/black-hole-model.mjs`: representative pure scientific model.
- `frontend/black-hole-playground.html` and `.js`: representative scientific simulator structure.
- `tests/black-hole-model.test.js`: representative Node physics and page-integration tests.
- `tests/theme.test.js` and `tests/site-credibility.test.js`: shared public-page expectations.
- `frontend/sitemap.xml`: explicit list of indexable public pages.

## Proposed implementation location

Phase 1 will use:

- `frontend/quantum-playground.html`: semantic page shell and controls.
- `frontend/quantum-playground.css`: feature-scoped responsive instrumentation styles.
- `frontend/quantum-playground-model.mjs`: pure probability, seeded-random, and sampling functions.
- `frontend/quantum-playground.js`: state, Canvas rendering, and UI controller.
- `tests/quantum-playground-model.test.js`: deterministic physics and integration tests.
- `docs/quantum-playground/`: permanent phase reports.

The page will be linked from `frontend/demo-lab.html` and listed in the sitemap. No backend endpoint is required.

## Dependencies already available

- Native ES modules.
- Canvas 2D.
- Node's built-in test runner.
- Shared theme CSS variables.
- Font Awesome and Inter on existing public pages.

## Dependencies proposed

None for Phase 1. Native Canvas and typed arrays are sufficient, keep deployment simple, and match the existing repository.

## Risks

- Canvas output must remain understandable to keyboard and screen-reader users through textual live summaries.
- Large batches must update aggregate buffers rather than create one DOM element per particle.
- Seed parsing and random sampling must be deterministic across test and browser environments.
- Later phases must not bury quantum formulas in rendering code.
- Visual particle motion is illustrative; it must not be described as an observation of an unmeasured trajectory.
- The working tree already contains unrelated branded-email changes. Quantum work must not overwrite or stage those changes.

## Compatibility concerns

- The controller uses ES modules and Canvas 2D, supported by current evergreen browsers.
- The feature must honor `prefers-reduced-motion`.
- The shared theme controller must load before the feature stylesheet to avoid a theme flash where practical.
- Static asset query versions should follow existing cache-busting conventions.
- No server-side simulation or secret-bearing configuration will be introduced.

## Testing strategy

1. Unit-test probability normalization, non-negativity, bounds, seeded reproducibility, and sampling convergence in Node.
2. Test page structure, required controls, experiment placeholders, accessibility labels, and script/style wiring.
3. Run existing theme and site-credibility tests after registering the page as public.
4. Run the complete root Node test suite.
5. Verify Python syntax and relevant backend tests to detect unrelated server regressions.
6. Manually verify the page through the local Quart server at desktop and narrow viewport sizes when practical.

## Recommended phased plan

1. **Foundation / shell:** single-particle Gaussian detection model, seeded sampling, Canvas detector history, batch/run/pause/reset controls, and experiment placeholders.
2. **Double slit:** coherent two-amplitude probability distribution and statistical emergence.
3. **Which path:** coherent versus incoherent probability comparison.
4. **Decoherence:** continuous phenomenological coherence parameter.
5. **Quantum eraser:** marker degree of freedom and conditional subsets.
6. **Entanglement:** consistently selected singlet-like correlation model.
7. **Bell / CHSH:** quantum and local-hidden-variable comparisons.
8. **Build Your Own Reality:** controlled assumption exploration.
9. **Polish:** education, accessibility, mobile, and shareable state.
10. **Final verification:** full physics, integration, performance, and accessibility audit.

## Architectural conclusion

There is no blocking architecture problem. A dependency-free static module is the smallest and most compatible implementation. Physics will remain in pure functions, separate from state and rendering, so later experiments can extend the engine without rewriting the page shell.
