import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    createDetectionApparatusGeometry,
    createIllustrativeEmissionCoordinates,
    detectorPointForBin,
    schematicSlitMicrometersToPixels
} from '../frontend/quantum-apparatus-geometry.mjs';
import {
    CHSH_MAX_VIOLATION_PRESET,
    createChshConfiguration,
    createDoubleSlitDistribution,
    createPolarizationSingletDistribution,
    createSeededRandom,
    createSingleParticleDistribution,
    sampleDetections
} from '../frontend/quantum-playground-model.mjs';

const controllerSource = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../frontend/quantum-playground.html', import.meta.url), 'utf8');
const close = (actual, expected, tolerance = 1e-10) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);

function geometry(overrides = {}) {
    return createDetectionApparatusGeometry({
        viewportWidth: 900,
        viewportHeight: 520,
        slitWidthMicrometers: 12,
        slitSeparationMicrometers: 40,
        screenDistanceMeters: 1,
        binCount: 401,
        ...overrides
    });
}

test('emit-one cue starts at the authoritative rendered source coordinate', () => {
    const apparatus = geometry();
    const cue = createIllustrativeEmissionCoordinates(apparatus, 137);
    assert.deepEqual(cue.start, apparatus.source);
    assert.match(controllerSource, /ctx\.arc\(source\.x, source\.y, 10/);
    assert.doesNotMatch(controllerSource, /(?:const|let|var)\s+sourceX|quantum-flight-pulse|animatePulse/);
});

test('cue endpoint maps exactly to the already-sampled detector bin', () => {
    const apparatus = geometry();
    for (const binIndex of [0, 1, 137, 200, 399, 400]) {
        const expected = detectorPointForBin(apparatus, binIndex);
        const cue = createIllustrativeEmissionCoordinates(apparatus, binIndex);
        assert.deepEqual(cue.end, expected);
        assert.equal(cue.end.x, apparatus.detector.x);
        close(cue.end.y, apparatus.detector.top + binIndex / 400 * apparatus.plot.height);
    }
});

test('increasing physical slit separation monotonically increases displayed center separation', () => {
    const separations = [12, 20, 40, 70, 100].map(slitSeparationMicrometers =>
        geometry({ slitSeparationMicrometers }).barrier.apertureCenterSeparationPixels
    );
    separations.slice(1).forEach((value, index) => assert.ok(value > separations[index]));
});

test('increasing physical slit width monotonically increases displayed aperture width', () => {
    const widths = [4, 8, 12, 20, 30].map(slitWidthMicrometers =>
        geometry({ slitWidthMicrometers, slitSeparationMicrometers: 40 }).barrier.apertureWidthPixels
    );
    widths.slice(1).forEach((value, index) => assert.ok(value > widths[index]));
    assert.ok(schematicSlitMicrometersToPixels(30, 520) > schematicSlitMicrometersToPixels(4, 520));
});

test('d equals a produces valid touching, non-overlapping schematic apertures', () => {
    for (const value of [4, 12, 30]) {
        const apparatus = geometry({ slitWidthMicrometers: value, slitSeparationMicrometers: value });
        close(apparatus.barrier.apertureCenterSeparationPixels, apparatus.barrier.apertureWidthPixels);
        close(apparatus.barrier.upper.bottom, apparatus.barrier.lower.top);
        assert.ok(apparatus.barrier.upper.bottom <= apparatus.barrier.lower.top + 1e-10);
    }
    assert.throws(
        () => geometry({ slitWidthMicrometers: 30, slitSeparationMicrometers: 29 }),
        /d >= a/
    );
});

test('valid control changes return fresh apparatus geometry immediately', () => {
    const initial = geometry();
    const changedWidth = geometry({ slitWidthMicrometers: 24 });
    const changedSeparation = geometry({ slitSeparationMicrometers: 80 });
    assert.notEqual(changedWidth, initial);
    assert.ok(changedWidth.barrier.apertureWidthPixels > initial.barrier.apertureWidthPixels);
    assert.ok(changedSeparation.barrier.apertureCenterSeparationPixels > initial.barrier.apertureCenterSeparationPixels);
    assert.match(controllerSource, /updateDoubleSlitGeometry[\s\S]*this\.reset\(\)/);
});

test('responsive resize recomputes source, slit, detector, and bin coordinates consistently', () => {
    const desktop = geometry({ viewportWidth: 900, viewportHeight: 520 });
    const mobile = geometry({ viewportWidth: 360, viewportHeight: 320 });
    close(desktop.source.x / desktop.viewport.width, mobile.source.x / mobile.viewport.width);
    close(desktop.source.y / desktop.viewport.height, mobile.source.y / mobile.viewport.height);
    close(desktop.barrier.x / desktop.viewport.width, mobile.barrier.x / mobile.viewport.width);
    close(desktop.detector.x / desktop.viewport.width, mobile.detector.x / mobile.viewport.width);
    close(detectorPointForBin(desktop, 200).y / desktop.viewport.height, detectorPointForBin(mobile, 200).y / mobile.viewport.height);
    assert.notEqual(desktop.barrier.apertureWidthPixels, mobile.barrier.apertureWidthPixels);
});

test('larger screen distance moves the schematic detector farther from the slits', () => {
    const near = geometry({ screenDistanceMeters: 0.5 });
    const middle = geometry({ screenDistanceMeters: 1 });
    const far = geometry({ screenDistanceMeters: 2 });
    assert.ok(near.detector.x < middle.detector.x && middle.detector.x < far.detector.x);
    assert.ok(near.slitToScreenIndicator.lengthPixels < middle.slitToScreenIndicator.lengthPixels);
    assert.ok(middle.slitToScreenIndicator.lengthPixels < far.slitToScreenIndicator.lengthPixels);
    assert.match(pageSource, /Apparatus geometry is schematic — not to scale/);
});

test('visual correction leaves approved probability and seeded sampling fixtures unchanged', () => {
    const singleBins = [...sampleDetections(
        createSingleParticleDistribution(),
        12,
        createSeededRandom('visual-fixture')
    )];
    const doubleBins = [...sampleDetections(
        createDoubleSlitDistribution(),
        12,
        createSeededRandom('visual-fixture')
    )];
    assert.deepEqual(singleBins, [103, 86, 55, 88, 104, 56, 88, 101, 50, 55, 68, 50]);
    assert.deepEqual(doubleBins, [266, 212, 128, 221, 269, 129, 218, 264, 96, 128, 153, 96]);
    assert.deepEqual(
        [...createPolarizationSingletDistribution({ aliceAngleDeg: 13, bobAngleDeg: 71 }).probabilities],
        [0.3595927866972693, 0.14040721330273068, 0.14040721330273068, 0.3595927866972693]
    );
    assert.equal(
        createChshConfiguration({ model: 'quantum', ...CHSH_MAX_VIOLATION_PRESET }).expectedS,
        -2.8284271247461903
    );
});

test('coherent slit animation uses a symmetric cue and never selects one aperture', () => {
    const cue = createIllustrativeEmissionCoordinates(geometry(), 200, { coherentDoubleSlit: true });
    assert.equal(cue.mode, 'symmetric-aperture-wavefront');
    assert.equal(cue.symmetricApertureCenters.length, 2);
    close(
        cue.symmetricApertureCenters[0].y + cue.symmetricApertureCenters[1].y,
        geometry().source.y * 2
    );
    assert.doesNotMatch(controllerSource, /chosenSlit|selectedSlit|upperPath|lowerPath/);
});
