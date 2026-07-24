# Acceptance Criteria and Test Plan

## Global safety tests

- [ ] No scenario sends requests to user-controlled destinations.
- [ ] No live packet capture exists.
- [ ] No raw socket or OS command execution exists.
- [ ] No exploit or malware payload is generated.
- [ ] No user credentials are requested or stored.
- [ ] All addresses are synthetic/reserved.
- [ ] Exported reports contain only synthetic data.
- [ ] Every scenario visibly states that it is simulated.

## Core interaction tests

- [ ] User can select every scenario.
- [ ] User can change difficulty.
- [ ] User can start, pause, resume, step, reset, and replay.
- [ ] Speed controls affect virtual time.
- [ ] Same seed and configuration reproduce the same outcome.
- [ ] Defense toggles alter results.
- [ ] Filters update charts and tables consistently.
- [ ] Selecting a flow highlights associated nodes.
- [ ] Selecting an alert shows a plain-language explanation.
- [ ] Results report appears after completion.

## Scenario tests

For each of the eleven scenarios:

- [ ] baseline traffic appears before the attack phase;
- [ ] at least three meaningful indicators appear;
- [ ] at least two defenses affect the outcome;
- [ ] a defended run differs measurably from an undefended run;
- [ ] post-run recommendations are scenario-specific;
- [ ] no functional attack instructions appear.

## Accessibility tests

- [ ] all interactive elements are keyboard reachable;
- [ ] focus order is logical;
- [ ] visible focus is present;
- [ ] severity is not communicated by color alone;
- [ ] topology has a text summary;
- [ ] reduced-motion mode removes nonessential animation;
- [ ] controls have accessible names;
- [ ] charts have summaries;
- [ ] contrast is acceptable.

## Responsive tests

- [ ] desktop layout works at common widescreen sizes;
- [ ] tablet layout remains usable;
- [ ] mobile controls remain reachable;
- [ ] tables do not break the viewport;
- [ ] topology has a compact alternative.

## Performance tests

- [ ] high-volume DDoS events are aggregated;
- [ ] long tables are virtualized or capped;
- [ ] animation remains responsive;
- [ ] hidden tabs reduce work;
- [ ] route is lazy-loaded where appropriate;
- [ ] production bundle impact is reviewed.

## Build and regression tests

- [ ] lint passes;
- [ ] type checks pass;
- [ ] unit tests pass;
- [ ] integration tests pass;
- [ ] production build passes;
- [ ] existing Demo Lab pages still function;
- [ ] existing navigation remains intact.
