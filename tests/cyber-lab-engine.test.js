'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const E = require('../frontend/cyber-lab-engine.js');

function run(config, ticks) {
    let state = E.initialState(config);
    const total = ticks ?? (state.scenario.id === 'dos' ? 24 : 20);
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
    assert.ok(report.events.every(event => ['forwarded', 'scrubbed', 'filtered'].includes(event.action)));
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
