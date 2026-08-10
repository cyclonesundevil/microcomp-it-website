'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'frontend', 'binary-black-hole-physics.mjs')).href;
const page = require('node:fs').readFileSync(path.resolve(__dirname, '..', 'frontend', 'black-hole-playground.html'), 'utf8');
const controller = require('node:fs').readFileSync(path.resolve(__dirname, '..', 'frontend', 'black-hole-playground.js'), 'utf8');
const renderer = require('node:fs').readFileSync(path.resolve(__dirname, '..', 'frontend', 'binary-black-hole-renderer.mjs'), 'utf8');
const styles = require('node:fs').readFileSync(path.resolve(__dirname, '..', 'frontend', 'styles.css'), 'utf8');

test('binary mass combinations produce physical invariant parameters', async () => {
    const { binaryMassParameters } = await import(moduleUrl);
    for (const [m1, m2] of [[30, 30], [36, 29], [10, 10], [50, 10]]) {
        const p = binaryMassParameters(m1, m2);
        assert.equal(p.totalSolar, m1 + m2);
        assert.ok(p.q > 0 && p.q <= 1);
        assert.ok(p.eta > 0 && p.eta <= 0.25);
        assert.ok(p.chirpSolar > 0 && p.chirpSolar < p.totalSolar);
        assert.ok(p.gravitationalRadiusM > 0);
    }
});

test('default binary begins at the requested eighty-percent evolution point', async () => {
    const { BinaryBlackHolePhysics } = await import(moduleUrl);
    const snapshot = new BinaryBlackHolePhysics().snapshot();
    assert.ok(Math.abs(snapshot.evolutionProgress - 0.8) < 0.001);
    assert.ok(Math.abs(snapshot.separationRg - 15.9) < 1e-10);
});

test('adjustable progress reconstructs physics-connected inspiral, merger, and ringdown states', async () => {
    const { BinaryBlackHolePhysics } = await import(moduleUrl);
    const model = new BinaryBlackHolePhysics();
    const checkpoints = [
        [0, 'INSPIRAL'],
        [0.8, 'INSPIRAL'],
        [0.82, 'LATE INSPIRAL'],
        [0.9, 'MERGER'],
        [0.94, 'RINGDOWN'],
        [0.97, 'RINGDOWN'],
        [1, 'FINAL KERR BLACK HOLE']
    ];
    let previousFrequency = 0;
    for (const [progress, regime] of checkpoints) {
        const snapshot = model.seekEvolutionProgress(progress);
        assert.ok(Math.abs(snapshot.evolutionProgress - progress) < 1e-10);
        assert.equal(snapshot.regime, regime);
        assert.ok(snapshot.gwFrequencyHz >= previousFrequency);
        assert.ok(Number.isFinite(snapshot.hPlus) && Number.isFinite(snapshot.hCross));
        previousFrequency = snapshot.gwFrequencyHz;
    }
    const rewound = model.seekEvolutionProgress(0.25);
    assert.equal(rewound.regime, 'INSPIRAL');
    assert.ok(rewound.separationRg > 30);
    assert.equal(rewound.finished, false);
});

test('quasi-circular inspiral is monotonic and keeps fGW equal to twice fOrbit', async () => {
    const { BinaryBlackHolePhysics } = await import(moduleUrl);
    for (const [m1, m2] of [[30, 30], [36, 29], [10, 10], [50, 10]]) {
        const model = new BinaryBlackHolePhysics({ m1Solar: m1, m2Solar: m2, initialSeparationRg: 50 });
        let previous = model.snapshot();
        assert.equal(previous.evolutionProgress, 0);
        for (let index = 0; index < 120; index += 1) {
            const next = model.advance(Math.max(1e-5, previous.timeToMergerS / 2000));
            assert.ok(next.separationM <= previous.separationM + 1e-6);
            assert.ok(next.gwFrequencyHz >= previous.gwFrequencyHz * (1 - 1e-10));
            assert.ok(next.powerW >= previous.powerW * (1 - 1e-8));
            assert.ok(next.cumulativeEnergyJ >= previous.cumulativeEnergyJ);
            assert.ok(next.evolutionProgress >= previous.evolutionProgress);
            assert.ok(Math.abs(next.gwFrequencyHz / next.orbitFrequencyHz - 2) < 1e-12);
            const comX = m1 * next.body1PositionM[0] + m2 * next.body2PositionM[0];
            const comY = m1 * next.body1PositionM[1] + m2 * next.body2PositionM[1];
            assert.ok(Math.abs(comX) < 1e-5 && Math.abs(comY) < 1e-5);
            assert.ok(Number.isFinite(next.hPlus) && Number.isFinite(next.hCross));
            previous = next;
        }
    }
});

test('full evolution reaches a lower-mass spinning Kerr remnant and stable ringdown', async () => {
    const { BinaryBlackHolePhysics } = await import(moduleUrl);
    const model = new BinaryBlackHolePhysics({ initialSeparationRg: 18 });
    const regimes = new Set([model.snapshot().regime]);
    let snapshot = model.snapshot();
    let previousProgress = snapshot.evolutionProgress;
    for (let index = 0; index < 3000 && !snapshot.finished; index += 1) {
        snapshot = model.advance(0.02);
        regimes.add(snapshot.regime);
        assert.ok(Number.isFinite(snapshot.gwFrequencyHz));
        assert.ok(Number.isFinite(snapshot.cumulativeEnergyJ));
        assert.ok(snapshot.evolutionProgress >= previousProgress);
        previousProgress = snapshot.evolutionProgress;
    }
    assert.equal(snapshot.regime, 'FINAL KERR BLACK HOLE');
    assert.ok(regimes.has('LATE INSPIRAL'));
    assert.ok(regimes.has('MERGER'));
    assert.ok(regimes.has('RINGDOWN'));
    assert.ok(snapshot.remnant.finalMassSolar < snapshot.masses.totalSolar);
    assert.ok(snapshot.remnant.finalSpin > 0 && snapshot.remnant.finalSpin < 1);
    assert.ok(snapshot.ringdown.frequencyHz > 0);
    assert.ok(snapshot.ringdown.dampingTimeS > 0);
    assert.equal(snapshot.evolutionProgress, 1);
});

test('inclination changes polarization without changing binary dynamics', async () => {
    const { BinaryBlackHolePhysics } = await import(moduleUrl);
    const face = new BinaryBlackHolePhysics({ inclinationDegrees: 0 }).snapshot();
    const edge = new BinaryBlackHolePhysics({ inclinationDegrees: 90 }).snapshot();
    assert.equal(face.gwFrequencyHz, edge.gwFrequencyHz);
    assert.ok(Math.abs(face.hCross) >= Math.abs(edge.hCross));
    assert.ok(Math.abs(edge.hCross) < 1e-30);
});

test('binary merger mode connects controls, telemetry, physics disclosure, and waveform', () => {
    for (const id of [
        'binary-m1', 'binary-m2', 'binary-separation', 'binary-inclination',
        'binary-speed', 'binary-amplification', 'binary-camera', 'binary-restart',
        'binary-step', 'binary-regime', 'binary-waveform', 'binary-frequency',
        'binary-power', 'binary-energy', 'binary-time-left', 'binary-progress',
        'binary-progress-value', 'binary-progress-detail'
    ]) assert.match(page, new RegExp(`id="${id}"`));
    assert.match(page, /Spacetime deformation visually amplified/);
    assert.match(page, /It is not numerical relativity/);
    assert.match(page, /quadrupole energy loss/);
    assert.match(controller, /binaryPhysics\.advance\(physicalDelta, recordBinarySample\)/);
    assert.match(controller, /playbackSpeeds/);
    assert.match(controller, /\[0\.05, 0\.1, 0\.25, 0\.5, 1, 2, 4\]/);
    assert.match(controller, /maxVisualPhaseAdvance \/ phaseRate/);
    assert.match(page, /Default playback is quarter-speed/);
    assert.match(page, /id="binary-separation"[^>]*value="15\.9"/);
    assert.match(page, /id="binary-progress-value">80\.0%/);
    assert.match(page, /id="binary-progress" type="range"/);
    assert.match(controller, /seekEvolutionProgress\(Number\(binaryProgressBar\.value\) \/ 100\)/);
    assert.match(controller, /drawBinaryWaveform/);
    assert.match(renderer, /Physical propagation is c\*age/);
    assert.match(renderer, /square-root compressed/);
    assert.match(renderer, /GRID_VERTEX_SHADER/);
    assert.match(renderer, /cos\(2\.0 \* \(angle - uPhase\)\)/);
    assert.match(renderer, /mergerFlash/);
    assert.match(renderer, /ringDistortion/);
    assert.match(controller, /updateBinaryCinematicCamera/);
    assert.match(page, /Cinematic evolution/);
    assert.match(page, /82 Plunge/);
    assert.match(styles, /\.black-hole-single-controls\[hidden\]/);
});
