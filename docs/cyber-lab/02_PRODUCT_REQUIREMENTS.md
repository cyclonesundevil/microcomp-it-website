# Product Requirements Document

## Product name

**MicroCompIT Cybersecurity Simulation Lab**

## Product purpose

The Cybersecurity Simulation Lab helps users understand how common attacks appear in network traffic, logs, alerts, and system behavior without exposing them to real offensive tooling.

The central experience is a visual, interactive, defensive learning environment.

## Primary audiences

- students and career changers;
- business owners;
- junior IT and cybersecurity professionals;
- software developers;
- nontechnical users who want to understand cyber risk;
- prospective MicroCompIT clients.

## Primary user journey

1. User opens the lab.
2. User selects an attack scenario.
3. User reads a short briefing.
4. User chooses guided or free-play mode.
5. User configures safe parameters.
6. User begins the simulation.
7. Synthetic network events animate through the topology.
8. Logs, flow records, metrics, and alerts update.
9. User activates or adjusts defensive controls.
10. User compares outcomes.
11. User receives a post-simulation explanation and report.

## Modes

### Guided mode

- explains each phase;
- highlights relevant network nodes;
- pauses at teaching checkpoints;
- recommends controls;
- defines unfamiliar terms;
- includes simple questions or observations.

### Free-play mode

- allows parameter changes;
- permits defense selection before or during the run;
- shows fewer hints;
- emphasizes experimentation and comparison.

## Difficulty levels

### Beginner

- fewer hosts;
- slower pace;
- obvious alerts;
- simplified terminology;
- guided annotations enabled by default.

### Intermediate

- more background traffic;
- multiple alert sources;
- some false positives;
- mixed control effectiveness.

### Advanced

- denser synthetic traffic;
- multi-stage scenarios;
- delayed indicators;
- competing alerts;
- more subtle root cause;
- still no functional exploit details.

## Core functional requirements

### Scenario selection

Display all eleven scenarios as cards with:

- title;
- category;
- difficulty;
- estimated simulation duration;
- learning objectives;
- affected systems;
- recommended prerequisites.

### Simulation controls

- Start
- Pause
- Resume
- Step
- Reset
- Replay
- Speed: 0.5x, 1x, 2x, 4x
- Seed selector or "Replay same run"
- Guided/free-play toggle

### Network topology

Represent synthetic:

- internet;
- edge gateway;
- firewall;
- load balancer;
- web server;
- application server;
- database;
- identity provider;
- email gateway;
- employee workstation;
- administrative workstation;
- file server;
- security monitoring system;
- remote user;
- fictional attacker nodes.

### Metrics

At minimum:

- requests per second;
- active sessions;
- throughput;
- latency;
- error rate;
- authentication failures;
- suspicious connections;
- blocked events;
- exfiltration-risk score;
- service availability;
- alert severity counts.

### Traffic and log inspection

Users can inspect:

- timestamp;
- synthetic source;
- synthetic destination;
- protocol;
- service;
- action;
- byte count;
- latency;
- result;
- severity;
- related alert;
- plain-language explanation.

Do not expose executable payloads.

### Defenses

Controls should have:

- enabled/disabled state;
- configuration level;
- effect on synthetic events;
- trade-off explanation;
- operational cost or usability impact;
- coverage limitations.

### Results report

After each run, show:

- scenario summary;
- timeline;
- affected assets;
- service impact;
- alerts generated;
- successful defensive actions;
- missed detections;
- residual risk;
- remediation recommendations;
- comparison with previous run;
- synthetic JSON/CSV export.

## Nonfunctional requirements

- no real attack traffic;
- no arbitrary external target input;
- no storage of sensitive user information;
- responsive design;
- keyboard navigation;
- screen-reader labels;
- reduced-motion mode;
- reasonable performance on modern desktop and mobile browsers;
- deterministic replay;
- no unnecessary backend dependency.

## Success criteria

- users can understand the difference between normal and suspicious traffic;
- users can identify at least one meaningful indicator per scenario;
- users can see how defensive controls change outcomes;
- the feature increases engagement with the MicroCompIT Demo Lab;
- the simulation remains safe enough for public deployment.
