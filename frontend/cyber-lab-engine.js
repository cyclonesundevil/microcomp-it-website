(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.CyberLabEngine = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const PROTOCOLS = ['HTTPS', 'DNS', 'SMTP', 'AUTH', 'SMB'];
    const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
    const HOSTS = [
        ['internet', 'Synthetic Internet', '198.51.100.1', 'cloud'],
        ['upstream', 'Upstream Filter', '198.51.100.2', 'shield'],
        ['edge', 'Firewall / Rate Limiter', '192.0.2.1', 'gateway'],
        ['loadbalancer', 'Load Balancer', '192.0.2.10', 'gateway'],
        ['web', 'Web Service', '192.0.2.20', 'server'],
        ['identity', 'Identity Provider', '192.0.2.30', 'identity'],
        ['email', 'Email Gateway', '192.0.2.40', 'email'],
        ['workstation', 'Employee Workstation', '192.0.2.50', 'endpoint'],
        ['database', 'Records Database', '192.0.2.60', 'database'],
        ['files', 'File Service', '192.0.2.70', 'server'],
        ['soc', 'Security Monitor', '192.0.2.80', 'monitor'],
        ['actor', 'Simulated Source A', '203.0.113.10', 'actor'],
        ['actor2', 'Simulated Source B', '203.0.113.11', 'actor'],
        ['actor3', 'Simulated Source C', '203.0.113.12', 'actor'],
        ['actor4', 'Simulated Source D', '203.0.113.13', 'actor'],
        ['actor5', 'Simulated Source E', '203.0.113.14', 'actor']
    ].map(([id, name, ip, type]) => ({ id, name, ip, type, status: 'healthy' }));

    const DEFENSES = {
        rateLimiting: ['Rate limiting', 'Caps accepted requests when a source exceeds a safe synthetic threshold.', 'Legitimate traffic bursts may be delayed or rejected.'],
        trafficFiltering: ['Traffic filtering', 'Drops flows that match the simulation’s abnormal-volume pattern.', 'Imperfect rules can block a small share of legitimate traffic.'],
        caching: ['Caching', 'Serves repeatable synthetic responses without using origin capacity.', 'Dynamic or uncached requests still reach the service.'],
        autoscaling: ['Autoscaling', 'Adds fictional service capacity after sustained load is observed.', 'Capacity arrives after a delay and adds simulated operating cost.'],
        upstreamProtection: ['Upstream DDoS protection', 'Filters distributed traffic before it reaches the edge gateway.', 'Scrubbing can add latency and is less useful for a single trusted-looking source.'],
        waf: ['Web application firewall', 'Flags unsafe web-request markers.', 'Rules require tuning.'],
        mfa: ['Multi-factor authentication', 'Reduces account takeover risk.', 'Adds a sign-in step.'],
        accountLockout: ['Account lockout', 'Stops repeated sign-in attempts.', 'Can temporarily block users.'],
        segmentation: ['Network segmentation', 'Limits movement between systems.', 'Adds network complexity.'],
        encryption: ['Encryption', 'Protects synthetic data in transit.', 'Requires certificate management.'],
        endpointProtection: ['Endpoint protection', 'Detects risky endpoint behavior.', 'May generate false positives.'],
        emailFiltering: ['Email filtering', 'Blocks suspicious mock messages.', 'Some messages need review.'],
        leastPrivilege: ['Least privilege', 'Limits access and potential impact.', 'Requires access reviews.'],
        anomalyDetection: ['Anomaly detection', 'Finds behavior outside the baseline.', 'Needs baseline tuning.'],
        ids: ['Intrusion detection', 'Raises alerts on suspicious flows.', 'Detection alone does not block.'],
        patchManagement: ['Patch management', 'Reduces exposure to known flaws.', 'Needs maintenance windows.'],
        dlp: ['Data-loss prevention', 'Flags risky data movement.', 'May interrupt valid transfers.']
    };

    const DEFENSE_META = {
        upstreamProtection: { kind: 'preventive', layer: 'upstream', order: 10, action: 'filtered', visual: 'interrupted' },
        emailFiltering: { kind: 'preventive', layer: 'gateway', order: 15, action: 'filtered', visual: 'interrupted' },
        trafficFiltering: { kind: 'preventive', layer: 'firewall', order: 20, action: 'filtered', visual: 'interrupted' },
        waf: { kind: 'preventive', layer: 'application-edge', order: 22, action: 'blocked', visual: 'interrupted' },
        rateLimiting: { kind: 'preventive', layer: 'firewall', order: 25, action: 'rate-limited', visual: 'interrupted' },
        accountLockout: { kind: 'preventive', layer: 'identity', order: 26, action: 'locked', visual: 'interrupted' },
        mfa: { kind: 'preventive', layer: 'identity', order: 30, action: 'challenged', visual: 'protected' },
        encryption: { kind: 'preventive', layer: 'transport', order: 32, action: 'protected', visual: 'protected' },
        segmentation: { kind: 'preventive', layer: 'network', order: 35, action: 'isolated', visual: 'interrupted' },
        caching: { kind: 'resilience', layer: 'load-balancer', order: 40, action: 'offloaded', visual: 'offloaded' },
        endpointProtection: { kind: 'preventive', layer: 'endpoint', order: 42, action: 'contained', visual: 'protected' },
        patchManagement: { kind: 'preventive', layer: 'host', order: 44, action: 'hardened', visual: 'protected' },
        autoscaling: { kind: 'resilience', layer: 'service', order: 50, action: 'scaled', visual: 'capacity' },
        leastPrivilege: { kind: 'preventive', layer: 'authorization', order: 55, action: 'restricted', visual: 'protected' },
        dlp: { kind: 'preventive', layer: 'data', order: 60, action: 'blocked-transfer', visual: 'interrupted' },
        anomalyDetection: { kind: 'detective', layer: 'monitoring', order: 90, action: 'detected', visual: 'detected' },
        ids: { kind: 'detective', layer: 'monitoring', order: 92, action: 'detected', visual: 'detected' }
    };

    function defenseDefinition(id) {
        const copy = DEFENSES[id];
        const meta = DEFENSE_META[id];
        return copy && meta ? { id, name: copy[0], protects: copy[1], tradeOff: copy[2], ...meta } : null;
    }

    function orderedDefenses(scenario, enabled) {
        return scenario.defenses
            .filter(id => enabled[id] && DEFENSE_META[id])
            .map(defenseDefinition)
            .sort((left, right) => left.order - right.order);
    }

    const SCENARIOS = [
        ['dos', 'DoS & DDoS', 'Availability', 'Overwhelm a public service with synthetic request volume.', ['rateLimiting', 'trafficFiltering', 'caching', 'autoscaling', 'upstreamProtection'], ['actor', 'edge', 'web'], 'AGGREGATED_REQUEST_SURGE'],
        ['mitm', 'Man-in-the-Middle', 'Network', 'Observe and alter a fictional session path.', ['encryption', 'ids', 'mfa'], ['actor', 'edge', 'workstation'], 'ROUTE_INTEGRITY_RISK'],
        ['phishing', 'Phishing & Spear Phishing', 'Human', 'Influence a fictional user through a mock inbox.', ['emailFiltering', 'mfa', 'endpointProtection'], ['internet', 'email', 'workstation'], 'DECEPTIVE_MESSAGE_RISK'],
        ['malware', 'Malware Outbreak', 'Endpoint', 'Disrupt fictional endpoints and attempt abstract spread.', ['endpointProtection', 'segmentation', 'patchManagement'], ['workstation', 'files', 'soc'], 'ENDPOINT_BEHAVIOR_RISK'],
        ['sqli', 'SQL Injection', 'Application', 'Reach mock records through unsafe input handling.', ['waf', 'leastPrivilege', 'ids'], ['internet', 'web', 'database'], 'SIMULATED_QUERY_MANIPULATION'],
        ['zeroday', 'Zero-Day Exploit', 'Application', 'Use an unknown abstract flaw before a signature exists.', ['anomalyDetection', 'segmentation', 'leastPrivilege'], ['actor', 'web', 'database'], 'UNKNOWN_FLAW_ACTIVITY'],
        ['xss', 'Cross-Site Scripting', 'Application', 'Create session risk through mishandled fictional content.', ['waf', 'ids', 'patchManagement'], ['internet', 'web', 'workstation'], 'UNTRUSTED_CONTENT_MARKER'],
        ['password', 'Password Attacks', 'Identity', 'Generate repeated synthetic authentication patterns.', ['mfa', 'accountLockout', 'rateLimiting'], ['actor', 'identity', 'soc'], 'AUTHENTICATION_PATTERN'],
        ['apt', 'Advanced Persistent Threat', 'Multi-stage', 'Move toward fictional sensitive assets over several abstract stages.', ['segmentation', 'leastPrivilege', 'dlp'], ['actor', 'workstation', 'files'], 'MULTI_STAGE_ACCESS_RISK'],
        ['eavesdropping', 'Eavesdropping & Packet Sniffing', 'Network', 'Compare protected and unprotected synthetic metadata.', ['encryption', 'segmentation', 'ids'], ['workstation', 'edge', 'actor'], 'PLAINTEXT_EXPOSURE_RISK'],
        ['insider', 'Insider Threat', 'Data', 'Access fictional data outside a trusted user baseline.', ['leastPrivilege', 'dlp', 'anomalyDetection'], ['workstation', 'files', 'soc'], 'UNUSUAL_ACCESS_PATTERN']
    ].map(([id, title, category, objective, defenses, path, marker]) => ({
        id, title, category, objective, defenses, path, marker,
        duration: id === 'apt' ? '4 min' : (id === 'dos' ? '24 virtual ticks' : '2–3 min'),
        phases: id === 'dos'
            ? ['Normal baseline', 'Traffic ramp-up', 'Sustained attack', 'Recovery']
            : id === 'apt'
                ? ['Initial access', 'Persistence', 'Discovery', 'Privilege expansion', 'Lateral movement', 'Collection', 'Exfiltration outcome']
                : ['Baseline', 'Initial activity', 'Escalation', 'Detection & response', 'Outcome'],
        indicators: indicatorText(id),
        remediation: remediationText(id)
    }));

    function indicatorText(id) {
        const map = {
            dos: 'Request volume, latency, errors, and availability change together.',
            mitm: 'A route change and integrity warning appear on a synthetic session.',
            phishing: 'Sender discrepancy, urgency cues, and interaction risk appear in a mock inbox.',
            malware: 'Endpoint health, file access, and lateral-connection risk deviate from baseline.',
            sqli: 'A safe request marker correlates with database errors and record-access risk.',
            zeroday: 'Behavior-based detection observes activity missed by signature checks.',
            xss: 'Unsafe-content markers correlate with browser policy and session-risk alerts.',
            password: 'Authentication failures form repeated and distributed patterns.',
            apt: 'Low-volume events accumulate across access, discovery, movement, and collection.',
            eavesdropping: 'Encryption changes content visibility while metadata remains observable.',
            insider: 'Access time, volume, privilege, and destination differ from the user baseline.'
        };
        return map[id];
    }

    function remediationText(id) {
        const map = {
            dos: 'Layer rate limits, traffic monitoring, caching, and upstream protection.',
            mitm: 'Enforce encryption and certificate validation; reauthenticate risky sessions.',
            phishing: 'Combine filtering, MFA, awareness, and endpoint monitoring.',
            malware: 'Isolate affected endpoints, patch systems, and review endpoint alerts.',
            sqli: 'Use parameterized queries, validation, least privilege, and safe error handling.',
            zeroday: 'Use behavior analytics, rapid isolation, segmentation, and virtual patching.',
            xss: 'Encode output, validate input, enforce browser policy, and secure cookies.',
            password: 'Use MFA, rate limits, lockouts, and monitored authentication baselines.',
            apt: 'Reduce privilege, segment assets, hunt anomalies, and protect data movement.',
            eavesdropping: 'Encrypt data in transit and validate certificates across every hop.',
            insider: 'Review access, enforce least privilege, and monitor unusual data movement.'
        };
        return map[id];
    }

    function seededRandom(seed) {
        let value = (Number(seed) || 1) >>> 0;
        return function () {
            value += 0x6D2B79F5;
            let t = value;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function initialState(config) {
        const scenario = SCENARIOS.find(item => item.id === config.scenarioId) || SCENARIOS[0];
        const enabled = {};
        Object.keys(DEFENSES).forEach(key => { enabled[key] = Boolean(config.defenses && config.defenses[key]); });
        const isDos = scenario.id === 'dos';
        return {
            config: {
                scenarioId: scenario.id,
                difficulty: config.difficulty || 'Beginner',
                seed: Number(config.seed) || 4242,
                mode: config.mode || 'guided',
                attackType: config.attackType === 'dos' ? 'dos' : 'ddos',
                recovery: config.recovery !== false
            },
            scenario, status: 'ready', tick: 0, phase: 0, defenses: enabled,
            hosts: HOSTS.map(host => ({ ...host })), flows: [], events: [], alerts: [],
            history: [], metrics: {
                rps: isDos ? 120 : 18, offered: isDos ? 120 : 18, allowed: isDos ? 120 : 18,
                blocked: 0, totalBlocked: 0, latency: 42, errors: 1, availability: 100,
                capacity: isDos ? 800 : 120, attackSources: 0, risk: 4,
                serverRps: isDos ? 120 : 18, upstreamFiltered: 0, totalUpstreamFiltered: 0,
                residualAttack: 0, upstreamEffectiveness: 0, detections: 0
            },
            defenseStats: {}, activeDefenseEffects: [], defenseEffectLog: [], downtimeTicks: 0,
            findings: null
        };
    }

    const DOS_PROFILES = {
        Beginner: { baseline: 120, peakDos: 1450, peakDdos: 2100, capacity: 900, sources: 3 },
        Intermediate: { baseline: 175, peakDos: 2300, peakDdos: 3800, capacity: 950, sources: 4 },
        Advanced: { baseline: 240, peakDos: 3600, peakDdos: 6200, capacity: 1000, sources: 5 }
    };
    const UPSTREAM_EFFECTIVENESS = {
        Beginner: [0.95, 0.99],
        Intermediate: [0.85, 0.95],
        Advanced: [0.70, 0.90]
    };

    function upstreamEffectiveness(config) {
        const [minimum, maximum] = UPSTREAM_EFFECTIVENESS[config.difficulty] || UPSTREAM_EFFECTIVENESS.Beginner;
        const difficultySalt = { Beginner: 101, Intermediate: 211, Advanced: 307 }[config.difficulty] || 101;
        const random = seededRandom((Number(config.seed) || 1) + difficultySalt);
        return minimum + random() * (maximum - minimum);
    }

    function step(previous) {
        if (previous.scenario.id === 'dos') return stepDos(previous);
        if (['mitm', 'password', 'eavesdropping', 'sqli', 'xss', 'phishing', 'malware', 'insider', 'zeroday', 'apt'].includes(previous.scenario.id)) return stepSpecializedScenario(previous);
        if (previous.status === 'complete') return previous;
        const state = JSON.parse(JSON.stringify(previous));
        const random = seededRandom(state.config.seed + state.tick * 997);
        state.activeDefenseEffects = [];
        state.status = 'running';
        state.tick += 1;
        state.phase = Math.min(4, Math.floor((state.tick - 1) / 4));
        const difficulty = { Beginner: 0.75, Intermediate: 1, Advanced: 1.3 }[state.config.difficulty] || 1;
        const activeDefenses = orderedDefenses(state.scenario, state.defenses);
        const preventive = activeDefenses.filter(defense => defense.kind !== 'detective');
        const detective = activeDefenses.filter(defense => defense.kind === 'detective');
        const mitigated = Math.min(0.72, preventive.length * 0.22);
        const intensity = Math.max(0.18, (state.tick / 10) * difficulty * (1 - mitigated));
        const path = state.scenario.path;
        const src = path[(state.tick - 1) % (path.length - 1)];
        const dst = path[(state.tick) % path.length];
        const protocol = protocolFor(state.scenario.id, state.tick);
        const severityIndex = Math.min(4, Math.floor(intensity * 4 + random()));
        const blocked = preventive.length > 0 && random() < mitigated;
        if (blocked) {
            const selected = preventive[(state.tick - 1) % preventive.length];
            recordDefense(state, selected.id, 1, {
                metricDeltas: { blocked: 1, risk: -Math.round(mitigated * 20) },
                explanation: `${selected.name} prevented one aggregated ${state.scenario.title} event.`
            });
        }
        if (severityIndex >= 1) {
            detective.forEach(defense => recordDefense(state, defense.id, 1, {
                metricDeltas: { detections: 1 },
                explanation: `${defense.name} detected the synthetic ${state.scenario.marker.toLowerCase().replaceAll('_', ' ')} indicator without blocking the flow.`
            }));
        }
        const preventingEffect = state.activeDefenseEffects.find(effect => effect.kind !== 'detective');
        const event = {
            id: `evt-${state.tick}`, tick: state.tick, time: `${String(Math.floor(state.tick / 60)).padStart(2, '0')}:${String(state.tick % 60).padStart(2, '0')}`,
            source: host(src), destination: host(dst), protocol,
            action: blocked ? 'blocked' : 'observed', bytes: Math.round(180 + random() * 4200),
            latency: Math.round(35 + intensity * 310 + random() * 20),
            severity: blocked ? 'low' : SEVERITIES[severityIndex],
            marker: state.scenario.marker,
            explanation: blocked
                ? `${preventingEffect.name} reduced this simulated event.`
                : `${state.scenario.indicators} No executable content is present.`
        };
        const defenseEvents = state.activeDefenseEffects.map(effect => defenseEffectEvent(state, effect, event.source, event.destination, protocol, event.latency));
        state.events.unshift(...defenseEvents.slice().reverse(), event);
        state.events = state.events.slice(0, 80);
        state.flows = [event, ...defenseEvents].slice(0, 24);
        if (severityIndex >= 2 || blocked) {
            state.alerts.unshift({ ...event, id: `alert-${state.tick}`, title: blocked ? 'Defense action recorded' : `${state.scenario.title} indicator` });
        }
        defenseEvents.forEach(defenseEvent => {
            state.alerts.unshift({ ...defenseEvent, id: `alert-${defenseEvent.id}`, title: `${DEFENSES[defenseEvent.defenseId][0]} triggered` });
        });
        state.alerts = state.alerts.slice(0, 30);
        const detectionsThisTick = state.activeDefenseEffects.filter(effect => effect.kind === 'detective').reduce((sum, effect) => sum + effect.affected, 0);
        state.metrics = {
            rps: Math.round(18 + intensity * (state.scenario.id === 'dos' ? 900 : 120)),
            latency: event.latency,
            errors: Math.min(96, Math.round(1 + intensity * 54)),
            availability: Math.max(12, Math.round(100 - intensity * 68)),
            blocked: blocked ? 1 : 0,
            totalBlocked: (state.metrics.totalBlocked || 0) + (blocked ? 1 : 0),
            detections: (state.metrics.detections || 0) + detectionsThisTick,
            allowed: blocked ? 0 : 1,
            serverRps: blocked ? 0 : Math.round(18 + intensity * 120),
            risk: Math.min(100, Math.round(5 + intensity * 82))
        };
        state.history.push({ tick: state.tick, ...state.metrics });
        state.history = state.history.slice(-32);
        const impacted = state.hosts.find(item => item.id === path[Math.min(path.length - 1, 1 + state.phase % (path.length - 1))]);
        if (impacted) impacted.status = blocked ? 'protected' : (severityIndex >= 3 ? 'at-risk' : 'observing');
        if (state.tick >= 20) {
            state.status = 'complete';
            state.findings = buildReport(state);
        }
        return state;
    }

    const SPECIALIZED_SCENARIO_PROFILES = {
        mitm: {
            protocol: 'HTTPS',
            metrics: ['Route integrity', 'Certificate status', 'Altered sessions', 'Protected sessions'],
            guidance: [
                'Establish a normal direct session path and a trusted fictional certificate.',
                'A synthetic route change introduces an intermediary hop without sending any real traffic.',
                'Certificate validation and encryption determine whether the altered path can affect session integrity.',
                'Intrusion detection observes the route anomaly; MFA can require a fresh identity check.',
                'Compare altered and protected sessions, certificate warnings, and residual integrity risk.'
            ]
        },
        password: {
            protocol: 'AUTH',
            metrics: ['Authentication attempts', 'Failed attempts', 'Locked accounts', 'Prevented takeovers'],
            guidance: [
                'Establish the fictional identity provider’s normal authentication baseline.',
                'Repeated failures begin against documentation-only accounts and sources.',
                'The pattern expands into a safe password-spray simulation across more accounts.',
                'Rate limits and lockouts constrain attempts; MFA prevents a guessed password from becoming a session.',
                'Compare failed attempts, locked accounts, prevented takeovers, and residual account risk.'
            ]
        },
        eavesdropping: {
            protocol: 'HTTPS',
            metrics: ['Observed packets', 'Encrypted packets', 'Exposed packets', 'Isolated flows'],
            guidance: [
                'Establish a normal metadata-only flow between the workstation and gateway.',
                'A fictional observer begins seeing route metadata; no packet capture or external connection occurs.',
                'Protected content remains unreadable while unencrypted synthetic units become exposed.',
                'Segmentation limits observable paths and intrusion detection records the monitoring anomaly.',
                'Compare encrypted, exposed, isolated, and detected units to assess confidentiality risk.'
            ]
        },
        sqli: {
            protocol: 'HTTPS',
            metrics: ['Request markers', 'Rejected requests', 'Database queries', 'Records at risk'],
            guidance: [
                'Establish a normal fictional web-to-database request baseline with safe query metadata.',
                'A non-executable unsafe-input marker appears at the application edge.',
                'Input patterns correlate with database errors and possible record-access risk.',
                'The WAF rejects marked requests, least privilege limits database scope, and IDS records suspicious flows.',
                'Compare rejected requests, database errors, protected records, and residual data-access risk.'
            ]
        },
        xss: {
            protocol: 'HTTPS',
            metrics: ['Content submissions', 'Rejected content', 'Unsafe renders', 'Sessions at risk'],
            guidance: [
                'Establish normal fictional content submission and browser rendering behavior.',
                'A harmless untrusted-content marker appears without containing executable script.',
                'Unsafe rendering raises fictional session risk when browser and application protections are absent.',
                'The WAF rejects marked content, patch management hardens rendering, and IDS records suspicious delivery.',
                'Compare rejected content, protected renders, sessions at risk, and residual browser-policy risk.'
            ]
        },
        phishing: {
            protocol: 'SMTP',
            metrics: ['Mock messages', 'Filtered messages', 'User interactions', 'Protected identities'],
            guidance: [
                'Establish a normal mock inbox baseline using fictional senders and inert message metadata.',
                'Generic deceptive-message cues appear, including urgency and sender mismatch labels.',
                'The simulation progresses to targeted spear-phishing metadata without links, attachments, or real delivery.',
                'Email filtering removes messages, MFA protects identities, and endpoint protection contains risky interactions.',
                'Compare delivered, filtered, interacted, identity-protected, and endpoint-contained outcomes.'
            ]
        },
        malware: {
            protocol: 'SMB',
            metrics: ['Endpoint events', 'Infected endpoints', 'Isolated endpoints', 'Spread attempts'],
            guidance: [
                'Establish normal fictional endpoint health, file activity, and internal connection patterns.',
                'A harmless behavior marker changes one workstation from healthy to suspicious.',
                'Abstract spread attempts move toward the fictional file service without files, binaries, or executable content.',
                'Endpoint protection contains behavior, patch management prevents infection, and segmentation isolates lateral paths.',
                'Compare infected, contained, patched, isolated, and residual spread-risk outcomes.'
            ]
        },
        insider: {
            protocol: 'SMB',
            metrics: ['Access events', 'Baseline deviations', 'Restricted events', 'Transfer risk'],
            guidance: [
                'Establish a fictional user baseline for access time, volume, privilege, and destination.',
                'A deterministic negligent, compromised, or malicious insider variant begins deviating from that baseline.',
                'Access volume and destination sensitivity increase without exposing real data or credentials.',
                'Least privilege restricts access, DLP blocks risky transfer units, and anomaly detection records behavioral deviations.',
                'Compare deviations, restricted access, blocked transfers, and residual organizational risk.'
            ]
        },
        zeroday: {
            protocol: 'HTTPS',
            metrics: ['Behavior events', 'Signature misses', 'Anomaly detections', 'Contained actions'],
            guidance: [
                'Establish normal fictional application behavior and a known-signature monitoring baseline.',
                'An abstract unknown-flaw marker appears and intentionally does not match a known signature.',
                'Behavioral deviation grows while signature-only checks continue to miss the activity.',
                'Anomaly detection identifies behavior, segmentation limits reach, and least privilege contains impact.',
                'Compare signature misses, behavioral detections, contained actions, and residual unknown-flaw risk.'
            ]
        },
        apt: {
            protocol: 'SMB',
            metrics: ['Stage activity', 'Assets discovered', 'Collected units', 'Exfiltrated units'],
            guidance: [
                'Initial access: a harmless metadata marker reaches the fictional workstation.',
                'Persistence: repeated low-volume events establish a synthetic foothold.',
                'Discovery: the simulation enumerates fictional asset labels without scanning any network.',
                'Privilege expansion: least privilege determines whether higher-sensitivity actions remain available.',
                'Lateral movement: segmentation determines whether the path can reach the file service.',
                'Collection: fictional data units accumulate locally without reading or creating real files.',
                'Exfiltration outcome: DLP determines whether synthetic collection units leave the protected data boundary.'
            ]
        }
    };

    function stepSpecializedScenario(previous) {
        if (previous.status === 'complete') return previous;
        const state = JSON.parse(JSON.stringify(previous));
        const id = state.scenario.id;
        const random = seededRandom(state.config.seed + state.tick * 1297 + id.length * 41);
        const difficulty = { Beginner: 0.8, Intermediate: 1, Advanced: 1.25 }[state.config.difficulty] || 1;
        state.activeDefenseEffects = [];
        state.status = 'running';
        state.tick += 1;
        state.phase = Math.min(state.scenario.phases.length - 1, Math.floor((state.tick - 1) / 4));
        if (id === 'mitm') stepMitm(state, random, difficulty);
        if (id === 'password') stepPassword(state, random, difficulty);
        if (id === 'eavesdropping') stepEavesdropping(state, random, difficulty);
        if (id === 'sqli') stepSqli(state, random, difficulty);
        if (id === 'xss') stepXss(state, random, difficulty);
        if (id === 'phishing') stepPhishing(state, random, difficulty);
        if (id === 'malware') stepMalware(state, random, difficulty);
        if (id === 'insider') stepInsider(state, random, difficulty);
        if (id === 'zeroday') stepZeroDay(state, random, difficulty);
        if (id === 'apt') stepApt(state, random, difficulty);
        state.history.push({ tick: state.tick, ...state.metrics });
        state.history = state.history.slice(-32);
        const totalTicks = state.scenario.id === 'apt' ? 28 : 20;
        if (state.tick >= totalTicks) {
            state.status = 'complete';
            state.findings = buildReport(state);
        }
        return state;
    }

    function baseNetworkEvent(state, details) {
        return {
            id: `${state.scenario.id}-${state.tick}`, tick: state.tick,
            time: `${String(Math.floor(state.tick / 60)).padStart(2, '0')}:${String(state.tick % 60).padStart(2, '0')}`,
            source: host(details.source), destination: host(details.destination),
            protocol: details.protocol, action: details.action,
            requests: details.units, allowedRequests: details.allowed,
            blockedRequests: details.blocked, bytes: details.units * 240,
            latency: details.latency, severity: details.severity,
            marker: details.marker || state.scenario.marker,
            explanation: details.explanation,
            scenarioState: details.scenarioState
        };
    }

    function commitNetworkTick(state, event, risk, specificMetrics) {
        const defenseEvents = state.activeDefenseEffects.map(effect =>
            defenseEffectEvent(state, effect, event.source, event.destination, event.protocol, event.latency));
        state.events.unshift(...defenseEvents.slice().reverse(), event);
        state.events = state.events.slice(0, 100);
        state.flows = [event, ...defenseEvents].slice(0, 24);
        if (event.severity !== 'info' || defenseEvents.length) {
            state.alerts.unshift({ ...event, id: `alert-${event.id}`, title: `${state.scenario.title} — ${event.marker.replaceAll('_', ' ').toLowerCase()}` });
        }
        defenseEvents.forEach(defenseEvent => {
            state.alerts.unshift({ ...defenseEvent, id: `alert-${defenseEvent.id}`, title: `${DEFENSES[defenseEvent.defenseId][0]} triggered` });
        });
        state.alerts = state.alerts.slice(0, 30);
        const blocked = state.activeDefenseEffects.filter(effect => effect.kind !== 'detective').reduce((sum, effect) => sum + effect.affected, 0);
        const detections = state.activeDefenseEffects.filter(effect => effect.kind === 'detective').reduce((sum, effect) => sum + effect.affected, 0);
        state.metrics = {
            ...state.metrics,
            rps: event.requests, offered: event.requests, allowed: event.allowedRequests,
            serverRps: event.allowedRequests, blocked,
            totalBlocked: (state.metrics.totalBlocked || 0) + blocked,
            detections: (state.metrics.detections || 0) + detections,
            latency: event.latency, errors: Math.round(risk * 0.18),
            availability: Math.max(60, 100 - Math.round(risk * 0.12)),
            risk: Math.round(risk),
            ...specificMetrics
        };
    }

    function stepMitm(state, random, difficulty) {
        const attackActive = state.tick > 4;
        const attempted = attackActive ? Math.round((4 + state.phase * 3 + random() * 4) * difficulty) : 0;
        const encrypted = Boolean(state.defenses.encryption);
        const mfa = Boolean(state.defenses.mfa);
        const ids = Boolean(state.defenses.ids);
        const altered = attackActive && !encrypted ? attempted : 0;
        const protectedSessions = attackActive && encrypted ? attempted : 0;
        const certificateWarnings = attackActive ? Math.max(1, Math.round(attempted * (encrypted ? 1 : 0.45))) : 0;
        const reauthChallenges = attackActive && mfa ? Math.max(1, Math.round(attempted * 0.55)) : 0;
        if (protectedSessions) recordDefense(state, 'encryption', protectedSessions, {
            metricDeltas: { alteredSessions: -protectedSessions },
            explanation: `Encryption and certificate validation protected ${protectedSessions} fictional sessions on the altered route.`
        });
        if (reauthChallenges) recordDefense(state, 'mfa', reauthChallenges, {
            metricDeltas: { reauthChallenges },
            explanation: `MFA challenged ${reauthChallenges} fictional sessions after the route-integrity warning.`
        });
        if (ids && attackActive) recordDefense(state, 'ids', certificateWarnings, {
            metricDeltas: { detections: certificateWarnings },
            explanation: `Intrusion detection observed ${certificateWarnings} route or certificate integrity indicators without blocking them.`
        });
        const totals = state.scenarioState || { alteredSessions: 0, protectedSessions: 0, certificateWarnings: 0, reauthChallenges: 0 };
        totals.route = attackActive ? ['workstation', 'edge', 'actor'] : ['workstation', 'edge'];
        totals.routeIntegrity = attackActive ? (encrypted ? 'protected' : 'altered') : 'trusted';
        totals.certificateStatus = attackActive ? (encrypted ? 'validated warning' : 'untrusted') : 'trusted';
        totals.alteredSessions += altered;
        totals.protectedSessions += protectedSessions;
        totals.certificateWarnings += certificateWarnings;
        totals.reauthChallenges += reauthChallenges;
        state.scenarioState = totals;
        const risk = attackActive ? Math.min(96, 28 + state.phase * 14 + altered * 2 - protectedSessions - reauthChallenges) : 5;
        const event = baseNetworkEvent(state, {
            source: attackActive ? 'actor' : 'workstation', destination: attackActive ? 'workstation' : 'edge',
            protocol: 'HTTPS', action: altered ? 'integrity-risk' : (protectedSessions ? 'protected' : 'forwarded'),
            units: Math.max(1, attempted || 3), allowed: altered, blocked: protectedSessions,
            latency: Math.round(38 + state.phase * 12 + random() * 8),
            severity: altered ? (state.phase >= 3 ? 'critical' : 'high') : (attackActive ? 'low' : 'info'),
            marker: attackActive ? 'ROUTE_CERTIFICATE_WARNING' : 'TRUSTED_SESSION_BASELINE',
            explanation: attackActive
                ? `${altered} fictional sessions had integrity risk; ${protectedSessions} remained protected.`
                : 'The synthetic session follows the expected route with a trusted certificate.',
            scenarioState: { routeIntegrity: totals.routeIntegrity, certificateStatus: totals.certificateStatus }
        });
        commitNetworkTick(state, event, risk, {
            alteredSessions: totals.alteredSessions, protectedSessions: totals.protectedSessions,
            certificateWarnings: totals.certificateWarnings, reauthChallenges: totals.reauthChallenges
        });
        const workstation = state.hosts.find(item => item.id === 'workstation');
        const edge = state.hosts.find(item => item.id === 'edge');
        if (workstation) workstation.status = altered ? 'at-risk' : (attackActive ? 'protected' : 'healthy');
        if (edge) edge.status = attackActive ? 'observing' : 'healthy';
    }

    function stepPassword(state, random, difficulty) {
        const attackActive = state.tick > 4;
        const rawAttempts = attackActive ? Math.round((10 + state.phase * 12 + random() * 8) * difficulty) : 3;
        const rateLimited = attackActive && state.defenses.rateLimiting ? Math.round(rawAttempts * 0.42) : 0;
        const accepted = rawAttempts - rateLimited;
        const locked = attackActive && state.defenses.accountLockout && state.phase >= 2 ? Math.max(1, Math.round(accepted * 0.18)) : 0;
        const guessed = attackActive ? Math.max(0, Math.floor(accepted * (0.015 + state.phase * 0.006))) : 0;
        const preventedTakeovers = state.defenses.mfa ? guessed : 0;
        const successfulTakeovers = guessed - preventedTakeovers;
        if (rateLimited) recordDefense(state, 'rateLimiting', rateLimited, {
            metricDeltas: { attemptsRejected: rateLimited },
            explanation: `Rate limiting rejected ${rateLimited} repeated fictional authentication attempts.`
        });
        if (locked) recordDefense(state, 'accountLockout', locked, {
            metricDeltas: { lockedAccounts: locked },
            explanation: `Account lockout protected ${locked} fictional accounts after repeated failures.`
        });
        if (preventedTakeovers) recordDefense(state, 'mfa', preventedTakeovers, {
            metricDeltas: { preventedTakeovers },
            explanation: `MFA prevented ${preventedTakeovers} guessed passwords from becoming fictional sessions.`
        });
        const totals = state.scenarioState || { attempts: 0, failedAttempts: 0, lockedAccounts: 0, preventedTakeovers: 0, successfulTakeovers: 0, distinctSources: 0 };
        totals.pattern = state.phase < 2 ? 'repeated' : 'password-spray';
        totals.attempts += rawAttempts;
        totals.failedAttempts += Math.max(0, accepted - guessed);
        totals.lockedAccounts += locked;
        totals.preventedTakeovers += preventedTakeovers;
        totals.successfulTakeovers += successfulTakeovers;
        totals.distinctSources = Math.max(totals.distinctSources, attackActive ? 1 + state.phase : 1);
        state.scenarioState = totals;
        const risk = attackActive ? Math.min(98, 22 + state.phase * 15 + successfulTakeovers * 24 - locked * 2 - rateLimited * 0.3) : 4;
        const event = baseNetworkEvent(state, {
            source: attackActive ? `actor${Math.min(5, 1 + (state.tick % Math.max(1, totals.distinctSources)))}`.replace('actor1', 'actor') : 'workstation',
            destination: 'identity', protocol: 'AUTH',
            action: rateLimited ? 'rate-limited' : (locked ? 'locked' : 'authentication-failed'),
            units: rawAttempts, allowed: accepted - locked, blocked: rateLimited + locked,
            latency: Math.round(28 + accepted * 0.7),
            severity: successfulTakeovers ? 'critical' : (attackActive ? (state.phase >= 2 ? 'high' : 'medium') : 'info'),
            marker: attackActive ? 'AUTHENTICATION_PATTERN' : 'AUTHENTICATION_BASELINE',
            explanation: attackActive
                ? `${rawAttempts} safe authentication attempts produced ${locked} lockouts and ${successfulTakeovers} fictional account takeovers.`
                : 'Normal fictional sign-in volume establishes the identity baseline.',
            scenarioState: { pattern: totals.pattern, distinctSources: totals.distinctSources }
        });
        commitNetworkTick(state, event, risk, {
            authAttempts: totals.attempts, failedAttempts: totals.failedAttempts,
            lockedAccounts: totals.lockedAccounts, preventedTakeovers: totals.preventedTakeovers,
            successfulTakeovers: totals.successfulTakeovers, distinctSources: totals.distinctSources
        });
        const identity = state.hosts.find(item => item.id === 'identity');
        if (identity) identity.status = successfulTakeovers ? 'at-risk' : (attackActive ? 'observing' : 'healthy');
    }

    function stepEavesdropping(state, random, difficulty) {
        const observationActive = state.tick > 4;
        const observed = observationActive ? Math.round((18 + state.phase * 11 + random() * 10) * difficulty) : 8;
        const encryptionEnabled = Boolean(state.defenses.encryption);
        const segmented = observationActive && state.defenses.segmentation ? Math.round(observed * 0.35) : 0;
        const observable = observed - segmented;
        const encrypted = encryptionEnabled ? observable : 0;
        const exposed = encryptionEnabled ? 0 : observable;
        if (encrypted) recordDefense(state, 'encryption', encrypted, {
            metricDeltas: { exposedPackets: -encrypted },
            explanation: `Encryption kept ${encrypted} fictional content units unreadable while leaving route metadata observable.`
        });
        if (segmented) recordDefense(state, 'segmentation', segmented, {
            metricDeltas: { isolatedFlows: segmented },
            explanation: `Network segmentation removed ${segmented} fictional units from the observer-visible path.`
        });
        if (observationActive && state.defenses.ids) recordDefense(state, 'ids', observable, {
            metricDeltas: { detections: observable },
            explanation: `Intrusion detection recorded the unusual monitoring pattern for ${observable} synthetic units without claiming prevention.`
        });
        const totals = state.scenarioState || { observedPackets: 0, encryptedPackets: 0, exposedPackets: 0, isolatedFlows: 0, metadataObserved: 0 };
        totals.contentVisibility = encryptionEnabled ? 'encrypted' : 'exposed';
        totals.observedPackets += observed;
        totals.encryptedPackets += encrypted;
        totals.exposedPackets += exposed;
        totals.isolatedFlows += segmented;
        totals.metadataObserved += observable;
        state.scenarioState = totals;
        const risk = observationActive ? Math.min(96, 20 + state.phase * 14 + exposed * 0.8 - segmented * 0.4) : 4;
        const event = baseNetworkEvent(state, {
            source: 'workstation', destination: 'edge', protocol: encryptionEnabled ? 'HTTPS' : 'DNS',
            action: exposed ? 'content-exposed' : (encrypted ? 'content-protected' : 'forwarded'),
            units: observed, allowed: observable, blocked: segmented,
            latency: Math.round(30 + random() * 9 + segmented * 0.15),
            severity: exposed ? (state.phase >= 3 ? 'critical' : 'high') : (observationActive ? 'low' : 'info'),
            marker: observationActive ? 'PLAINTEXT_EXPOSURE_RISK' : 'TRAFFIC_BASELINE',
            explanation: observationActive
                ? `${encrypted} fictional content units stayed encrypted; ${exposed} were exposed; ${segmented} were isolated.`
                : 'Normal synthetic traffic establishes observable metadata without exposing content.',
            scenarioState: { contentVisibility: totals.contentVisibility, metadataObservable: true }
        });
        commitNetworkTick(state, event, risk, {
            observedPackets: totals.observedPackets, encryptedPackets: totals.encryptedPackets,
            exposedPackets: totals.exposedPackets, isolatedFlows: totals.isolatedFlows,
            metadataObserved: totals.metadataObserved
        });
        const workstation = state.hosts.find(item => item.id === 'workstation');
        if (workstation) workstation.status = exposed ? 'at-risk' : (observationActive ? 'protected' : 'healthy');
    }

    function stepSqli(state, random, difficulty) {
        const attackActive = state.tick > 4;
        const markedRequests = attackActive ? Math.round((5 + state.phase * 4 + random() * 5) * difficulty) : 0;
        const rejected = attackActive && state.defenses.waf ? Math.round(markedRequests * 0.82) : 0;
        const databaseQueries = markedRequests - rejected;
        const privilegeReduction = state.defenses.leastPrivilege ? 0.82 : 0;
        const recordsAtRisk = Math.round(databaseQueries * (1 - privilegeReduction) * (2 + state.phase));
        const protectedRecords = Math.round(databaseQueries * privilegeReduction * (2 + state.phase));
        const databaseErrors = attackActive ? Math.max(0, Math.round(databaseQueries * 0.38)) : 0;
        if (rejected) recordDefense(state, 'waf', rejected, {
            metricDeltas: { rejectedRequests: rejected },
            explanation: `The web application firewall rejected ${rejected} metadata-only unsafe-input markers before the fictional application.`
        });
        if (protectedRecords) recordDefense(state, 'leastPrivilege', protectedRecords, {
            metricDeltas: { protectedRecords },
            explanation: `Least privilege kept ${protectedRecords} fictional record units outside the application identity’s allowed scope.`
        });
        if (attackActive && state.defenses.ids) recordDefense(state, 'ids', Math.max(1, databaseQueries), {
            metricDeltas: { detections: Math.max(1, databaseQueries) },
            explanation: `Intrusion detection correlated ${Math.max(1, databaseQueries)} safe request markers with database-flow changes.`
        });
        const totals = state.scenarioState || {
            markedRequests: 0, rejectedRequests: 0, databaseQueries: 0,
            databaseErrors: 0, recordsAtRisk: 0, protectedRecords: 0
        };
        totals.requestHandling = rejected === markedRequests && markedRequests ? 'rejected-at-edge' : (attackActive ? 'reached-application' : 'normal');
        totals.markedRequests += markedRequests;
        totals.rejectedRequests += rejected;
        totals.databaseQueries += databaseQueries;
        totals.databaseErrors += databaseErrors;
        totals.recordsAtRisk += recordsAtRisk;
        totals.protectedRecords += protectedRecords;
        state.scenarioState = totals;
        const risk = attackActive ? Math.min(98, 20 + state.phase * 14 + recordsAtRisk * 0.8 + databaseErrors - rejected) : 4;
        const event = baseNetworkEvent(state, {
            source: 'internet', destination: databaseQueries ? 'database' : 'web', protocol: 'HTTPS',
            action: rejected ? 'blocked' : (databaseQueries ? 'query-risk' : 'forwarded'),
            units: Math.max(1, markedRequests || 4), allowed: databaseQueries, blocked: rejected,
            latency: Math.round(36 + databaseQueries * 2.5 + random() * 8),
            severity: recordsAtRisk ? (state.phase >= 3 ? 'critical' : 'high') : (attackActive ? 'low' : 'info'),
            marker: attackActive ? 'SIMULATED_QUERY_MANIPULATION' : 'WEB_DATABASE_BASELINE',
            explanation: attackActive
                ? `${rejected} marked requests were rejected; ${databaseQueries} reached the fictional database path; ${recordsAtRisk} record units were at risk.`
                : 'Normal synthetic web requests use safe query metadata and expected database access.',
            scenarioState: { requestHandling: totals.requestHandling, databaseErrors }
        });
        commitNetworkTick(state, event, risk, {
            markedRequests: totals.markedRequests, rejectedRequests: totals.rejectedRequests,
            databaseQueries: totals.databaseQueries, databaseErrors: totals.databaseErrors,
            recordsAtRisk: totals.recordsAtRisk, protectedRecords: totals.protectedRecords
        });
        const web = state.hosts.find(item => item.id === 'web');
        const database = state.hosts.find(item => item.id === 'database');
        if (web) web.status = rejected ? 'protected' : (attackActive ? 'observing' : 'healthy');
        if (database) database.status = recordsAtRisk ? 'at-risk' : (attackActive ? 'protected' : 'healthy');
    }

    function stepXss(state, random, difficulty) {
        const attackActive = state.tick > 4;
        const submissions = attackActive ? Math.round((4 + state.phase * 4 + random() * 4) * difficulty) : 2;
        const rejected = attackActive && state.defenses.waf ? Math.round(submissions * 0.8) : 0;
        const applicationBound = submissions - rejected;
        const hardened = Boolean(state.defenses.patchManagement);
        const unsafeRenders = attackActive && !hardened ? applicationBound : 0;
        const protectedRenders = attackActive && hardened ? applicationBound : 0;
        const sessionsAtRisk = Math.round(unsafeRenders * (1.4 + state.phase * 0.4));
        if (rejected) recordDefense(state, 'waf', rejected, {
            metricDeltas: { rejectedContent: rejected },
            explanation: `The web application firewall rejected ${rejected} harmless untrusted-content markers before rendering.`
        });
        if (protectedRenders) recordDefense(state, 'patchManagement', protectedRenders, {
            metricDeltas: { protectedRenders },
            explanation: `Patch management hardened ${protectedRenders} fictional render operations against the unsafe-content condition.`
        });
        if (attackActive && state.defenses.ids) recordDefense(state, 'ids', Math.max(1, applicationBound), {
            metricDeltas: { detections: Math.max(1, applicationBound) },
            explanation: `Intrusion detection observed ${Math.max(1, applicationBound)} untrusted-content delivery markers without executing content.`
        });
        const totals = state.scenarioState || {
            contentSubmissions: 0, rejectedContent: 0, unsafeRenders: 0,
            protectedRenders: 0, sessionsAtRisk: 0
        };
        totals.browserPolicy = hardened ? 'hardened' : (attackActive ? 'permissive-risk' : 'normal');
        totals.contentSubmissions += submissions;
        totals.rejectedContent += rejected;
        totals.unsafeRenders += unsafeRenders;
        totals.protectedRenders += protectedRenders;
        totals.sessionsAtRisk += sessionsAtRisk;
        state.scenarioState = totals;
        const risk = attackActive ? Math.min(96, 18 + state.phase * 14 + sessionsAtRisk * 1.2 - rejected - protectedRenders) : 4;
        const event = baseNetworkEvent(state, {
            source: 'internet', destination: unsafeRenders ? 'workstation' : 'web', protocol: 'HTTPS',
            action: rejected ? 'blocked' : (unsafeRenders ? 'unsafe-render-risk' : 'content-protected'),
            units: submissions, allowed: applicationBound, blocked: rejected,
            latency: Math.round(32 + applicationBound * 1.2 + random() * 6),
            severity: sessionsAtRisk ? (state.phase >= 3 ? 'critical' : 'high') : (attackActive ? 'low' : 'info'),
            marker: attackActive ? 'UNTRUSTED_CONTENT_MARKER' : 'CONTENT_RENDER_BASELINE',
            explanation: attackActive
                ? `${rejected} inert markers were rejected; ${unsafeRenders} unsafe fictional renders placed ${sessionsAtRisk} sessions at risk.`
                : 'Normal fictional content is rendered without executable payloads.',
            scenarioState: { browserPolicy: totals.browserPolicy, executableContent: false }
        });
        commitNetworkTick(state, event, risk, {
            contentSubmissions: totals.contentSubmissions, rejectedContent: totals.rejectedContent,
            unsafeRenders: totals.unsafeRenders, protectedRenders: totals.protectedRenders,
            sessionsAtRisk: totals.sessionsAtRisk
        });
        const web = state.hosts.find(item => item.id === 'web');
        const workstation = state.hosts.find(item => item.id === 'workstation');
        if (web) web.status = rejected || hardened ? 'protected' : (attackActive ? 'observing' : 'healthy');
        if (workstation) workstation.status = sessionsAtRisk ? 'at-risk' : 'healthy';
    }

    function stepPhishing(state, random, difficulty) {
        const campaignActive = state.tick > 4;
        const variant = state.phase >= 2 ? 'spear-phishing' : (campaignActive ? 'phishing' : 'baseline');
        const messages = campaignActive ? Math.round((3 + state.phase * 3 + random() * 4) * difficulty) : 2;
        const filtered = campaignActive && state.defenses.emailFiltering ? Math.round(messages * (variant === 'spear-phishing' ? 0.62 : 0.84)) : 0;
        const delivered = messages - filtered;
        const interactions = campaignActive ? Math.round(delivered * (variant === 'spear-phishing' ? 0.34 : 0.2)) : 0;
        const protectedIdentities = state.defenses.mfa ? interactions : 0;
        const containedEndpoints = state.defenses.endpointProtection ? interactions : 0;
        const compromisedIdentities = Math.max(0, interactions - protectedIdentities);
        const endpointRisk = Math.max(0, interactions - containedEndpoints);
        if (filtered) recordDefense(state, 'emailFiltering', filtered, {
            metricDeltas: { filteredMessages: filtered },
            explanation: `Email filtering quarantined ${filtered} inert mock messages using sender and urgency metadata.`
        });
        if (protectedIdentities) recordDefense(state, 'mfa', protectedIdentities, {
            metricDeltas: { protectedIdentities },
            explanation: `MFA protected ${protectedIdentities} fictional identities after mock-message interaction.`
        });
        if (containedEndpoints) recordDefense(state, 'endpointProtection', containedEndpoints, {
            metricDeltas: { containedEndpoints },
            explanation: `Endpoint protection contained ${containedEndpoints} fictional interaction outcomes without opening links or attachments.`
        });
        const totals = state.scenarioState || {
            mockMessages: 0, filteredMessages: 0, deliveredMessages: 0,
            interactions: 0, protectedIdentities: 0, compromisedIdentities: 0,
            containedEndpoints: 0, endpointRisk: 0, inbox: []
        };
        totals.variant = variant;
        totals.mockMessages += messages;
        totals.filteredMessages += filtered;
        totals.deliveredMessages += delivered;
        totals.interactions += interactions;
        totals.protectedIdentities += protectedIdentities;
        totals.compromisedIdentities += compromisedIdentities;
        totals.containedEndpoints += containedEndpoints;
        totals.endpointRisk += endpointRisk;
        totals.inbox.unshift({
            id: `mock-message-${state.tick}`, tick: state.tick,
            sender: variant === 'spear-phishing' ? 'project-update@fictional.test' : 'notice@fictional.test',
            subject: variant === 'spear-phishing' ? 'Mock targeted project update' : 'Mock urgent account notice',
            variant, disposition: filtered ? 'filtered' : 'delivered',
            cues: variant === 'spear-phishing' ? ['targeted context', 'sender mismatch'] : ['urgency', 'sender mismatch'],
            inert: true
        });
        totals.inbox = totals.inbox.slice(0, 12);
        state.scenarioState = totals;
        const risk = campaignActive ? Math.min(98, 18 + state.phase * 13 + compromisedIdentities * 18 + endpointRisk * 10 - filtered) : 4;
        const event = baseNetworkEvent(state, {
            source: 'internet', destination: filtered ? 'email' : 'workstation', protocol: 'SMTP',
            action: filtered ? 'filtered' : (interactions ? 'mock-interaction' : 'delivered'),
            units: messages, allowed: delivered, blocked: filtered,
            latency: Math.round(26 + random() * 7),
            severity: compromisedIdentities || endpointRisk ? (state.phase >= 3 ? 'critical' : 'high') : (campaignActive ? 'medium' : 'info'),
            marker: campaignActive ? 'DECEPTIVE_MESSAGE_RISK' : 'MOCK_INBOX_BASELINE',
            explanation: campaignActive
                ? `${filtered} inert messages were filtered; ${delivered} reached the mock inbox; ${interactions} produced fictional user interactions.`
                : 'Normal inert messages establish the fictional inbox baseline.',
            scenarioState: { variant, inertMessage: true, cues: totals.inbox[0].cues }
        });
        commitNetworkTick(state, event, risk, {
            mockMessages: totals.mockMessages, filteredMessages: totals.filteredMessages,
            deliveredMessages: totals.deliveredMessages, interactions: totals.interactions,
            protectedIdentities: totals.protectedIdentities, compromisedIdentities: totals.compromisedIdentities,
            containedEndpoints: totals.containedEndpoints, endpointRisk: totals.endpointRisk
        });
        const email = state.hosts.find(item => item.id === 'email');
        const workstation = state.hosts.find(item => item.id === 'workstation');
        if (email) email.status = filtered ? 'protected' : (campaignActive ? 'observing' : 'healthy');
        if (workstation) workstation.status = compromisedIdentities || endpointRisk ? 'at-risk' : (campaignActive ? 'protected' : 'healthy');
    }

    function stepMalware(state, random, difficulty) {
        const active = state.tick > 4;
        const behaviorEvents = active ? Math.round((3 + state.phase * 3 + random() * 3) * difficulty) : 2;
        const patched = active && state.defenses.patchManagement ? Math.round(behaviorEvents * 0.68) : 0;
        const vulnerableEvents = behaviorEvents - patched;
        const contained = active && state.defenses.endpointProtection ? Math.round(vulnerableEvents * 0.72) : 0;
        const infectionEvents = Math.max(0, vulnerableEvents - contained);
        const spreadAttempts = active && state.phase >= 2 ? Math.round(infectionEvents * (1 + state.phase * 0.35)) : 0;
        const isolated = spreadAttempts && state.defenses.segmentation ? Math.round(spreadAttempts * 0.78) : 0;
        const successfulSpread = Math.max(0, spreadAttempts - isolated);
        if (patched) recordDefense(state, 'patchManagement', patched, {
            metricDeltas: { preventedInfections: patched },
            explanation: `Patch management prevented ${patched} fictional behavior events from becoming endpoint infections.`
        });
        if (contained) recordDefense(state, 'endpointProtection', contained, {
            metricDeltas: { containedEvents: contained },
            explanation: `Endpoint protection contained ${contained} abstract endpoint behavior events without executing files.`
        });
        if (isolated) recordDefense(state, 'segmentation', isolated, {
            metricDeltas: { isolatedSpread: isolated },
            explanation: `Network segmentation isolated ${isolated} fictional lateral spread attempts before the file service.`
        });
        const totals = state.scenarioState || {
            endpointEvents: 0, infectedEndpoints: 0, containedEvents: 0,
            preventedInfections: 0, spreadAttempts: 0, isolatedSpread: 0,
            successfulSpread: 0, affectedHosts: []
        };
        const newInfections = Math.min(2, Math.floor(infectionEvents / 3));
        totals.endpointEvents += behaviorEvents;
        totals.preventedInfections += patched;
        totals.containedEvents += contained;
        totals.spreadAttempts += spreadAttempts;
        totals.isolatedSpread += isolated;
        totals.successfulSpread += successfulSpread;
        totals.infectedEndpoints = Math.min(6, totals.infectedEndpoints + newInfections + Math.min(1, successfulSpread));
        if (newInfections && !totals.affectedHosts.includes('workstation')) totals.affectedHosts.push('workstation');
        if (successfulSpread && !totals.affectedHosts.includes('files')) totals.affectedHosts.push('files');
        totals.endpointHealth = totals.infectedEndpoints ? 'infection-risk' : (active ? 'protected' : 'healthy');
        state.scenarioState = totals;
        const risk = active ? Math.min(98, 18 + state.phase * 14 + totals.infectedEndpoints * 9 + successfulSpread * 3 - contained - isolated) : 4;
        const event = baseNetworkEvent(state, {
            source: 'workstation', destination: spreadAttempts ? 'files' : 'soc', protocol: spreadAttempts ? 'SMB' : 'HTTPS',
            action: isolated ? 'isolated' : (infectionEvents ? 'endpoint-risk' : 'contained'),
            units: behaviorEvents + spreadAttempts, allowed: infectionEvents + successfulSpread, blocked: patched + contained + isolated,
            latency: Math.round(30 + infectionEvents * 3 + random() * 7),
            severity: successfulSpread ? 'critical' : (infectionEvents ? 'high' : (active ? 'low' : 'info')),
            marker: active ? 'ENDPOINT_BEHAVIOR_RISK' : 'ENDPOINT_HEALTH_BASELINE',
            explanation: active
                ? `${infectionEvents} fictional endpoint events remained active; ${isolated} spread attempts were isolated; ${successfulSpread} reached the next abstract host.`
                : 'Normal endpoint and file-access metadata establishes the fictional health baseline.',
            scenarioState: { endpointHealth: totals.endpointHealth, executableContent: false, affectedHosts: totals.affectedHosts.slice() }
        });
        commitNetworkTick(state, event, risk, {
            endpointEvents: totals.endpointEvents, infectedEndpoints: totals.infectedEndpoints,
            containedEvents: totals.containedEvents, preventedInfections: totals.preventedInfections,
            spreadAttempts: totals.spreadAttempts, isolatedSpread: totals.isolatedSpread,
            successfulSpread: totals.successfulSpread
        });
        const workstation = state.hosts.find(item => item.id === 'workstation');
        const files = state.hosts.find(item => item.id === 'files');
        if (workstation) workstation.status = infectionEvents ? 'at-risk' : (active ? 'protected' : 'healthy');
        if (files) files.status = successfulSpread ? 'at-risk' : (spreadAttempts ? 'observing' : 'healthy');
    }

    function stepInsider(state, random, difficulty) {
        const active = state.tick > 4;
        const variants = ['negligent', 'compromised', 'malicious'];
        const variant = variants[Math.abs(Number(state.config.seed) || 1) % variants.length];
        const variantFactor = { negligent: 0.75, compromised: 1, malicious: 1.25 }[variant];
        const accessEvents = active ? Math.round((4 + state.phase * 4 + random() * 4) * difficulty * variantFactor) : 3;
        const deviations = active ? Math.max(1, Math.round(accessEvents * (0.28 + state.phase * 0.08))) : 0;
        const restricted = active && state.defenses.leastPrivilege ? Math.round(deviations * 0.62) : 0;
        const transferUnits = active && state.phase >= 2 ? Math.max(0, (deviations - restricted) * (2 + state.phase)) : 0;
        const blockedTransfers = transferUnits && state.defenses.dlp ? Math.round(transferUnits * 0.78) : 0;
        const transferRisk = transferUnits - blockedTransfers;
        if (restricted) recordDefense(state, 'leastPrivilege', restricted, {
            metricDeltas: { restrictedEvents: restricted },
            explanation: `Least privilege restricted ${restricted} fictional access events outside the user baseline.`
        });
        if (blockedTransfers) recordDefense(state, 'dlp', blockedTransfers, {
            metricDeltas: { blockedTransfers },
            explanation: `Data-loss prevention blocked ${blockedTransfers} synthetic transfer units at the data boundary.`
        });
        if (active && state.defenses.anomalyDetection) recordDefense(state, 'anomalyDetection', deviations, {
            metricDeltas: { anomalyDetections: deviations },
            explanation: `Anomaly detection identified ${deviations} access events that differed from the fictional behavioral baseline.`
        });
        const totals = state.scenarioState || {
            variant, accessEvents: 0, baselineDeviations: 0, restrictedEvents: 0,
            transferUnits: 0, blockedTransfers: 0, transferRisk: 0, anomalyDetections: 0
        };
        totals.variant = variant;
        totals.baseline = { accessWindow: 'business-hours', normalVolume: 3, allowedDestination: 'File Service' };
        totals.accessEvents += accessEvents;
        totals.baselineDeviations += deviations;
        totals.restrictedEvents += restricted;
        totals.transferUnits += transferUnits;
        totals.blockedTransfers += blockedTransfers;
        totals.transferRisk += transferRisk;
        totals.anomalyDetections += active && state.defenses.anomalyDetection ? deviations : 0;
        state.scenarioState = totals;
        const risk = active ? Math.min(98, 16 + state.phase * 13 + transferRisk * 1.5 + deviations - restricted) : 4;
        const event = baseNetworkEvent(state, {
            source: 'workstation', destination: transferUnits ? 'files' : 'soc', protocol: transferUnits ? 'SMB' : 'HTTPS',
            action: blockedTransfers ? 'blocked-transfer' : (deviations ? 'baseline-deviation' : 'baseline-access'),
            units: accessEvents + transferUnits, allowed: accessEvents - restricted + transferRisk, blocked: restricted + blockedTransfers,
            latency: Math.round(28 + deviations * 1.4 + random() * 6),
            severity: transferRisk ? (state.phase >= 3 ? 'critical' : 'high') : (deviations ? 'medium' : 'info'),
            marker: active ? 'UNUSUAL_ACCESS_PATTERN' : 'USER_ACCESS_BASELINE',
            explanation: active
                ? `${variant} variant: ${deviations} baseline deviations, ${restricted} restricted events, and ${transferRisk} fictional transfer units remained at risk.`
                : 'Normal fictional user access establishes time, volume, privilege, and destination baselines.',
            scenarioState: { variant, baselineDeviation: deviations, dataContent: false }
        });
        commitNetworkTick(state, event, risk, {
            accessEvents: totals.accessEvents, baselineDeviations: totals.baselineDeviations,
            restrictedEvents: totals.restrictedEvents, transferUnits: totals.transferUnits,
            blockedTransfers: totals.blockedTransfers, transferRisk: totals.transferRisk,
            anomalyDetections: totals.anomalyDetections
        });
        const workstation = state.hosts.find(item => item.id === 'workstation');
        const files = state.hosts.find(item => item.id === 'files');
        if (workstation) workstation.status = deviations ? 'observing' : 'healthy';
        if (files) files.status = transferRisk ? 'at-risk' : (active ? 'protected' : 'healthy');
    }

    function stepZeroDay(state, random, difficulty) {
        const active = state.tick > 4;
        const behaviorEvents = active ? Math.round((4 + state.phase * 4 + random() * 4) * difficulty) : 2;
        const signatureMisses = active ? behaviorEvents : 0;
        const detected = active && state.defenses.anomalyDetection ? Math.round(behaviorEvents * 0.76) : 0;
        const suspiciousActions = Math.max(0, behaviorEvents - detected);
        const isolated = suspiciousActions && state.defenses.segmentation ? Math.round(suspiciousActions * 0.68) : 0;
        const privilegeContained = suspiciousActions && state.defenses.leastPrivilege ? Math.round((suspiciousActions - isolated) * 0.7) : 0;
        const impactActions = Math.max(0, suspiciousActions - isolated - privilegeContained);
        if (detected) recordDefense(state, 'anomalyDetection', detected, {
            metricDeltas: { anomalyDetections: detected },
            explanation: `Anomaly detection identified ${detected} unknown behavior events that had no fictional signature match.`
        });
        if (isolated) recordDefense(state, 'segmentation', isolated, {
            metricDeltas: { isolatedActions: isolated },
            explanation: `Network segmentation isolated ${isolated} unknown-flaw actions from sensitive fictional systems.`
        });
        if (privilegeContained) recordDefense(state, 'leastPrivilege', privilegeContained, {
            metricDeltas: { privilegeContained },
            explanation: `Least privilege contained ${privilegeContained} actions that lacked an authorized fictional capability.`
        });
        const totals = state.scenarioState || {
            behaviorEvents: 0, signatureMisses: 0, anomalyDetections: 0,
            isolatedActions: 0, privilegeContained: 0, impactActions: 0
        };
        totals.signatureStatus = active ? 'unknown-no-match' : 'baseline';
        totals.behaviorEvents += behaviorEvents;
        totals.signatureMisses += signatureMisses;
        totals.anomalyDetections += detected;
        totals.isolatedActions += isolated;
        totals.privilegeContained += privilegeContained;
        totals.impactActions += impactActions;
        state.scenarioState = totals;
        const risk = active ? Math.min(99, 22 + state.phase * 15 + impactActions * 7 - detected - isolated * 2) : 4;
        const event = baseNetworkEvent(state, {
            source: 'actor', destination: state.phase >= 2 ? 'database' : 'web', protocol: 'HTTPS',
            action: isolated ? 'isolated' : (detected ? 'behavior-detected' : 'signature-missed'),
            units: behaviorEvents, allowed: impactActions, blocked: isolated + privilegeContained,
            latency: Math.round(34 + suspiciousActions * 2 + random() * 7),
            severity: impactActions ? (state.phase >= 3 ? 'critical' : 'high') : (active ? 'medium' : 'info'),
            marker: active ? 'UNKNOWN_FLAW_ACTIVITY' : 'APPLICATION_BEHAVIOR_BASELINE',
            explanation: active
                ? `${signatureMisses} events missed signature matching; ${detected} were behaviorally detected; ${impactActions} fictional actions remained.`
                : 'Normal application behavior establishes a signature and behavioral baseline.',
            scenarioState: { signatureStatus: totals.signatureStatus, exploitPayload: false }
        });
        commitNetworkTick(state, event, risk, {
            behaviorEvents: totals.behaviorEvents, signatureMisses: totals.signatureMisses,
            anomalyDetections: totals.anomalyDetections, isolatedActions: totals.isolatedActions,
            privilegeContained: totals.privilegeContained, impactActions: totals.impactActions
        });
        const web = state.hosts.find(item => item.id === 'web');
        const database = state.hosts.find(item => item.id === 'database');
        if (web) web.status = impactActions ? 'at-risk' : (active ? 'observing' : 'healthy');
        if (database) database.status = state.phase >= 2 ? (impactActions ? 'at-risk' : 'protected') : 'healthy';
    }

    function stepApt(state, random, difficulty) {
        const stageNames = ['initial-access', 'persistence', 'discovery', 'privilege-expansion', 'lateral-movement', 'collection', 'exfiltration'];
        const stage = stageNames[state.phase];
        const activity = Math.round((2 + state.phase + random() * 3) * difficulty);
        const privilegeRestricted = stage === 'privilege-expansion' && state.defenses.leastPrivilege ? Math.max(1, Math.round(activity * 0.72)) : 0;
        const lateralBlocked = stage === 'lateral-movement' && state.defenses.segmentation ? Math.max(1, Math.round(activity * 0.76)) : 0;
        const collectionUnits = stage === 'collection' ? activity * 4 : 0;
        const exfiltrationAttempt = stage === 'exfiltration' ? Math.max(activity * 5, state.scenarioState?.collectedUnits || 0) : 0;
        const exfiltrationBlocked = exfiltrationAttempt && state.defenses.dlp ? Math.round(exfiltrationAttempt * 0.88) : 0;
        const exfiltratedUnits = exfiltrationAttempt - exfiltrationBlocked;
        if (privilegeRestricted) recordDefense(state, 'leastPrivilege', privilegeRestricted, {
            metricDeltas: { privilegeRestricted },
            explanation: `Least privilege restricted ${privilegeRestricted} fictional privilege-expansion actions.`
        });
        if (lateralBlocked) recordDefense(state, 'segmentation', lateralBlocked, {
            metricDeltas: { lateralBlocked },
            explanation: `Network segmentation blocked ${lateralBlocked} fictional lateral-movement actions toward the file service.`
        });
        if (exfiltrationBlocked) recordDefense(state, 'dlp', exfiltrationBlocked, {
            metricDeltas: { exfiltrationBlocked },
            explanation: `Data-loss prevention blocked ${exfiltrationBlocked} synthetic collection units at the data boundary.`
        });
        const totals = state.scenarioState || {
            currentStage: stage, completedStages: [], stageEvents: 0, assetsDiscovered: 0,
            privilegeRestricted: 0, lateralMoves: 0, lateralBlocked: 0,
            collectedUnits: 0, exfiltrationAttempted: 0, exfiltrationBlocked: 0, exfiltratedUnits: 0
        };
        totals.currentStage = stage;
        if (!totals.completedStages.includes(stage)) totals.completedStages.push(stage);
        totals.stageEvents += activity;
        if (stage === 'discovery') totals.assetsDiscovered += activity;
        totals.privilegeRestricted += privilegeRestricted;
        if (stage === 'lateral-movement') totals.lateralMoves += activity - lateralBlocked;
        totals.lateralBlocked += lateralBlocked;
        totals.collectedUnits += collectionUnits;
        totals.exfiltrationAttempted += exfiltrationAttempt;
        totals.exfiltrationBlocked += exfiltrationBlocked;
        totals.exfiltratedUnits += exfiltratedUnits;
        state.scenarioState = totals;
        const stageBlocked = privilegeRestricted + lateralBlocked + exfiltrationBlocked;
        const risk = Math.min(99, 12 + state.phase * 13 + exfiltratedUnits * 0.7 + totals.lateralMoves * 3 - stageBlocked);
        const path = {
            'initial-access': ['actor', 'workstation'], persistence: ['workstation', 'workstation'],
            discovery: ['workstation', 'soc'], 'privilege-expansion': ['workstation', 'files'],
            'lateral-movement': ['workstation', 'files'], collection: ['files', 'workstation'],
            exfiltration: ['workstation', 'actor']
        }[stage];
        const event = baseNetworkEvent(state, {
            source: path[0], destination: path[1], protocol: ['initial-access', 'exfiltration'].includes(stage) ? 'HTTPS' : 'SMB',
            action: stageBlocked ? (stage === 'exfiltration' ? 'blocked-transfer' : 'restricted') : stage,
            units: Math.max(activity, exfiltrationAttempt), allowed: Math.max(0, activity + exfiltrationAttempt - stageBlocked),
            blocked: stageBlocked, latency: Math.round(30 + state.phase * 5 + random() * 7),
            severity: exfiltratedUnits ? 'critical' : (state.phase >= 4 ? 'high' : (state.phase >= 2 ? 'medium' : 'low')),
            marker: `APT_${stage.toUpperCase().replaceAll('-', '_')}`,
            explanation: `${stage.replaceAll('-', ' ')} generated ${activity} metadata-only actions; ${stageBlocked} were controlled; ${exfiltratedUnits} synthetic units crossed the boundary.`,
            scenarioState: { stage, completedStages: totals.completedStages.slice(), executableContent: false, realData: false }
        });
        commitNetworkTick(state, event, risk, {
            stageEvents: totals.stageEvents, assetsDiscovered: totals.assetsDiscovered,
            privilegeRestricted: totals.privilegeRestricted, lateralMoves: totals.lateralMoves,
            lateralBlocked: totals.lateralBlocked, collectedUnits: totals.collectedUnits,
            exfiltrationAttempted: totals.exfiltrationAttempted,
            exfiltrationBlocked: totals.exfiltrationBlocked, exfiltratedUnits: totals.exfiltratedUnits
        });
        ['workstation', 'files'].forEach(id => {
            const target = state.hosts.find(item => item.id === id);
            if (target) target.status = stageBlocked ? 'protected' : (state.phase >= 3 ? 'at-risk' : 'observing');
        });
    }

    function dosPhase(tick, recovery) {
        if (tick <= 4) return { index: 0, name: 'Normal baseline', intensity: 0 };
        if (tick <= 9) return { index: 1, name: 'Traffic ramp-up', intensity: (tick - 4) / 5 };
        if (tick <= 18 || !recovery) return { index: 2, name: 'Sustained attack', intensity: 1 };
        return { index: 3, name: 'Recovery', intensity: Math.max(0, (24 - tick) / 6) };
    }

    function recordDefense(state, id, amount, details = {}) {
        if (amount <= 0) return null;
        const definition = defenseDefinition(id);
        if (!definition) return null;
        const affected = Math.round(amount);
        if (!state.defenseStats[id]) {
            state.defenseStats[id] = {
                affected: 0, blocked: 0, triggered: 0, detected: 0,
                kind: definition.kind, layer: definition.layer, action: definition.action
            };
        }
        const stats = state.defenseStats[id];
        stats.affected += affected;
        stats.blocked += definition.kind === 'preventive' ? affected : 0;
        stats.detected += definition.kind === 'detective' ? affected : 0;
        stats.triggered += 1;
        const effect = {
            id, tick: state.tick, name: definition.name, kind: definition.kind,
            layer: definition.layer, order: definition.order,
            action: details.action || definition.action,
            visual: details.visual || definition.visual,
            affected,
            metricDeltas: details.metricDeltas || {},
            explanation: details.explanation || `${definition.name} ${definition.action} ${affected.toLocaleString()} synthetic units.`,
            tradeOff: definition.tradeOff
        };
        state.activeDefenseEffects.push(effect);
        state.defenseEffectLog.unshift(effect);
        state.defenseEffectLog = state.defenseEffectLog.slice(0, 120);
        return effect;
    }

    function stepDos(previous) {
        if (previous.status === 'complete') return previous;
        const state = JSON.parse(JSON.stringify(previous));
        const random = seededRandom(state.config.seed + state.tick * 997);
        const profile = DOS_PROFILES[state.config.difficulty] || DOS_PROFILES.Beginner;
        state.activeDefenseEffects = [];
        state.status = 'running';
        state.tick += 1;
        const phase = dosPhase(state.tick, state.config.recovery);
        state.phase = phase.index;

        const baseline = Math.round(profile.baseline * (0.94 + random() * 0.12));
        const peak = state.config.attackType === 'ddos' ? profile.peakDdos : profile.peakDos;
        const attackRequests = Math.round(peak * phase.intensity * (0.93 + random() * 0.14));
        const offered = baseline + attackRequests;
        const effectiveness = state.defenses.upstreamProtection ? upstreamEffectiveness(state.config) : 0;
        const upstreamFiltered = attackRequests * effectiveness;
        const residualAttack = Math.max(0, attackRequests - upstreamFiltered);
        if (upstreamFiltered > 0) recordDefense(state, 'upstreamProtection', upstreamFiltered, {
            metricDeltas: { upstreamFiltered: Math.round(upstreamFiltered), serverRps: -Math.round(upstreamFiltered) },
            explanation: `Upstream DDoS protection filtered ${Math.round(upstreamFiltered).toLocaleString()} fictional attack requests before the firewall.`
        });

        const pipeline = downstreamPipeline(state, profile, phase, residualAttack, baseline, true);
        const counterfactual = downstreamPipeline(state, profile, phase, attackRequests, baseline, false);
        const blocked = upstreamFiltered + pipeline.localBlocked;
        const jitter = random() * 8;
        const health = deriveServiceHealth(
            pipeline.serverRps,
            pipeline.capacity,
            (state.defenses.upstreamProtection ? 5 : 0) + (state.defenses.trafficFiltering ? 3 : 0),
            jitter
        );
        const unprotectedHealth = deriveServiceHealth(
            counterfactual.serverRps,
            counterfactual.capacity,
            state.defenses.trafficFiltering ? 3 : 0,
            jitter
        );
        const { latency, errors, availability } = health;
        const risk = Math.min(100, Math.round((100 - availability) * 0.72 + errors * 0.28));
        const activeSources = phase.index === 0 ? 0 : (state.config.attackType === 'ddos' ? profile.sources : 1);
        const totalBlocked = state.metrics.totalBlocked + Math.round(blocked);
        const totalUpstreamFiltered = state.metrics.totalUpstreamFiltered + Math.round(upstreamFiltered);

        state.metrics = {
            rps: offered, offered, allowed: Math.round(pipeline.allowed), blocked: Math.round(blocked),
            totalBlocked, latency, errors, availability, capacity: pipeline.capacity,
            attackSources: activeSources, risk, serverRps: Math.round(pipeline.serverRps),
            upstreamFiltered: Math.round(upstreamFiltered), totalUpstreamFiltered,
            residualAttack: Math.round(residualAttack), upstreamEffectiveness: effectiveness,
            unprotectedAvailability: unprotectedHealth.availability,
            unprotectedLatency: unprotectedHealth.latency,
            unprotectedErrors: unprotectedHealth.errors
        };
        if (availability < 90) state.downtimeTicks += 1;
        state.history.push({ tick: state.tick, phase: phase.name, ...state.metrics });
        state.history = state.history.slice(-32);

        const events = buildDosEvents(state, phase, baseline, attackRequests, pipeline, upstreamFiltered, latency);
        state.events = [...events.reverse(), ...state.events].slice(0, 100);
        state.flows = events.slice().reverse();
        updateDosAlerts(state, phase);
        updateDosHostStatus(state, phase, availability);

        if (state.tick >= 24) {
            state.status = 'complete';
            state.findings = buildReport(state);
        }
        return state;
    }

    function downstreamPipeline(state, profile, phase, attackInput, baseline, recordStats) {
        let attackRemaining = attackInput;
        let legitimateRemaining = baseline;
        let localBlocked = 0;
        if (state.defenses.trafficFiltering && attackRemaining > 0) {
            const attackBlock = attackRemaining * 0.28;
            const legitimateBlock = legitimateRemaining * 0.012;
            attackRemaining -= attackBlock;
            legitimateRemaining -= legitimateBlock;
            localBlocked += attackBlock + legitimateBlock;
            if (recordStats) recordDefense(state, 'trafficFiltering', attackBlock + legitimateBlock, {
                metricDeltas: { blocked: Math.round(attackBlock + legitimateBlock) },
                explanation: `Traffic filtering removed ${Math.round(attackBlock).toLocaleString()} attack-pattern requests and ${Math.round(legitimateBlock).toLocaleString()} baseline requests.`
            });
        }
        let allowed = attackRemaining + legitimateRemaining;
        if (state.defenses.rateLimiting && phase.index > 0) {
            const amount = Math.max(0, allowed - profile.capacity * 0.78);
            const attackShare = attackRemaining / Math.max(1, allowed);
            attackRemaining = Math.max(0, attackRemaining - amount * attackShare);
            legitimateRemaining = Math.max(0, legitimateRemaining - amount * (1 - attackShare));
            allowed -= amount;
            localBlocked += amount;
            if (recordStats) recordDefense(state, 'rateLimiting', amount, {
                metricDeltas: { blocked: Math.round(amount), allowed: -Math.round(amount) },
                explanation: `Rate limiting rejected ${Math.round(amount).toLocaleString()} requests above the fictional safe threshold.`
            });
        }
        const cacheRatio = state.defenses.caching ? 0.34 : 0;
        const cacheOffload = allowed * cacheRatio;
        if (recordStats && cacheOffload > 0) recordDefense(state, 'caching', cacheOffload, {
            metricDeltas: { serverRps: -Math.round(cacheOffload) },
            explanation: `Caching served ${Math.round(cacheOffload).toLocaleString()} requests without using web-server capacity.`
        });
        let capacity = profile.capacity;
        if (state.defenses.autoscaling && state.tick >= 12) {
            capacity = Math.round(capacity * 1.65);
            if (recordStats) recordDefense(state, 'autoscaling', Math.max(1, allowed - profile.capacity), {
                metricDeltas: { capacity: capacity - profile.capacity },
                explanation: `Autoscaling added ${(capacity - profile.capacity).toLocaleString()} requests per second of fictional service capacity.`
            });
        }
        return {
            allowed,
            localBlocked,
            capacity,
            cacheOffload,
            serverRps: allowed - cacheOffload,
            serverAttackRps: attackRemaining * (1 - cacheRatio)
        };
    }

    function deriveServiceHealth(serverRps, capacity, processingLatency, jitter) {
        const loadRatio = serverRps / capacity;
        const latency = Math.round(40 + processingLatency + Math.max(0, loadRatio - 0.55) * 330 + jitter);
        const errors = Math.min(96, Math.round(1 + Math.max(0, loadRatio - 0.7) * 58));
        const availability = Math.max(5, Math.round(100 - Math.max(0, loadRatio - 0.78) * 46 - errors * 0.12));
        return { latency, errors, availability };
    }

    function defenseEffectEvent(state, effect, source, destination, protocol = 'HTTPS', latency = state.metrics.latency || 0) {
        const prevented = effect.kind === 'preventive' ? effect.affected : 0;
        return {
            id: `defense-${state.tick}-${effect.id}`, tick: state.tick,
            time: `${String(Math.floor(state.tick / 60)).padStart(2, '0')}:${String(state.tick % 60).padStart(2, '0')}`,
            source, destination, protocol, action: effect.action,
            requests: effect.affected,
            allowedRequests: effect.kind === 'detective' || effect.kind === 'resilience' ? effect.affected : 0,
            blockedRequests: prevented,
            bytes: 0, latency,
            severity: effect.kind === 'detective' ? 'medium' : 'low',
            marker: 'DEFENSE_TRIGGERED', defenseId: effect.id,
            defenseKind: effect.kind, defenseLayer: effect.layer,
            visualEffect: effect.visual, metricDeltas: effect.metricDeltas,
            explanation: effect.explanation
        };
    }

    function buildDosEvents(state, phase, baseline, attackRequests, pipeline, upstreamFiltered, latency) {
        const events = [];
        const normalSource = host('internet');
        const upstreamEnabled = state.defenses.upstreamProtection;
        const firstHop = upstreamEnabled ? host('upstream') : host('edge');
        events.push(dosEvent(state, phase, normalSource, firstHop, baseline, baseline, 0, latency, 'NORMAL_TRAFFIC_AGGREGATE', 'forwarded'));
        if (attackRequests > 0) {
            const sourceIds = state.config.attackType === 'ddos'
                ? ['actor', 'actor2', 'actor3', 'actor4', 'actor5'].slice(0, state.metrics.attackSources)
                : ['actor'];
            const perSource = Math.round(attackRequests / sourceIds.length);
            sourceIds.forEach((id, index) => {
                const share = index === sourceIds.length - 1 ? attackRequests - perSource * index : perSource;
                const blockedShare = Math.round(upstreamFiltered * (share / Math.max(1, attackRequests)));
                const allowedShare = Math.max(0, share - blockedShare);
                events.push(dosEvent(state, phase, host(id), firstHop, share, allowedShare, blockedShare, latency, state.scenario.marker, upstreamEnabled ? 'scrubbed' : 'forwarded'));
            });
        }
        events.push(dosEvent(
            state, phase, host('edge'), host('loadbalancer'), pipeline.allowed, pipeline.allowed,
            0, latency, 'EDGE_ACCEPTED_TRAFFIC', 'forwarded'
        ));
        events.push(dosEvent(
            state, phase, host('loadbalancer'), host('web'), pipeline.serverRps, pipeline.serverRps,
            0, latency, 'SERVER_BOUND_TRAFFIC', 'forwarded'
        ));
        state.activeDefenseEffects.forEach(effect => {
            const [source, destination] = dosDefenseEndpoints(effect);
            events.push(defenseEffectEvent(state, effect, source, destination));
        });
        return events;
    }

    function dosDefenseEndpoints(effect) {
        if (effect.layer === 'upstream') return [host('upstream'), host('edge')];
        if (effect.layer === 'firewall') return [host('edge'), host('loadbalancer')];
        if (effect.layer === 'load-balancer') return [host('loadbalancer'), host('web')];
        if (effect.layer === 'service') return [host('soc'), host('web')];
        return [host('soc'), host('edge')];
    }

    function dosEvent(state, phase, source, destination, requests, allowed, blocked, latency, marker, action, defenseId) {
        const severity = phase.index === 0 ? 'info' : (state.metrics.availability < 70 ? 'critical' : state.metrics.availability < 92 ? 'high' : 'medium');
        return {
            id: `evt-${state.tick}-${source.id}`, tick: state.tick,
            time: `${String(Math.floor(state.tick / 60)).padStart(2, '0')}:${String(state.tick % 60).padStart(2, '0')}`,
            source, destination, protocol: 'HTTPS', action,
            requests: Math.round(requests), allowedRequests: Math.round(allowed), blockedRequests: Math.round(blocked),
            bytes: Math.round(requests * 620), latency, severity, marker, phase: phase.name,
            ...(defenseId ? { defenseId } : {}),
            explanation: marker === 'DEFENSE_TRIGGERED'
                ? `Upstream DDoS protection filtered ${Math.round(blocked).toLocaleString()} fictional attack requests before the edge gateway; ${Math.round(allowed).toLocaleString()} residual requests continued downstream.`
                : `${Math.round(requests).toLocaleString()} fictional requests were aggregated for this virtual tick; ${Math.round(blocked).toLocaleString()} were filtered. No network traffic was sent.`
        };
    }

    function updateDosAlerts(state, phase) {
        const latest = state.events[0];
        const candidates = [];
        if (state.tick === 5) candidates.push(['Traffic baseline exceeded', 'Synthetic request volume moved outside the normal baseline.', 'medium']);
        if (state.metrics.availability < 90 && !state.alerts.some(item => item.code === 'availability')) {
            candidates.push(['Service availability degraded', 'The fictional service is still running, but latency and errors make successful use unreliable.', 'high', 'availability']);
        }
        Object.keys(state.defenseStats).forEach(id => {
            const code = `defense-${id}`;
            if (!state.alerts.some(item => item.code === code)) {
                candidates.push([`${DEFENSES[id][0]} triggered`, `${DEFENSES[id][0]} changed the synthetic traffic outcome.`, 'low', code]);
            }
        });
        candidates.forEach(([title, explanation, severity, code]) => {
            state.alerts.unshift({
                ...latest, id: `alert-${state.tick}-${code || 'volume'}`, code: code || 'volume',
                title, explanation, severity
            });
        });
        state.alerts = state.alerts.slice(0, 30);
    }

    function updateDosHostStatus(state, phase, availability) {
        state.hosts.forEach(item => {
            if (item.id.startsWith('actor')) item.status = phase.index === 0 ? 'healthy' : 'observing';
            else if (item.id === 'upstream') item.status = state.defenses.upstreamProtection && state.metrics.upstreamFiltered > 0 ? 'protected' : 'healthy';
            else if (item.id === 'edge') item.status = state.metrics.blocked > 0 ? 'protected' : (phase.index === 0 ? 'healthy' : 'observing');
            else if (item.id === 'loadbalancer') item.status = availability < 90 ? 'observing' : 'healthy';
            else if (item.id === 'web') item.status = availability < 70 ? 'at-risk' : (availability < 96 ? 'observing' : 'healthy');
            else item.status = 'healthy';
        });
    }

    function protocolFor(id, tick) {
        if (id === 'phishing') return 'SMTP';
        if (id === 'password') return 'AUTH';
        if (id === 'malware' || id === 'apt' || id === 'insider') return tick % 3 ? 'SMB' : 'HTTPS';
        if (id === 'eavesdropping' || id === 'mitm') return tick % 2 ? 'HTTPS' : 'DNS';
        return tick % 4 ? 'HTTPS' : 'DNS';
    }

    function host(id) {
        return HOSTS.find(item => item.id === id) || HOSTS[0];
    }

    function defenseReportEntries(state) {
        return Object.keys(state.defenseStats)
            .filter(id => state.defenseStats[id].triggered > 0)
            .sort((left, right) => DEFENSE_META[left].order - DEFENSE_META[right].order)
            .map(id => {
                const definition = defenseDefinition(id);
                const stats = state.defenseStats[id];
                return {
                    id, name: definition.name, kind: definition.kind, layer: definition.layer,
                    action: definition.action, order: definition.order,
                    affectedUnits: stats.affected, blockedUnits: stats.blocked,
                    detectedUnits: stats.detected, triggerCount: stats.triggered,
                    tradeOff: definition.tradeOff
                };
            });
    }

    function scenarioGuidance(scenarioId) {
        return SPECIALIZED_SCENARIO_PROFILES[scenarioId]?.guidance || null;
    }

    function buildReport(state) {
        if (state.scenario.id === 'dos') return buildDosReport(state);
        const defenseResults = defenseReportEntries(state);
        const helped = defenseResults.map(result => result.name);
        const missed = state.scenario.defenses.filter(id => !state.defenses[id]).map(id => DEFENSES[id][0]);
        const maxRisk = Math.max(...state.history.map(item => item.risk), 0);
        const riskReduction = defenseResults.reduce((sum, result) =>
            sum + (result.kind === 'preventive' ? 18 : result.kind === 'resilience' ? 12 : 5), 0);
        const report = {
            synthetic: true, generatedAtVirtualTime: state.tick, scenario: state.scenario.title,
            seed: state.config.seed, difficulty: state.config.difficulty,
            objective: state.scenario.objective, indicators: state.scenario.indicators,
            affectedAssets: state.scenario.path.map(id => host(id).name),
            controlsHelped: helped, controlsNotEnabled: missed, blockedEvents: state.metrics.totalBlocked || 0,
            detections: state.metrics.detections || 0,
            defensesTriggered: defenseResults,
            defenseEffectLog: state.defenseEffectLog.slice().reverse(),
            peakRisk: maxRisk, residualRisk: Math.max(4, maxRisk - riskReduction),
            recommendation: state.scenario.remediation,
            events: state.events.slice().reverse()
        };
        if (SPECIALIZED_SCENARIO_PROFILES[state.scenario.id]) {
            report.specializedScenario = true;
            report.networkScenario = ['mitm', 'password', 'eavesdropping'].includes(state.scenario.id);
            report.scenarioState = { ...state.scenarioState };
            report.outcomeMetrics = networkOutcomeMetrics(state);
            report.observableEvidence = state.events
                .filter(event => event.marker !== 'DEFENSE_TRIGGERED')
                .slice(0, 8)
                .map(event => ({ tick: event.tick, marker: event.marker, action: event.action, explanation: event.explanation }));
        }
        return report;
    }

    function networkOutcomeMetrics(state) {
        if (state.scenario.id === 'mitm') return {
            routeIntegrity: state.scenarioState.routeIntegrity,
            certificateStatus: state.scenarioState.certificateStatus,
            alteredSessions: state.scenarioState.alteredSessions,
            protectedSessions: state.scenarioState.protectedSessions,
            certificateWarnings: state.scenarioState.certificateWarnings,
            reauthChallenges: state.scenarioState.reauthChallenges
        };
        if (state.scenario.id === 'password') return {
            pattern: state.scenarioState.pattern,
            authenticationAttempts: state.scenarioState.attempts,
            failedAttempts: state.scenarioState.failedAttempts,
            lockedAccounts: state.scenarioState.lockedAccounts,
            preventedTakeovers: state.scenarioState.preventedTakeovers,
            successfulTakeovers: state.scenarioState.successfulTakeovers,
            distinctSources: state.scenarioState.distinctSources
        };
        if (state.scenario.id === 'eavesdropping') return {
            contentVisibility: state.scenarioState.contentVisibility,
            observedPackets: state.scenarioState.observedPackets,
            encryptedPackets: state.scenarioState.encryptedPackets,
            exposedPackets: state.scenarioState.exposedPackets,
            isolatedFlows: state.scenarioState.isolatedFlows,
            metadataObserved: state.scenarioState.metadataObserved
        };
        if (state.scenario.id === 'sqli') return {
            requestHandling: state.scenarioState.requestHandling,
            markedRequests: state.scenarioState.markedRequests,
            rejectedRequests: state.scenarioState.rejectedRequests,
            databaseQueries: state.scenarioState.databaseQueries,
            databaseErrors: state.scenarioState.databaseErrors,
            recordsAtRisk: state.scenarioState.recordsAtRisk,
            protectedRecords: state.scenarioState.protectedRecords
        };
        if (state.scenario.id === 'xss') return {
            browserPolicy: state.scenarioState.browserPolicy,
            contentSubmissions: state.scenarioState.contentSubmissions,
            rejectedContent: state.scenarioState.rejectedContent,
            unsafeRenders: state.scenarioState.unsafeRenders,
            protectedRenders: state.scenarioState.protectedRenders,
            sessionsAtRisk: state.scenarioState.sessionsAtRisk
        };
        if (state.scenario.id === 'phishing') return {
            variant: state.scenarioState.variant,
            mockMessages: state.scenarioState.mockMessages,
            filteredMessages: state.scenarioState.filteredMessages,
            deliveredMessages: state.scenarioState.deliveredMessages,
            interactions: state.scenarioState.interactions,
            protectedIdentities: state.scenarioState.protectedIdentities,
            compromisedIdentities: state.scenarioState.compromisedIdentities,
            containedEndpoints: state.scenarioState.containedEndpoints,
            endpointRisk: state.scenarioState.endpointRisk
        };
        if (state.scenario.id === 'malware') return {
            endpointHealth: state.scenarioState.endpointHealth,
            endpointEvents: state.scenarioState.endpointEvents,
            infectedEndpoints: state.scenarioState.infectedEndpoints,
            containedEvents: state.scenarioState.containedEvents,
            preventedInfections: state.scenarioState.preventedInfections,
            spreadAttempts: state.scenarioState.spreadAttempts,
            isolatedSpread: state.scenarioState.isolatedSpread,
            successfulSpread: state.scenarioState.successfulSpread
        };
        if (state.scenario.id === 'insider') return {
            variant: state.scenarioState.variant,
            accessEvents: state.scenarioState.accessEvents,
            baselineDeviations: state.scenarioState.baselineDeviations,
            restrictedEvents: state.scenarioState.restrictedEvents,
            transferUnits: state.scenarioState.transferUnits,
            blockedTransfers: state.scenarioState.blockedTransfers,
            transferRisk: state.scenarioState.transferRisk,
            anomalyDetections: state.scenarioState.anomalyDetections
        };
        if (state.scenario.id === 'zeroday') return {
            signatureStatus: state.scenarioState.signatureStatus,
            behaviorEvents: state.scenarioState.behaviorEvents,
            signatureMisses: state.scenarioState.signatureMisses,
            anomalyDetections: state.scenarioState.anomalyDetections,
            isolatedActions: state.scenarioState.isolatedActions,
            privilegeContained: state.scenarioState.privilegeContained,
            impactActions: state.scenarioState.impactActions
        };
        return {
            currentStage: state.scenarioState.currentStage,
            completedStages: state.scenarioState.completedStages,
            stageEvents: state.scenarioState.stageEvents,
            assetsDiscovered: state.scenarioState.assetsDiscovered,
            privilegeRestricted: state.scenarioState.privilegeRestricted,
            lateralMoves: state.scenarioState.lateralMoves,
            lateralBlocked: state.scenarioState.lateralBlocked,
            collectedUnits: state.scenarioState.collectedUnits,
            exfiltrationAttempted: state.scenarioState.exfiltrationAttempted,
            exfiltrationBlocked: state.scenarioState.exfiltrationBlocked,
            exfiltratedUnits: state.scenarioState.exfiltratedUnits
        };
    }

    function buildDosReport(state) {
        const defenseResults = defenseReportEntries(state);
        const triggeredIds = defenseResults.map(result => result.id);
        const missedIds = state.scenario.defenses.filter(id => !state.defenses[id]);
        const peakRisk = Math.max(...state.history.map(item => item.risk), 0);
        const peakRps = Math.max(...state.history.map(item => item.rps), 0);
        const peakServerRps = Math.max(...state.history.map(item => item.serverRps || item.allowed), 0);
        const peakResidualAttack = Math.max(...state.history.map(item => item.residualAttack || 0), 0);
        const maximumLatency = Math.max(...state.history.map(item => item.latency), 0);
        const maximumErrorRate = Math.max(...state.history.map(item => item.errors), 0);
        const minimumAvailability = Math.min(...state.history.map(item => item.availability), 100);
        const counterfactualMinimumAvailability = Math.min(...state.history.map(item => item.unprotectedAvailability ?? item.availability), 100);
        const counterfactualMaximumLatency = Math.max(...state.history.map(item => item.unprotectedLatency ?? item.latency), 0);
        const availabilityImprovement = Math.max(0, minimumAvailability - counterfactualMinimumAvailability);
        const latencyImprovement = Math.max(0, counterfactualMaximumLatency - maximumLatency);
        const effectivenessValues = state.history.map(item => item.upstreamEffectiveness || 0).filter(Boolean);
        const effectiveness = effectivenessValues.length ? effectivenessValues[0] : 0;
        const residualRisk = Math.min(100, Math.max(3, Math.round(
            (100 - minimumAvailability) * 0.55 +
            maximumErrorRate * 0.3 +
            (missedIds.length / state.scenario.defenses.length) * 22
        )));
        return {
            synthetic: true,
            generatedAtVirtualTime: state.tick,
            scenario: state.scenario.title,
            attackType: state.config.attackType.toUpperCase(),
            seed: state.config.seed,
            difficulty: state.config.difficulty,
            recoveryEnabled: state.config.recovery,
            objective: state.scenario.objective,
            indicators: state.scenario.indicators,
            affectedAssets: ['Upstream Filter', 'Firewall / Rate Limiter', 'Load Balancer', 'Web Service'],
            peakRps,
            peakServerRps,
            peakResidualAttack,
            maximumLatency,
            maximumErrorRate,
            minimumAvailability,
            serviceDowntimeTicks: state.downtimeTicks,
            serviceDowntimeSeconds: state.downtimeTicks * 5,
            trafficBlocked: state.metrics.totalBlocked,
            upstreamTrafficFiltered: state.metrics.totalUpstreamFiltered,
            upstreamEffectivenessPercent: Math.round(effectiveness * 1000) / 10,
            availabilityImprovement,
            latencyImprovement,
            blockedEvents: state.metrics.totalBlocked,
            defensesTriggered: defenseResults.map(result => ({
                ...result,
                affectedRequests: result.affectedUnits,
                ...(result.id === 'upstreamProtection' ? {
                    trafficFiltered: state.metrics.totalUpstreamFiltered,
                    effectivenessPercent: Math.round(effectiveness * 1000) / 10,
                    availabilityImprovement
                } : {})
            })),
            defenseEffectLog: state.defenseEffectLog.slice().reverse(),
            controlsHelped: triggeredIds.map(id => DEFENSES[id][0]),
            controlsNotEnabled: missedIds.map(id => DEFENSES[id][0]),
            missedDetections: missedIds.map(id => `${DEFENSES[id][0]} was not enabled, leaving part of the synthetic request surge untreated.`),
            peakRisk,
            residualRisk,
            recommendation: missedIds.length
                ? `Add ${missedIds.map(id => DEFENSES[id][0]).join(', ')} and retain layered capacity, filtering, and rate controls.`
                : 'Keep the layered controls, tune thresholds using normal traffic baselines, and rehearse capacity and upstream-provider response.',
            events: state.events.slice().reverse()
        };
    }

    function filterEvents(events, filters, currentTick) {
        const values = filters || {};
        const protocol = values.protocol || '';
        const severity = values.severity || '';
        const source = String(values.source || '').trim().toLowerCase();
        const destination = String(values.destination || '').trim().toLowerCase();
        const windowSize = Number(values.timeWindow) || 0;
        const now = Number(currentTick) || 0;
        return events.filter(event =>
            (!protocol || event.protocol === protocol) &&
            (!severity || event.severity === severity) &&
            (!source || `${event.source.name} ${event.source.ip}`.toLowerCase().includes(source)) &&
            (!destination || `${event.destination.name} ${event.destination.ip}`.toLowerCase().includes(destination)) &&
            (!windowSize || event.tick > now - windowSize)
        );
    }

    function serializeReportJson(report) {
        return JSON.stringify(report, null, 2);
    }

    function csvCell(value) {
        const normalized = value === undefined || value === null
            ? ''
            : (typeof value === 'object' ? JSON.stringify(value) : String(value));
        return `"${normalized.replaceAll('"', '""')}"`;
    }

    function serializeReportCsv(report) {
        const columns = ['record_type', 'key', 'value', 'time', 'source', 'destination', 'protocol', 'requests', 'allowed', 'blocked', 'severity', 'marker'];
        const summaryRows = Object.entries(report)
            .filter(([key]) => key !== 'events')
            .map(([key, value]) => ['summary', key, value, '', '', '', '', '', '', '', '', '']);
        const eventRows = (report.events || []).map(event => [
            'event', '', '', event.time, event.source.ip, event.destination.ip, event.protocol,
            event.requests || 1, event.allowedRequests ?? (event.action === 'blocked' ? 0 : 1),
            event.blockedRequests ?? (event.action === 'blocked' ? 1 : 0), event.severity, event.marker
        ]);
        return [columns, ...summaryRows, ...eventRows].map(row => row.map(csvCell).join(',')).join('\n');
    }

    function compareReports(previous, current) {
        if (!previous || !current) return { comparable: false, reason: 'A completed previous run is required.', deltas: {} };
        const identityKeys = ['scenario', 'seed', 'difficulty'];
        if (current.attackType !== undefined || previous.attackType !== undefined) identityKeys.push('attackType');
        const mismatch = identityKeys.find(key => previous[key] !== current[key]);
        if (mismatch) return { comparable: false, reason: `Run ${mismatch} does not match.`, deltas: {} };
        const metrics = ['peakRisk', 'residualRisk', 'peakRps', 'peakServerRps', 'maximumLatency', 'maximumErrorRate', 'minimumAvailability', 'serviceDowntimeSeconds', 'trafficBlocked'];
        const deltas = {};
        metrics.forEach(key => {
            if (Number.isFinite(previous[key]) && Number.isFinite(current[key])) {
                deltas[key] = current[key] - previous[key];
            }
        });
        return { comparable: true, reason: '', deltas };
    }

    function shouldAnnounceCheckpoint(state) {
        if (!state || state.config.mode !== 'guided') return false;
        const checkpoints = state.scenario.id === 'dos'
            ? [4, 8, 11, 15, 19]
            : state.scenario.id === 'apt'
                ? [4, 8, 12, 16, 20, 24]
                : [4, 8, 12, 16];
        return checkpoints.includes(state.tick);
    }

    function reducer(state, action) {
        switch (action.type) {
        case 'START':
            return state.status === 'complete' ? state : { ...state, status: 'running' };
        case 'TICK':
            return step(state);
        case 'STEP': {
            const next = step(state);
            return next.status === 'complete' ? next : { ...next, status: 'paused' };
        }
        case 'PAUSE': return { ...state, status: state.status === 'running' ? 'paused' : state.status };
        case 'RESUME': return { ...state, status: state.status === 'paused' ? 'running' : state.status };
        case 'DEFENSE':
            if (!DEFENSES[action.id]) return state;
            return {
                ...state,
                defenses: { ...state.defenses, [action.id]: Boolean(action.enabled) },
                activeDefenseEffects: action.enabled
                    ? state.activeDefenseEffects
                    : state.activeDefenseEffects.filter(effect => effect.id !== action.id)
            };
        case 'RESET': return initialState({ ...state.config, defenses: state.defenses });
        default: return state;
        }
    }

    return {
        SCENARIOS, DEFENSES, DEFENSE_META, HOSTS, PROTOCOLS, SEVERITIES, DOS_PROFILES, UPSTREAM_EFFECTIVENESS,
        seededRandom, upstreamEffectiveness, initialState, step, reducer, buildReport, dosPhase,
        filterEvents, serializeReportJson, serializeReportCsv, compareReports, shouldAnnounceCheckpoint,
        defenseDefinition, orderedDefenses, defenseReportEntries, scenarioGuidance, networkOutcomeMetrics,
        SPECIALIZED_SCENARIO_PROFILES
    };
}));
