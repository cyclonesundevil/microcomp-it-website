const assert = require('node:assert/strict');
const test = require('node:test');

test('canonical state shares Kerr radii with the renderer in r_s units', async () => {
    const { createBlackHoleSimulationState } = await import('../frontend/black-hole-simulation-state.mjs');
    for (const spin of [0, 0.42, 0.99]) {
        const state = createBlackHoleSimulationState({ massSolar: 70, spin }).get();
        assert.equal(state.observerRadiusRs * 2, state.observerRadiusRg);
        assert.equal(state.observerAltitudeKm + state.physics.horizonDiameterKm / 2, state.observerRadiusKm);
        if (spin === 0) assert.equal(state.physics.iscoRadiusRg / 2, 3);
        if (spin === 0.99) assert.ok(state.physics.iscoRadiusRg / 2 < 1);
        assert.ok(Object.isFrozen(state));
    }
});

test('mass changes physical scales and elapsed phase without changing dimensionless geometry', async () => {
    const { createBlackHoleSimulationState } = await import('../frontend/black-hole-simulation-state.mjs');
    const small = createBlackHoleSimulationState({ massSolar: 10 });
    const large = createBlackHoleSimulationState({ massSolar: 80 });
    const a = small.advance(1), b = large.advance(1);
    assert.equal(b.observerRadiusKm / a.observerRadiusKm, 8);
    assert.equal(b.timeUnitRsSeconds / a.timeUnitRsSeconds, 8);
    assert.equal(a.modelTimeRs / b.modelTimeRs, 8);
    assert.equal(a.physics.horizonRadiusRg, b.physics.horizonRadiusRg);
    assert.equal(a.elapsedPhysicalSeconds, b.elapsedPhysicalSeconds);
    const phase = small.get().modelTimeRs;
    small.set({ massSolar: 80 });
    assert.equal(small.get().modelTimeRs, phase, 'changing mass preserves accumulated phase');
});

test('observer state supports both sides of the disk and rejects invalid updates atomically', async () => {
    const { createBlackHoleSimulationState } = await import('../frontend/black-hole-simulation-state.mjs');
    const store = createBlackHoleSimulationState();
    for (const angle of [0, 90, 180]) assert.equal(store.set({ observerAngleDegrees: angle }).observerAngleDegrees, angle);
    const before = store.get();
    assert.throws(() => store.set({ observerAngleDegrees: 181 }), RangeError);
    assert.equal(store.get(), before);
    assert.throws(() => store.set({ massSolar: 0 }), RangeError);
    assert.throws(() => store.set({ observerRadiusRg: 2 }), RangeError);
    assert.throws(() => store.advance(-1), RangeError);
    assert.throws(() => store.advance(Infinity), RangeError);
});
