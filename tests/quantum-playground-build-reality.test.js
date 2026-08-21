import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    CHSH_MAX_VIOLATION_PRESET,
    createChshConfiguration,
    createPolarizationSingletDistribution,
    createSeededRandom,
    localHiddenVariableExpectedCorrelation
} from '../frontend/quantum-playground-model.mjs';
import {
    REALITY_ANGLE_GRID_DEG,
    REALITY_BENCHMARK_SCENARIOS,
    REALITY_GRID_SCENARIOS,
    RealityExperiment,
    buildRealityVerdict,
    correlationCurveRmse,
    createRealityCandidate,
    evaluateOperationalNoSignaling,
    localResponseProbabilities,
    sampleRealityTrial
} from '../frontend/quantum-reality-model.mjs';

const close = (actual, expected, tolerance = 1e-12) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);

test('Phase 6 and Phase 7 reference engines retain approved numerical fixtures', () => {
    const singlet = createPolarizationSingletDistribution({ aliceAngleDeg: 13, bobAngleDeg: 71 });
    close(singlet.correlation, -Math.cos(2 * (13 - 71) * Math.PI / 180));
    close(singlet.probabilities.reduce((sum, value) => sum + value, 0), 1);
    const quantum = createChshConfiguration({ model: 'quantum', ...CHSH_MAX_VIOLATION_PRESET });
    const local = createChshConfiguration({ model: 'local', ...CHSH_MAX_VIOLATION_PRESET });
    close(quantum.expectedS, -2 * Math.sqrt(2));
    close(local.expectedS, -2);
    close(localHiddenVariableExpectedCorrelation(0, 22.5), -0.5);
});

test('local candidates structurally expose only local-setting response APIs', () => {
    const candidate = createRealityCandidate({ mode: 'local' });
    assert.deepEqual(candidate.modelApi.aliceResponseInputs, ['aliceAngleDeg', 'lambda', 'random']);
    assert.deepEqual(candidate.modelApi.bobResponseInputs, ['bobAngleDeg', 'lambda', 'random']);
    assert.deepEqual(candidate.modelApi.jointResponseInputs, []);
    assert.equal(candidate.capabilities.jointResponseMayAccessBothSettings, false);
    assert.equal(candidate.ledger.locality, 'preserved');
});

test('measurement-independent hidden variables cannot condition on analyzer settings', () => {
    const candidate = createRealityCandidate({ mode: 'local', hiddenDistribution: 'axial-biased', hiddenBias: 0.6 });
    assert.deepEqual(candidate.modelApi.hiddenVariableInputs, ['random']);
    const first = sampleRealityTrial(candidate, REALITY_GRID_SCENARIOS[0], createSeededRandom('same-hidden-draws'));
    const second = sampleRealityTrial(candidate, REALITY_GRID_SCENARIOS.at(-1), createSeededRandom('same-hidden-draws'));
    assert.equal(first.lambda, second.lambda);
    assert.equal(candidate.ledger.measurementIndependence, 'preserved');
});

test('setting-dependent mode explicitly relaxes measurement independence without superdeterminism label', () => {
    const candidate = createRealityCandidate({ mode: 'measurement-dependent' });
    assert.deepEqual(candidate.modelApi.hiddenVariableInputs, ['aliceAngleDeg', 'bobAngleDeg', 'random']);
    assert.equal(candidate.ledger.measurementIndependence, 'relaxed');
    assert.doesNotMatch(JSON.stringify(candidate).toLowerCase(), /superdetermin/);
});

test('operational no-signaling is calculated from conditional marginals, not model labels', () => {
    const summaries = REALITY_GRID_SCENARIOS.map(scenario => ({
        scenario,
        total: 10000,
        correlation: 0,
        alicePlus: scenario.bobAngleDeg / 90,
        bobPlus: 0.5
    }));
    const result = evaluateOperationalNoSignaling(summaries);
    assert.equal(result.tested, true);
    assert.equal(result.satisfied, false);
    close(result.aliceMaxDelta, 1);
});

test('full-grid correlation RMSE uses every predetermined target', () => {
    const offset = 0.2;
    const summaries = REALITY_GRID_SCENARIOS.map(scenario => ({
        scenario,
        total: 10,
        correlation: scenario.targetCorrelation + offset,
        targetCorrelation: scenario.targetCorrelation
    }));
    close(correlationCurveRmse(summaries), offset);
    assert.equal(correlationCurveRmse(summaries.slice(1)), null);
});

test('matching the maximum CHSH configuration alone is insufficient', () => {
    const candidate = createRealityCandidate({ mode: 'local' });
    const verdict = buildRealityVerdict({
        candidate,
        gridRmse: 0.5,
        measuredS: -2 * Math.sqrt(2),
        noSignaling: { tested: true, satisfied: true },
        equalAngleRmse: 0
    });
    assert.equal(verdict.level, 'failed');
    assert.equal(verdict.title, 'One CHSH point is not enough');
});

test('local marginals are evaluated independently from joint correlations', () => {
    const summaries = REALITY_GRID_SCENARIOS.map(scenario => ({
        scenario,
        total: 10000,
        correlation: scenario.targetCorrelation,
        alicePlus: scenario.bobAngleDeg === 90 ? 0.8 : 0.5,
        bobPlus: 0.5
    }));
    assert.equal(evaluateOperationalNoSignaling(summaries).satisfied, false);
});

test('all stochastic local response probabilities normalize and remain non-negative', () => {
    const config = createRealityCandidate({
        mode: 'local', responseShape: 'soft', responseSoftness: 0.4, localNoise: 0.2
    }).config;
    for (const party of ['alice', 'bob']) {
        for (let angle = 0; angle <= 180; angle += 9) {
            const probabilities = localResponseProbabilities(angle, 0.731, config, party);
            assert.ok(probabilities.plus >= 0 && probabilities.minus >= 0);
            close(probabilities.plus + probabilities.minus, 1);
        }
    }
});

test('seeded candidate benchmarks and complete audit trails reproduce exactly', () => {
    const candidate = createRealityCandidate({ mode: 'local', responseShape: 'soft', localNoise: 0.1 });
    const first = new RealityExperiment(candidate, 'phase-8-repeat');
    const second = new RealityExperiment(candidate, 'phase-8-repeat');
    first.emit(500);
    second.emit(500);
    assert.deepEqual(first.auditTrail, second.auditTrail);
    assert.deepEqual(first.summary(), second.summary());
    assert.equal(first.auditTrail.length, first.total);
    first.auditTrail.forEach(trial => {
        assert.equal(trial.candidateId, candidate.id);
        assert.equal(trial.assumptions, candidate.ledger);
        assert.ok(Number.isFinite(trial.aliceAngleDeg));
        assert.ok(Number.isFinite(trial.bobAngleDeg));
        assert.match(trial.outcome, /^(\+\+|\+-|-\+|--)$/);
    });
});

test('candidate parameter changes clear incompatible observations', () => {
    const experiment = new RealityExperiment(createRealityCandidate({ mode: 'local' }), 'phase-8-state');
    experiment.emit(100);
    experiment.setCandidate(createRealityCandidate({ mode: 'local', localNoise: 0.2 }));
    assert.equal(experiment.total, 0);
    assert.equal(experiment.auditTrail.length, 0);
    assert.ok(Object.values(experiment.scenarios).every(scenario => scenario.total === 0));
});

test('assumption ledger is derived from and agrees with candidate capabilities', () => {
    const local = createRealityCandidate({ mode: 'local' });
    const dependent = createRealityCandidate({ mode: 'measurement-dependent' });
    const nonlocal = createRealityCandidate({ mode: 'nonlocal-quantum' });
    assert.equal(local.ledger.locality, local.capabilities.jointResponseMayAccessBothSettings ? 'relaxed' : 'preserved');
    assert.equal(dependent.ledger.measurementIndependence, dependent.capabilities.hiddenVariableMayAccessSettings ? 'relaxed' : 'preserved');
    assert.equal(nonlocal.ledger.locality, 'relaxed');
    assert.equal(nonlocal.ledger.measurementIndependence, 'preserved');
    assert.equal(nonlocal.ledger.noSignaling, 'tested from conditional marginals');
});

test('baseline local model passes equal-angle challenge but misses Bell/full-curve challenge', () => {
    const experiment = new RealityExperiment(createRealityCandidate({ mode: 'local' }), 'phase-8-local');
    experiment.emit(REALITY_BENCHMARK_SCENARIOS.length * 1500);
    const summary = experiment.summary();
    assert.ok(summary.equalAngleRmse < 0.02);
    assert.ok(Math.abs(summary.measuredS) < 2.12);
    assert.ok(summary.gridRmse > 0.12);
    assert.equal(summary.verdict.level, 'failed');
});

test('nonlocal Born mechanism reproduces the full target while remaining operationally non-signaling', () => {
    const candidate = createRealityCandidate({ mode: 'nonlocal-quantum' });
    const experiment = new RealityExperiment(candidate, 'phase-8-quantum');
    experiment.emit(REALITY_BENCHMARK_SCENARIOS.length * 1500);
    const summary = experiment.summary();
    assert.ok(summary.gridRmse < 0.04);
    assert.ok(Math.abs(Math.abs(summary.measuredS) - 2 * Math.sqrt(2)) < 0.1);
    assert.equal(summary.noSignaling.satisfied, true);
    assert.equal(summary.verdict.level, 'qualified');
    assert.match(summary.verdict.explanation, /Bell-local hidden-variable factorization is not imposed/);
    assert.match(summary.verdict.explanation, /no influence or message between Alice and Bob is simulated/);
});

test('predetermined benchmark spans a full Cartesian grid plus four CHSH cohorts', () => {
    assert.equal(REALITY_GRID_SCENARIOS.length, REALITY_ANGLE_GRID_DEG.length ** 2);
    assert.equal(REALITY_BENCHMARK_SCENARIOS.length, REALITY_GRID_SCENARIOS.length + 4);
});

test('Phase 8 page exposes mechanisms, ledger, challenges, diagnostics, and no executable-code input', () => {
    const page = readFileSync(new URL('../frontend/quantum-playground.html', import.meta.url), 'utf8');
    const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
    assert.match(page, /Can You Reproduce Quantum Mechanics\?/);
    assert.match(page, /Assumption Ledger/);
    assert.match(page, /Locality/);
    assert.match(page, /Measurement independence/);
    assert.match(page, /Full-curve RMSE/);
    assert.match(page, /Challenge 1/);
    assert.match(page, /Challenge 2/);
    assert.match(page, /Challenge 3/);
    assert.match(page, /approximate standard error/);
    assert.doesNotMatch(page, /<textarea/i);
    assert.doesNotMatch(controller, /\beval\s*\(|new Function\s*\(/);
});
