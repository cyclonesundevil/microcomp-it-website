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
        ['edge', 'Edge Gateway', '192.0.2.1', 'gateway'],
        ['web', 'Web Service', '192.0.2.20', 'server'],
        ['identity', 'Identity Provider', '192.0.2.30', 'identity'],
        ['email', 'Email Gateway', '192.0.2.40', 'email'],
        ['workstation', 'Employee Workstation', '192.0.2.50', 'endpoint'],
        ['database', 'Records Database', '192.0.2.60', 'database'],
        ['files', 'File Service', '192.0.2.70', 'server'],
        ['soc', 'Security Monitor', '192.0.2.80', 'monitor'],
        ['actor', 'Simulated Actor', '203.0.113.10', 'actor']
    ].map(([id, name, ip, type]) => ({ id, name, ip, type, status: 'healthy' }));

    const DEFENSES = {
        rateLimiting: ['Rate limiting', 'Restricts abnormal request volume.', 'May delay legitimate bursts.'],
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

    const SCENARIOS = [
        ['dos', 'DoS & DDoS', 'Availability', 'Overwhelm a public service with synthetic request volume.', ['rateLimiting', 'ids', 'anomalyDetection'], ['internet', 'edge', 'web'], 'REQUEST_SURGE'],
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
        duration: id === 'apt' ? '4 min' : '2–3 min',
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
        return {
            config: { scenarioId: scenario.id, difficulty: config.difficulty || 'Beginner', seed: Number(config.seed) || 4242, mode: config.mode || 'guided' },
            scenario, status: 'ready', tick: 0, phase: 0, defenses: enabled,
            hosts: HOSTS.map(host => ({ ...host })), flows: [], events: [], alerts: [],
            history: [], metrics: { rps: 18, latency: 42, errors: 1, availability: 100, blocked: 0, risk: 4 },
            findings: null
        };
    }

    function defenseScore(state) {
        return state.scenario.defenses.reduce((sum, id) => sum + (state.defenses[id] ? 1 : 0), 0);
    }

    function step(previous) {
        if (previous.status === 'complete') return previous;
        const state = JSON.parse(JSON.stringify(previous));
        const random = seededRandom(state.config.seed + state.tick * 997);
        state.status = 'running';
        state.tick += 1;
        state.phase = Math.min(4, Math.floor((state.tick - 1) / 4));
        const difficulty = { Beginner: 0.75, Intermediate: 1, Advanced: 1.3 }[state.config.difficulty] || 1;
        const defense = defenseScore(state);
        const mitigated = Math.min(0.72, defense * 0.22);
        const intensity = Math.max(0.18, (state.tick / 10) * difficulty * (1 - mitigated));
        const path = state.scenario.path;
        const src = path[(state.tick - 1) % (path.length - 1)];
        const dst = path[(state.tick) % path.length];
        const protocol = protocolFor(state.scenario.id, state.tick);
        const severityIndex = Math.min(4, Math.floor(intensity * 4 + random()));
        const blocked = defense > 0 && random() < mitigated;
        const event = {
            id: `evt-${state.tick}`, tick: state.tick, time: `${String(Math.floor(state.tick / 60)).padStart(2, '0')}:${String(state.tick % 60).padStart(2, '0')}`,
            source: host(src), destination: host(dst), protocol,
            action: blocked ? 'blocked' : 'observed', bytes: Math.round(180 + random() * 4200),
            latency: Math.round(35 + intensity * 310 + random() * 20),
            severity: blocked ? 'low' : SEVERITIES[severityIndex],
            marker: state.scenario.marker,
            explanation: blocked
                ? `${DEFENSES[state.scenario.defenses.find(id => state.defenses[id])][0]} reduced this simulated event.`
                : `${state.scenario.indicators} No executable content is present.`
        };
        state.events.unshift(event);
        state.events = state.events.slice(0, 80);
        state.flows.unshift(event);
        state.flows = state.flows.slice(0, 24);
        if (severityIndex >= 2 || blocked) {
            state.alerts.unshift({ ...event, id: `alert-${state.tick}`, title: blocked ? 'Defense action recorded' : `${state.scenario.title} indicator` });
            state.alerts = state.alerts.slice(0, 30);
        }
        state.metrics = {
            rps: Math.round(18 + intensity * (state.scenario.id === 'dos' ? 900 : 120)),
            latency: event.latency,
            errors: Math.min(96, Math.round(1 + intensity * 54)),
            availability: Math.max(12, Math.round(100 - intensity * 68)),
            blocked: state.metrics.blocked + (blocked ? 1 : 0),
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

    function buildReport(state) {
        const helped = state.scenario.defenses.filter(id => state.defenses[id]).map(id => DEFENSES[id][0]);
        const missed = state.scenario.defenses.filter(id => !state.defenses[id]).map(id => DEFENSES[id][0]);
        const maxRisk = Math.max(...state.history.map(item => item.risk), 0);
        return {
            synthetic: true, generatedAtVirtualTime: state.tick, scenario: state.scenario.title,
            seed: state.config.seed, difficulty: state.config.difficulty,
            objective: state.scenario.objective, indicators: state.scenario.indicators,
            affectedAssets: state.scenario.path.map(id => host(id).name),
            controlsHelped: helped, controlsNotEnabled: missed, blockedEvents: state.metrics.blocked,
            peakRisk: maxRisk, residualRisk: Math.max(4, maxRisk - helped.length * 18),
            recommendation: state.scenario.remediation,
            events: state.events.slice().reverse()
        };
    }

    function reducer(state, action) {
        switch (action.type) {
        case 'STEP': return step(state);
        case 'PAUSE': return { ...state, status: state.status === 'running' ? 'paused' : state.status };
        case 'RESUME': return { ...state, status: state.status === 'paused' ? 'running' : state.status };
        case 'DEFENSE': return { ...state, defenses: { ...state.defenses, [action.id]: Boolean(action.enabled) } };
        case 'RESET': return initialState({ ...state.config, defenses: state.defenses });
        default: return state;
        }
    }

    return { SCENARIOS, DEFENSES, HOSTS, PROTOCOLS, SEVERITIES, seededRandom, initialState, step, reducer, buildReport };
}));
