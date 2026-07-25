# Cybersecurity Simulation Lab — Full UI/UX Test Report

Test date: 2026-07-24  
Target: `http://localhost:8080/demo-lab/cybersecurity-simulation.html`  
Application changes made: **None**  
Automation: Playwright Core driving system Google Chrome, plus axe-core and manual artifact review

## Executive summary

| Measure | Result |
|---|---|
| Overall result | **Pass with issues** |
| Scenarios tested | 11 of 11 |
| Browsers tested | 1: Chromium (Google Chrome) |
| Browser availability | Firefox and WebKit binaries were not available |
| Viewport configurations | 4: 1440×1000, 1280×720, 768×1024, 390×844 |
| Defects found | 5 |
| Highest severity | Medium |
| Release recommendation | **Ready after minor fixes** |

The simulation is functionally stable. All eleven scenarios completed, exposed scenario-specific briefing/outcome/report content, responded to defenses, replayed deterministically, and reset without stale runtime state. All seventeen defenses were exercised individually in an enabled-versus-disabled run; each appeared in the enabled report, disappeared as a triggered control when disabled, and measurably changed the result. Twenty consecutive mixed runs completed without progressive DOM growth or loss of responsiveness.

The release blockers are not simulation-engine failures. The most important issues are WCAG contrast on the header Contact button, an accessibility conflict caused by a `role="img"` topology containing focusable controls, and analytics requests that fail against the tested localhost deployment. Two generic containers also use unsupported `aria-label` attributes. No body-level horizontal overflow occurred at any requested viewport.

## Scope and method

- The deployed localhost page was exercised through Chromium, not inferred only from source.
- Initial dark and light screenshots were captured at all four viewports.
- Every scenario was run from briefing through active attack, active defense, completion, replay, and reset.
- Guided and free-play modes were distributed across scenario runs.
- Normal and reduced motion were both exercised.
- Responsive layout was checked for every scenario at all four viewport widths.
- Controls, filtering, keyboard inspection, downloads, deterministic seed/speed behavior, live state, and repeat use were exercised.
- axe-core was used as supplemental evidence; keyboard focus and critical semantics were also checked directly.

Limitations:

- Firefox and WebKit could not be tested because their browser binaries were unavailable.
- Memory was assessed indirectly through repeat-use responsiveness and DOM counts; browser heap profiling was not available in this test setup.
- Visual contrast was manually reviewed in both themes, but only the Chromium/axe combination produced computed automated contrast evidence.

## Initial page inspection

| Check | Result | Evidence |
|---|---|---|
| Page and local assets load | Pass | All document, CSS, and JavaScript routes loaded; no Playwright `requestfailed` events |
| JavaScript exceptions | Pass | No page exceptions or unhandled promise rejections |
| Console quality | Issue | Analytics POSTs returned 501; one unidentified 404 console entry was observed |
| External requests | Expected dependency | Google Fonts stylesheet and Inter font were requested |
| Core content present | Pass | Navigation, headings, controls, topology, charts, alerts, events, report surface, and teaching content rendered |
| Body horizontal scrolling | Pass | Document width equaled viewport width at all four viewports |
| Intentional horizontal surfaces | Pass | Scenario carousel and event table remain internally scrollable where needed |
| Initial state clarity | Pass | “Ready,” empty alerts/events/report messages, scenario brief, disabled exports, and Start state were understandable |
| Disabled controls | Pass | Pause, Step, Replay, and exports were visibly unavailable where their action was not valid |
| Focus visibility | Pass | Sampled links, buttons, scenario cards, fields, and selects exposed a solid 3px focus outline |
| Light/dark readability | Pass with issue | General content was readable; the cyan Contact button failed contrast |

Initial screenshots:

- Desktop: [dark](ui-test-artifacts/initial-desktop-dark.png), [light](ui-test-artifacts/initial-desktop-light.png)
- Laptop: [dark](ui-test-artifacts/initial-laptop-dark.png), [light](ui-test-artifacts/initial-laptop-light.png)
- Tablet: [dark](ui-test-artifacts/initial-tablet-dark.png), [light](ui-test-artifacts/initial-tablet-light.png)
- Mobile: [dark](ui-test-artifacts/initial-mobile-dark.png), [light](ui-test-artifacts/initial-mobile-light.png)

## Test matrix

Legend: `P` = passed directly; `P*` = functional behavior was fully exercised at desktop and responsive rendering/availability was directly checked at this viewport; `I` = passed with the documented shared accessibility issues. “Controls” covers selection/start/pause/step/configuration availability; “Progress” covers baseline through completion; “Defense” covers visible and measurable control behavior.

| Scenario | Viewport | Load | Controls | Progress | Defense | Report | Replay | Reset | Layout | A11y | Result |
|---|---:|---|---|---|---|---|---|---|---|---|---|
| DoS & DDoS | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| DoS & DDoS | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| DoS & DDoS | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| DoS & DDoS | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Man-in-the-Middle | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| Man-in-the-Middle | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Man-in-the-Middle | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Man-in-the-Middle | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Phishing & Spear Phishing | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| Phishing & Spear Phishing | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Phishing & Spear Phishing | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Phishing & Spear Phishing | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Malware Outbreak | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| Malware Outbreak | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Malware Outbreak | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Malware Outbreak | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| SQL Injection | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| SQL Injection | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| SQL Injection | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| SQL Injection | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Zero-Day Exploit | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| Zero-Day Exploit | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Zero-Day Exploit | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Zero-Day Exploit | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Cross-Site Scripting | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| Cross-Site Scripting | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Cross-Site Scripting | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Cross-Site Scripting | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Password Attacks | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| Password Attacks | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Password Attacks | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Password Attacks | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Advanced Persistent Threat | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| Advanced Persistent Threat | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Advanced Persistent Threat | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Advanced Persistent Threat | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Eavesdropping & Packet Sniffing | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| Eavesdropping & Packet Sniffing | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Eavesdropping & Packet Sniffing | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Eavesdropping & Packet Sniffing | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Insider Threat | 1440×1000 | P | P | P | P | P | P | P | P | I | Pass with issues |
| Insider Threat | 1280×720 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Insider Threat | 768×1024 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |
| Insider Threat | 390×844 | P | P* | P* | P* | P* | P* | P* | P | I | Pass with issues |

Scenario screenshots are stored as:

- `ui-test-artifacts/<scenario>-01-briefing.png`
- `ui-test-artifacts/<scenario>-02-active-attack.png`
- `ui-test-artifacts/<scenario>-03-active-defense.png`
- `ui-test-artifacts/<scenario>-04-completed-report.png`

The scenario identifiers are `dos`, `mitm`, `phishing`, `malware`, `sqli`, `zeroday`, `xss`, `password`, `apt`, `eavesdropping`, and `insider`.

## Scenario, control, and consistency results

### Scenario coverage

All scenarios passed these direct checks:

- selection changed the briefing title, objective, indicators, attack stages, topology path, metrics vocabulary, and final scenario outcomes;
- relevant defense checkboxes rendered and were interactive;
- Start progressed from baseline to active stages and completion;
- topology, flows, metrics, alerts, event rows, guidance/outcome cards, and reports updated;
- the final report used the selected scenario’s objective, indicators, assets, controls, and outcome metrics;
- same-seed replay produced identical stable report values for every scenario;
- reset hid the report, cleared event rows and alerts, restored the inspector prompt, and returned status to tick zero.

No contradictory outcome was observed between the topology, metrics, event/alert logs, outcome cards, and final reports in the captured runs. Detective controls were reported as `detective`/`detected`; they were not counted as preventive blocks. Preventive controls reduced, protected, isolated, filtered, contained, or restricted the applicable synthetic activity.

### Playback and configuration controls

| Control | Result |
|---|---|
| Scenario selector/search | Pass; all eleven options selected and active scenario exposed with `aria-current="true"` |
| Difficulty | Pass; Advanced selection retained through reset/run |
| Deterministic seed | Pass; seed 98765 retained and reported |
| Guided mode | Pass; teaching checkpoints rendered and announced |
| Free play | Pass; guide card was hidden and checkpoint instruction was not presented |
| Reduced motion | Pass; motion status changed to a plain-language static-flow explanation |
| Start | Pass; state, metrics, and events advanced; repeated lifecycle use did not create duplicate growth |
| Pause | Pass; tick remained at 4/24 during a 700 ms wait |
| Resume | Pass; resumed from tick 4 and advanced normally |
| Step | Pass; advanced exactly from 4/24 to 5/24 and remained paused |
| Pause accessibility | Pass; `aria-pressed="true"` and label “Resume simulation activity” were exposed |
| Reset | Pass; report, events, alerts, filters, live announcement, and inspector selection cleared |
| Replay | Pass; stable report outcome was identical for all eleven scenarios |
| Speed | Pass; 1× and 4× produced identical deterministic report outcomes |
| Recovery | Pass in DoS lifecycle; completion and report reflected the configured recovery phase |

### Defense controls

All 17 controls passed individual browser-level enabled/disabled isolation:

`rateLimiting`, `trafficFiltering`, `caching`, `autoscaling`, `upstreamProtection`, `waf`, `mfa`, `accountLockout`, `segmentation`, `encryption`, `endpointProtection`, `emailFiltering`, `leastPrivilege`, `anomalyDetection`, `ids`, `patchManagement`, and `dlp`.

For each control:

- the checkbox accepted keyboard/browser interaction and showed the checked state;
- an enabled run named the control in its final report;
- the enabled run’s residual score/counter summary differed from the disabled replay;
- the disabled run did not claim the control triggered;
- preventive/detective terminology matched the control type.

One layered-behavior observation: when every DoS defense is enabled simultaneously, upstream protection and filtering can remove enough traffic that rate limiting has nothing left to trigger on. Rate limiting did trigger and measurably change results in its isolated test. This is consistent layered-control behavior, not a defect.

### Filters and inspection

| Check | Result |
|---|---|
| Protocol | Pass; populated from event data and reduced the visible list where applicable |
| Source | Pass; “Load Balancer” reduced 100 events to 18 |
| Destination | Pass; combination with “Web Service” retained the matching 18 |
| Time | Pass; adding “Last 5 ticks” reduced the combination to 5 |
| Severity | Pass; severity combination changed visible results |
| Combined filters | Pass |
| Empty result | Pass; displayed “No synthetic flows match these filters.” |
| Clear filters | Pass; restored all 100 retained events |
| Engine isolation | Pass; filter changes did not alter report totals |
| Node inspection | Pass by keyboard Enter; showed host name, documentation IP, type, status, and event count |
| Flow inspection | Pass by keyboard Enter; showed marker, source/destination, fictional volume, and safety statement |
| Stale selection | Pass; reset restored the generic inspector prompt |

### Exports

JSON and CSV downloads succeeded for DoS/DDoS, phishing, SQL injection, malware, and APT.

- filenames included `microcompit-synthetic-<scenario>-report`;
- JSON identity matched the selected scenario, seed 4242, Beginner difficulty, and `synthetic: true`;
- CSV rows had consistent column counts;
- no private IPv4 addresses were found;
- no executable script marker, JavaScript URL, credential assignment, authorization header, or bearer token was found;
- no download failed.

Export artifacts and detailed validation are in [filter-export-validation.json](ui-test-artifacts/filter-export-validation.json).

## Accessibility results

Manual/interaction checks:

- keyboard focus reached skip link, navigation, theme control, all eleven scenario cards, configuration fields, and playback controls in logical order;
- focus was visibly rendered with a solid 3px outline;
- node and flow inspection worked with Enter;
- active scenario and pause state were programmatically exposed;
- run status used a polite live region;
- no duplicate IDs were found;
- heading order began with one H1 and used H2 section headings with H3 subsections;
- hidden report/inbox surfaces were not rendered as visible content in their inactive state.

axe-core found two serious-rule violations:

1. Contact button contrast: white `#fff` on cyan `#00f0ff` measured 1.4:1; 4.5:1 is required for its text size.
2. Nested interactive controls: `#topology` has `role="img"` but contains focusable host buttons.

axe also marked two serious items incomplete for manual review: `.metric-grid` and `.filters` apply `aria-label` to generic `div` elements without a supporting role. These are recorded as a defect because the label is not reliably exposed.

## Error, network, and stress results

| Area | Result |
|---|---|
| JavaScript exceptions | None |
| Unhandled promise rejections | None |
| Console warnings | None |
| Failed Playwright network requests | None |
| Local HTTP errors | `/api/track` POST returned 501 under the static localhost server |
| Other console error | One unidentified 404 “File not found” entry |
| External traffic | Google Fonts CSS and Inter WOFF2 only |
| Missing core assets | None |
| Stress runs | 20 consecutive mixed-scenario runs completed |
| Stress elapsed time | 29.0 seconds in step-accelerated headless execution |
| DOM count | 856–1,802 depending on scenario/report size; repeated scenarios returned to the same range |
| Progressive growth | Not observed |
| Stale reports/inspectors | Not observed after reset |
| Duplicate old-timer events | Not observed |

The repeated high DOM count for DoS (approximately 1,800) is explained by its larger retained event/report surface. Repeating DoS returned to the same count rather than increasing.

## Defects

### UI-001 — Contact button text fails WCAG contrast

- Severity: **Medium**
- Scenario: Shared page header
- Browser: Chromium
- Viewport: All; measured at 1440×1000
- Reproduction:
  1. Open the lab.
  2. Inspect or scan the Contact link.
  3. Compare the white text against its cyan background.
- Expected: Text meets WCAG 2 AA contrast (at least 4.5:1 for this size).
- Actual: axe measured 1.4:1 (`#fff` on `#00f0ff`).
- Evidence: [initial desktop dark screenshot](ui-test-artifacts/initial-desktop-dark.png), [raw results](ui-test-artifacts/ui-test-results.json)
- Likely component: `frontend/styles.css` `.btn-primary`

### UI-002 — Topology image role contains interactive host buttons

- Severity: **Medium**
- Scenario: All
- Browser: Chromium
- Viewport: All
- Reproduction:
  1. Open the lab.
  2. Run axe-core or inspect `#topology`.
  3. Observe `role="img"` on the container and focusable `[data-host]` buttons inside it.
- Expected: Interactive topology controls retain their own accessible semantics within an appropriate group/region structure.
- Actual: The image role semantically flattens descendants for some assistive technologies; axe reports `nested-interactive`.
- Evidence: [axe results](ui-test-artifacts/ui-test-results.json)
- Likely component: `frontend/demo-lab/cybersecurity-simulation.html` and `frontend/cyber-lab.js`

### UI-003 — Analytics tracking fails on the deployed localhost server

- Severity: **Medium**
- Scenario: Shared
- Browser: Chromium
- Viewport: All
- Reproduction:
  1. Open the lab with the console/network panel active.
  2. Allow page analytics to initialize and exercise tracked actions.
  3. Inspect `/api/track`.
- Expected: Tracking succeeds, is disabled in an unsupported static environment, or fails silently without console errors.
- Actual: `POST http://localhost:8080/api/track` returned HTTP 501 and generated console errors.
- Evidence: [supplemental results](ui-test-artifacts/ui-test-supplement.json)
- Likely component: `frontend/analytics.js` and the localhost/static-server deployment

### UI-004 — Labels on metric/filter containers are not reliably exposed

- Severity: **Low**
- Scenario: All
- Browser: Chromium
- Viewport: All
- Reproduction:
  1. Inspect `.metric-grid` and `.filters`.
  2. Run axe-core.
- Expected: Group labels are attached to elements with supported grouping semantics.
- Actual: Both are generic `div` elements with `aria-label` but no valid role; axe marks `aria-prohibited-attr` for review.
- Evidence: [axe results](ui-test-artifacts/ui-test-results.json)
- Likely component: `frontend/demo-lab/cybersecurity-simulation.html`

### UI-005 — Unidentified 404 console error on initial load

- Severity: **Low**
- Scenario: Shared
- Browser: Chromium
- Viewport: All
- Reproduction:
  1. Open the lab in a new Chromium context.
  2. Observe the console during initial load.
- Expected: No missing-resource console errors.
- Actual: Chromium logged one `404 (File not found)` entry. All declared core CSS/JS assets loaded, and the failing URL was not exposed in the console message captured by Playwright.
- Evidence: [raw results](ui-test-artifacts/ui-test-results.json)
- Likely component: Optional browser-requested asset or deployment configuration; confirm with DevTools preserving full response URLs

## UX observations

These observations are not classified as software defects:

- The page is information-dense on mobile. It remains usable and avoids body overflow, but users must scroll through briefing, topology, controls, charts, logs, and report sections before seeing the complete story.
- The scenario selector intentionally scrolls horizontally at narrow widths. Its clipped next card suggests more content, but an explicit “swipe/scroll for more scenarios” cue would improve discoverability.
- The event table’s internal horizontal scrolling is appropriate, though its nine columns are difficult to compare on mobile.
- A defense may be enabled before the simulation stage where it can act. The “No defense triggered on this virtual tick” message is accurate but can initially look like the control failed; an additional “armed—waiting for applicable activity” state would be clearer.
- Detective versus preventive metadata is useful and accurate, but the terms may require explanation for novice users.
- The final reports are specific and comprehensive, but long defense/outcome sections are visually dense. Collapsible evidence sections could improve scanning without removing detail.
- The static-flow explanation in reduced-motion mode is strong: it explicitly tells users which non-motion cues preserve meaning.
- Initial disabled exports and empty-state copy clearly explain how to generate a report.

## Release recommendation

**Ready after minor fixes.**

The simulation behavior, responsive layout, deterministic replay, reset behavior, defenses, filtering, inspection, exports, and repeat-use stability are suitable for release. Before public release, fix UI-001 and UI-002 because they directly affect accessibility, and resolve or suppress the failed analytics requests in UI-003. UI-004 and UI-005 should be included in the same cleanup if practical.

After those changes, run a focused Chromium accessibility/console regression and add Firefox/WebKit coverage when those binaries are available.

## Artifact index

- [Primary raw run](ui-test-artifacts/ui-test-results.json)
- [Defense/export/replay supplement](ui-test-artifacts/ui-test-supplement.json)
- [Individual defense isolation](ui-test-artifacts/defense-isolation-results.json)
- [Filter and export validation](ui-test-artifacts/filter-export-validation.json)
- [Primary Playwright harness](ui-test-artifacts/run-ui-test.cjs)
- [Supplemental harness](ui-test-artifacts/run-ui-supplement.cjs)
- [Defense isolation harness](ui-test-artifacts/run-defense-isolation.cjs)
- [Filter/export harness](ui-test-artifacts/run-filter-validation.cjs)

## Focused defect remediation

Remediation date: 2026-07-24  
Scope: UI-001 through UI-005 only; scenario and simulation logic were not changed.

### UI-001 — Contact button contrast

- Fix applied: Added theme-specific primary-button foreground, hover, and active colors. Dark mode now uses dark text on cyan; light mode retains white text on a darker teal. Explicit focus-visible and disabled states preserve a prominent, distinguishable control.
- Files changed: `frontend/styles.css`
- Validation performed:
  - automated contrast assertions cover normal, hover, and active colors in both themes;
  - computed Chromium contrast was 13.41:1 in dark mode and 4.94:1 in light mode for the normal Contact button;
  - hover, focus, and active computed contrast remained above 4.5:1;
  - a 3px focus outline remains defined;
  - axe no longer reports the Contact button.
- Final status: **Resolved**

### UI-002 — Topology accessibility semantics

- Fix applied: Replaced the incompatible `role="img"` container with a named `role="group"` using the existing topology heading and the live topology/motion summaries as its description. Removed controller code that overwrote the group’s accessible name. The generated SVG remains `aria-hidden="true"` and host buttons retain their labels and button semantics.
- Files changed: `frontend/demo-lab/cybersecurity-simulation.html`, `frontend/cyber-lab.js`
- Validation performed:
  - axe no longer reports `nested-interactive`;
  - all 15 rendered host buttons were reached, focused, and activated with keyboard Enter in every viewport/theme configuration;
  - every activation updated the selection inspector;
  - static tests verify the group, name, description, decorative SVG, and button markup.
- Final status: **Resolved**

### UI-003 — Unsupported localhost analytics

- Fix applied: Analytics initialization now exits on `localhost`, `127.0.0.1`, `[::1]`, and `file:` pages. Production sendBeacon/fetch behavior remains unchanged.
- Files changed: `frontend/analytics.js`
- Validation performed:
  - no `/api/track` request occurred in any of the four focused browser configurations;
  - no analytics console error occurred;
  - static tests verify both the development guard and retained production submission path.
- Final status: **Resolved**

### UI-004 — Unsupported labels on generic containers

- Fix applied: Converted the metrics container to a native named `section` with a visually hidden heading. Converted traffic filters to a native `fieldset` with a visually hidden `legend`. Reset fieldset border/padding/min-width while preserving the existing responsive grid.
- Files changed: `frontend/demo-lab/cybersecurity-simulation.html`, `frontend/cyber-lab.css`
- Validation performed:
  - axe no longer reports or flags `aria-prohibited-attr` for either group;
  - Chromium exposed `SECTION`/`current-metrics-title` and `FIELDSET`/`Traffic filters`;
  - desktop and mobile screenshots showed no body overflow or layout regression.
- Final status: **Resolved**

### UI-005 — Initial-load 404

- Fix applied: Chrome DevTools Protocol identified the missing resource as `http://localhost:8080/favicon.ico`. Added a local MicroComp IT SVG favicon and an explicit page `<link rel="icon">`.
- Files changed: `frontend/favicon.svg`, `frontend/demo-lab/cybersecurity-simulation.html`
- Validation performed:
  - the focused test recorded complete response URLs/statuses through Chrome’s network protocol;
  - the favicon loaded from `http://localhost:8080/favicon.svg`;
  - no 4xx or 5xx response occurred at 1440×1000 or 390×844 in either theme.
- Final status: **Resolved**

### Focused regression result

| Configuration | Contact contrast | Topology keyboard | Targeted axe findings | `/api/track` | HTTP 4xx/5xx | Console/page errors | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| 1440×1000 dark | Pass | 15/15 | None | None | None | None | Pass |
| 1440×1000 light | Pass | 15/15 | None | None | None | None | Pass |
| 390×844 dark | Pass | 15/15 | None | None | None | None | Pass |
| 390×844 light | Pass | 15/15 | None | None | None | None | Pass |

“Targeted axe findings” covers `color-contrast` on Contact, `nested-interactive`, and `aria-prohibited-attr`. The complete axe scan still identifies two pre-existing, out-of-scope opportunities: light-theme defense tradeoff copy contrast and keyboard focusability of the horizontally scrollable event table on mobile. They were not introduced by these fixes and should be evaluated in a future accessibility pass.

Regression summary:

- 68 Node tests passed.
- `frontend/analytics.js`, `frontend/cyber-lab.js`, and `frontend/cyber-lab-engine.js` passed `node --check`.
- Deterministic engine and report tests remained unchanged and passed.
- No JavaScript exception, console error/warning, failed localhost analytics request, or HTTP 4xx/5xx response occurred.
- No body-level horizontal overflow occurred.

Remediation artifacts:

- [Focused regression results](ui-test-artifacts/remediation/focused-regression-results.json)
- [Desktop dark screenshot](ui-test-artifacts/remediation/desktop-dark.png)
- [Desktop light screenshot](ui-test-artifacts/remediation/desktop-light.png)
- [Mobile dark screenshot](ui-test-artifacts/remediation/mobile-dark.png)
- [Mobile light screenshot](ui-test-artifacts/remediation/mobile-light.png)
- [Focused Playwright harness](ui-test-artifacts/remediation/run-focused-regression.cjs)
