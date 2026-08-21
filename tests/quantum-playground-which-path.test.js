import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    binaryWhichPathMarkers,
    createDoubleSlitDistribution,
    DetectionExperiment,
    createSeededRandom,
    createSingleSlitFraunhoferDistribution,
    createWhichPathDistribution,
    pathMarkerOverlap,
    sampleDetections
} from '../frontend/quantum-playground-model.mjs';

const geometry = {
    slitWidthM: 12e-6,
    slitSeparationM: 40e-6,
    wavelengthM: 550e-9,
    screenDistanceM: 1,
    detectorHalfWidthM: 0.05,
    binCount: 401
};

function assertArraysClose(actual, expected, tolerance = 1e-14) {
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < actual.length; index += 1) {
        assert.ok(Math.abs(actual[index] - expected[index]) < tolerance, `bin ${index} differed`);
    }
}

test('detector OFF reproduces the Phase 2 coherent distribution', () => {
    const phase2 = createDoubleSlitDistribution(geometry);
    const detectorOff = createWhichPathDistribution({ ...geometry, detectorEnabled: false });
    assert.deepEqual(detectorOff.markerOverlap, { re: 1, im: 0 });
    assertArraysClose(detectorOff.probabilities, phase2.probabilities);
});

test('detector ON is the incoherent sum of the two slit intensities', () => {
    const detectorOn = createWhichPathDistribution({ ...geometry, detectorEnabled: true });
    assert.deepEqual(detectorOn.markerOverlap, { re: 0, im: 0 });
    assertArraysClose(detectorOn.intensities, detectorOn.incoherentIntensities);
});

test('orthogonal marker states make every interference cross term vanish', () => {
    const markers = binaryWhichPathMarkers(true);
    assert.deepEqual(pathMarkerOverlap(markers.first, markers.second), { re: 0, im: 0 });
    const detectorOn = createWhichPathDistribution({ ...geometry, detectorEnabled: true });
    assert.ok(detectorOn.interferenceTerms.every(value => value === 0));
});

test('which-path detection retains the finite single-slit diffraction envelope', () => {
    const detectorOn = createWhichPathDistribution({ ...geometry, detectorEnabled: true });
    const singleSlit = createSingleSlitFraunhoferDistribution(geometry);
    for (let index = 0; index < detectorOn.intensities.length; index += 1) {
        assert.ok(Math.abs(detectorOn.intensities[index] - 2 * singleSlit.intensities[index]) < 1e-12);
    }
});

test('both binary measurement states remain normalized and non-negative', () => {
    for (const detectorEnabled of [false, true]) {
        const distribution = createWhichPathDistribution({ ...geometry, detectorEnabled });
        const total = distribution.probabilities.reduce((sum, value) => sum + value, 0);
        assert.ok(Math.abs(total - 1) < 1e-12);
        assert.ok(distribution.probabilities.every(value => value >= 0));
    }
});

test('seeded which-path event samples are reproducible and distribution-driven', () => {
    const distribution = createWhichPathDistribution({ ...geometry, detectorEnabled: true });
    const first = sampleDetections(distribution, 5000, createSeededRandom('phase-3-marker'));
    const second = sampleDetections(distribution, 5000, createSeededRandom('phase-3-marker'));
    assert.deepEqual([...first], [...second]);
    assert.ok(new Set(first).size > 40, 'samples should occupy computed detector bins');

    const model = readFileSync(new URL('../frontend/quantum-playground-model.mjs', import.meta.url), 'utf8');
    assert.match(model, /sampleDetections\(this\.distribution/);
    const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
    assert.doesNotMatch(controller, /whichPath.*(?:fringe|pattern).*=/i);
});

test('measurement changes rebuild state so incompatible observations cannot mix', () => {
    const off = createWhichPathDistribution({ ...geometry, detectorEnabled: false });
    const on = createWhichPathDistribution({ ...geometry, detectorEnabled: true });
    const experiment = new DetectionExperiment(off, 'state-isolation');
    experiment.emit(1000);
    assert.equal(experiment.total, 1000);
    experiment.setDistribution(on);
    assert.equal(experiment.total, 0);
    assert.equal(experiment.recent.length, 0);
    assert.ok(experiment.counts.every(count => count === 0));
    assert.equal(experiment.distribution, on);

    const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
    assert.match(controller, /updateWhichPathMeasurement\(\)[\s\S]*rebuildWhichPathDistribution\(\)[\s\S]*this\.reset\(\)/);
});

test('Phase 3 UI is binary and explains marker entanglement without consciousness collapse', () => {
    const page = readFileSync(new URL('../frontend/quantum-playground.html', import.meta.url), 'utf8');
    assert.match(page, /data-experiment="which-path"[^>]*>[\s\S]*?<span>Live<\/span>/);
    assert.match(page, /id="quantum-which-path-detector" type="checkbox"/);
    const whichPathControls = page.match(/id="quantum-which-path-controls"[\s\S]*?<\/div>/)?.[0] || '';
    assert.doesNotMatch(whichPathControls, /type="range"/i);

    const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
    assert.match(controller, /correlated \(entangled\) with a marker or measurement system/);
    assert.match(controller, /Human consciousness is not part of this calculation/);
});
