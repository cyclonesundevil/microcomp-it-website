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
