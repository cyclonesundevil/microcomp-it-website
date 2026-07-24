# Cyber Lab Scenario Authoring

Scenarios are declarative entries in `frontend/cyber-lab-engine.js`. Add a unique ID, title, category, objective, relevant defense IDs, a host path, a non-executable marker, observable indicators, and remediation copy.

Keep every new scenario inside the existing safety boundary:

- use only hosts from the three RFC documentation ranges already defined by the engine;
- describe behavior with abstract markers, never working payloads or operational exploit steps;
- do not add target inputs, network APIs, credentials, external delivery, filesystem access, or dynamic code execution;
- reuse the virtual clock and seeded random generator so identical inputs replay identically;
- add the scenario to the engine tests and confirm generated events contain metadata only.

The renderer discovers scenario entries automatically. A new definition should not require presentation code unless it introduces a genuinely new defensive visualization.
