import { computeBlackHoleModel } from './black-hole-model.mjs?v=3.0';

const LIGHT_SPEED_M_S = 299792458;
// Educational slow motion: 1.5 ms of physical evolution per wall-clock second.
export const DISK_PHYSICAL_SECONDS_PER_WALL_SECOND = 0.0015;

/** Canonical playground state. Lengths use r_g; renderer boundaries use r_s. */
export function createBlackHoleSimulationState(initial = {}) {
    let snapshot;
    function set(patch) {
        const values = {
            massSolar: 32, spin: 0.42, observerAngleDegrees: 85,
            observerAzimuthRadians: 0, observerRadiusRg: 32,
            modelTimeRs: 0, elapsedPhysicalSeconds: 0,
            ...snapshot, ...patch
        };
        for (const key of ['observerRadiusRg', 'observerAzimuthRadians', 'modelTimeRs', 'elapsedPhysicalSeconds']) {
            if (!Number.isFinite(values[key])) throw new TypeError(`${key} must be finite`);
        }
        if (values.observerRadiusRg <= 3) throw new RangeError('Observer must remain outside the photon-sphere reference');
        if (values.modelTimeRs < 0 || values.elapsedPhysicalSeconds < 0) throw new RangeError('Simulation time cannot be negative');
        const samePhysics = snapshot && ['massSolar', 'spin', 'observerAngleDegrees']
            .every(key => snapshot[key] === values[key]);
        const physics = samePhysics ? snapshot.physics : computeBlackHoleModel(values);
        const radiusKm = values.observerRadiusRg * physics.gravitationalRadiusKm;
        snapshot = Object.freeze({
            massSolar: values.massSolar, spin: values.spin,
            observerAngleDegrees: values.observerAngleDegrees,
            observerAzimuthRadians: values.observerAzimuthRadians,
            observerRadiusRg: values.observerRadiusRg,
            observerRadiusRs: values.observerRadiusRg / 2,
            observerRadiusKm: radiusKm,
            observerAltitudeKm: radiusKm - physics.horizonDiameterKm / 2,
            timeUnitRsSeconds: 2 * physics.gravitationalRadiusKm * 1000 / LIGHT_SPEED_M_S,
            modelTimeRs: values.modelTimeRs,
            elapsedPhysicalSeconds: values.elapsedPhysicalSeconds,
            physics
        });
        return snapshot;
    }
    function advance(wallSeconds) {
        if (!Number.isFinite(wallSeconds) || wallSeconds < 0) throw new RangeError('Elapsed wall time must be finite and nonnegative');
        const physicalDelta = wallSeconds * DISK_PHYSICAL_SECONDS_PER_WALL_SECOND;
        return set({
            modelTimeRs: snapshot.modelTimeRs + physicalDelta / snapshot.timeUnitRsSeconds,
            elapsedPhysicalSeconds: snapshot.elapsedPhysicalSeconds + physicalDelta
        });
    }
    set(initial);
    return Object.freeze({ get: () => snapshot, set, advance });
}
