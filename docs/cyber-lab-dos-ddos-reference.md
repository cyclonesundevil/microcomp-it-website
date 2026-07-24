# DoS/DDoS Reference Scenario

The DoS/DDoS scenario is the complete reference implementation for future Cybersecurity Simulation Lab scenarios. It remains a deterministic, client-side state model and never creates network traffic.

## Virtual timeline

The run lasts 24 virtual ticks:

1. **Normal baseline (ticks 1–4):** ordinary fictional internet traffic establishes expected load.
2. **Traffic ramp-up (ticks 5–9):** safe aggregated request metadata increases toward the selected difficulty’s peak.
3. **Sustained attack (ticks 10–18):** the synthetic request surge remains near peak volume.
4. **Recovery (ticks 19–24):** when enabled, attack volume declines. When disabled, the sustained phase continues through tick 24.

DoS uses one source at `203.0.113.10`. DDoS uses three, four, or five sources from `203.0.113.10–14`, depending on difficulty. These addresses belong to a documentation-only range.

## Difficulty profiles

Difficulty changes baseline traffic, peak synthetic load, service capacity, and DDoS source count. The engine derives every tick from the run configuration and seed, so identical inputs produce identical events, metrics, and reports.

## Aggregation

The engine emits one metadata summary per active source per virtual tick, plus one normal-traffic summary. Each record contains offered, allowed, and blocked request counts. It never creates an event for an individual request and never sends a browser network request.

## Defense model

- **Rate limiting** caps accepted load but can reject legitimate bursts.
- **Traffic filtering** removes part of the abnormal pattern and may falsely block a small share of baseline traffic.
- **Caching** removes repeatable work from origin load but does not help dynamic requests.
- **Autoscaling** adds delayed capacity and simulated cost but does not remove hostile traffic.
- **Upstream DDoS protection** filters distributed traffic before the edge and adds small processing latency.

Each triggered defense records affected request volume and its trade-off in the final report. Layered controls intentionally outperform any one control.

## Report contract

The completed report includes peak RPS, maximum latency, maximum error rate, minimum availability, virtual downtime, blocked traffic, triggered defenses and trade-offs, disabled coverage, residual risk, and remediation. The UI compares these outcomes with the previous run only when scenario, attack type, difficulty, and seed match.

## Extension guidance

Future reference-quality scenarios should follow the same boundaries:

- explicit virtual phases;
- deterministic difficulty profiles;
- aggregated, fictional evidence;
- measurable control effects and trade-offs;
- plain-language teaching checkpoints;
- a scenario-specific report contract;
- engine, safety, reducer, and UI interaction tests.
