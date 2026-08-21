import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    CHSH_COHORTS,
    CHSH_LOCAL_BOUND,
    CHSH_MAX_VIOLATION_PRESET,
    CHSH_SIGN_CONVENTION,
    CHSH_TSIRELSON_BOUND,
    ChshExperiment,
    calculateChshS,
    createChshConfiguration,
    createPolarizationSingletDistribution,
    createSeededRandom,
    localAlicePolarizationResponse,
    localBobPolarizationResponse,
    sampleChshTrial
} from '../frontend/quantum-playground-model.mjs';

function close(actual, expected, tolerance = 1e-12) {
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differed from ${expected}`);
}

test('Phase 6 Born-rule photon-polarization probabilities remain unchanged', () => {
    const distribution = createPolarizationSingletDistribution({ aliceAngleDeg: 13, bobAngleDeg: 71 });
    const expected = [0.3595927866972693, 0.14040721330273068, 0.14040721330273068, 0.3595927866972693];
    distribution.probabilities.forEach((value, index) => close(value, expected[index]));
    close(distribution.correlation, 0.43837114678907724);
});

test('stated CHSH sign convention is applied consistently', () => {
    assert.equal(CHSH_SIGN_CONVENTION, 'E(a,b)+E(a,bPrime)+E(aPrime,b)-E(aPrime,bPrime)');
    const values = { ab: 0.1, abPrime: 0.2, aPrimeB: 0.3, aPrimeBPrime: 0.4 };
    close(calculateChshS(values), 0.2);
    const configuration = createChshConfiguration();
    close(configuration.expectedS, calculateChshS(configuration.expectedCorrelations));
});

test('maximum-violation photon preset reaches the Tsirelson magnitude', () => {
    const configuration = createChshConfiguration(CHSH_MAX_VIOLATION_PRESET);
    close(Math.abs(configuration.expectedS), 2 * Math.sqrt(2));
    close(Math.abs(configuration.expectedS), CHSH_TSIRELSON_BOUND);
    assert.equal(configuration.angles.bPrimeDeg, 157.5);
    assert.equal(CHSH_MAX_VIOLATION_PRESET.bPrimeEquivalentDeg, -22.5);
});

test('quantum CHSH values never exceed the Tsirelson bound numerically', () => {
    const angles = [0, 17, 45, 83.5, 120, 157.5];
    for (const aDeg of angles) {
        for (const aPrimeDeg of angles.slice(0, 3)) {
            for (const bDeg of angles.slice(2, 5)) {
                const configuration = createChshConfiguration({ aDeg, aPrimeDeg, bDeg, bPrimeDeg: 157.5 });
                assert.ok(Math.abs(configuration.expectedS) <= CHSH_TSIRELSON_BOUND + 1e-12);
            }
        }
    }
});

test('every trial has one Alice setting, one Bob setting, and one joint outcome', () => {
    for (const model of ['quantum', 'local']) {
        const configuration = createChshConfiguration({ model });
        const random = createSeededRandom(`phase-7-shape-${model}`);
        for (let index = 0; index < 1000; index += 1) {
            const trial = sampleChshTrial(configuration, random);
            assert.ok(['a', 'aPrime'].includes(trial.aliceSetting));
            assert.ok(['b', 'bPrime'].includes(trial.bobSetting));
            assert.ok(['++', '+-', '-+', '--'].includes(trial.outcome));
            assert.ok(CHSH_COHORTS.some(cohort => cohort.key === trial.cohort));
        }
    }
});

test('all setting combinations are approximately uniform and choices are independent', () => {
    const configuration = createChshConfiguration();
    const random = createSeededRandom('phase-7-settings');
    const counts = { ab: 0, abPrime: 0, aPrimeB: 0, aPrimeBPrime: 0 };
    const sampleCount = 200_000;
    for (let index = 0; index < sampleCount; index += 1) counts[sampleChshTrial(configuration, random).cohort] += 1;
    Object.values(counts).forEach(count => close(count / sampleCount, 0.25, 0.004));
    const aliceA = (counts.ab + counts.abPrime) / sampleCount;
    const bobB = (counts.ab + counts.aPrimeB) / sampleCount;
    close(counts.ab / sampleCount, aliceA * bobB, 0.003);
});

test('setting selection is independent of local hidden variables', () => {
    const configuration = createChshConfiguration({ model: 'local' });
    const random = createSeededRandom('phase-7-measurement-independence');
    const groups = Object.fromEntries(CHSH_COHORTS.map(({ key }) => [key, { total: 0, lambdaSum: 0 }]));
    for (let index = 0; index < 200_000; index += 1) {
        const trial = sampleChshTrial(configuration, random);
        groups[trial.cohort].total += 1;
        groups[trial.cohort].lambdaSum += trial.lambda;
    }
    Object.values(groups).forEach(group => close(group.lambdaSum / group.total, Math.PI / 2, 0.015));

    const source = readFileSync(new URL('../frontend/quantum-playground-model.mjs', import.meta.url), 'utf8');
    const sampler = source.match(/export function sampleChshTrial[\s\S]*?\n}\n/)?.[0] || '';
    assert.ok(sampler.indexOf('const aliceSetting') < sampler.indexOf('lambda = random()'));
    assert.ok(sampler.indexOf('const bobSetting') < sampler.indexOf('lambda = random()'));
});

test('changing the outcome draw cannot retroactively change selected settings', () => {
    const configuration = createChshConfiguration();
    const randomFrom = values => {
        let index = 0;
        return () => values[index++];
    };
    const first = sampleChshTrial(configuration, randomFrom([0.1, 0.9, 0.01]));
    const second = sampleChshTrial(configuration, randomFrom([0.1, 0.9, 0.99]));
    assert.equal(first.aliceSetting, 'a');
    assert.equal(first.bobSetting, 'bPrime');
    assert.equal(second.aliceSetting, first.aliceSetting);
    assert.equal(second.bobSetting, first.bobSetting);
    assert.equal(second.cohort, first.cohort);
});

test('quantum cohort correlations and S converge in one complete Bell run', () => {
    const experiment = new ChshExperiment(createChshConfiguration(), 'phase-7-quantum-convergence');
    experiment.emit(400_000);
    const summary = experiment.summary();
    for (const { key } of CHSH_COHORTS) {
        close(summary.cohorts[key].correlation, experiment.configuration.expectedCorrelations[key], 0.012);
        assert.ok(summary.cohorts[key].total > 95_000);
    }
    close(summary.measuredS, experiment.configuration.expectedS, 0.02);
});

test('local response functions use only local setting and shared lambda', () => {
    const lambda = 0.37;
    assert.ok(['+', '-'].includes(localAlicePolarizationResponse(12, lambda)));
    assert.ok(['+', '-'].includes(localBobPolarizationResponse(77, lambda)));
    const source = readFileSync(new URL('../frontend/quantum-playground-model.mjs', import.meta.url), 'utf8');
    const alice = source.match(/export function localAlicePolarizationResponse[\s\S]*?\n}/)?.[0] || '';
    const bob = source.match(/export function localBobPolarizationResponse[\s\S]*?\n}/)?.[0] || '';
    assert.doesNotMatch(alice, /bob|remote|outcome/i);
    assert.doesNotMatch(bob, /alice|remote|outcome/i);
});

test('large local-model run converges to the Bell bound without clamping finite S', () => {
    const experiment = new ChshExperiment(createChshConfiguration({ model: 'local' }), 'local');
    experiment.emit(100_000);
    const summary = experiment.summary();
    close(Math.abs(summary.expectedS), CHSH_LOCAL_BOUND);
    close(summary.absoluteS, CHSH_LOCAL_BOUND, 0.03);
    assert.ok(summary.absoluteS > CHSH_LOCAL_BOUND, 'this deterministic finite sample demonstrates a permitted fluctuation above 2');
    assert.ok(summary.uncertainty > 0);
});

test('example local model expected CHSH value respects the bound for varied settings', () => {
    const angleSets = [[0, 45, 22.5, 157.5], [3, 81, 40, 119], [17, 53, 2, 97], [0, 90, 45, 135]];
    for (const [aDeg, aPrimeDeg, bDeg, bPrimeDeg] of angleSets) {
        const configuration = createChshConfiguration({ model: 'local', aDeg, aPrimeDeg, bDeg, bPrimeDeg });
        assert.ok(Math.abs(configuration.expectedS) <= CHSH_LOCAL_BOUND + 1e-12);
    }
});

test('local marginals remain non-signaling across remote setting cohorts', () => {
    for (const model of ['quantum', 'local']) {
        const experiment = new ChshExperiment(createChshConfiguration({ model }), `phase-7-marginal-${model}`);
        experiment.emit(400_000);
        const { cohorts } = experiment.summary();
        close(cohorts.ab.alicePlus, cohorts.abPrime.alicePlus, 0.012);
        close(cohorts.aPrimeB.alicePlus, cohorts.aPrimeBPrime.alicePlus, 0.012);
        close(cohorts.ab.bobPlus, cohorts.aPrimeB.bobPlus, 0.012);
        close(cohorts.abPrime.bobPlus, cohorts.aPrimeBPrime.bobPlus, 0.012);
        Object.values(cohorts).forEach(cohort => {
            close(cohort.alicePlus, 0.5, 0.012);
            close(cohort.bobPlus, 0.5, 0.012);
        });
    }
});

test('seeded complete Bell runs are exactly reproducible', () => {
    const configuration = createChshConfiguration();
    const first = new ChshExperiment(configuration, 'phase-7-repeat');
    const second = new ChshExperiment(configuration, 'phase-7-repeat');
    first.emit(20_000);
    second.emit(20_000);
    assert.deepEqual(first.summary(), second.summary());
    for (const { key } of CHSH_COHORTS) assert.deepEqual([...first.cohorts[key].counts], [...second.cohorts[key].counts]);
});

test('reset and configuration changes clear all four cohorts', () => {
    const experiment = new ChshExperiment(createChshConfiguration(), 'phase-7-state');
    experiment.emit(1000);
    experiment.reset();
    assert.equal(experiment.total, 0);
    CHSH_COHORTS.forEach(({ key }) => assert.equal(experiment.cohorts[key].total, 0));
    experiment.emit(1000);
    experiment.setConfiguration(createChshConfiguration({ model: 'local' }));
    assert.equal(experiment.total, 0);
    experiment.emit(1000);
    experiment.setConfiguration(createChshConfiguration({ aDeg: 0.5 }));
    assert.equal(experiment.total, 0);
});

test('cohort uncertainty and CHSH uncertainty use the documented approximation', () => {
    const experiment = new ChshExperiment(createChshConfiguration(), 'phase-7-uncertainty');
    experiment.emit(50_000);
    const summary = experiment.summary();
    let variance = 0;
    for (const { key } of CHSH_COHORTS) {
        const cohort = summary.cohorts[key];
        close(cohort.uncertainty, Math.sqrt((1 - cohort.correlation ** 2) / cohort.total));
        variance += cohort.uncertainty ** 2;
    }
    close(summary.uncertainty, Math.sqrt(variance));
});

test('Phase 7 UI states bounds, convention, local-model scope, and safeguards', () => {
    const page = readFileSync(new URL('../frontend/quantum-playground.html', import.meta.url), 'utf8');
    const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
    assert.match(page, /data-experiment="bell-test"[^>]*>[\s\S]*?<span>Live<\/span>/);
    assert.match(page, /Quantum Model/);
    assert.match(page, /Local Hidden-Variable Model/);
    assert.match(page, /157\.5°[\s\S]*equivalent to[\s\S]*−22\.5°/);
    assert.match(page, /Local Bell bound:[\s\S]*2/);
    assert.match(page, /Tsirelson bound:[\s\S]*2√2/);
    assert.match(controller, /S=E\(a,b\)\+E\(a,b′\)\+E\(a′,b\)−E\(a′,b′\)/);
    assert.match(controller, /one example local hidden-variable model, not every classical theory/);
    assert.match(controller, /Finite measured estimates can fluctuate around either asymptotic bound/);
    assert.match(controller, /not every hidden-variable theory or any quantum interpretation/);
    assert.match(controller, /does not prove faster-than-light communication/);
    assert.match(controller, /consciousness-caused collapse/);
    assert.match(controller, /'bell-test': \{ title: 'Bell \/ CHSH Test', phase: 'Live' \}/);
});
