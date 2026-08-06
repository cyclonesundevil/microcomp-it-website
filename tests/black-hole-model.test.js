'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const modelUrl = pathToFileURL(
    path.join(frontend, 'black-hole-model.mjs')
).href;

test('Kerr reference limits reproduce the Schwarzschild horizon and ISCO', async () => {
    const model = await import(modelUrl);
    assert.equal(model.kerrHorizonRadiusRg(0), 2);
    assert.equal(model.progradeIscoRadiusRg(0), 6);

    const result = model.computeBlackHoleModel({
        massSolar: 10,
        spin: 0,
        observerAngleDegrees: 0
    });
    assert.ok(Math.abs(result.horizonDiameterKm - 59.06500154) < 1e-8);
    assert.ok(Math.abs(result.orbitClockRatio - Math.sqrt(2)) < 1e-12);
    assert.equal(result.dopplerBrightnessContrast, 1);
});

test('mass scales physical lengths without changing dimensionless strong-field results', async () => {
    const { computeBlackHoleModel } = await import(modelUrl);
    const small = computeBlackHoleModel({
        massSolar: 10,
        spin: 0.42,
        observerAngleDegrees: 48
    });
    const large = computeBlackHoleModel({
        massSolar: 40,
        spin: 0.42,
        observerAngleDegrees: 48
    });

    assert.ok(Math.abs(large.horizonDiameterKm / small.horizonDiameterKm - 4) < 1e-12);
    assert.equal(large.iscoRadiusRg, small.iscoRadiusRg);
    assert.equal(large.orbitClockRatio, small.orbitClockRatio);
    assert.equal(large.gravitationalRedshift, small.gravitationalRedshift);
});

test('spin contracts the prograde ISCO and viewing angle only changes Doppler contrast', async () => {
    const { computeBlackHoleModel } = await import(modelUrl);
    const slowFaceOn = computeBlackHoleModel({
        massSolar: 32,
        spin: 0,
        observerAngleDegrees: 0
    });
    const fastFaceOn = computeBlackHoleModel({
        massSolar: 32,
        spin: 0.99,
        observerAngleDegrees: 0
    });
    const fastInclined = computeBlackHoleModel({
        massSolar: 32,
        spin: 0.99,
        observerAngleDegrees: 75
    });

    assert.ok(fastFaceOn.iscoRadiusRg < slowFaceOn.iscoRadiusRg);
    assert.equal(fastFaceOn.dopplerBrightnessContrast, 1);
    assert.ok(fastInclined.dopplerBrightnessContrast > 1);
    assert.equal(fastInclined.horizonDiameterKm, fastFaceOn.horizonDiameterKm);
    assert.equal(fastInclined.orbitClockRatio, fastFaceOn.orbitClockRatio);
    assert.equal(fastInclined.gravitationalRedshift, fastFaceOn.gravitationalRedshift);
});

test('observer angles above the disk plane remain valid through 120 degrees', async () => {
    const { computeBlackHoleModel } = await import(modelUrl);
    const above = computeBlackHoleModel({
        massSolar: 32,
        spin: 0.42,
        observerAngleDegrees: 60
    });
    const below = computeBlackHoleModel({
        massSolar: 32,
        spin: 0.42,
        observerAngleDegrees: 120
    });

    assert.equal(below.observerAngleDegrees, 120);
    assert.ok(Math.abs(
        above.dopplerBrightnessContrast - below.dopplerBrightnessContrast
    ) < 1e-10);
});

test('calculator rejects nonphysical inputs', async () => {
    const { computeBlackHoleModel } = await import(modelUrl);
    const valid = {
        massSolar: 32,
        spin: 0.42,
        observerAngleDegrees: 48
    };
    assert.throws(
        () => computeBlackHoleModel({ ...valid, massSolar: 0 }),
        /greater than 0/
    );
    assert.throws(
        () => computeBlackHoleModel({ ...valid, spin: 1 }),
        /less than 1/
    );
    assert.throws(
        () => computeBlackHoleModel({ ...valid, observerAngleDegrees: 121 }),
        /from 0 to 120/
    );
});

test('playground labels the approximation and no longer displays invented lensing strength', () => {
    const page = fs.readFileSync(
        path.join(frontend, 'black-hole-playground.html'),
        'utf8'
    );
    const controller = fs.readFileSync(
        path.join(frontend, 'black-hole-playground.js'),
        'utf8'
    );

    assert.match(page, /general-relativistic Kerr equations/i);
    assert.match(page, /not a real-time ray trace/i);
    assert.match(page, /Horizon diameter/);
    assert.match(page, /Prograde ISCO/);
    assert.match(page, /ISCO clock ratio/);
    assert.match(page, /Disk brightness contrast/);
    assert.doesNotMatch(page, /Lensing strength/);
    assert.match(controller, /from '\.\/black-hole-model\.mjs'/);
    assert.doesNotMatch(controller, /massScale \* 2\.8/);
});
