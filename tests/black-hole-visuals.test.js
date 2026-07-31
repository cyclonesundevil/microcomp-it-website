'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const frontend = path.resolve(__dirname, '..', 'frontend');
const visualsPath = path.join(frontend, 'black-hole-visuals.mjs');
const controller = fs.readFileSync(
    path.join(frontend, 'black-hole-playground.js'),
    'utf8'
);
const page = fs.readFileSync(
    path.join(frontend, 'black-hole-playground.html'),
    'utf8'
);

test('seeded visual randomness is deterministic and bounded', async () => {
    const { createSeededRandom } = await import(pathToFileURL(visualsPath).href);
    const first = createSeededRandom(1234);
    const second = createSeededRandom(1234);
    const firstSequence = Array.from({ length: 12 }, first);
    const secondSequence = Array.from({ length: 12 }, second);

    assert.deepEqual(firstSequence, secondSequence);
    firstSequence.forEach(value => {
        assert.ok(value >= 0 && value < 1);
    });
    assert.ok(new Set(firstSequence).size > 1);
});

test('mode contract separates observable appearances from conceptual diagrams', async () => {
    const { BLACK_HOLE_MODES } = await import(
        pathToFileURL(visualsPath).href
    );
    assert.deepEqual(Object.keys(BLACK_HOLE_MODES), [
        'disk',
        'lensing',
        'wave',
        'well'
    ]);
    assert.equal(BLACK_HOLE_MODES.disk.category, 'Observable appearance');
    assert.equal(BLACK_HOLE_MODES.lensing.category, 'Observable appearance');
    assert.equal(BLACK_HOLE_MODES.wave.category, 'Conceptual diagram');
    assert.equal(BLACK_HOLE_MODES.well.category, 'Conceptual diagram');
    assert.equal(BLACK_HOLE_MODES.disk.rotatable, true);
    assert.equal(BLACK_HOLE_MODES.lensing.rotatable, false);
    assert.equal(BLACK_HOLE_MODES.wave.rotatable, false);
    assert.equal(BLACK_HOLE_MODES.well.rotatable, true);
    Object.values(BLACK_HOLE_MODES).forEach(mode => {
        assert.ok(mode.description);
        assert.ok(mode.interaction);
        assert.ok(mode.sceneLabel);
        assert.equal(mode.legend.length, 4);
    });
});

test('procedural disk shader exposes continuous radial flow, temperature, and beaming controls', async () => {
    const visuals = await import(pathToFileURL(visualsPath).href);
    const shader = visuals.ACCRETION_DISK_FRAGMENT_SHADER;

    assert.match(shader, /uniform float uTime/);
    assert.match(shader, /uniform float uSpin/);
    assert.match(shader, /uniform float uInclination/);
    assert.match(shader, /uniform float uDoppler/);
    assert.match(shader, /uniform float uBeamingAngle/);
    assert.match(shader, /textureFlow/);
    assert.match(shader, /float shear/);
    assert.match(shader, /narrowStreaks/);
    assert.match(shader, /radialHeat/);
    assert.match(shader, /whiteHot/);
    assert.match(shader, /approaching/);
});

test('lensing shader remaps the deterministic stellar backdrop', async () => {
    const visuals = await import(pathToFileURL(visualsPath).href);
    const shader = visuals.LENSING_FRAGMENT_SHADER;

    assert.match(shader, /uniform sampler2D uBackdrop/);
    assert.match(shader, /uniform float uStrength/);
    assert.match(shader, /einsteinRadius/);
    assert.match(shader, /mappedRadius/);
    assert.match(shader, /texture2D\(uBackdrop, sampleUv\)/);
});

test('controller uses restrained deterministic rendering rather than flat neon disk halves', () => {
    assert.match(controller, /ACCRETION_DISK_FRAGMENT_SHADER/);
    assert.match(controller, /ACESFilmicToneMapping/);
    assert.match(controller, /new THREE\.ShaderMaterial/);
    assert.match(controller, /createSeededRandom/);
    assert.doesNotMatch(controller, /Math\.random/);
    assert.doesNotMatch(controller, /makeDiskHalf/);
    assert.doesNotMatch(controller, /hotDisk|redDisk/);
    assert.doesNotMatch(controller, /0xff6fff|0xff7cff|0xff8aff/);
    assert.match(controller, /new THREE\.CubicBezierCurve3/);
    assert.match(controller, /diskGroup\.rotation\.x = Math\.PI \/ 2/);
    assert.match(controller, /positionCameraForObserverAngle/);
    assert.match(controller, /controls\.getPolarAngle\(\)/);
    assert.match(controller, /controls\.getAzimuthalAngle\(\)/);
    assert.match(controller, /inputs\.angle\.value = String\(angle\)/);
    assert.match(controller, /uBeamingAngle\.value/);
    assert.match(controller, /photonRing\.quaternion\.copy\(camera\.quaternion\)/);
    assert.match(controller, /controls\.enabled = config\.rotatable/);
    assert.match(controller, /inputs\.angle\.disabled = !config\.rotatable/);
    assert.match(controller, /button\.setAttribute\('aria-pressed'/);
    assert.match(controller, /container\.setAttribute\('aria-label'/);
    assert.match(controller, /renderModeLegend\(config\.legend\)/);
    assert.doesNotMatch(controller, /diskGroup\.rotation\.z \+=/);
});

test('page legend distinguishes illustrative paths from calculated readouts', () => {
    assert.match(page, /Doppler-brightened side/);
    assert.match(page, /receding, dimmer side/);
    assert.match(page, /lensed disk image/);
    assert.match(page, /not a real-time ray trace/);
    assert.match(page, /Observable appearance/);
    assert.match(page, /Conceptual diagrams/);
    assert.match(page, /id="bh-mode-description"/);
    assert.match(page, /id="bh-mode-interaction"/);
    assert.match(page, /id="bh-reset-view"/);
    assert.match(page, /drag vertically/);
    assert.match(page, /horizontal dragging changes azimuth/);
    assert.match(page, /black-hole-playground\.js\?v=1\.7/);
});
