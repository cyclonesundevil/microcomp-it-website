import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    ENTANGLED_PAIR_OUTCOMES,
    EntanglementExperiment,
    POLARIZATION_SINGLET_STATE,
    createPolarizationSingletDistribution,
    createSeededRandom,
    polarizationAnalyzerBasis,
    sampleEntangledPairs
} from '../frontend/quantum-playground-model.mjs';

function close(actual, expected, tolerance = 1e-12) {
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differed from ${expected}`);
}

test('photon-polarization singlet state is normalized', () => {
    const norm = Object.values(POLARIZATION_SINGLET_STATE).reduce((sum, amplitude) => sum + amplitude ** 2, 0);
    close(norm, 1);
    close(POLARIZATION_SINGLET_STATE.hv, -POLARIZATION_SINGLET_STATE.vh);
});

test('each polarization analyzer basis is normalized and orthogonal', () => {
    for (const angle of [-37, 0, 22.5, 90, 180, 413]) {
        const { plus, minus } = polarizationAnalyzerBasis(angle);
        close(plus.h ** 2 + plus.v ** 2, 1);
        close(minus.h ** 2 + minus.v ** 2, 1);
        close(plus.h * minus.h + plus.v * minus.v, 0);
    }
});

test('Born probabilities are non-negative and form one normalized four-outcome distribution', () => {
    for (const angles of [[0, 0], [12.5, 87], [180, 31.5], [-45, 720]]) {
        const distribution = createPolarizationSingletDistribution({ aliceAngleDeg: angles[0], bobAngleDeg: angles[1] });
        assert.deepEqual(distribution.outcomes, ENTANGLED_PAIR_OUTCOMES);
        assert.ok(distribution.probabilities.every(value => value >= 0));
        close(distribution.probabilities.reduce((sum, value) => sum + value, 0), 1);
    }
});

test('local marginals remain one half independent of the remote analyzer setting', () => {
    for (const alice of [0, 17, 63.5, 120]) {
        for (const bob of [0, 29, 90, 177.5]) {
            const distribution = createPolarizationSingletDistribution({ aliceAngleDeg: alice, bobAngleDeg: bob });
            close(distribution.aliceMarginals.plus, 0.5);
            close(distribution.aliceMarginals.minus, 0.5);
            close(distribution.bobMarginals.plus, 0.5);
            close(distribution.bobMarginals.minus, 0.5);
        }
    }
});

test('equal analyzer angles give perfect anticorrelation', () => {
    for (const angle of [0, 22.5, 91, 179]) {
        const distribution = createPolarizationSingletDistribution({ aliceAngleDeg: angle, bobAngleDeg: angle });
        close(distribution.probabilities[0], 0);
        close(distribution.probabilities[1], 0.5);
        close(distribution.probabilities[2], 0.5);
        close(distribution.probabilities[3], 0);
        close(distribution.correlation, -1);
    }
});

test('45-degree analyzer difference gives zero correlation', () => {
    close(createPolarizationSingletDistribution({ aliceAngleDeg: 10, bobAngleDeg: 55 }).correlation, 0);
});

test('90-degree analyzer difference gives perfect correlation in the polarization convention', () => {
    const distribution = createPolarizationSingletDistribution({ aliceAngleDeg: 5, bobAngleDeg: 95 });
    close(distribution.correlation, 1);
    close(distribution.probabilities[0], 0.5);
    close(distribution.probabilities[3], 0.5);
});

test('arbitrary angles reproduce E = -cos[2(a-b)] and all four closed forms', () => {
    for (const [alice, bob] of [[13, 71], [92.5, 4], [-30, 19.5]]) {
        const distribution = createPolarizationSingletDistribution({ aliceAngleDeg: alice, bobAngleDeg: bob });
        const delta = (alice - bob) * Math.PI / 180;
        const same = 0.5 * Math.sin(delta) ** 2;
        const opposite = 0.5 * Math.cos(delta) ** 2;
        close(distribution.probabilities[0], same);
        close(distribution.probabilities[1], opposite);
        close(distribution.probabilities[2], opposite);
        close(distribution.probabilities[3], same);
        close(distribution.correlation, -Math.cos(2 * delta));
    }
});

test('simultaneous analyzer rotation leaves probabilities and correlation unchanged', () => {
    const reference = createPolarizationSingletDistribution({ aliceAngleDeg: 11, bobAngleDeg: 64 });
    for (const rotation of [-73, 20, 180, 360]) {
        const rotated = createPolarizationSingletDistribution({ aliceAngleDeg: 11 + rotation, bobAngleDeg: 64 + rotation });
        rotated.probabilities.forEach((value, index) => close(value, reference.probabilities[index]));
        close(rotated.correlation, reference.correlation);
    }
});

test('photon-polarization probabilities have 180-degree analyzer periodicity', () => {
    const reference = createPolarizationSingletDistribution({ aliceAngleDeg: 17, bobAngleDeg: 83 });
    const alicePeriod = createPolarizationSingletDistribution({ aliceAngleDeg: 197, bobAngleDeg: 83 });
    const bobPeriod = createPolarizationSingletDistribution({ aliceAngleDeg: 17, bobAngleDeg: 263 });
    reference.probabilities.forEach((value, index) => {
        close(alicePeriod.probabilities[index], value);
        close(bobPeriod.probabilities[index], value);
    });
});

test('seeded pair sampling is reproducible and samples one four-outcome joint variable', () => {
    const distribution = createPolarizationSingletDistribution({ aliceAngleDeg: 13, bobAngleDeg: 71 });
    const first = sampleEntangledPairs(distribution, 5000, createSeededRandom('phase-6-joint'));
    const second = sampleEntangledPairs(distribution, 5000, createSeededRandom('phase-6-joint'));
    assert.deepEqual(first, second);
    assert.ok(new Set(first).size === 4);

    const source = readFileSync(new URL('../frontend/quantum-playground-model.mjs', import.meta.url), 'utf8');
    const sampler = source.match(/export function sampleEntangledPairs[\s\S]*?\n}\n/)?.[0] || '';
    assert.match(sampler, /distribution\.cumulative/);
    assert.doesNotMatch(sampler, /aliceRandom|bobRandom|adjust|manufacture/i);
});

test('large joint Monte Carlo sample converges to all probabilities and correlation', () => {
    const distribution = createPolarizationSingletDistribution({ aliceAngleDeg: 13, bobAngleDeg: 71 });
    const outcomes = sampleEntangledPairs(distribution, 300_000, createSeededRandom('phase-6-convergence'));
    const counts = new Uint32Array(4);
    outcomes.forEach(outcome => { counts[ENTANGLED_PAIR_OUTCOMES.indexOf(outcome)] += 1; });
    counts.forEach((count, index) => close(count / outcomes.length, distribution.probabilities[index], 0.002));
    const measuredE = (counts[0] - counts[1] - counts[2] + counts[3]) / outcomes.length;
    close(measuredE, distribution.correlation, 0.003);
});

test('remote settings do not change sampled local 50/50 marginals', () => {
    for (const bobAngleDeg of [0, 37, 90, 151]) {
        const distribution = createPolarizationSingletDistribution({ aliceAngleDeg: 23, bobAngleDeg });
        const outcomes = sampleEntangledPairs(distribution, 100_000, createSeededRandom(`phase-6-local-${bobAngleDeg}`));
        const alicePlus = outcomes.filter(outcome => outcome[0] === '+').length / outcomes.length;
        close(alicePlus, 0.5, 0.006);
    }
});

test('changing either analyzer clears statistics from the previous configuration', () => {
    const experiment = new EntanglementExperiment(
        createPolarizationSingletDistribution({ aliceAngleDeg: 0, bobAngleDeg: 22.5 }),
        'phase-6-state'
    );
    experiment.emit(1000);
    assert.equal(experiment.total, 1000);
    experiment.setDistribution(createPolarizationSingletDistribution({ aliceAngleDeg: 1, bobAngleDeg: 22.5 }));
    assert.equal(experiment.total, 0);
    assert.ok(experiment.counts.every(value => value === 0));
    experiment.emit(1000);
    experiment.setDistribution(createPolarizationSingletDistribution({ aliceAngleDeg: 1, bobAngleDeg: 23 }));
    assert.equal(experiment.total, 0);
});

test('Phase 6 UI uses photon polarization, joint outcomes, and no-signaling education only', () => {
    const page = readFileSync(new URL('../frontend/quantum-playground.html', import.meta.url), 'utf8');
    const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
    assert.match(page, /data-experiment="entanglement"[^>]*>[\s\S]*?<span>Live<\/span>/);
    assert.match(page, /id="quantum-alice-angle"/);
    assert.match(page, /id="quantum-bob-angle"/);
    for (const id of ['pp', 'pm', 'mp', 'mm']) assert.match(page, new RegExp(`id="quantum-count-${id}"`));
    assert.match(controller, /photon-polarization singlet/i);
    assert.match(controller, /cannot enable faster-than-light communication/);
    assert.match(controller, /Neither photon signals the other/);
    assert.match(controller, /Alice does not send Bob an outcome/);
    const phase6Education = controller.match(/if \(experimentId === 'entanglement'\)[\s\S]*?\n        }/)?.[0] || '';
    assert.doesNotMatch(phase6Education, /CHSH|hidden.?variable|detector loophole|inefficiency/i);
    assert.doesNotMatch(phase6Education, /spin-?1\/2|spin singlet/i);
});
