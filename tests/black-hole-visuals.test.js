'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
const localThree = path.join(
    frontend,
    'vendor',
    'three',
    'three.module.js'
);
const localOrbitControls = path.join(
    frontend,
    'vendor',
    'three',
    'addons',
    'controls',
    'OrbitControls.js'
);
const localThreeLicense = path.join(frontend, 'vendor', 'three', 'LICENSE');

function sha256(file) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex')
        .toUpperCase();
}

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

test('render profiles bound pixel density and motion by viewport capability', async () => {
    const { getBlackHoleRenderProfile } = await import(
        pathToFileURL(visualsPath).href
    );

    assert.deepEqual(
        getBlackHoleRenderProfile({
            width: 480,
            devicePixelRatio: 3,
            reducedMotion: false
        }),
        {
            compact: true,
            pixelRatio: 1.25,
            maximumFramesPerSecond: 30
        }
    );
    assert.deepEqual(
        getBlackHoleRenderProfile({
            width: 1280,
            devicePixelRatio: 2,
            reducedMotion: false
        }),
        {
            compact: false,
            pixelRatio: 1.75,
            maximumFramesPerSecond: 60
        }
    );
    assert.deepEqual(
        getBlackHoleRenderProfile({
            width: 1280,
            devicePixelRatio: 3,
            reducedMotion: true
        }),
        {
            compact: false,
            pixelRatio: 1,
            maximumFramesPerSecond: 0
        }
    );
});

test('pinned Three.js runtime is served locally with a startup watchdog', () => {
    assert.ok(fs.statSync(localThree).size > 1_000_000);
    assert.ok(fs.statSync(localOrbitControls).size > 20_000);
    assert.equal(
        sha256(localThree),
        '5916C8DFB5F4E3EEDE312DE305345868D4A0A8105383B080C6985565D6E79B46'
    );
    assert.equal(
        sha256(localOrbitControls),
        'F260591EF315AA04888152E7F121865214E33FB54727145CF4E4445058DB1297'
    );
    assert.match(fs.readFileSync(localThreeLicense, 'utf8'), /MIT License/);
    assert.match(page, /"three": "\.\/vendor\/three\/three\.module\.js"/);
    assert.match(page, /"three\/addons\/": "\.\/vendor\/three\/addons\/"/);
    assert.doesNotMatch(page, /unpkg\.com\/three/);
    assert.match(page, /window\.__blackHoleReady = false/);
    assert.match(page, /window\.__blackHoleStartupError/);
    assert.match(page, /id="bh-runtime-indicator"/);
    assert.match(page, /id="bh-retry-renderer"/);
    assert.match(page, /id="bh-error-details"/);
    assert.match(page, /id="bh-error-message"/);
    assert.match(page, /window\.location\.reload\(\)/);
    assert.match(page, /local 3D renderer did not finish starting/);
    assert.match(controller, /window\.__blackHoleReady = true/);
    assert.match(controller, /dataset\.renderStatus = 'ready'/);
    assert.match(controller, /black-hole-visuals\.mjs\?v=2\.0/);
    assert.match(controller, /URLSearchParams\(window\.location\.search\)/);
    assert.match(controller, /storeModeInUrl/);
    assert.match(controller, /window\.history\.replaceState/);
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
    assert.equal(BLACK_HOLE_MODES.wave.rotatable, true);
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
    assert.doesNotMatch(controller, /waveGroup\.quaternion\.copy\(camera\.quaternion\)/);
    assert.match(controller, /controls\.enabled = config\.rotatable/);
    assert.match(controller, /inputs\.angle\.disabled = !config\.rotatable/);
    assert.match(controller, /button\.setAttribute\('aria-pressed'/);
    assert.match(controller, /container\.setAttribute\('aria-label'/);
    assert.match(controller, /renderModeLegend\(config\.legend\)/);
    assert.match(controller, /getBlackHoleRenderProfile/);
    assert.match(controller, /prefers-reduced-motion: reduce/);
    assert.match(controller, /document\.addEventListener\('visibilitychange'/);
    assert.match(controller, /webglcontextlost/);
    assert.match(controller, /webglcontextrestored/);
    assert.match(controller, /ResizeObserver/);
    assert.match(controller, /requestAnimationFrame\(\(\) => \{\s*resize\(\)/);
    assert.match(controller, /container\.addEventListener\('keydown'/);
    assert.match(controller, /cancelAnimationFrame/);
    assert.match(controller, /preserveDrawingBuffer: true/);
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
    assert.match(page, /id="bh-animation-toggle"/);
    assert.match(page, /id="bh-webgl-fallback"/);
    assert.match(page, /id="bh-render-status"/);
    assert.match(page, /aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"/);
    assert.match(page, /drag vertically/);
    assert.match(page, /horizontal dragging changes azimuth/);
    assert.match(page, /styles\.css\?v=2\.7/);
    assert.match(page, /black-hole-playground\.js\?v=2\.4/);
});
