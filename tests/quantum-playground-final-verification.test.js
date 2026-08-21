import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    CHSH_LOCAL_BOUND,
    CHSH_MAX_VIOLATION_PRESET,
    CHSH_TSIRELSON_BOUND,
    ChshExperiment,
    DEFAULT_DOUBLE_SLIT_GEOMETRY,
    DetectionExperiment,
    ENTANGLED_PAIR_OUTCOMES,
    EntanglementExperiment,
    QuantumEraserExperiment,
    calculateChshS,
    complexAdd,
    complexMagnitudeSquared,
    createChshConfiguration,
    createDecoherenceDistribution,
    createDoubleSlitDistribution,
    createPolarizationSingletDistribution,
    createQuantumEraserDistribution,
    createSeededRandom,
    createSingleParticleDistribution,
    createWhichPathDistribution,
    fraunhoferSlitAmplitude
} from '../frontend/quantum-playground-model.mjs';
import {
    REALITY_BENCHMARK_SCENARIOS,
    RealityExperiment,
    createRealityCandidate,
    sampleRealityTrial
} from '../frontend/quantum-reality-model.mjs';

const page = readFileSync(new URL('../frontend/quantum-playground.html', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
const realitySource = readFileSync(new URL('../frontend/quantum-reality-model.mjs', import.meta.url), 'utf8');
const close = (actual, expected, tolerance = 1e-12) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
const normalizedNonNegative = probabilities => {
    close(probabilities.reduce((sum, value) => sum + value, 0), 1, 2e-12);
    probabilities.forEach(value => assert.ok(Number.isFinite(value) && value >= 0));
};

test('frozen public inventory contains exactly eight live experiment implementations', () => {
    const expected = ['single', 'double-slit', 'which-path', 'decoherence', 'quantum-eraser', 'entanglement', 'bell-test', 'build-reality'];
    assert.equal([...page.matchAll(/data-experiment="([^"]+)"/g)].length, expected.length);
    for (const key of expected) {
        assert.equal([...page.matchAll(new RegExp(`data-experiment="${key}"`, 'g'))].length, 1);
        assert.match(controller, new RegExp(`['"]?${key.replace('-', '\\-')}['"]?\\s*:`));
    }
    assert.doesNotMatch(controller, /Planned for Phase|drawPlaceholder/);
    assert.doesNotMatch(page, /<span>Phase \d+<\/span>/);
});

test('all applicable distributions remain finite, normalized, and non-negative at public boundaries', () => {
    normalizedNonNegative(createSingleParticleDistribution().probabilities);
    const geometries = [
        { slitWidthM: 4e-6, slitSeparationM: 4e-6, wavelengthM: 380e-9, screenDistanceM: 0.5 },
        { slitWidthM: 30e-6, slitSeparationM: 30e-6, wavelengthM: 700e-9, screenDistanceM: 2 },
        { slitWidthM: 30e-6, slitSeparationM: 100e-6, wavelengthM: 380e-9, screenDistanceM: 2 }
    ];
    for (const geometry of geometries) {
        normalizedNonNegative(createDoubleSlitDistribution(geometry).probabilities);
        normalizedNonNegative(createWhichPathDistribution({ ...geometry, detectorEnabled: true }).probabilities);
        for (const coherence of [0, 0.5, 1]) {
            normalizedNonNegative(createDecoherenceDistribution({ ...geometry, coherence }).probabilities);
        }
        normalizedNonNegative(createQuantumEraserDistribution(geometry).jointProbabilities);
    }
    for (const aliceAngleDeg of [0, 90, 180]) {
        for (const bobAngleDeg of [0, 90, 180]) {
            normalizedNonNegative(createPolarizationSingletDistribution({ aliceAngleDeg, bobAngleDeg }).probabilities);
        }
    }
});

test('double-slit intensity is the squared sum of two calculated complex amplitudes', () => {
    const geometry = { ...DEFAULT_DOUBLE_SLIT_GEOMETRY, slitSeparationM: DEFAULT_DOUBLE_SLIT_GEOMETRY.slitWidthM };
    const distribution = createDoubleSlitDistribution(geometry);
    distribution.positions.forEach((screenPositionM, index) => {
        const first = fraunhoferSlitAmplitude({
            screenPositionM,
            slitWidthM: geometry.slitWidthM,
            slitCenterM: -geometry.slitSeparationM / 2,
            wavelengthM: geometry.wavelengthM,
            screenDistanceM: geometry.screenDistanceM
        });
        const second = fraunhoferSlitAmplitude({
            screenPositionM,
            slitWidthM: geometry.slitWidthM,
            slitCenterM: geometry.slitSeparationM / 2,
            wavelengthM: geometry.wavelengthM,
            screenDistanceM: geometry.screenDistanceM
        });
        close(distribution.intensities[index], complexMagnitudeSquared(complexAdd(first, second)), 2e-12);
    });
});

test('which-path endpoints and decoherence continuum preserve the approved dependency chain', () => {
    const coherent = createDoubleSlitDistribution();
    const detectorOff = createWhichPathDistribution({ detectorEnabled: false });
    const detectorOn = createWhichPathDistribution({ detectorEnabled: true });
    const gammaOne = createDecoherenceDistribution({ coherence: 1 });
    const gammaZero = createDecoherenceDistribution({ coherence: 0 });
    for (let index = 0; index < coherent.probabilities.length; index += 1) {
        close(detectorOff.probabilities[index], coherent.probabilities[index]);
        close(gammaOne.probabilities[index], coherent.probabilities[index]);
        close(gammaZero.probabilities[index], detectorOn.probabilities[index]);
    }
    const unitCross = gammaOne.interferenceTerms;
    for (const coherence of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const distribution = createDecoherenceDistribution({ coherence });
        distribution.intensities.forEach((intensity, index) => {
            close(intensity, distribution.incoherentIntensities[index] + coherence * unitCross[index], 3e-12);
        });
        normalizedNonNegative(distribution.probabilities);
    }
});

test('quantum eraser joint branches reconstruct the incoherent marginal bin by bin', () => {
    const eraser = createQuantumEraserDistribution();
    normalizedNonNegative(eraser.jointProbabilities);
    eraser.marginalDistribution.probabilities.forEach((value, index) => {
        close(value, eraser.plusJointProbabilities[index] + eraser.minusJointProbabilities[index]);
    });
});

test('entanglement and Bell reference fixtures retain polarization convention and bounds', () => {
    for (const [aliceAngleDeg, bobAngleDeg] of [[0, 0], [0, 45], [0, 90], [13, 71], [180, 0]]) {
        const distribution = createPolarizationSingletDistribution({ aliceAngleDeg, bobAngleDeg });
        close(distribution.correlation, -Math.cos(2 * (aliceAngleDeg - bobAngleDeg) * Math.PI / 180));
    }
    const quantum = createChshConfiguration({ model: 'quantum', ...CHSH_MAX_VIOLATION_PRESET });
    const local = createChshConfiguration({ model: 'local', ...CHSH_MAX_VIOLATION_PRESET });
    close(Math.abs(quantum.expectedS), CHSH_TSIRELSON_BOUND);
    close(Math.abs(local.expectedS), CHSH_LOCAL_BOUND);
    close(calculateChshS(quantum.expectedCorrelations), quantum.expectedS);
});

test('Phase 8 quantum reference reuses Phase 7 Born outcomes without numerical substitution', () => {
    assert.match(realitySource, /createPolarizationSingletDistribution/);
    assert.match(realitySource, /sampleEntangledPairs/);
    const candidate = createRealityCandidate({ mode: 'nonlocal-quantum' });
    const scenario = REALITY_BENCHMARK_SCENARIOS[7];
    const trial = sampleRealityTrial(candidate, scenario, createSeededRandom('phase-10-reference'));
    const distribution = createPolarizationSingletDistribution({
        aliceAngleDeg: scenario.aliceAngleDeg,
        bobAngleDeg: scenario.bobAngleDeg
    });
    const expectedDraw = createSeededRandom('phase-10-reference')();
    let expectedIndex = 0;
    while (expectedIndex < distribution.cumulative.length - 1 && expectedDraw > distribution.cumulative[expectedIndex]) expectedIndex += 1;
    assert.equal(trial.outcome, ENTANGLED_PAIR_OUTCOMES[expectedIndex]);
});

test('state containers handle empty, one-event, maximum batch, reset, and bounded recent histories', () => {
    const detection = new DetectionExperiment(createDoubleSlitDistribution(), 'final-detection');
    assert.equal(detection.moments().count, 0);
    detection.emit(1);
    assert.equal(detection.total, 1);
    detection.emit(1000);
    assert.equal(detection.total, 1001);
    assert.ok(detection.recent.length <= 220);
    assert.equal(detection.counts.reduce((sum, value) => sum + value, 0), detection.total);
    detection.reset();
    assert.equal(detection.total, 0);

    const eraser = new QuantumEraserExperiment(createQuantumEraserDistribution(), 'final-eraser');
    eraser.emit(1000);
    assert.ok(eraser.recentEvents.length <= 220);
    assert.equal(eraser.allCounts.reduce((sum, value) => sum + value, 0), 1000);

    const entangled = new EntanglementExperiment(createPolarizationSingletDistribution(), 'final-entangled');
    entangled.emit(1000);
    assert.ok(entangled.recent.length <= 80);
    assert.equal(entangled.counts.reduce((sum, value) => sum + value, 0), 1000);

    const chsh = new ChshExperiment(createChshConfiguration(), 'final-chsh');
    chsh.emit(1000);
    assert.ok(chsh.recent.length <= 80);
    assert.equal(Object.values(chsh.cohorts).reduce((sum, cohort) => sum + cohort.total, 0), 1000);
});

test('configuration changes clear incompatible accumulated observations', () => {
    const detection = new DetectionExperiment(createDoubleSlitDistribution(), 'change-detection');
    detection.emit(100);
    detection.setDistribution(createDoubleSlitDistribution({ wavelengthM: 700e-9 }));
    assert.equal(detection.total, 0);

    const entangled = new EntanglementExperiment(createPolarizationSingletDistribution(), 'change-entangled');
    entangled.emit(100);
    entangled.setDistribution(createPolarizationSingletDistribution({ aliceAngleDeg: 90, bobAngleDeg: 180 }));
    assert.equal(entangled.total, 0);

    const chsh = new ChshExperiment(createChshConfiguration(), 'change-chsh');
    chsh.emit(100);
    chsh.setConfiguration(createChshConfiguration({ model: 'local' }));
    assert.equal(chsh.total, 0);

    const reality = new RealityExperiment(createRealityCandidate(), 'change-reality');
    reality.emit(100);
    reality.setCandidate(createRealityCandidate({ localNoise: 0.5 }));
    assert.equal(reality.total, 0);
    assert.equal(reality.auditTrail.length, 0);
});

test('candidate authenticity prevents forged ledger and behavior mismatches', () => {
    const real = createRealityCandidate({ mode: 'local', ledger: { locality: 'relaxed' } });
    assert.equal(real.ledger.locality, 'preserved');
    assert.ok(Object.isFrozen(real) && Object.isFrozen(real.config) && Object.isFrozen(real.ledger));
    const forged = {
        ...real,
        config: { ...real.config, mode: 'nonlocal-quantum' },
        ledger: { ...real.ledger, locality: 'preserved' }
    };
    assert.throws(() => sampleRealityTrial(forged, REALITY_BENCHMARK_SCENARIOS[0], createSeededRandom('forged')), /predetermined benchmark scenario/);
    assert.throws(() => new RealityExperiment(forged), /verified reality candidate/);
});

test('sampling never produces NaN, Infinity, negative indices, or off-by-one bins', () => {
    const experiment = new DetectionExperiment(createDoubleSlitDistribution({
        slitWidthM: 30e-6,
        slitSeparationM: 30e-6,
        wavelengthM: 700e-9,
        screenDistanceM: 0.5
    }), 'bin-boundary');
    const bins = experiment.emit(10000);
    bins.forEach(index => assert.ok(Number.isInteger(index) && index >= 0 && index < experiment.counts.length));
    experiment.counts.forEach(count => assert.ok(Number.isFinite(count) && count >= 0));
    assert.equal(experiment.counts.reduce((sum, value) => sum + value, 0), 10000);
});

test('current source contains scoped reference-model and factorization terminology only', () => {
    const publicText = `${page}\n${controller}`;
    assert.doesNotMatch(publicText, /Nonlocal Born joint response|no-signaling is satisfied|satisfied operationally|local marginals remain non-signaling/i);
    assert.match(publicText, /Quantum Born Joint Reference/);
    assert.match(publicText, /Bell-local factorization (?:is )?not imposed/);
    assert.match(publicText, /operational no-signaling/);
});

test('skip-link target is programmatically focusable for keyboard navigation', () => {
    assert.match(page, /class="quantum-skip-link" href="#quantum-workbench"/);
    assert.match(page, /id="quantum-workbench" class="quantum-workbench" tabindex="-1"/);
});
