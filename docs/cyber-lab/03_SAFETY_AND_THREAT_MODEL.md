# Safety, Abuse Prevention, and Threat Model

## Safety objective

The public lab must teach defensive concepts while preventing use as an attack-development, targeting, credential-theft, malware, or exploitation tool.

## Safety boundary

The lab is a visualization and state simulation. It does not interact with real networks or vulnerable services.

## Prohibited implementation patterns

Do not add:

- IP, hostname, domain, or URL target fields;
- port scanners;
- packet injection;
- raw socket access;
- browser requests to user-selected targets;
- external webhook delivery;
- credential forms that store or transmit entered secrets;
- password cracking;
- exploit payload generators;
- shellcode;
- malware samples;
- ransomware encryption;
- command-and-control logic;
- persistence or evasion workflows;
- destructive file operations;
- functional injection strings;
- copied real breach data;
- realistic secrets, access tokens, or private keys.

## Required implementation patterns

Use:

- documentation-only IP addresses;
- fake domains such as `example.test`;
- synthetic users and passwords that are never accepted outside the simulation;
- labels such as `[SIMULATED_QUERY_MANIPULATION]`;
- abstract event verbs such as `attempt`, `intercept`, `enumerate`, `execute_simulated`, and `exfiltration_risk`;
- internal-only state transitions;
- generated packet metadata, not packet payloads;
- strict content-security policy where compatible;
- local static scenario definitions;
- safe report export.

## Scenario abstraction rules

### SQL injection

Represent:

- suspicious input pattern detected;
- database error rate rising;
- WAF rule triggered;
- unauthorized-query risk;
- mock records accessed count.

Do not display functional SQL payloads.

### XSS

Represent:

- untrusted script marker submitted;
- output encoding failure;
- browser policy alert;
- session-risk indicator.

Do not create or execute a script payload.

### Password attacks

Represent:

- repeated authentication attempts;
- password-spray pattern;
- credential-stuffing pattern;
- lockout and MFA effects.

Do not test or generate passwords.

### Malware and ransomware

Represent:

- endpoint infection state;
- unusual process behavior;
- file-access spike;
- encryption-risk events;
- lateral-movement risk.

Do not create executable files or encrypt user files.

### Phishing

Use a mock inbox entirely inside the simulation. Messages must use fictional identities and must not be sent externally.

### Zero-day

Treat the vulnerability as an unknown abstract flaw. Model anomalous behavior and compensating controls, not exploit mechanics.

### Eavesdropping

Display synthetic metadata and mock plaintext labels. Do not capture browser, device, or network traffic.

## Public labeling

Every page must prominently state:

> All attacks, hosts, traffic, logs, credentials, and outcomes in this lab are simulated. The lab does not send attack traffic or connect to external targets.

## Data handling

- Prefer no backend.
- Store optional preferences locally.
- Do not store user-entered secrets.
- Do not request real credentials.
- Reports contain only generated simulation data.
- Analytics events should identify feature usage, not packet-level content.

## Abuse tests

Verify that:

1. no user-controlled value becomes a fetch destination;
2. no route proxies network requests;
3. no scenario runs OS commands;
4. no exported file contains active code;
5. no scenario generates usable exploit syntax;
6. all synthetic hosts use safe reserved addresses;
7. content remains educational and defensive;
8. the lab works with the network disconnected after initial page load, where feasible.
