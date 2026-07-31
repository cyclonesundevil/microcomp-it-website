/**
 * Educational Kerr black-hole calculator.
 *
 * Uses geometrized units (G = c = M = 1) for dimensionless radii, then
 * converts physical lengths with r_g = GM/c². The disk is represented by a
 * prograde equatorial test particle at the ISCO. This is not a ray tracer,
 * accretion-flow simulation, or prediction of an observed spectrum.
 */

export const GRAVITATIONAL_RADIUS_KM_PER_SOLAR_MASS = 1.4766250385;

function finiteNumber(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new TypeError(`${name} must be a finite number`);
    }
    return number;
}

export function kerrHorizonRadiusRg(spin) {
    const a = finiteNumber(spin, 'spin');
    if (a < 0 || a >= 1) {
        throw new RangeError('spin must be at least 0 and less than 1');
    }
    return 1 + Math.sqrt(1 - a * a);
}

export function progradeIscoRadiusRg(spin) {
    const a = finiteNumber(spin, 'spin');
    if (a < 0 || a >= 1) {
        throw new RangeError('spin must be at least 0 and less than 1');
    }

    const z1 = 1
        + Math.cbrt(1 - a * a)
        * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
    const z2 = Math.sqrt(3 * a * a + z1 * z1);
    return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

export function circularOrbitClockRatio(radiusRg, spin) {
    const r = finiteNumber(radiusRg, 'radiusRg');
    const a = finiteNumber(spin, 'spin');
    const rThreeHalves = r ** 1.5;
    const denominatorSquared = r ** 3 - 3 * r ** 2 + 2 * a * rThreeHalves;
    if (denominatorSquared <= 0) {
        throw new RangeError('orbit must have a positive timelike clock factor');
    }
    return (rThreeHalves + a) / Math.sqrt(denominatorSquared);
}

function equatorialLapseAndOrbitalSpeed(radiusRg, spin) {
    const r = radiusRg;
    const a = spin;
    const delta = r * r - 2 * r + a * a;
    const metricA = (r * r + a * a) ** 2 - a * a * delta;
    const lapse = Math.sqrt((delta * r * r) / metricA);
    const frameDragging = (2 * a * r) / metricA;
    const angularVelocity = 1 / (r ** 1.5 + a);
    const azimuthalMetric = metricA / (r * r);
    const localSpeed = ((angularVelocity - frameDragging)
        * Math.sqrt(azimuthalMetric)) / lapse;
    return {
        lapse,
        localSpeed: Math.min(0.999, Math.max(0, localSpeed))
    };
}

export function computeBlackHoleModel({
    massSolar,
    spin,
    observerAngleDegrees
}) {
    const mass = finiteNumber(massSolar, 'massSolar');
    const a = finiteNumber(spin, 'spin');
    const angle = finiteNumber(observerAngleDegrees, 'observerAngleDegrees');

    if (mass <= 0) throw new RangeError('massSolar must be greater than 0');
    if (a < 0 || a >= 1) {
        throw new RangeError('spin must be at least 0 and less than 1');
    }
    if (angle < 0 || angle > 90) {
        throw new RangeError('observerAngleDegrees must be from 0 to 90');
    }

    const gravitationalRadiusKm =
        mass * GRAVITATIONAL_RADIUS_KM_PER_SOLAR_MASS;
    const horizonRadiusRg = kerrHorizonRadiusRg(a);
    const iscoRadiusRg = progradeIscoRadiusRg(a);
    const orbitClockRatio = circularOrbitClockRatio(iscoRadiusRg, a);
    const { lapse, localSpeed } =
        equatorialLapseAndOrbitalSpeed(iscoRadiusRg, a);
    const gravitationalRedshift = 1 / lapse - 1;
    const lineOfSightSpeed =
        localSpeed * Math.sin(angle * Math.PI / 180);
    const dopplerBrightnessContrast =
        ((1 + lineOfSightSpeed) / (1 - lineOfSightSpeed)) ** 3;

    return Object.freeze({
        massSolar: mass,
        spin: a,
        observerAngleDegrees: angle,
        gravitationalRadiusKm,
        horizonRadiusRg,
        horizonDiameterKm: 2 * horizonRadiusRg * gravitationalRadiusKm,
        iscoRadiusRg,
        iscoRadiusKm: iscoRadiusRg * gravitationalRadiusKm,
        orbitClockRatio,
        gravitationalRedshift,
        localOrbitalSpeedC: localSpeed,
        dopplerBrightnessContrast
    });
}
