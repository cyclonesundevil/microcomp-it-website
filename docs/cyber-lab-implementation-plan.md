# Cybersecurity Simulation Lab Implementation Plan

## Repository findings

- The frontend is a dependency-free static site built with HTML, CSS, and browser JavaScript; pages are file-based routes under `frontend/`.
- Shared conventions are `styles.css`, `theme.js`, `analytics.js`, the `.navbar`/`.site-footer` layout, Font Awesome icons, responsive CSS, semantic controls, and ARIA labels.
- `demo-lab.html` is the existing interactive-demo directory. The production backend serves static frontend files and is not required for this simulation.
- Deployment assumes directly served static assets, so the preferred route is `frontend/demo-lab/cybersecurity-simulation.html`, with a compatibility redirect at `frontend/cybersecurity-simulation.html`.

## Implementation phases

1. Add the lab page shell, responsive workspace, persistent simulated-environment notice, navigation entry, and accessible control structure.
2. Build a presentation-independent deterministic engine with seeded randomness, a virtual clock, reducers, scenario definitions, defense effects, replay, and report serialization.
3. Render an accessible SVG network topology, animated synthetic flows, metric charts, stage indicator, alerts, event log, host cards, and flow inspection table.
4. Complete DoS/DDoS as the reference scenario, including guided explanations, defense comparisons, filtering, and report export.
5. Add all ten remaining abstract scenarios using the shared event model and documentation-only addresses, without functional payloads or external activity.
6. Add reduced-motion behavior, keyboard/focus support, mobile layouts, live-region summaries, bounded event rendering, and JSON/CSV synthetic report downloads.
7. Add dependency-free engine/reducer unit tests and browser integration smoke tests, document the scenario extension format, and verify tests plus a static production smoke check.

## Safety and scope

- The engine will generate metadata-only events locally and deterministically. It will not use `fetch`, sockets, user-supplied targets, credentials, executable payloads, shell commands, or backend APIs.
- All hosts will use RFC documentation ranges and fictional `.test` names; all exported data will be clearly labeled synthetic.
- Existing pages and backend behavior will remain unchanged except for the Demo Lab navigation/card link and shared styles required by the new page.
