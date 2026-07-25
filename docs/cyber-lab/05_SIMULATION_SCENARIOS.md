# Simulation Scenario Specifications

Every scenario must include:

- briefing;
- attacker objective;
- synthetic environment;
- normal baseline;
- attack phases;
- observable indicators;
- available defenses;
- success/failure conditions;
- learning checkpoints;
- post-run findings.

## 1. DoS and DDoS

### Concept

Synthetic request volume overwhelms a public service.

### Visual indicators

- many attacker nodes;
- rapid inbound flow animation;
- requests per second spike;
- latency increase;
- error rate increase;
- service health degradation.

### Defenses

- rate limiting;
- traffic filtering;
- autoscaling;
- caching;
- upstream protection.

### Learning outcome

Users see that availability attacks may involve legitimate-looking traffic at abnormal scale.

---

## 2. Man-in-the-Middle

### Concept

A simulated intermediary inserts itself between a client and service.

### Visual indicators

- route change;
- certificate-warning event;
- duplicated or altered flow;
- session anomaly;
- integrity alert.

### Defenses

- TLS enforcement;
- certificate validation;
- secure Wi-Fi;
- mutual authentication;
- session reauthentication.

### Safety note

No real traffic interception. Use synthetic message labels.

---

## 3. Phishing and Spear Phishing

### Concept

A fictional employee receives a simulated deceptive message.

### Visual indicators

- mock inbox;
- sender-domain discrepancy;
- urgency cues;
- link-risk alert;
- credential exposure risk;
- endpoint event after simulated interaction.

### Defenses

- email filtering;
- user awareness;
- MFA;
- link isolation;
- attachment sandboxing.

### Learning outcome

Users compare generic phishing with targeted spear phishing.

---

## 4. Malware Outbreak

### Concept

A deterministic seed selects one of four fictional behavior profiles. Each run follows six beginner-friendly stages—initial infection, local execution, discovery, attempted spread or access, infrastructure impact, and containment or recovery—without creating malware or touching a real system.

The profiles are teaching models, not exact reproductions of named real-world malware families:

| Profile | Purpose and likely targets | Main defenses |
|---|---|---|
| Ransomware-like | Begins at the employee workstation and may reach the file service plus one nearby business system. It teaches synthetic file availability, disruption, and recovery workload. | Endpoint protection, patch management, segmentation, least privilege |
| Worm-like | Begins at the employee workstation, discovers a nearby application server, and may attempt one additional shared-service hop. It teaches propagation, host degradation, and internal traffic. | Patch management, endpoint protection, segmentation, IDS, anomaly detection |
| Credential-stealing | Begins at the employee workstation, attempts synthetic authentication at the identity service, and may reach one application. No credential is collected or displayed. | Endpoint protection, MFA, account lockout, least privilege, anomaly detection |
| Botnet-like | Begins at the employee workstation and follows one outbound path through the gateway to a fictional external destination. It teaches abnormal outbound traffic and endpoint resource use. | Endpoint protection, traffic filtering, segmentation, IDS, anomaly detection |

Profile selection uses `abs(seed) mod 4`. The profile is selected once during initialization, remains fixed through the run, and is reproduced by replay. Changing the seed may select a different profile.

Every profile intentionally uses a primary path of three meaningful assets and no more than one secondary continuation. This keeps the topology understandable, prevents excessive simultaneous flows, and makes defense effects easier for beginners to compare.

### Visual indicators

- identified initial infection point;
- one ordered attempted path;
- affected, protected, observing, and unaffected host states;
- profile-specific outcome values;
- static path, status, and summary text in reduced-motion mode.

### Defenses

- endpoint protection;
- segmentation;
- least privilege;
- patching.
- MFA and account lockout for credential-driven behavior;
- traffic filtering for outbound behavior;
- IDS and anomaly detection as detection-only controls.

### Safety note

Do not create executable content, touch real files, collect credentials, or use a real command-and-control destination. All addresses and activity remain fictional and documentation-safe.

---

## 5. SQL Injection

### Concept

A web request produces a simulated unsafe database-query path.

### Visual indicators

- suspicious request marker;
- WAF alert;
- database error spike;
- unauthorized-record-access risk;
- application response anomaly.

### Defenses

- parameterized queries;
- input validation;
- WAF;
- least-privilege database account;
- secure error handling.

### Safety note

Use placeholder labels, not executable SQL syntax.

---

## 6. Zero-Day Exploit

### Concept

A fictional unknown vulnerability causes anomalous system behavior before a signature exists.

### Visual indicators

- new process-risk event;
- unusual privilege transition;
- unexpected outbound flow;
- signature-based defense initially misses;
- behavior-based alert fires.

### Defenses

- anomaly detection;
- segmentation;
- least privilege;
- rapid isolation;
- virtual patching;
- incident response.

### Learning outcome

Users learn why layered defenses matter when no patch exists.

---

## 7. Cross-Site Scripting

### Concept

A simulated application fails to safely handle untrusted content.

### Visual indicators

- unsafe-content marker;
- browser security alert;
- session-risk indicator;
- content-security-policy event;
- affected-user count.

### Defenses

- output encoding;
- content security policy;
- input validation;
- secure cookie settings;
- framework protections.

### Safety note

Never render or execute a script payload.

---

## 8. Password Attacks

### Concept

Simulate brute-force, password spraying, dictionary-style attempts, and credential stuffing as traffic patterns.

### Visual indicators

- authentication-failure spike;
- distributed source pattern;
- low-and-slow spray;
- repeated account targeting;
- impossible-travel alert.

### Defenses

- MFA;
- rate limiting;
- lockout;
- password screening;
- bot detection;
- breached-credential monitoring.

### Safety note

Do not generate, test, or store passwords.

---

## 9. Advanced Persistent Threat

### Concept

A multi-stage, long-duration scenario in which a fictional intruder attempts to maintain access and reach sensitive assets.

### Stages

- initial access risk;
- foothold;
- privilege-risk escalation;
- discovery;
- lateral movement risk;
- collection;
- exfiltration risk.

### Defenses

- segmentation;
- identity monitoring;
- endpoint detection;
- least privilege;
- anomaly detection;
- data-loss prevention;
- threat hunting.

### Safety note

Keep persistence and evasion abstract. Do not show operational techniques.

---

## 10. Eavesdropping and Packet Sniffing

### Concept

Users compare encrypted and unencrypted synthetic traffic.

### Visual indicators

- metadata visibility;
- plaintext-risk labels;
- encrypted-content label;
- sensitive-field exposure count;
- secure-protocol coverage.

### Defenses

- encryption in transit;
- secure wireless;
- VPN;
- certificate validation;
- network segmentation.

### Safety note

Do not capture real packets.

---

## 11. Insider Threat

### Concept

A fictional trusted user accesses data outside an expected behavioral baseline.

### Variants

- malicious insider;
- negligent insider;
- compromised insider account.

### Visual indicators

- unusual file access;
- off-hours activity;
- mass-download risk;
- removable-media event;
- privilege misuse;
- atypical destination.

### Defenses

- least privilege;
- user behavior analytics;
- data-loss prevention;
- approval workflows;
- logging;
- access reviews.

## Cross-scenario comparison

The user should be able to compare:

- impact without defenses;
- impact with selected defenses;
- time to detection;
- time to containment;
- false positives;
- service availability;
- data-exposure risk;
- residual risk.
