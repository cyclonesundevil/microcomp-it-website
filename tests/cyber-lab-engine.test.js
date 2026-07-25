'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const E = require('../frontend/cyber-lab-engine.js');

function run(config, ticks) {
    let state = E.initialState(config);
    const total = ticks ?? (state.scenario.id === 'dos' ? 24 : state.scenario.phases.length * 4);
    for (let i = 0; i < total; i += 1) state = E.step(state);
    return state;
}

test('provides all eleven safe scenario definitions', () => {
    assert.equal(E.SCENARIOS.length, 11);
    assert.equal(new Set(E.SCENARIOS.map(item => item.id)).size, 11);
});

test('same inputs and seed produce an identical run', () => {
    const config = { scenarioId: 'dos', attackType: 'ddos', difficulty: 'Intermediate', seed: 9182, defenses: { rateLimiting: true } };
    assert.deepEqual(run(config), run(config));
});

test('every generated host uses a documentation-only IPv4 range', () => {
    const allowed = /^(192\.0\.2|198\.51\.100|203\.0\.113)\./;
    E.HOSTS.forEach(host => assert.match(host.ip, allowed));
});

test('events contain safe labels and metadata rather than executable payloads', () => {
    E.SCENARIOS.forEach(scenario => {
        const state = run({ scenarioId: scenario.id, difficulty: 'Advanced', seed: 4 }, 5);
        assert.ok(state.events.length >= 5);
        state.events.forEach(event => {
            assert.ok(event.marker);
            assert.equal('payload' in event, false);
            assert.equal('url' in event, false);
        });
    });
});

test('relevant defenses reduce or preserve residual risk and record blocked events', () => {
    const plain = run({ scenarioId: 'dos', attackType: 'ddos', difficulty: 'Intermediate', seed: 42, defenses: {} });
    const defended = run({ scenarioId: 'dos', attackType: 'ddos', difficulty: 'Intermediate', seed: 42, defenses: {
        rateLimiting: true, trafficFiltering: true, caching: true, autoscaling: true, upstreamProtection: true
    } });
    assert.ok(defended.findings.residualRisk <= plain.findings.residualRisk);
    assert.ok(defended.findings.blockedEvents > 0);
    assert.ok(defended.findings.minimumAvailability > plain.findings.minimumAvailability);
});

test('reducer supports pause, resume, defense toggle, step, and reset', () => {
    let state = E.initialState({ scenarioId: 'password', seed: 12 });
    state = E.reducer(state, { type: 'STEP' });
    assert.equal(state.tick, 1);
    state = E.reducer(state, { type: 'PAUSE' });
    assert.equal(state.status, 'paused');
    state = E.reducer(state, { type: 'RESUME' });
    assert.equal(state.status, 'running');
    state = E.reducer(state, { type: 'DEFENSE', id: 'mfa', enabled: true });
    assert.equal(state.defenses.mfa, true);
    state = E.reducer(state, { type: 'RESET' });
    assert.equal(state.tick, 0);
    assert.equal(state.defenses.mfa, true);
});

test('DoS and DDoS use one and multiple fictional sources respectively', () => {
    const dos = run({ scenarioId: 'dos', attackType: 'dos', difficulty: 'Advanced', seed: 31 }, 12);
    const ddos = run({ scenarioId: 'dos', attackType: 'ddos', difficulty: 'Advanced', seed: 31 }, 12);
    const dosSources = new Set(dos.flows.filter(event => event.marker === 'AGGREGATED_REQUEST_SURGE').map(event => event.source.id));
    const ddosSources = new Set(ddos.flows.filter(event => event.marker === 'AGGREGATED_REQUEST_SURGE').map(event => event.source.id));
    assert.equal(dosSources.size, 1);
    assert.equal(ddosSources.size, 5);
    assert.ok(ddos.metrics.rps > dos.metrics.rps);
});

test('DoS reference run has baseline, ramp-up, sustained, and optional recovery phases', () => {
    let state = E.initialState({ scenarioId: 'dos', attackType: 'ddos', seed: 8, recovery: true });
    const seen = new Set();
    for (let i = 0; i < 24; i += 1) {
        state = E.step(state);
        seen.add(state.history.at(-1).phase);
    }
    assert.deepEqual([...seen], ['Normal baseline', 'Traffic ramp-up', 'Sustained attack', 'Recovery']);
    assert.equal(state.status, 'complete');
    const noRecovery = run({ scenarioId: 'dos', attackType: 'ddos', seed: 8, recovery: false });
    assert.equal(noRecovery.history.at(-1).phase, 'Sustained attack');
});

test('difficulty changes the deterministic traffic volume and source count', () => {
    const beginner = run({ scenarioId: 'dos', attackType: 'ddos', difficulty: 'Beginner', seed: 99 }, 12);
    const advanced = run({ scenarioId: 'dos', attackType: 'ddos', difficulty: 'Advanced', seed: 99 }, 12);
    assert.ok(advanced.metrics.rps > beginner.metrics.rps);
    assert.ok(advanced.metrics.attackSources > beginner.metrics.attackSources);
});

test('each reference defense visibly changes the synthetic outcome', () => {
    const baseConfig = { scenarioId: 'dos', attackType: 'ddos', difficulty: 'Intermediate', seed: 730 };
    const plain = run(baseConfig);
    ['rateLimiting', 'trafficFiltering', 'caching', 'autoscaling', 'upstreamProtection'].forEach(id => {
        const defended = run({ ...baseConfig, defenses: { [id]: true } });
        assert.ok(defended.findings.defensesTriggered.some(item => item.id === id), `${id} did not trigger`);
        const changed = defended.findings.maximumLatency !== plain.findings.maximumLatency ||
            defended.findings.minimumAvailability !== plain.findings.minimumAvailability ||
            defended.findings.trafficBlocked !== plain.findings.trafficBlocked;
        assert.ok(changed, `${id} did not change a reported metric`);
    });
});

test('pause, resume, and step mode preserve the virtual clock contract', () => {
    let state = E.initialState({ scenarioId: 'dos', seed: 71 });
    state = E.reducer(state, { type: 'STEP' });
    assert.equal(state.tick, 1);
    state = E.reducer(state, { type: 'PAUSE' });
    assert.equal(state.status, 'paused');
    const pausedTick = state.tick;
    state = E.reducer(state, { type: 'RESUME' });
    assert.equal(state.status, 'running');
    assert.equal(state.tick, pausedTick);
    state = E.reducer(state, { type: 'STEP' });
    assert.equal(state.tick, pausedTick + 1);
});

test('DoS report includes availability outcomes, triggered defenses, gaps, and safe aggregate events', () => {
    const state = run({
        scenarioId: 'dos', attackType: 'dos', difficulty: 'Beginner', seed: 200,
        defenses: { rateLimiting: true, caching: true }
    });
    const report = state.findings;
    ['peakRps', 'maximumLatency', 'maximumErrorRate', 'serviceDowntimeSeconds', 'trafficBlocked', 'defensesTriggered', 'missedDetections', 'residualRisk'].forEach(key => {
        assert.ok(key in report, `report missing ${key}`);
    });
    assert.equal(report.synthetic, true);
    assert.equal(report.attackType, 'DOS');
    assert.ok(report.events.every(event => ['forwarded', 'scrubbed', 'filtered', 'rate-limited', 'offloaded', 'scaled'].includes(event.action)));
});

test('upstream DDoS protection changes the same seeded traffic before downstream metrics', () => {
    const config = { scenarioId: 'dos', attackType: 'ddos', difficulty: 'Intermediate', seed: 4242 };
    const unprotected = run(config);
    const protectedRun = run({ ...config, defenses: { upstreamProtection: true } });
    assert.ok(protectedRun.findings.peakResidualAttack < unprotected.findings.peakResidualAttack);
    assert.ok(protectedRun.findings.peakServerRps < unprotected.findings.peakServerRps);
    assert.ok(protectedRun.findings.maximumLatency < unprotected.findings.maximumLatency);
    assert.ok(protectedRun.findings.maximumErrorRate < unprotected.findings.maximumErrorRate);
    assert.ok(protectedRun.findings.minimumAvailability > unprotected.findings.minimumAvailability);
    assert.ok(protectedRun.findings.upstreamTrafficFiltered > 0);
    assert.ok(protectedRun.events.some(event => event.marker === 'DEFENSE_TRIGGERED' && event.defenseId === 'upstreamProtection'));
    const result = protectedRun.findings.defensesTriggered.find(item => item.id === 'upstreamProtection');
    assert.ok(result);
    assert.equal(result.trafficFiltered, protectedRun.findings.upstreamTrafficFiltered);
    assert.ok(result.availabilityImprovement > 0);
});

test('upstream filtering effectiveness is deterministic and stays within difficulty ranges', () => {
    const expectedRanges = {
        Beginner: [0.95, 0.99],
        Intermediate: [0.85, 0.95],
        Advanced: [0.70, 0.90]
    };
    Object.entries(expectedRanges).forEach(([difficulty, [minimum, maximum]]) => {
        const config = { scenarioId: 'dos', attackType: 'ddos', difficulty, seed: 8181, defenses: { upstreamProtection: true } };
        const first = run(config);
        const replay = run(config);
        const effectiveness = first.history.find(item => item.upstreamEffectiveness > 0).upstreamEffectiveness;
        assert.ok(effectiveness >= minimum && effectiveness <= maximum, `${difficulty} effectiveness outside range`);
        assert.deepEqual(first, replay);
    });
});

test('disabling upstream protection restores the undefended pipeline', () => {
    const config = { scenarioId: 'dos', attackType: 'ddos', difficulty: 'Advanced', seed: 5150 };
    const undefended = run(config);
    const explicitlyDisabled = run({ ...config, defenses: { upstreamProtection: false } });
    assert.deepEqual(explicitlyDisabled, undefended);
    assert.equal(explicitlyDisabled.metrics.totalUpstreamFiltered, 0);
    assert.equal(explicitlyDisabled.events.some(event => event.marker === 'DEFENSE_TRIGGERED'), false);
});

test('shared lifecycle reducer owns start, tick, pause, resume, step, and reset transitions', () => {
    let state = E.initialState({ scenarioId: 'mitm', difficulty: 'Beginner', seed: 90, defenses: { encryption: true } });
    state = E.reducer(state, { type: 'START' });
    assert.equal(state.status, 'running');
    state = E.reducer(state, { type: 'TICK' });
    assert.equal(state.tick, 1);
    assert.equal(state.status, 'running');
    state = E.reducer(state, { type: 'PAUSE' });
    assert.equal(state.status, 'paused');
    const pausedTick = state.tick;
    state = E.reducer(state, { type: 'RESUME' });
    assert.equal(state.status, 'running');
    state = E.reducer(state, { type: 'STEP' });
    assert.equal(state.tick, pausedTick + 1);
    assert.equal(state.status, 'paused');
    state = E.reducer(state, { type: 'RESET' });
    assert.equal(state.status, 'ready');
    assert.equal(state.tick, 0);
    assert.deepEqual(state.events, []);
    assert.deepEqual(state.alerts, []);
    assert.deepEqual(state.flows, []);
    assert.deepEqual(state.history, []);
    assert.equal(state.findings, null);
    assert.equal(state.defenses.encryption, true);
});

test('reset and replay reproduce the same report without retaining runtime state', () => {
    const config = { scenarioId: 'dos', attackType: 'ddos', difficulty: 'Advanced', seed: 664, defenses: { upstreamProtection: true } };
    const first = run(config);
    let replay = E.reducer(first, { type: 'RESET' });
    assert.equal(replay.tick, 0);
    assert.equal(replay.metrics.totalBlocked, 0);
    for (let index = 0; index < 24; index += 1) replay = E.reducer(replay, { type: 'TICK' });
    assert.deepEqual(replay.findings, first.findings);
});

test('guided checkpoints announce only in guided mode', () => {
    const guided = E.initialState({ scenarioId: 'dos', mode: 'guided', seed: 1 });
    guided.tick = 4;
    const freePlay = E.initialState({ scenarioId: 'dos', mode: 'free-play', seed: 1 });
    freePlay.tick = 4;
    assert.equal(E.shouldAnnounceCheckpoint(guided), true);
    assert.equal(E.shouldAnnounceCheckpoint(freePlay), false);
    guided.tick = 5;
    assert.equal(E.shouldAnnounceCheckpoint(guided), false);
});

test('shared event filters use actual protocol, host, severity, and virtual time data', () => {
    const state = run({ scenarioId: 'dos', attackType: 'ddos', difficulty: 'Beginner', seed: 33 }, 12);
    const byProtocol = E.filterEvents(state.events, { protocol: 'HTTPS' }, state.tick);
    assert.ok(byProtocol.length > 0);
    assert.ok(byProtocol.every(event => event.protocol === 'HTTPS'));
    const bySource = E.filterEvents(state.events, { source: '203.0.113.10' }, state.tick);
    assert.ok(bySource.length > 0);
    assert.ok(bySource.every(event => event.source.ip === '203.0.113.10'));
    const byDestination = E.filterEvents(state.events, { destination: 'Web Service' }, state.tick);
    assert.ok(byDestination.every(event => event.destination.name === 'Web Service'));
    const severity = state.events.find(event => event.severity !== 'info').severity;
    assert.ok(E.filterEvents(state.events, { severity }, state.tick).every(event => event.severity === severity));
    assert.ok(E.filterEvents(state.events, { timeWindow: 5 }, state.tick).every(event => event.tick > state.tick - 5));
});

test('JSON and CSV serializers preserve synthetic report summary and event values', () => {
    const report = run({
        scenarioId: 'dos', attackType: 'ddos', difficulty: 'Intermediate', seed: 41,
        defenses: { upstreamProtection: true }
    }).findings;
    assert.deepEqual(JSON.parse(E.serializeReportJson(report)), report);
    const csv = E.serializeReportCsv(report);
    ['synthetic', 'residualRisk', 'peakServerRps', 'upstreamTrafficFiltered', 'event', 'DEFENSE_TRIGGERED'].forEach(value => {
        assert.ok(csv.includes(value), `CSV missing ${value}`);
    });
    assert.doesNotMatch(csv, /\[object Object\]/);
});

test('report comparison requires matching run identity and returns metric deltas', () => {
    const base = run({ scenarioId: 'dos', attackType: 'ddos', difficulty: 'Intermediate', seed: 51 });
    const defended = run({
        scenarioId: 'dos', attackType: 'ddos', difficulty: 'Intermediate', seed: 51,
        defenses: { upstreamProtection: true }
    });
    const comparison = E.compareReports(base.findings, defended.findings);
    assert.equal(comparison.comparable, true);
    assert.ok(comparison.deltas.peakServerRps < 0);
    assert.ok(comparison.deltas.minimumAvailability > 0);
    const mismatch = E.compareReports(base.findings, { ...defended.findings, seed: 52 });
    assert.equal(mismatch.comparable, false);
});

test('every visible defense has a typed shared definition and deterministic order', () => {
    assert.deepEqual(Object.keys(E.DEFENSE_META).sort(), Object.keys(E.DEFENSES).sort());
    Object.keys(E.DEFENSES).forEach(id => {
        const definition = E.defenseDefinition(id);
        assert.ok(definition);
        assert.ok(['preventive', 'detective', 'resilience'].includes(definition.kind));
        assert.ok(definition.layer);
        assert.ok(Number.isFinite(definition.order));
        assert.ok(definition.action);
        assert.ok(definition.visual);
    });
    const scenario = E.SCENARIOS.find(item => item.id === 'dos');
    const enabled = Object.fromEntries(scenario.defenses.map(id => [id, true]));
    const ordered = E.orderedDefenses(scenario, enabled);
    assert.deepEqual(ordered.map(item => item.id), ['upstreamProtection', 'trafficFiltering', 'rateLimiting', 'caching', 'autoscaling']);
});

test('all five DoS defenses emit standardized effects, events, visuals, and report entries', () => {
    const defenses = { upstreamProtection: true, trafficFiltering: true, rateLimiting: true, caching: true, autoscaling: true };
    const state = run({ scenarioId: 'dos', attackType: 'ddos', difficulty: 'Advanced', seed: 414, defenses });
    Object.keys(defenses).forEach(id => {
        const effect = state.defenseEffectLog.find(item => item.id === id);
        assert.ok(effect, `${id} missing effect`);
        assert.ok(effect.metricDeltas && Object.keys(effect.metricDeltas).length, `${id} missing metric deltas`);
        const event = state.events.find(item => item.marker === 'DEFENSE_TRIGGERED' && item.defenseId === id);
        assert.ok(event, `${id} missing standardized event`);
        assert.equal(event.defenseKind, E.DEFENSE_META[id].kind);
        assert.equal(event.defenseLayer, E.DEFENSE_META[id].layer);
        assert.equal(event.visualEffect, E.DEFENSE_META[id].visual);
        const reportEntry = state.findings.defensesTriggered.find(item => item.id === id);
        assert.ok(reportEntry, `${id} missing report entry`);
        assert.equal(reportEntry.kind, E.DEFENSE_META[id].kind);
        assert.ok(reportEntry.affectedUnits > 0);
    });
});

test('shared framework distinguishes detective controls from preventive blocking', () => {
    const idsRun = run({ scenarioId: 'mitm', difficulty: 'Intermediate', seed: 100, defenses: { ids: true } });
    assert.ok(idsRun.metrics.detections > 0);
    assert.equal(idsRun.metrics.totalBlocked, 0);
    assert.ok(idsRun.events.some(event => event.defenseId === 'ids' && event.action === 'detected' && event.blockedRequests === 0));
    const encryptionRun = run({ scenarioId: 'mitm', difficulty: 'Intermediate', seed: 100, defenses: { encryption: true } });
    assert.ok(encryptionRun.metrics.totalBlocked > 0);
    assert.ok(encryptionRun.events.some(event => event.defenseId === 'encryption' && event.blockedRequests > 0));
});

test('every defense can trigger through configuration and disappears when disabled', () => {
    Object.keys(E.DEFENSES).forEach(id => {
        const scenario = E.SCENARIOS.find(item => item.defenses.includes(id));
        assert.ok(scenario, `${id} is not assigned to a scenario`);
        const config = { scenarioId: scenario.id, difficulty: 'Intermediate', seed: 100 };
        const enabled = run({ ...config, defenses: { [id]: true } });
        assert.ok(enabled.defenseStats[id]?.triggered > 0, `${id} did not trigger`);
        assert.ok(enabled.findings.defensesTriggered.some(item => item.id === id), `${id} missing from report`);
        const disabled = run({ ...config, defenses: { [id]: false } });
        assert.equal(Boolean(disabled.defenseStats[id]), false, `${id} remained active when disabled`);
        assert.equal(disabled.events.some(event => event.defenseId === id), false, `${id} emitted an event while disabled`);
        assert.equal(disabled.findings.defensesTriggered.some(item => item.id === id), false, `${id} remained in report when disabled`);
    });
});

test('defense reducer rejects unknown controls and clears a disabled active visual effect', () => {
    let state = E.initialState({ scenarioId: 'dos', defenses: { caching: true }, seed: 9 });
    state = E.step(state);
    assert.ok(state.activeDefenseEffects.some(effect => effect.id === 'caching'));
    const unchanged = E.reducer(state, { type: 'DEFENSE', id: 'notAControl', enabled: true });
    assert.equal(unchanged, state);
    state = E.reducer(state, { type: 'DEFENSE', id: 'caching', enabled: false });
    assert.equal(state.defenses.caching, false);
    assert.equal(state.activeDefenseEffects.some(effect => effect.id === 'caching'), false);
});

test('MITM models route integrity, certificate state, and session protection', () => {
    const exposed = run({ scenarioId: 'mitm', difficulty: 'Intermediate', seed: 303 });
    const protectedRun = run({
        scenarioId: 'mitm', difficulty: 'Intermediate', seed: 303,
        defenses: { encryption: true, ids: true, mfa: true }
    });
    assert.equal(exposed.scenarioState.routeIntegrity, 'altered');
    assert.equal(exposed.scenarioState.certificateStatus, 'untrusted');
    assert.ok(exposed.scenarioState.alteredSessions > 0);
    assert.equal(protectedRun.scenarioState.routeIntegrity, 'protected');
    assert.equal(protectedRun.scenarioState.alteredSessions, 0);
    assert.ok(protectedRun.scenarioState.protectedSessions > 0);
    assert.ok(protectedRun.scenarioState.certificateWarnings > 0);
    assert.ok(protectedRun.scenarioState.reauthChallenges > 0);
    assert.ok(protectedRun.events.some(event => event.marker === 'ROUTE_CERTIFICATE_WARNING'));
    assert.deepEqual(run({
        scenarioId: 'mitm', difficulty: 'Intermediate', seed: 303,
        defenses: { encryption: true, ids: true, mfa: true }
    }), protectedRun);
});

test('password scenario derives authentication patterns, lockouts, and takeover outcomes', () => {
    const undefended = run({ scenarioId: 'password', difficulty: 'Advanced', seed: 404 });
    const defended = run({
        scenarioId: 'password', difficulty: 'Advanced', seed: 404,
        defenses: { rateLimiting: true, accountLockout: true, mfa: true }
    });
    assert.equal(defended.scenarioState.pattern, 'password-spray');
    assert.ok(defended.scenarioState.attempts > 0);
    assert.ok(defended.scenarioState.failedAttempts > 0);
    assert.ok(defended.scenarioState.distinctSources > 1);
    assert.ok(defended.scenarioState.lockedAccounts > 0);
    assert.ok(defended.scenarioState.preventedTakeovers > 0);
    assert.equal(defended.scenarioState.successfulTakeovers, 0);
    assert.ok(undefended.scenarioState.successfulTakeovers > defended.scenarioState.successfulTakeovers);
    assert.ok(defended.events.some(event => event.protocol === 'AUTH' && event.marker === 'AUTHENTICATION_PATTERN'));
    const attackSources = new Set(defended.events
        .filter(event => event.marker === 'AUTHENTICATION_PATTERN')
        .map(event => event.source.id));
    assert.ok(attackSources.has('actor2'));
    assert.ok([...attackSources].every(id => id === 'actor' || Number(id.replace('actor', '')) <= defended.scenarioState.distinctSources));
});

test('eavesdropping distinguishes encrypted content from observable metadata', () => {
    const exposed = run({ scenarioId: 'eavesdropping', difficulty: 'Intermediate', seed: 505 });
    const protectedRun = run({
        scenarioId: 'eavesdropping', difficulty: 'Intermediate', seed: 505,
        defenses: { encryption: true, segmentation: true, ids: true }
    });
    assert.ok(exposed.scenarioState.exposedPackets > 0);
    assert.equal(exposed.scenarioState.encryptedPackets, 0);
    assert.equal(protectedRun.scenarioState.exposedPackets, 0);
    assert.ok(protectedRun.scenarioState.encryptedPackets > 0);
    assert.ok(protectedRun.scenarioState.isolatedFlows > 0);
    assert.ok(protectedRun.scenarioState.metadataObserved > 0);
    assert.ok(protectedRun.metrics.detections > 0);
    assert.ok(protectedRun.events.some(event => event.marker === 'PLAINTEXT_EXPOSURE_RISK'));
});

test('network-centric reports include scenario outcomes and safe observable evidence', () => {
    [
        ['mitm', { encryption: true, ids: true, mfa: true }],
        ['password', { rateLimiting: true, accountLockout: true, mfa: true }],
        ['eavesdropping', { encryption: true, segmentation: true, ids: true }]
    ].forEach(([scenarioId, defenses]) => {
        const state = run({ scenarioId, difficulty: 'Intermediate', seed: 606, defenses });
        const report = state.findings;
        assert.equal(report.networkScenario, true);
        assert.ok(report.scenarioState);
        assert.ok(report.outcomeMetrics);
        assert.ok(report.observableEvidence.length > 0);
        assert.ok(report.defensesTriggered.length === 3);
        assert.ok(report.events.every(event => !('payload' in event) && !('url' in event)));
    });
});

test('network-centric scenarios provide five dedicated guided checkpoints', () => {
    ['mitm', 'password', 'eavesdropping'].forEach(id => {
        const guidance = E.scenarioGuidance(id);
        assert.equal(guidance.length, 5);
        assert.ok(guidance.every(item => item.length > 40));
    });
    assert.equal(E.scenarioGuidance('dos'), null);
});

test('SQL injection models safe request markers, database risk, and layered controls', () => {
    const undefended = run({ scenarioId: 'sqli', difficulty: 'Advanced', seed: 707 });
    const defended = run({
        scenarioId: 'sqli', difficulty: 'Advanced', seed: 707,
        defenses: { waf: true, leastPrivilege: true, ids: true }
    });
    assert.ok(undefended.scenarioState.recordsAtRisk > 0);
    assert.equal(undefended.scenarioState.rejectedRequests, 0);
    assert.ok(defended.scenarioState.rejectedRequests > 0);
    assert.ok(defended.scenarioState.protectedRecords > 0);
    assert.ok(defended.scenarioState.databaseQueries < undefended.scenarioState.databaseQueries);
    assert.ok(defended.scenarioState.recordsAtRisk < undefended.scenarioState.recordsAtRisk);
    assert.ok(defended.events.some(event => event.marker === 'SIMULATED_QUERY_MANIPULATION'));
    assert.ok(defended.events.every(event => !('query' in event) && !('payload' in event)));
});

test('XSS models inert content markers, render state, and session risk', () => {
    const undefended = run({ scenarioId: 'xss', difficulty: 'Intermediate', seed: 808 });
    const defended = run({
        scenarioId: 'xss', difficulty: 'Intermediate', seed: 808,
        defenses: { waf: true, patchManagement: true, ids: true }
    });
    assert.ok(undefended.scenarioState.unsafeRenders > 0);
    assert.ok(undefended.scenarioState.sessionsAtRisk > 0);
    assert.equal(defended.scenarioState.unsafeRenders, 0);
    assert.equal(defended.scenarioState.sessionsAtRisk, 0);
    assert.ok(defended.scenarioState.rejectedContent > 0);
    assert.ok(defended.scenarioState.protectedRenders > 0);
    assert.equal(defended.scenarioState.browserPolicy, 'hardened');
    assert.ok(defended.events.every(event => event.scenarioState?.executableContent !== true));
});

test('phishing models inert generic and targeted mock messages plus user outcomes', () => {
    const undefended = run({ scenarioId: 'phishing', difficulty: 'Advanced', seed: 909 });
    const defended = run({
        scenarioId: 'phishing', difficulty: 'Advanced', seed: 909,
        defenses: { emailFiltering: true, mfa: true, endpointProtection: true }
    });
    assert.equal(defended.scenarioState.variant, 'spear-phishing');
    assert.ok(defended.scenarioState.filteredMessages > 0);
    assert.ok(defended.scenarioState.protectedIdentities > 0);
    assert.ok(defended.scenarioState.containedEndpoints > 0);
    assert.equal(defended.scenarioState.compromisedIdentities, 0);
    assert.equal(defended.scenarioState.endpointRisk, 0);
    assert.ok(undefended.scenarioState.compromisedIdentities > 0);
    assert.ok(defended.scenarioState.inbox.some(message => message.variant === 'spear-phishing'));
    assert.ok(defended.scenarioState.inbox.every(message =>
        message.inert && message.sender.endsWith('.test') && !('url' in message) && !('attachment' in message)));
});

test('Phase 4 reports expose scenario outcomes without executable artifacts', () => {
    [
        ['sqli', { waf: true, leastPrivilege: true, ids: true }],
        ['xss', { waf: true, patchManagement: true, ids: true }],
        ['phishing', { emailFiltering: true, mfa: true, endpointProtection: true }]
    ].forEach(([scenarioId, defenses]) => {
        const state = run({ scenarioId, difficulty: 'Intermediate', seed: 1001, defenses });
        assert.equal(state.findings.specializedScenario, true);
        assert.equal(state.findings.networkScenario, false);
        assert.ok(state.findings.outcomeMetrics);
        assert.equal(state.findings.defensesTriggered.length, 3);
        assert.ok(E.scenarioGuidance(scenarioId).length === 5);
        const serialized = E.serializeReportJson(state.findings);
        assert.doesNotMatch(serialized, /<script|javascript:|https?:\/\/(?!fictional)/i);
    });
});

test('all four malware profiles are selected deterministically with two seeds each', () => {
    const expected = [
        [2000, 2004, 'ransomware-like'],
        [2001, 2005, 'worm-like'],
        [2002, 2006, 'credential-stealing'],
        [2003, 2007, 'botnet-like']
    ];
    expected.forEach(([firstSeed, secondSeed, profileId]) => {
        [firstSeed, secondSeed].forEach(seed => {
            const initial = E.initialState({ scenarioId: 'malware', seed });
            assert.equal(initial.scenarioState.profileId, profileId);
            assert.equal(E.malwareProfileForSeed(seed).id, profileId);
            assert.equal(E.initialState({ scenarioId: 'malware', seed }).scenarioState.profileId, profileId);
        });
    });
});

test('malware profiles use short understandable paths and do not always target file service first', () => {
    const profiles = E.MALWARE_PROFILES;
    assert.equal(profiles.length, 4);
    profiles.forEach(profile => {
        assert.ok(profile.path.length >= 3 && profile.path.length <= 5);
        assert.equal(new Set(profile.path).size, profile.path.length);
        assert.equal(profile.guidance.length, 4);
        assert.ok(profile.defenses.length >= 4);
    });
    assert.equal(profiles.filter(profile => profile.path[1] === 'files').length, 1);
    assert.ok(profiles.some(profile => !profile.path.includes('files')));
});

test('each malware profile remains bounded, deterministic, replayable, and safely described', () => {
    [2000, 2001, 2002, 2003].forEach(seed => {
        const first = run({ scenarioId: 'malware', difficulty: 'Advanced', seed });
        const replay = run({ scenarioId: 'malware', difficulty: 'Advanced', seed });
        assert.deepEqual(replay.findings, first.findings);
        assert.equal(first.tick, 24);
        assert.ok(first.scenarioState.affectedHosts.length <= first.scenarioState.targetedHosts.length);
        assert.ok(first.scenarioState.affectedHosts.every(id => first.scenarioState.targetedHosts.includes(id)));
        assert.equal(first.findings.malwareProfile, first.scenarioState.profileName);
        assert.equal(first.findings.initialInfectionPoint, E.HOSTS.find(host => host.id === first.scenarioState.initialHost).name);
        assert.deepEqual(first.findings.systemsTargeted, first.scenarioState.targetedHosts.map(id => E.HOSTS.find(host => host.id === id).name));
        assert.match(first.findings.outcomeExplanation, new RegExp(first.scenarioState.profileName, 'i'));
        assert.ok(first.events.every(event =>
            event.scenarioState?.executableContent !== true &&
            event.scenarioState?.realCredentials !== true &&
            !('payload' in event)));
    });
});

test('profile-relevant malware defenses measurably change outcomes without detective blocking claims', () => {
    const cases = [
        [2000, { endpointProtection: true, segmentation: true, leastPrivilege: true, patchManagement: true }],
        [2001, { patchManagement: true, endpointProtection: true, segmentation: true, ids: true, anomalyDetection: true }],
        [2002, { endpointProtection: true, mfa: true, leastPrivilege: true, anomalyDetection: true, accountLockout: true }],
        [2003, { endpointProtection: true, trafficFiltering: true, ids: true, anomalyDetection: true, segmentation: true }]
    ];
    cases.forEach(([seed, defenses]) => {
        const undefended = run({ scenarioId: 'malware', difficulty: 'Advanced', seed });
        const defended = run({ scenarioId: 'malware', difficulty: 'Advanced', seed, defenses });
        assert.ok(defended.scenarioState.successfulSpread < undefended.scenarioState.successfulSpread);
        assert.ok(defended.scenarioState.protectedHosts.length > 0);
        assert.equal(defended.scenarioState.successfulSpread, 0);
        assert.equal(defended.scenarioState.affectedServices, 0);
        assert.deepEqual(defended.scenarioState.affectedHosts, []);
        assert.equal(defended.scenarioState.originInternal, true);
        assert.equal(defended.scenarioState.initialInfectionOccurred, true);
        assert.match(defended.findings.outcomeExplanation, /originating inside/i);
        assert.match(defended.findings.outcomeExplanation, /downstream network spread was prevented/i);
        assert.ok(defended.events
            .filter(event => event.marker !== 'DEFENSE_TRIGGERED')
            .every(event => event.source.id !== 'internet'));
        assert.ok(defended.findings.defensesTriggered.length >= 3);
        defended.findings.defensesTriggered
            .filter(effect => effect.kind === 'detective')
            .forEach(effect => {
                assert.equal(effect.blockedUnits, 0);
                assert.equal(effect.action, 'detected');
            });
    });
});

test('malware reset reselects the same profile while clearing all runtime state', () => {
    const complete = run({
        scenarioId: 'malware', difficulty: 'Advanced', seed: 2002,
        defenses: { endpointProtection: true, mfa: true, leastPrivilege: true }
    });
    const reset = E.reducer(complete, { type: 'RESET' });
    assert.equal(reset.status, 'ready');
    assert.equal(reset.tick, 0);
    assert.equal(reset.scenarioState.profileId, complete.scenarioState.profileId);
    assert.deepEqual(reset.scenarioState.affectedHosts, []);
    assert.deepEqual(reset.scenarioState.protectedHosts, []);
    assert.deepEqual(reset.events, []);
    assert.deepEqual(reset.alerts, []);
    assert.equal(reset.findings, null);
});

test('insider scenario deterministically models three variants and behavioral controls', () => {
    const variants = [1200, 1201, 1202].map(seed =>
        run({ scenarioId: 'insider', difficulty: 'Intermediate', seed }).scenarioState.variant);
    assert.deepEqual(variants, ['negligent', 'compromised', 'malicious']);
    const undefended = run({ scenarioId: 'insider', difficulty: 'Advanced', seed: 1202 });
    const defended = run({
        scenarioId: 'insider', difficulty: 'Advanced', seed: 1202,
        defenses: { leastPrivilege: true, dlp: true, anomalyDetection: true }
    });
    assert.ok(undefended.scenarioState.baselineDeviations > 0);
    assert.ok(undefended.scenarioState.transferRisk > 0);
    assert.ok(defended.scenarioState.restrictedEvents > 0);
    assert.ok(defended.scenarioState.blockedTransfers > 0);
    assert.ok(defended.scenarioState.anomalyDetections > 0);
    assert.ok(defended.scenarioState.transferRisk < undefended.scenarioState.transferRisk);
    assert.equal(defended.scenarioState.baseline.allowedDestination, 'File Service');
});

test('zero-day scenario separates signature misses from behavioral detection and containment', () => {
    const undefended = run({ scenarioId: 'zeroday', difficulty: 'Advanced', seed: 1303 });
    const defended = run({
        scenarioId: 'zeroday', difficulty: 'Advanced', seed: 1303,
        defenses: { anomalyDetection: true, segmentation: true, leastPrivilege: true }
    });
    assert.ok(undefended.scenarioState.signatureMisses > 0);
    assert.equal(undefended.scenarioState.anomalyDetections, 0);
    assert.equal(defended.scenarioState.signatureStatus, 'unknown-no-match');
    assert.ok(defended.scenarioState.signatureMisses > 0);
    assert.ok(defended.scenarioState.anomalyDetections > 0);
    assert.ok(defended.scenarioState.isolatedActions > 0);
    assert.ok(defended.scenarioState.privilegeContained > 0);
    assert.ok(defended.scenarioState.impactActions < undefended.scenarioState.impactActions);
    assert.ok(defended.events.every(event => event.scenarioState?.exploitPayload !== true));
});

test('APT completes all seven stages and applies controls at their actual layers', () => {
    const undefended = run({ scenarioId: 'apt', difficulty: 'Advanced', seed: 1404 });
    const defended = run({
        scenarioId: 'apt', difficulty: 'Advanced', seed: 1404,
        defenses: { leastPrivilege: true, segmentation: true, dlp: true }
    });
    assert.equal(defended.tick, 28);
    assert.equal(defended.phase, 6);
    assert.deepEqual(defended.scenarioState.completedStages, [
        'initial-access', 'persistence', 'discovery', 'privilege-expansion',
        'lateral-movement', 'collection', 'exfiltration'
    ]);
    assert.ok(defended.scenarioState.assetsDiscovered > 0);
    assert.ok(defended.scenarioState.privilegeRestricted > 0);
    assert.ok(defended.scenarioState.lateralBlocked > 0);
    assert.ok(defended.scenarioState.collectedUnits > 0);
    assert.ok(defended.scenarioState.exfiltrationBlocked > 0);
    assert.ok(defended.scenarioState.exfiltratedUnits < undefended.scenarioState.exfiltratedUnits);
    assert.ok(defended.events.some(event => event.marker === 'APT_EXFILTRATION'));
});

test('Phase 5 reports and guidance cover all organizational scenario outcomes', () => {
    [
        ['malware', { endpointProtection: true, segmentation: true, patchManagement: true, ids: true, anomalyDetection: true }, 4, 5],
        ['insider', { leastPrivilege: true, dlp: true, anomalyDetection: true }, 5, 3],
        ['zeroday', { anomalyDetection: true, segmentation: true, leastPrivilege: true }, 5, 3],
        ['apt', { leastPrivilege: true, segmentation: true, dlp: true }, 7, 3]
    ].forEach(([scenarioId, defenses, guidanceLength, triggeredCount]) => {
        const state = run({ scenarioId, difficulty: 'Intermediate', seed: 1505, defenses });
        assert.equal(state.findings.specializedScenario, true);
        assert.ok(state.findings.outcomeMetrics);
        assert.equal(state.findings.defensesTriggered.length, triggeredCount);
        assert.equal(E.scenarioGuidance(scenarioId).length, guidanceLength);
        assert.ok(state.findings.events.every(event => !('payload' in event) && !('url' in event) && !('credentials' in event)));
    });
});

test('all eleven reports expose the normalized Phase 6 summary schema', () => {
    E.SCENARIOS.forEach(scenario => {
        const defenses = Object.fromEntries(scenario.defenses.map(id => [id, true]));
        const state = run({ scenarioId: scenario.id, difficulty: 'Intermediate', seed: 1606, defenses });
        const report = state.findings;
        assert.equal(report.schemaVersion, '2.0', `${scenario.id} schema version`);
        assert.equal(report.summary.identity.scenarioId, scenario.id);
        assert.equal(report.summary.identity.scenario, scenario.title);
        assert.ok(Number.isFinite(report.summary.risk.peak));
        assert.ok(Number.isFinite(report.summary.risk.residual));
        assert.ok(Number.isFinite(report.summary.activity.eventCount));
        assert.ok(Number.isFinite(report.summary.activity.blockedUnits));
        assert.ok(Number.isFinite(report.summary.service.maximumLatency));
        assert.ok(Number.isFinite(report.summary.service.minimumAvailability));
        assert.equal(report.summary.defenses.triggered, report.defensesTriggered.length);
        assert.ok(report.summary.outcomes);
    });
});

test('normalized comparison deltas work consistently for DoS and specialized scenarios', () => {
    [
        ['dos', { rateLimiting: true, trafficFiltering: true }],
        ['phishing', { emailFiltering: true, mfa: true }],
        ['apt', { leastPrivilege: true, segmentation: true, dlp: true }]
    ].forEach(([scenarioId, defenses]) => {
        const baseline = run({ scenarioId, difficulty: 'Intermediate', seed: 1707 });
        const defended = run({ scenarioId, difficulty: 'Intermediate', seed: 1707, defenses });
        const comparison = E.compareReports(baseline.findings, defended.findings);
        assert.equal(comparison.comparable, true);
        assert.ok(Number.isFinite(comparison.normalizedDeltas['risk.residual']));
        assert.ok(Number.isFinite(comparison.normalizedDeltas['activity.blockedUnits']));
        assert.ok(Number.isFinite(comparison.normalizedDeltas['service.maximumLatency']));
    });
});

test('all scenarios remain within centralized rendering and state limits', () => {
    const started = performance.now();
    E.SCENARIOS.forEach(scenario => {
        const defenses = Object.fromEntries(scenario.defenses.map(id => [id, true]));
        const state = run({ scenarioId: scenario.id, difficulty: 'Advanced', seed: 1808, defenses });
        assert.ok(state.events.length <= E.STATE_LIMITS.events, `${scenario.id} event cap`);
        assert.ok(state.flows.length <= E.STATE_LIMITS.flows, `${scenario.id} flow cap`);
        assert.ok(state.alerts.length <= E.STATE_LIMITS.alerts, `${scenario.id} alert cap`);
        assert.ok(state.history.length <= E.STATE_LIMITS.history, `${scenario.id} history cap`);
        assert.ok(state.defenseEffectLog.length <= E.STATE_LIMITS.defenseEffects, `${scenario.id} effect cap`);
    });
    assert.ok(performance.now() - started < 2500, 'all scenario simulations should complete within the regression budget');
});
