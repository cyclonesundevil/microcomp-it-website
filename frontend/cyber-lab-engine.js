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
        phases: id === 'dos' ? ['Normal baseline', 'Traffic ramp-up', 'Sustained attack', 'Recovery'] : ['Baseline', 'Initial activity', 'Escalation', 'Detection & response', 'Outcome'],
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
                residualAttack: 0, upstreamEffectiveness: 0
            },
            defenseStats: {}, downtimeTicks: 0,
            findings: null
        };
    }

    function defenseScore(state) {
        return state.scenario.defenses.reduce((sum, id) => sum + (state.defenses[id] ? 1 : 0), 0);
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

    function dosPhase(tick, recovery) {
        if (tick <= 4) return { index: 0, name: 'Normal baseline', intensity: 0 };
        if (tick <= 9) return { index: 1, name: 'Traffic ramp-up', intensity: (tick - 4) / 5 };
        if (tick <= 18 || !recovery) return { index: 2, name: 'Sustained attack', intensity: 1 };
        return { index: 3, name: 'Recovery', intensity: Math.max(0, (24 - tick) / 6) };
    }

    function recordDefense(state, id, amount) {
        if (amount <= 0) return;
        if (!state.defenseStats[id]) state.defenseStats[id] = { blocked: 0, triggered: 0 };
        state.defenseStats[id].blocked += Math.round(amount);
        state.defenseStats[id].triggered += 1;
    }

    function stepDos(previous) {
        if (previous.status === 'complete') return previous;
        const state = JSON.parse(JSON.stringify(previous));
        const random = seededRandom(state.config.seed + state.tick * 997);
        const profile = DOS_PROFILES[state.config.difficulty] || DOS_PROFILES.Beginner;
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
        if (upstreamFiltered > 0) recordDefense(state, 'upstreamProtection', upstreamFiltered);

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

        const events = buildDosEvents(state, phase, baseline, attackRequests, pipeline, upstreamFiltered, residualAttack, latency);
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
            if (recordStats) recordDefense(state, 'trafficFiltering', attackBlock + legitimateBlock);
        }
        let allowed = attackRemaining + legitimateRemaining;
        if (state.defenses.rateLimiting && phase.index > 0) {
            const amount = Math.max(0, allowed - profile.capacity * 0.78);
            const attackShare = attackRemaining / Math.max(1, allowed);
            attackRemaining = Math.max(0, attackRemaining - amount * attackShare);
            legitimateRemaining = Math.max(0, legitimateRemaining - amount * (1 - attackShare));
            allowed -= amount;
            localBlocked += amount;
            if (recordStats) recordDefense(state, 'rateLimiting', amount);
        }
        let capacity = profile.capacity;
        if (state.defenses.autoscaling && state.tick >= 12) {
            capacity = Math.round(capacity * 1.65);
            if (recordStats) recordDefense(state, 'autoscaling', Math.max(1, allowed - profile.capacity));
        }
        const cacheRatio = state.defenses.caching ? 0.34 : 0;
        const cacheOffload = allowed * cacheRatio;
        if (recordStats && cacheOffload > 0) recordDefense(state, 'caching', cacheOffload);
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

    function buildDosEvents(state, phase, baseline, attackRequests, pipeline, upstreamFiltered, residualAttack, latency) {
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
            if (upstreamEnabled && upstreamFiltered > 0) {
                events.push(dosEvent(
                    state, phase, host('upstream'), host('edge'), attackRequests, residualAttack,
                    upstreamFiltered, latency, 'DEFENSE_TRIGGERED', 'filtered', 'upstreamProtection'
                ));
            }
        }
        events.push(dosEvent(
            state, phase, host('edge'), host('loadbalancer'), pipeline.allowed, pipeline.allowed,
            0, latency, 'EDGE_ACCEPTED_TRAFFIC', 'forwarded'
        ));
        events.push(dosEvent(
            state, phase, host('loadbalancer'), host('web'), pipeline.serverRps, pipeline.serverRps,
            0, latency, 'SERVER_BOUND_TRAFFIC', 'forwarded'
        ));
        return events;
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

    function buildReport(state) {
        if (state.scenario.id === 'dos') return buildDosReport(state);
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

    function buildDosReport(state) {
        const triggeredIds = Object.keys(state.defenseStats).filter(id => state.defenseStats[id].triggered > 0);
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
            defensesTriggered: triggeredIds.map(id => ({
                id,
                name: DEFENSES[id][0],
                affectedRequests: Math.round(state.defenseStats[id].blocked),
                tradeOff: DEFENSES[id][2],
                ...(id === 'upstreamProtection' ? {
                    trafficFiltered: state.metrics.totalUpstreamFiltered,
                    effectivenessPercent: Math.round(effectiveness * 1000) / 10,
                    availabilityImprovement
                } : {})
            })),
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
        const checkpoints = state.scenario.id === 'dos' ? [4, 8, 11, 15, 19] : [4, 8, 12, 16];
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
        case 'DEFENSE': return { ...state, defenses: { ...state.defenses, [action.id]: Boolean(action.enabled) } };
        case 'RESET': return initialState({ ...state.config, defenses: state.defenses });
        default: return state;
        }
    }

    return {
        SCENARIOS, DEFENSES, HOSTS, PROTOCOLS, SEVERITIES, DOS_PROFILES, UPSTREAM_EFFECTIVENESS,
        seededRandom, upstreamEffectiveness, initialState, step, reducer, buildReport, dosPhase,
        filterEvents, serializeReportJson, serializeReportCsv, compareReports, shouldAnnounceCheckpoint
    };
}));
