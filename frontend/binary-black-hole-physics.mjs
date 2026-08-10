/**
 * Educational binary-black-hole evolution model.
 *
 * Inspiral uses a quasi-circular leading quadrupole flux with the 1PN and
 * 1.5PN flux factor. The weak-field expression is stopped at r = 6 GM/c^2.
 * A smooth EOB-inspired plunge interpolation then joins to a fitted
 * nonspinning remnant and the l=m=2 Kerr quasi-normal mode. This is not a
 * numerical-relativity waveform or a parameter-estimation model.
 */
export const G = 6.67430e-11;
export const C = 299792458;
export const SOLAR_MASS_KG = 1.98847e30;
export const MPC_METERS = 3.085677581491367e22;

const TWO_PI = 2 * Math.PI;
const PLUNGE_START_RG = 6;
const PROGRESS_REFERENCE_RG = 40;

function finite(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
    return number;
}

export function binaryMassParameters(m1Solar, m2Solar) {
    const m1 = finite(m1Solar, 'm1Solar');
    const m2 = finite(m2Solar, 'm2Solar');
    if (m1 < 5 || m1 > 100 || m2 < 5 || m2 > 100) {
        throw new RangeError('component masses must be from 5 to 100 solar masses');
    }
    const totalSolar = m1 + m2;
    const totalKg = totalSolar * SOLAR_MASS_KG;
    const reducedSolar = (m1 * m2) / totalSolar;
    const eta = (m1 * m2) / (totalSolar * totalSolar);
    const chirpSolar = totalSolar * eta ** (3 / 5);
    return Object.freeze({
        m1Solar: m1,
        m2Solar: m2,
        totalSolar,
        totalKg,
        reducedSolar,
        reducedKg: reducedSolar * SOLAR_MASS_KG,
        eta,
        q: Math.min(m1, m2) / Math.max(m1, m2),
        chirpSolar,
        gravitationalRadiusM: G * totalKg / C ** 2,
        gravitationalTimeS: G * totalKg / C ** 3
    });
}

export function remnantFit(m1Solar, m2Solar) {
    const masses = binaryMassParameters(m1Solar, m2Solar);
    const { eta, totalSolar } = masses;
    // Compact nonspinning numerical-relativity-inspired polynomial fits.
    const radiatedFraction = Math.min(0.1, 0.0559745 * eta + 0.580951 * eta ** 2);
    const finalSpin = Math.min(0.95, Math.sqrt(12) * eta - 3.871 * eta ** 2 + 4.028 * eta ** 3);
    const finalMassSolar = totalSolar * (1 - radiatedFraction);
    const finalMassKg = finalMassSolar * SOLAR_MASS_KG;
    const horizonRadiusM = G * finalMassKg / C ** 2 * (1 + Math.sqrt(1 - finalSpin ** 2));
    return Object.freeze({
        finalMassSolar,
        finalMassKg,
        finalSpin,
        radiatedFraction,
        radiatedMassSolar: totalSolar - finalMassSolar,
        horizonRadiusKm: horizonRadiusM / 1000
    });
}

export function ringdownMode(finalMassSolar, finalSpin) {
    const massKg = finite(finalMassSolar, 'finalMassSolar') * SOLAR_MASS_KG;
    const spin = Math.min(0.999, Math.max(0, finite(finalSpin, 'finalSpin')));
    // Berti et al.-style l=m=2 fundamental-mode fits.
    const angularFactor = 1.5251 - 1.1568 * (1 - spin) ** 0.1292;
    const frequencyHz = C ** 3 / (TWO_PI * G * massKg) * angularFactor;
    const qualityFactor = 0.7 + 1.4187 * (1 - spin) ** -0.499;
    const dampingTimeS = qualityFactor / (Math.PI * frequencyHz);
    return Object.freeze({ frequencyHz, qualityFactor, dampingTimeS });
}

export class BinaryBlackHolePhysics {
    constructor(options = {}) {
        this.configure(options);
    }

    configure({
        m1Solar = 36,
        m2Solar = 29,
        initialSeparationRg = 15.9,
        inclinationDegrees = 35,
        distanceMpc = 400
    } = {}) {
        this.masses = binaryMassParameters(m1Solar, m2Solar);
        this.remnant = remnantFit(m1Solar, m2Solar);
        this.ringdown = ringdownMode(this.remnant.finalMassSolar, this.remnant.finalSpin);
        this.initialSeparationRg = Math.min(100, Math.max(12, finite(initialSeparationRg, 'initialSeparationRg')));
        this.inclinationDegrees = Math.min(90, Math.max(0, finite(inclinationDegrees, 'inclinationDegrees')));
        this.distanceMpc = Math.max(1, finite(distanceMpc, 'distanceMpc'));
        this.reset();
    }

    reset() {
        this.timeS = 0;
        this.phase = 0;
        this.separationM = this.initialSeparationRg * this.masses.gravitationalRadiusM;
        this.cumulativeEnergyJ = 0;
        this.plungeElapsedS = 0;
        this.ringdownElapsedS = 0;
        this.regime = 'INSPIRAL';
        this.plunging = false;
        this.finished = false;
        this.mergerPhase = 0;
        this.mergerAmplitude = 0;
        this._refresh();
        const initialProgress = this._evolutionProgress();
        if (initialProgress > 0) return this.seekEvolutionProgress(initialProgress);
        return this.snapshot();
    }

    setInclination(degrees) {
        this.inclinationDegrees = Math.min(90, Math.max(0, finite(degrees, 'inclinationDegrees')));
        this._refresh();
        return this.snapshot();
    }

    _inspiralPhaseAt(separationM) {
        const { totalKg: M, reducedKg: mu, gravitationalRadiusM: rg } = this.masses;
        const referenceM = PROGRESS_REFERENCE_RG * rg;
        const decayConstant = 64 / 5 * G ** 3 * mu * M ** 2 / C ** 5;
        return 2 / 5 * Math.sqrt(G * M) / decayConstant *
            (referenceM ** 2.5 - separationM ** 2.5);
    }

    _plungePhaseAt(fraction) {
        const clamped = Math.min(1, Math.max(0, fraction));
        const duration = 70 * this.masses.gravitationalTimeS;
        const startOmega = this._inspiralQuantities(PLUNGE_START_RG * this.masses.gravitationalRadiusM).omega;
        const endOmega = Math.PI * this.ringdown.frequencyHz;
        const steps = Math.max(1, Math.ceil(80 * clamped));
        let integral = 0;
        for (let index = 0; index < steps; index += 1) {
            const midpoint = (index + 0.5) / steps * clamped;
            const smooth = midpoint * midpoint * (3 - 2 * midpoint);
            integral += startOmega + (endOmega - startOmega) * smooth;
        }
        return this._inspiralPhaseAt(PLUNGE_START_RG * this.masses.gravitationalRadiusM) +
            duration * clamped * integral / steps;
    }

    seekEvolutionProgress(progress) {
        const target = Math.min(1, Math.max(0, finite(progress, 'progress')));
        const { totalKg: M, reducedKg: mu, gravitationalRadiusM: rg } = this.masses;
        const referenceM = PROGRESS_REFERENCE_RG * rg;
        const endpointM = PLUNGE_START_RG * rg;
        const inspiralDurationCoefficient = 5 / 256 * C ** 5 / (G ** 3 * mu * M ** 2);
        const inspiralEndTime = inspiralDurationCoefficient * (referenceM ** 4 - endpointM ** 4);
        const inspiralEndEnergy = G * M * mu / 2 * (1 / endpointM - 1 / referenceM);
        const plungeDuration = 70 * this.masses.gravitationalTimeS;
        const targetEnergy = this.remnant.radiatedMassSolar * SOLAR_MASS_KG * C ** 2;

        this.plunging = target >= 0.82;
        this.finished = false;
        this.plungeElapsedS = 0;
        this.ringdownElapsedS = 0;
        this.mergerAmplitude = 0;

        if (target < 0.82) {
            const fraction = target / 0.82;
            const separation4 = referenceM ** 4 - fraction * (referenceM ** 4 - endpointM ** 4);
            this.separationM = separation4 ** 0.25;
            this.phase = this._inspiralPhaseAt(this.separationM);
            this.mergerPhase = 2 * this.phase;
            this.timeS = inspiralDurationCoefficient * (referenceM ** 4 - separation4);
            this.cumulativeEnergyJ = G * M * mu / 2 * (1 / this.separationM - 1 / referenceM);
            this.regime = this.separationM / rg <= 12 ? 'LATE INSPIRAL' : 'INSPIRAL';
        } else if (target < 0.94) {
            const fraction = (target - 0.82) / 0.12;
            this.separationM = endpointM;
            this.plungeElapsedS = fraction * plungeDuration;
            this.phase = this._plungePhaseAt(fraction);
            this.mergerPhase = 2 * this.phase;
            this.timeS = inspiralEndTime + this.plungeElapsedS;
            this.cumulativeEnergyJ = Math.max(inspiralEndEnergy, targetEnergy * fraction ** 3);
            this.regime = fraction < 0.58 ? 'LATE INSPIRAL' : 'MERGER';
        } else {
            const fraction = (target - 0.94) / 0.06;
            const plungeEndPhase = this._plungePhaseAt(1);
            const plungeEndWavePhase = 2 * plungeEndPhase;
            this.separationM = endpointM;
            this.plungeElapsedS = plungeDuration;
            this.phase = plungeEndPhase;
            this.ringdownElapsedS = fraction * 8 * this.ringdown.dampingTimeS;
            this.mergerPhase = plungeEndWavePhase + TWO_PI * this.ringdown.frequencyHz * this.ringdownElapsedS;
            this.timeS = inspiralEndTime + plungeDuration + this.ringdownElapsedS;
            this.cumulativeEnergyJ = targetEnergy;
            this.regime = target >= 1 ? 'FINAL KERR BLACK HOLE' : 'RINGDOWN';
            this.finished = target >= 1;
        }
        this._refresh();
        return this.snapshot();
    }

    _inspiralQuantities(separationM = this.separationM) {
        const { totalKg: M, reducedKg: mu, eta, gravitationalRadiusM: rg } = this.masses;
        const r = Math.max(separationM, PLUNGE_START_RG * rg);
        const omega = Math.sqrt(G * M / r ** 3);
        const x = rg / r;
        const pnFlux = Math.max(0.45, 1 - (743 / 336 + 11 * eta / 4) * x + 4 * Math.PI * x ** 1.5);
        const powerW = 32 / 5 * G ** 4 * mu ** 2 * M ** 3 / (C ** 5 * r ** 5) * pnFlux;
        const drdt = -64 / 5 * G ** 3 * mu * M ** 2 / (C ** 5 * r ** 3) * pnFlux;
        const velocityC = Math.min(0.95, Math.sqrt(G * M / r) / C);
        const timeToMergerS = 5 / 256 * C ** 5 * r ** 4 / (G ** 3 * mu * M ** 2);
        return { omega, powerW, drdt, velocityC, timeToMergerS, pnFlux };
    }

    _strain(omega, separationM, phase, amplitudeScale = 1, phaseMultiplier = 2) {
        const i = this.inclinationDegrees * Math.PI / 180;
        const cosI = Math.cos(i);
        const distanceM = this.distanceMpc * MPC_METERS;
        const base = 4 * G * this.masses.reducedKg * omega ** 2 * separationM ** 2 /
            (C ** 4 * distanceM) * amplitudeScale;
        return {
            hPlus: base * (1 + cosI ** 2) / 2 * Math.cos(phaseMultiplier * phase),
            hCross: base * cosI * Math.sin(phaseMultiplier * phase),
            strainAmplitude: Math.abs(base)
        };
    }

    _evolutionProgress() {
        if (this.finished || this.regime === 'FINAL KERR BLACK HOLE') return 1;
        const clamp01 = value => Math.min(1, Math.max(0, value));
        const plungeDuration = 70 * this.masses.gravitationalTimeS;

        if (!this.plunging) {
            // At leading quadrupole order r^4 decreases linearly with time.
            // Map that physical inspiral clock onto the first 82% of the UI.
            const initial4 = PROGRESS_REFERENCE_RG ** 4;
            const endpoint4 = PLUNGE_START_RG ** 4;
            const currentSeparationRg = this.separationM / this.masses.gravitationalRadiusM;
            if (Math.abs(currentSeparationRg - PROGRESS_REFERENCE_RG) < 1e-12) return 0;
            const current4 = currentSeparationRg ** 4;
            return 0.82 * clamp01((initial4 - current4) / (initial4 - endpoint4));
        }
        if (this.regime === 'LATE INSPIRAL' || this.regime === 'MERGER') {
            return 0.82 + 0.12 * clamp01(this.plungeElapsedS / plungeDuration);
        }
        if (this.regime === 'RINGDOWN') {
            return 0.94 + 0.06 * clamp01(
                this.ringdownElapsedS / (8 * this.ringdown.dampingTimeS)
            );
        }
        return 0;
    }

    _refresh() {
        const rg = this.masses.gravitationalRadiusM;
        const inspiral = this._inspiralQuantities();
        let omega = inspiral.omega;
        let powerW = inspiral.powerW;
        let separationM = this.separationM;
        let strain;

        if (this.plunging && (this.regime === 'LATE INSPIRAL' || this.regime === 'MERGER')) {
            const duration = 70 * this.masses.gravitationalTimeS;
            const p = Math.min(1, this.plungeElapsedS / duration);
            const smooth = p * p * (3 - 2 * p);
            const mergerOmega = Math.PI * this.ringdown.frequencyHz;
            omega = inspiral.omega + (mergerOmega - inspiral.omega) * smooth;
            separationM = rg * (6 - 4.4 * smooth);
            powerW = inspiral.powerW * (1 + 3.5 * smooth) * (1 - 0.55 * smooth);
            this.mergerAmplitude = 1 + 2.2 * smooth;
            strain = this._strain(omega, separationM, this.phase, this.mergerAmplitude);
        } else if (this.regime === 'RINGDOWN' || this.regime === 'FINAL KERR BLACK HOLE') {
            omega = Math.PI * this.ringdown.frequencyHz;
            separationM = 0;
            const decay = Math.exp(-this.ringdownElapsedS / this.ringdown.dampingTimeS);
            const peakSeparation = 2 * this.remnant.horizonRadiusKm * 1000;
            strain = this._strain(omega, peakSeparation, this.mergerPhase, 3.2 * decay, 1);
            powerW = inspiral.powerW * decay ** 2;
        } else {
            strain = this._strain(omega, separationM, this.phase);
        }

        this.current = {
            separationM,
            separationRg: separationM / rg,
            orbitalOmegaRadS: omega,
            orbitFrequencyHz: omega / TWO_PI,
            gwFrequencyHz: omega / Math.PI,
            gwWavelengthM: C / (omega / Math.PI),
            gwWavelengthRg: 1 / ((omega / Math.PI) * this.masses.gravitationalTimeS),
            powerW,
            velocityC: inspiral.velocityC,
            timeToMergerS: !this.plunging && (this.regime === 'INSPIRAL' || this.regime === 'LATE INSPIRAL')
                ? inspiral.timeToMergerS
                : null,
            body1PositionM: separationM > 0 ? [
                Math.cos(this.phase) * separationM * this.masses.m2Solar / this.masses.totalSolar,
                Math.sin(this.phase) * separationM * this.masses.m2Solar / this.masses.totalSolar
            ] : [0, 0],
            body2PositionM: separationM > 0 ? [
                -Math.cos(this.phase) * separationM * this.masses.m1Solar / this.masses.totalSolar,
                -Math.sin(this.phase) * separationM * this.masses.m1Solar / this.masses.totalSolar
            ] : [0, 0],
            ...strain
        };
    }

    advance(deltaSeconds, onSubstep) {
        let remaining = Math.min(5, Math.max(0, finite(deltaSeconds, 'deltaSeconds')));
        let guard = 0;
        while (remaining > 0 && guard < 20000) {
            guard += 1;
            const startingRegime = this.regime;
            this._refresh();
            const omega = Math.max(1e-9, this.current.orbitalOmegaRadS);
            const phaseLimited = 0.045 / omega;
            const decayLimited = !this.plunging && (this.regime === 'INSPIRAL' || this.regime === 'LATE INSPIRAL')
                ? Math.abs(0.002 * this.separationM / this._inspiralQuantities().drdt)
                : this.masses.gravitationalTimeS * 0.8;
            const dt = Math.min(remaining, Math.max(1e-7, phaseLimited), Math.max(1e-7, decayLimited));

            if (!this.plunging && (this.regime === 'INSPIRAL' || this.regime === 'LATE INSPIRAL')) {
                const q = this._inspiralQuantities();
                this.separationM = Math.max(PLUNGE_START_RG * this.masses.gravitationalRadiusM, this.separationM + q.drdt * dt);
                this.phase += q.omega * dt;
                this.cumulativeEnergyJ += q.powerW * dt;
                if (this.separationM / this.masses.gravitationalRadiusM <= 12) this.regime = 'LATE INSPIRAL';
                if (this.separationM / this.masses.gravitationalRadiusM <= PLUNGE_START_RG + 1e-8) {
                    this.regime = 'LATE INSPIRAL';
                    this.plunging = true;
                    this.plungeElapsedS = 0;
                }
            } else if (this.regime === 'LATE INSPIRAL' || this.regime === 'MERGER') {
                const duration = 70 * this.masses.gravitationalTimeS;
                this.plungeElapsedS += dt;
                this.phase += this.current.orbitalOmegaRadS * dt;
                const progress = Math.min(1, this.plungeElapsedS / duration);
                this.regime = progress < 0.58 ? 'LATE INSPIRAL' : 'MERGER';
                const targetEnergy = this.remnant.radiatedMassSolar * SOLAR_MASS_KG * C ** 2;
                this.cumulativeEnergyJ = Math.max(this.cumulativeEnergyJ, targetEnergy * progress ** 3);
                if (progress >= 1) {
                    this.regime = 'RINGDOWN';
                    this.ringdownElapsedS = 0;
                    this.mergerPhase = 2 * this.phase;
                }
            } else if (this.regime === 'RINGDOWN') {
                this.ringdownElapsedS += dt;
                this.mergerPhase += TWO_PI * this.ringdown.frequencyHz * dt;
                if (this.ringdownElapsedS >= 8 * this.ringdown.dampingTimeS) {
                    this.regime = 'FINAL KERR BLACK HOLE';
                    this.finished = true;
                }
            }
            this.timeS += dt;
            remaining -= dt;
            this._refresh();
            if (onSubstep) onSubstep(this.snapshot());
            // Keep every physical regime observable for at least one caller
            // update even when educational playback is heavily accelerated.
            if (this.regime !== startingRegime) break;
        }
        return this.snapshot();
    }

    snapshot() {
        return Object.freeze({
            timeS: this.timeS,
            phase: this.phase,
            mergerPhase: this.mergerPhase,
            ringdownElapsedS: this.ringdownElapsedS,
            regime: this.regime,
            finished: this.finished,
            cumulativeEnergyJ: this.cumulativeEnergyJ,
            masses: this.masses,
            inclinationDegrees: this.inclinationDegrees,
            remnant: this.remnant,
            ringdown: this.ringdown,
            evolutionProgress: this._evolutionProgress(),
            ...this.current
        });
    }
}
