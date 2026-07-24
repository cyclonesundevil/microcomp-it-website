# Recommended Implementation Plan

## Phase 0 — Repository discovery

- inspect existing stack;
- locate Demo Lab;
- identify routing and layout conventions;
- identify current visual components;
- confirm testing and build commands;
- document findings.

## Phase 1 — Lab shell

Build:

- route;
- page header;
- safety notice;
- scenario selector;
- empty topology panel;
- empty metrics and alerts panels;
- responsive layout.

## Phase 2 — Shared simulation engine

Build:

- virtual clock;
- scenario loader;
- seeded randomness;
- event reducer;
- pause/resume/step/reset;
- baseline traffic generator;
- report generator.

Add unit tests before scenarios multiply.

## Phase 3 — DoS/DDoS reference scenario

Implement a complete vertical slice:

- scenario configuration;
- normal baseline;
- attack phases;
- topology animation;
- charts;
- alerts;
- defenses;
- guided checkpoints;
- result report.

Use it to validate engine and UI patterns.

## Phase 4 — Network traffic analysis

Add:

- flow table;
- filters;
- topology selection;
- protocol aggregation;
- time-window selection;
- host inspection;
- event-to-alert correlation;
- plain-language explanations.

## Phase 5 — Additional scenarios

Suggested order:

1. password attacks;
2. eavesdropping;
3. MitM;
4. SQL injection;
5. XSS;
6. phishing;
7. malware;
8. insider threat;
9. zero-day;
10. APT.

This order moves from simpler traffic patterns to longer multi-stage scenarios.

## Phase 6 — Comparative defense mode

Allow:

- rerun with same seed;
- compare two runs;
- before/after metric deltas;
- defense benefit and trade-off summary.

## Phase 7 — Accessibility and performance

- keyboard test;
- screen-reader labels;
- reduced motion;
- non-color status indicators;
- table virtualization;
- animation limits;
- responsive review.

## Phase 8 — Quality and release

- unit tests;
- integration tests;
- production build;
- lint/type checks;
- route smoke test;
- no-external-target audit;
- documentation;
- deployment verification.

## Codex working style

Codex should:

- make small, reviewable commits or change groups;
- explain architectural decisions;
- run tests after each phase;
- avoid broad refactoring;
- preserve existing styling;
- record follow-up work in documentation;
- stop and report if repository assumptions are incorrect.
