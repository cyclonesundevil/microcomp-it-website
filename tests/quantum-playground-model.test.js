'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const modelUrl = pathToFileURL(
    path.join(frontend, 'quantum-playground-model.mjs')
).href;

test('single-particle probability is normalized, non-negative, and symmetric', async () => {
    const { createSingleParticleDistribution } = await import(modelUrl);
    const distribution = createSingleParticleDistribution({ binCount: 201, center: 0, sigma: 0.24 });
    const sum = [...distribution.probabilities].reduce((total, value) => total + value, 0);

    assert.ok(Math.abs(sum - 1) < 1e-12);
    assert.ok([...distribution.probabilities].every(value => value >= 0));
    assert.equal(distribution.cumulative.at(-1), 1);
    for (let index = 0; index < distribution.probabilities.length; index += 1) {
        const opposite = distribution.probabilities.length - 1 - index;
        assert.ok(Math.abs(
            distribution.probabilities[index] - distribution.probabilities[opposite]
        ) < 1e-14);
    }
});

test('seeded detection samples are reproducible', async () => {
    const {
        createSeededRandom,
        createSingleParticleDistribution,
        sampleDetections
    } = await import(modelUrl);
    const distribution = createSingleParticleDistribution();
    const first = sampleDetections(distribution, 250, createSeededRandom('repeatable-seed'));
    const second = sampleDetections(distribution, 250, createSeededRandom('repeatable-seed'));
    const different = sampleDetections(distribution, 250, createSeededRandom('different-seed'));

    assert.deepEqual([...first], [...second]);
    assert.notDeepEqual([...first], [...different]);
});

test('large seeded sample converges toward the theoretical Gaussian moments', async () => {
    const {
        createSeededRandom,
        createSingleParticleDistribution,
        detectionMoments,
        sampleDetections
    } = await import(modelUrl);
    const distribution = createSingleParticleDistribution({ binCount: 241, center: 0.12, sigma: 0.22 });
    const detections = sampleDetections(distribution, 100000, createSeededRandom('convergence'));
    const counts = new Uint32Array(distribution.positions.length);
    for (const binIndex of detections) counts[binIndex] += 1;
    const moments = detectionMoments(distribution, counts);

    assert.equal(moments.count, 100000);
    assert.ok(Math.abs(moments.mean - 0.12) < 0.006, `mean was ${moments.mean}`);
    assert.ok(Math.abs(moments.standardDeviation - 0.22) < 0.006, `spread was ${moments.standardDeviation}`);
});

test('physics utilities reject invalid probability inputs', async () => {
    const {
        createSingleParticleDistribution,
        normalizeWeights,
        sampleDetections
    } = await import(modelUrl);

    assert.throws(() => createSingleParticleDistribution({ sigma: 0 }), /greater than 0/);
    assert.throws(() => createSingleParticleDistribution({ binCount: 2 }), /at least 3/);
    assert.throws(() => createSingleParticleDistribution({ center: 2 }), /inside the detector domain/);
    assert.throws(() => normalizeWeights([0, 0]), /positive mass/);
    assert.throws(() => normalizeWeights([1, -1]), /non-negative/);
    assert.throws(
        () => sampleDetections(createSingleParticleDistribution(), 0),
        /positive integer/
    );
});

test('Phase 1 page exposes the required shell, controls, and physics caveat', () => {
    const page = fs.readFileSync(path.join(frontend, 'quantum-playground.html'), 'utf8');
    const controller = fs.readFileSync(path.join(frontend, 'quantum-playground.js'), 'utf8');
    const model = fs.readFileSync(path.join(frontend, 'quantum-playground-model.mjs'), 'utf8');

    assert.match(page, /Quantum Playground — Break Reality/);
    assert.match(page, /data-experiment="single"/);
    assert.match(page, /data-experiment="double-slit"/);
    assert.match(page, /data-experiment="which-path"/);
    assert.match(page, /data-experiment="decoherence"/);
    assert.match(page, /data-experiment="quantum-eraser"/);
    assert.match(page, /data-experiment="entanglement"/);
    assert.match(page, /data-experiment="bell-test"/);
    assert.match(page, /data-experiment="build-reality"/);
    assert.match(page, /id="quantum-emit-one"/);
    assert.match(page, /id="quantum-emit-batch"/);
    assert.match(page, /id="quantum-run-toggle"/);
    assert.match(page, /id="quantum-reset"/);
    assert.match(page, /id="quantum-fixed-seed"/);
    assert.match(page, /aria-live="polite"/);
    assert.match(page, /not an observed quantum trajectory/i);
    assert.doesNotMatch(page, /particle literally splits|changing the past/i);
    assert.match(model, /this\.counts\.fill\(0\)/);
    assert.match(model, /this\.recent\.length = 0/);
    assert.match(controller, /createSeededRandom/);
    assert.match(model, /Uint32Array/);
});
