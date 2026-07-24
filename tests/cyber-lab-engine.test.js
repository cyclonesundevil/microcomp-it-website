'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const E = require('../frontend/cyber-lab-engine.js');

function run(config, ticks = 20) {
    let state = E.initialState(config);
    for (let i = 0; i < ticks; i += 1) state = E.step(state);
    return state;
}

test('provides all eleven safe scenario definitions', () => {
    assert.equal(E.SCENARIOS.length, 11);
    assert.equal(new Set(E.SCENARIOS.map(item => item.id)).size, 11);
});

test('same inputs and seed produce an identical run', () => {
    const config = { scenarioId: 'dos', difficulty: 'Intermediate', seed: 9182, defenses: { rateLimiting: true } };
    assert.deepEqual(run(config), run(config));
});

test('every generated host uses a documentation-only IPv4 range', () => {
    const allowed = /^(192\.0\.2|198\.51\.100|203\.0\.113)\./;
    E.HOSTS.forEach(host => assert.match(host.ip, allowed));
});

test('events contain safe labels and metadata rather than executable payloads', () => {
    E.SCENARIOS.forEach(scenario => {
        const state = run({ scenarioId: scenario.id, difficulty: 'Advanced', seed: 4 }, 5);
        assert.equal(state.events.length, 5);
        state.events.forEach(event => {
            assert.ok(event.marker);
            assert.equal('payload' in event, false);
            assert.equal('url' in event, false);
        });
    });
});

test('relevant defenses reduce or preserve residual risk and record blocked events', () => {
    const plain = run({ scenarioId: 'dos', seed: 42, defenses: {} });
    const defended = run({ scenarioId: 'dos', seed: 42, defenses: { rateLimiting: true, ids: true, anomalyDetection: true } });
    assert.ok(defended.findings.residualRisk <= plain.findings.residualRisk);
    assert.ok(defended.findings.blockedEvents > 0);
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
