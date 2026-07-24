# Technical Architecture

## Architectural principle

Separate the simulation domain from the rendering layer.

Recommended layers:

1. **Scenario definitions**
2. **Simulation engine**
3. **State store**
4. **Selectors and derived metrics**
5. **Visualization components**
6. **Teaching/explanation layer**
7. **Report generator**

## Frontend-first design

Prefer a client-side implementation unless the existing site architecture requires otherwise.

Benefits:

- no live target infrastructure;
- easier abuse prevention;
- deterministic replay;
- lower operational cost;
- simpler deployment;
- offline-capable simulation.

## Suggested module structure

Adapt names to the existing repository conventions.

```text
src/
  features/
    cyberLab/
      components/
        AttackSelector
        ControlPanel
        NetworkTopology
        TrafficCharts
        FlowTable
        EventTimeline
        AlertPanel
        HostInspector
        DefensePanel
        GuidedLesson
        ResultsReport
      engine/
        simulationEngine
        scheduler
        seededRandom
        reducers
        metrics
        reporting
      scenarios/
        dosDdos
        mitm
        phishing
        malware
        sqlInjection
        zeroDay
        xss
        passwordAttack
        apt
        eavesdropping
        insiderThreat
      models/
      hooks/
      utils/
      tests/
```

## Simulation engine

The engine should:

- load a scenario definition;
- initialize hosts, defenses, metrics, and timeline;
- execute time-indexed events;
- calculate outcomes;
- emit derived visualization updates;
- support pause and step;
- support replay from a seed;
- allow defense-state changes;
- finish with a report.

Use a virtual clock rather than wall-clock-dependent logic.

## Rendering strategy

### Network topology

Use the site's existing visualization library if available.

Otherwise, prefer:

- SVG for accessibility and control;
- Canvas only if required for performance;
- a force-directed or fixed enterprise topology;
- animated flow particles with a reduced-motion alternative.

### Charts

Prefer existing chart dependencies. Avoid adding a large chart library solely for this feature if simple SVG charts are sufficient.

## State

Possible state groups:

- configuration;
- virtual clock;
- scenario phase;
- hosts;
- flows;
- events;
- alerts;
- defenses;
- metrics;
- learning checkpoints;
- results.

## Determinism

Every run should have a seed.

The same:

- scenario;
- difficulty;
- defense configuration;
- parameter set;
- seed

must produce the same outcome.

## Performance

- cap the number of visible flow animations;
- aggregate high-volume events;
- virtualize long tables;
- avoid rerendering the entire topology per event;
- use derived selectors;
- pause animation when the tab is hidden;
- honor reduced-motion preferences.

## Accessibility

- keyboard-accessible controls;
- visible focus indicators;
- text equivalents for topology changes;
- non-color severity indicators;
- live-region announcements used sparingly;
- chart summaries in text;
- reduced-motion toggle;
- sufficient contrast.

## Security of the feature

- no dynamic code evaluation;
- no `eval`;
- no unsafe HTML injection;
- sanitize scenario copy if content becomes remotely managed;
- no user-controlled outbound requests;
- strict type validation for scenario files;
- limit export size;
- keep simulation data non-sensitive.
