import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    createDoubleSlitDistribution,
    createSeededRandom,
    createSingleSlitFraunhoferDistribution,
    sampleDetections
} from '../frontend/quantum-playground-model.mjs';

const geometry = {
    slitWidthM: 12e-6,
    slitSeparationM: 40e-6,
    wavelengthM: 550e-9,
    screenDistanceM: 1,
    detectorHalfWidthM: 0.08,
    binCount: 1601
};

function positiveLocalExtrema(distribution, kind) {
    const center = Math.floor(distribution.positions.length / 2);
    const values = distribution.intensities;
    const result = [];
    for (let index = center + 1; index < values.length - 1; index += 1) {
        const isExtremum = kind === 'maximum'
            ? values[index] > values[index - 1] && values[index] >= values[index + 1]
            : values[index] < values[index - 1] && values[index] <= values[index + 1];
        if (isExtremum) result.push(distribution.positions[index]);
    }
    return result;
}

function firstFringeSpacing(options) {
    const distribution = createDoubleSlitDistribution(options);
    const peaks = positiveLocalExtrema(distribution, 'maximum');
    assert.ok(peaks.length >= 2, 'geometry should resolve at least two positive-side fringes');
    return peaks[1] - peaks[0];
}

test('double-slit probabilities are normalized and non-negative', () => {
    const distribution = createDoubleSlitDistribution(geometry);
    const total = distribution.probabilities.reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-12);
    assert.ok(distribution.probabilities.every(value => value >= 0));
    assert.ok(distribution.intensities.every(value => value >= 0));
});

test('symmetric double-slit geometry produces a symmetric distribution', () => {
    const { probabilities } = createDoubleSlitDistribution(geometry);
    for (let index = 0; index < probabilities.length; index += 1) {
        assert.ok(Math.abs(probabilities[index] - probabilities[probabilities.length - 1 - index]) < 1e-14);
    }
});

test('independent rectangular slits reject overlap and accept the touching boundary d = a', () => {
    assert.throws(
        () => createDoubleSlitDistribution({ ...geometry, slitWidthM: 20e-6, slitSeparationM: 19e-6 }),
        /greater than or equal to slitWidthM/
    );
    assert.doesNotThrow(
        () => createDoubleSlitDistribution({ ...geometry, slitWidthM: 20e-6, slitSeparationM: 20e-6 })
    );
});

test('a narrower slit produces a broader diffraction envelope', () => {
    const narrow = createSingleSlitFraunhoferDistribution({ ...geometry, slitWidthM: 8e-6 });
    const wide = createSingleSlitFraunhoferDistribution({ ...geometry, slitWidthM: 20e-6 });
    const narrowMinimum = positiveLocalExtrema(narrow, 'minimum')[0];
    const wideMinimum = positiveLocalExtrema(wide, 'minimum')[0];
    assert.ok(narrowMinimum > wideMinimum * 2.3);
});

test('larger slit separation produces smaller numerically measured fringe spacing', () => {
    const smallSeparation = firstFringeSpacing({ ...geometry, slitSeparationM: 35e-6 });
    const largeSeparation = firstFringeSpacing({ ...geometry, slitSeparationM: 70e-6 });
    assert.ok(largeSeparation < smallSeparation * 0.55);
});

test('larger wavelength produces larger numerically measured fringe spacing', () => {
    const shortWavelength = firstFringeSpacing({ ...geometry, slitSeparationM: 70e-6, wavelengthM: 420e-9 });
    const longWavelength = firstFringeSpacing({ ...geometry, slitSeparationM: 70e-6, wavelengthM: 680e-9 });
    assert.ok(longWavelength > shortWavelength * 1.5);
});

test('seeded Monte Carlo detections converge quantitatively to analytical probabilities', () => {
    const distribution = createDoubleSlitDistribution({ ...geometry, binCount: 401 });
    const sampleCount = 250_000;
    const samples = sampleDetections(distribution, sampleCount, createSeededRandom('phase-2-convergence'));
    const counts = new Uint32Array(distribution.probabilities.length);
    samples.forEach(index => { counts[index] += 1; });
    const squaredError = distribution.probabilities.reduce((sum, probability, index) => {
        const observed = counts[index] / sampleCount;
        return sum + (observed - probability) ** 2;
    }, 0);
    const rmse = Math.sqrt(squaredError / distribution.probabilities.length);
    assert.ok(rmse < 0.00015, `Monte Carlo RMSE ${rmse} exceeded 0.00015`);
});

test('fringe locations are derived from geometry rather than stored in rendering code', () => {
    const source = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fringePositions|fringeLocations|hard.?coded.?fringe/i);

    const arbitrary = { ...geometry, slitSeparationM: 53e-6, wavelengthM: 613e-9 };
    const measured = firstFringeSpacing(arbitrary);
    const paraxialPrediction = arbitrary.wavelengthM * arbitrary.screenDistanceM / arbitrary.slitSeparationM;
    assert.ok(Math.abs(measured - paraxialPrediction) / paraxialPrediction < 0.04);
});

test('Phase 2 page exposes live geometry controls and complex-amplitude explanation', () => {
    const page = readFileSync(new URL('../frontend/quantum-playground.html', import.meta.url), 'utf8');
    assert.match(page, /data-experiment="double-slit"[^>]*>[\s\S]*?<span>Live<\/span>/);
    for (const id of ['quantum-slit-width', 'quantum-slit-separation', 'quantum-wavelength', 'quantum-screen-distance']) {
        assert.match(page, new RegExp(`id="${id}"`));
    }
    const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
    assert.match(controller, /createDoubleSlitDistribution/);
    assert.match(controller, /complex Fraunhofer amplitude/);
    assert.match(controller, /state\.distribution/);
});
