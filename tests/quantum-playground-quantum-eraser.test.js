import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    QuantumEraserExperiment,
    createQuantumEraserDistribution,
    createSeededRandom,
    createWhichPathDistribution,
    sampleQuantumEraserEvents
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

function rmse(observed, expected) {
    const squared = expected.reduce((sum, value, index) => sum + (observed[index] - value) ** 2, 0);
    return Math.sqrt(squared / expected.length);
}

test('orthogonal path markers give the non-interfering marginal detector distribution', () => {
    const eraser = createQuantumEraserDistribution(geometry);
    const whichPathOn = createWhichPathDistribution({ ...geometry, detectorEnabled: true });
    assertArraysClose(eraser.marginalDistribution.probabilities, whichPathOn.probabilities);
});

test('plus and minus joint channels contain opposite coherent cross terms', () => {
    const distribution = createQuantumEraserDistribution(geometry);
    for (let index = 0; index < geometry.binCount; index += 1) {
        assert.ok(Math.abs(4 * distribution.plusWeights[index] -
            (distribution.incoherentIntensities[index] + distribution.crossTerms[index])) < 1e-13);
        assert.ok(Math.abs(4 * distribution.minusWeights[index] -
            (distribution.incoherentIntensities[index] - distribution.crossTerms[index])) < 1e-13);
    }
});

test('conditioned plus and minus patterns are complementary', () => {
    const distribution = createQuantumEraserDistribution(geometry);
    const center = Math.floor(geometry.binCount / 2);
    assert.ok(distribution.plusConditionalDistribution.probabilities[center] >
        1000 * distribution.minusConditionalDistribution.probabilities[center]);

    const firstMinusPeak = distribution.crossTerms.findIndex((value, index) => index > center && value < -1.5);
    assert.ok(firstMinusPeak > center);
    assert.ok(distribution.minusConditionalDistribution.probabilities[firstMinusPeak] >
        distribution.plusConditionalDistribution.probabilities[firstMinusPeak]);
});

test('joint branch sum reconstructs the incoherent marginal bin by bin', () => {
    const distribution = createQuantumEraserDistribution(geometry);
    for (let index = 0; index < geometry.binCount; index += 1) {
        const reconstructed = distribution.plusJointProbabilities[index] + distribution.minusJointProbabilities[index];
        assert.ok(Math.abs(reconstructed - distribution.marginalDistribution.probabilities[index]) < 1e-15);
    }
});

test('joint probabilities are globally normalized and non-negative', () => {
    const distribution = createQuantumEraserDistribution(geometry);
    const total = distribution.jointProbabilities.reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-12);
    assert.ok(distribution.jointProbabilities.every(value => value >= 0));
    assert.ok(Math.abs(distribution.markerMarginals.plus + distribution.markerMarginals.minus - 1) < 1e-14);
});

test('symmetric setup gives the expected approximately equal marker marginals', () => {
    const { markerMarginals } = createQuantumEraserDistribution(geometry);
    assert.ok(Math.abs(markerMarginals.plus - 0.5) < 0.001);
    assert.ok(Math.abs(markerMarginals.minus - 0.5) < 0.001);
});

test('seeded joint sampling is reproducible and chooses x and marker jointly', () => {
    const distribution = createQuantumEraserDistribution(geometry);
    const first = sampleQuantumEraserEvents(distribution, 5000, createSeededRandom('phase-5-joint'));
    const second = sampleQuantumEraserEvents(distribution, 5000, createSeededRandom('phase-5-joint'));
    assert.deepEqual(first, second);
    assert.ok(first.some(event => event.outcome === 'plus'));
    assert.ok(first.some(event => event.outcome === 'minus'));

    const source = readFileSync(new URL('../frontend/quantum-playground-model.mjs', import.meta.url), 'utf8');
    const jointSampler = source.match(/export function sampleQuantumEraserEvents[\s\S]*?\n}\n/)?.[0] || '';
    assert.match(jointSampler, /jointCumulative/);
    assert.doesNotMatch(jointSampler, /sampleDistribution|sampleDetections/);
});

test('sampled conditional and recombined histograms converge to calculated distributions', () => {
    const distribution = createQuantumEraserDistribution(geometry);
    const events = sampleQuantumEraserEvents(distribution, 300_000, createSeededRandom('phase-5-convergence'));
    const plus = new Uint32Array(geometry.binCount);
    const minus = new Uint32Array(geometry.binCount);
    const all = new Uint32Array(geometry.binCount);
    let plusTotal = 0;
    let minusTotal = 0;
    for (const event of events) {
        all[event.binIndex] += 1;
        if (event.outcome === 'plus') {
            plus[event.binIndex] += 1;
            plusTotal += 1;
        } else {
            minus[event.binIndex] += 1;
            minusTotal += 1;
        }
    }
    const plusObserved = Float64Array.from(plus, value => value / plusTotal);
    const minusObserved = Float64Array.from(minus, value => value / minusTotal);
    const allObserved = Float64Array.from(all, value => value / events.length);
    assert.ok(rmse(plusObserved, distribution.plusConditionalDistribution.probabilities) < 0.00016);
    assert.ok(rmse(minusObserved, distribution.minusConditionalDistribution.probabilities) < 0.00016);
    assert.ok(rmse(allObserved, distribution.marginalDistribution.probabilities) < 0.00013);
});

test('incompatible distribution changes clear all joint accumulated data', () => {
    const experiment = new QuantumEraserExperiment(createQuantumEraserDistribution(geometry), 'phase-5-state');
    experiment.emit(1000);
    assert.equal(experiment.ensembleTotal, 1000);
    experiment.setDistribution(createQuantumEraserDistribution({ ...geometry, wavelengthM: 600e-9 }));
    assert.equal(experiment.ensembleTotal, 0);
    assert.equal(experiment.recentEvents.length, 0);
    assert.ok(experiment.allCounts.every(value => value === 0));
    assert.ok(experiment.plusCounts.every(value => value === 0));
    assert.ok(experiment.minusCounts.every(value => value === 0));
});

test('view switching sorts one compatible joint ensemble without fabricating branch weight', () => {
    const experiment = new QuantumEraserExperiment(createQuantumEraserDistribution(geometry), 'phase-5-view');
    experiment.emit(2000);
    const ensembleTotal = experiment.ensembleTotal;
    experiment.setView('plus');
    const plusTotal = experiment.total;
    experiment.setView('minus');
    const minusTotal = experiment.total;
    assert.equal(experiment.ensembleTotal, ensembleTotal);
    assert.equal(plusTotal + minusTotal, ensembleTotal);
    assert.ok(plusTotal < ensembleTotal && minusTotal < ensembleTotal);
});

test('Phase 5 UI and renderer contain no hard-coded fringes or retrocausal claims', () => {
    const page = readFileSync(new URL('../frontend/quantum-playground.html', import.meta.url), 'utf8');
    const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
    assert.match(page, /data-experiment="quantum-eraser"[^>]*>[\s\S]*?<span>Live<\/span>/);
    assert.match(page, /data-eraser-view="all"/);
    assert.match(page, /data-eraser-view="plus"/);
    assert.match(page, /data-eraser-view="minus"/);
    assert.match(controller, /does not change the past/);
    assert.match(controller, /no information travels backward in time/);
    assert.match(controller, /no faster-than-light signaling occurs/);
    assert.match(controller, /does not physically delete a previously recorded classical fact/);
    assert.match(controller, /All detector events remain non-interfering/);
    assert.doesNotMatch(controller, /fringePositions|fringeLocations|storedFringes/i);
    assert.doesNotMatch(controller, /delayed.?choice/i);
});
