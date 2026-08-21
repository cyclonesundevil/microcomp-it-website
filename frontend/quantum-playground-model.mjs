/**
 * Browser-independent probability utilities for Quantum Playground.
 *
 * Phase 1 uses a dimensionless one-dimensional detector coordinate. The
 * Gaussian intensity is a pedagogical |psi(x)|^2 distribution for a prepared
 * wavepacket; it does not animate or claim knowledge of an unmeasured path.
 */

export const SINGLE_PARTICLE_DOMAIN = Object.freeze({ min: -1, max: 1 });
export const DEFAULT_SINGLE_PARTICLE_SEED = 'quantum-phase-1';
export const DEFAULT_DOUBLE_SLIT_GEOMETRY = Object.freeze({
    slitWidthM: 12e-6,
    slitSeparationM: 40e-6,
    wavelengthM: 550e-9,
    screenDistanceM: 1,
    detectorHalfWidthM: 0.05,
    binCount: 401
});

function finiteNumber(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new TypeError(`${name} must be a finite number`);
    }
    return number;
}

function positiveInteger(value, name) {
    const number = finiteNumber(value, name);
    if (!Number.isInteger(number) || number <= 0) {
        throw new RangeError(`${name} must be a positive integer`);
    }
    return number;
}

export function createSeededRandom(seed = DEFAULT_SINGLE_PARTICLE_SEED) {
    const text = String(seed);
    let state = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        state ^= text.charCodeAt(index);
        state = Math.imul(state, 16777619);
    }
    state >>>= 0;

    return function seededRandom() {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function normalizeWeights(weights) {
    if (!weights || typeof weights.length !== 'number' || weights.length === 0) {
        throw new RangeError('weights must contain at least one value');
    }
    const normalized = new Float64Array(weights.length);
    let total = 0;
    for (let index = 0; index < weights.length; index += 1) {
        const weight = finiteNumber(weights[index], `weights[${index}]`);
        if (weight < 0) throw new RangeError('weights must be non-negative');
        total += weight;
        normalized[index] = weight;
    }
    if (!(total > 0)) throw new RangeError('weights must contain positive mass');
    for (let index = 0; index < normalized.length; index += 1) {
        normalized[index] /= total;
    }
    return normalized;
}

export function createSingleParticleDistribution({
    binCount = 161,
    center = 0,
    sigma = 0.24,
    domain = SINGLE_PARTICLE_DOMAIN
} = {}) {
    const bins = positiveInteger(binCount, 'binCount');
    if (bins < 3) throw new RangeError('binCount must be at least 3');
    const mean = finiteNumber(center, 'center');
    const width = finiteNumber(sigma, 'sigma');
    const minimum = finiteNumber(domain?.min, 'domain.min');
    const maximum = finiteNumber(domain?.max, 'domain.max');
    if (!(maximum > minimum)) throw new RangeError('domain.max must exceed domain.min');
    if (!(width > 0)) throw new RangeError('sigma must be greater than 0');
    if (mean < minimum || mean > maximum) {
        throw new RangeError('center must lie inside the detector domain');
    }

    const positions = new Float64Array(bins);
    const weights = new Float64Array(bins);
    const step = (maximum - minimum) / (bins - 1);
    for (let index = 0; index < bins; index += 1) {
        const position = minimum + index * step;
        const standardized = (position - mean) / width;
        positions[index] = position;
        weights[index] = Math.exp(-0.5 * standardized * standardized);
    }
    const probabilities = normalizeWeights(weights);
    const cumulative = new Float64Array(bins);
    let running = 0;
    for (let index = 0; index < bins; index += 1) {
        running += probabilities[index];
        cumulative[index] = running;
    }
    cumulative[cumulative.length - 1] = 1;

    return {
        positions,
        probabilities,
        cumulative,
        domain: Object.freeze({ min: minimum, max: maximum }),
        center: mean,
        sigma: width,
        step
    };
}

export function sampleDistribution(distribution, random = Math.random) {
    if (!distribution?.cumulative?.length || !distribution?.positions?.length) {
        throw new TypeError('distribution must contain positions and cumulative probability');
    }
    if (distribution.cumulative.length !== distribution.positions.length) {
        throw new RangeError('distribution arrays must have matching lengths');
    }
    const draw = finiteNumber(random(), 'random draw');
    if (draw < 0 || draw >= 1) {
        throw new RangeError('random draw must be at least 0 and less than 1');
    }

    let low = 0;
    let high = distribution.cumulative.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (draw <= distribution.cumulative[middle]) high = middle;
        else low = middle + 1;
    }
    return { index: low, position: distribution.positions[low] };
}

export function sampleDetections(distribution, count, random = Math.random) {
    const sampleCount = positiveInteger(count, 'count');
    const indices = new Uint32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
        indices[index] = sampleDistribution(distribution, random).index;
    }
    return indices;
}

export function detectionMoments(distribution, counts) {
    if (!counts || counts.length !== distribution?.positions?.length) {
        throw new RangeError('counts must match the distribution bins');
    }
    let total = 0;
    let weighted = 0;
    for (let index = 0; index < counts.length; index += 1) {
        const count = finiteNumber(counts[index], `counts[${index}]`);
        if (count < 0) throw new RangeError('counts must be non-negative');
        total += count;
        weighted += count * distribution.positions[index];
    }
    if (total === 0) return { count: 0, mean: 0, standardDeviation: 0 };
    const mean = weighted / total;
    let varianceTotal = 0;
    for (let index = 0; index < counts.length; index += 1) {
        varianceTotal += counts[index] * (distribution.positions[index] - mean) ** 2;
    }
    return {
        count: total,
        mean,
        standardDeviation: Math.sqrt(varianceTotal / total)
    };
}

export class DetectionExperiment {
    constructor(distribution, seed = DEFAULT_SINGLE_PARTICLE_SEED) {
        this.seed = seed;
        this.setDistribution(distribution);
    }

    setDistribution(distribution) {
        if (!distribution?.positions?.length) throw new TypeError('distribution must contain detector positions');
        this.distribution = distribution;
        this.counts = new Uint32Array(distribution.positions.length);
        this.recent = [];
        this.total = 0;
        this.random = createSeededRandom(this.seed);
    }

    reset(random = createSeededRandom(this.seed)) {
        this.counts.fill(0);
        this.recent.length = 0;
        this.total = 0;
        this.random = random;
    }

    emit(count) {
        const detections = sampleDetections(this.distribution, count, this.random);
        for (const binIndex of detections) {
            this.counts[binIndex] += 1;
            this.total += 1;
            this.recent.push({ binIndex, sequence: this.total });
        }
        if (this.recent.length > 220) this.recent.splice(0, this.recent.length - 220);
        return detections;
    }

    moments() {
        return detectionMoments(this.distribution, this.counts);
    }
}

export function sinc(value) {
    const x = finiteNumber(value, 'sinc value');
    return Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x;
}

function validateFraunhoferGeometry({
    slitWidthM,
    slitSeparationM,
    wavelengthM,
    screenDistanceM,
    detectorHalfWidthM,
    binCount
}) {
    const geometry = {
        slitWidthM: finiteNumber(slitWidthM, 'slitWidthM'),
        slitSeparationM: finiteNumber(slitSeparationM, 'slitSeparationM'),
        wavelengthM: finiteNumber(wavelengthM, 'wavelengthM'),
        screenDistanceM: finiteNumber(screenDistanceM, 'screenDistanceM'),
        detectorHalfWidthM: finiteNumber(detectorHalfWidthM, 'detectorHalfWidthM'),
        binCount: positiveInteger(binCount, 'binCount')
    };
    if (!(geometry.slitWidthM > 0)) throw new RangeError('slitWidthM must be greater than 0');
    if (geometry.slitSeparationM < 0) throw new RangeError('slitSeparationM must be non-negative');
    if (!(geometry.wavelengthM > 0)) throw new RangeError('wavelengthM must be greater than 0');
    if (!(geometry.screenDistanceM > 0)) throw new RangeError('screenDistanceM must be greater than 0');
    if (!(geometry.detectorHalfWidthM > 0)) throw new RangeError('detectorHalfWidthM must be greater than 0');
    if (geometry.binCount < 3) throw new RangeError('binCount must be at least 3');
    return geometry;
}

function validateIndependentSlits(geometry) {
    if (geometry.slitSeparationM < geometry.slitWidthM) {
        throw new RangeError('slitSeparationM must be greater than or equal to slitWidthM');
    }
}

export function complexAdd(first, second) {
    return { re: first.re + second.re, im: first.im + second.im };
}

export function complexMagnitudeSquared(value) {
    return value.re * value.re + value.im * value.im;
}

export function pathMarkerOverlap(firstMarker, secondMarker) {
    if (!Array.isArray(firstMarker) || !Array.isArray(secondMarker) || firstMarker.length !== secondMarker.length || firstMarker.length === 0) {
        throw new RangeError('path markers must be non-empty state vectors of matching length');
    }
    let re = 0;
    let im = 0;
    let firstNorm = 0;
    let secondNorm = 0;
    for (let index = 0; index < firstMarker.length; index += 1) {
        const first = firstMarker[index];
        const second = secondMarker[index];
        const firstRe = finiteNumber(first?.re ?? first, `firstMarker[${index}].re`);
        const firstIm = finiteNumber(first?.im ?? 0, `firstMarker[${index}].im`);
        const secondRe = finiteNumber(second?.re ?? second, `secondMarker[${index}].re`);
        const secondIm = finiteNumber(second?.im ?? 0, `secondMarker[${index}].im`);
        re += firstRe * secondRe + firstIm * secondIm;
        im += firstRe * secondIm - firstIm * secondRe;
        firstNorm += firstRe ** 2 + firstIm ** 2;
        secondNorm += secondRe ** 2 + secondIm ** 2;
    }
    if (Math.abs(firstNorm - 1) > 1e-12 || Math.abs(secondNorm - 1) > 1e-12) {
        throw new RangeError('path marker states must be normalized');
    }
    return { re, im };
}

export function binaryWhichPathMarkers(detectorEnabled) {
    return detectorEnabled
        ? { first: [1, 0], second: [0, 1] }
        : { first: [1, 0], second: [1, 0] };
}

export function partialCoherenceMarkers(coherence) {
    const gamma = finiteNumber(coherence, 'coherence');
    if (gamma < 0 || gamma > 1) throw new RangeError('coherence must be between 0 and 1');
    return {
        first: [1, 0],
        second: [gamma, Math.sqrt(Math.max(0, 1 - gamma * gamma))]
    };
}

export function idealComplementarity(coherence) {
    const markers = partialCoherenceMarkers(coherence);
    const overlap = pathMarkerOverlap(markers.first, markers.second);
    const visibility = Math.hypot(overlap.re, overlap.im);
    const distinguishability = Math.sqrt(Math.max(0, 1 - visibility * visibility));
    return { visibility, distinguishability };
}

export function fraunhoferSlitAmplitude({
    screenPositionM,
    slitWidthM,
    slitCenterM,
    wavelengthM,
    screenDistanceM
}) {
    const x = finiteNumber(screenPositionM, 'screenPositionM');
    const width = finiteNumber(slitWidthM, 'slitWidthM');
    const center = finiteNumber(slitCenterM, 'slitCenterM');
    const wavelength = finiteNumber(wavelengthM, 'wavelengthM');
    const distance = finiteNumber(screenDistanceM, 'screenDistanceM');
    if (!(width > 0) || !(wavelength > 0) || !(distance > 0)) {
        throw new RangeError('slit width, wavelength, and screen distance must be positive');
    }

    const sinTheta = x / Math.sqrt(distance * distance + x * x);
    const diffractionPhase = Math.PI * width * sinTheta / wavelength;
    const propagationPhase = 2 * Math.PI * center * sinTheta / wavelength;
    const envelopeAmplitude = sinc(diffractionPhase);
    return {
        re: envelopeAmplitude * Math.cos(propagationPhase),
        im: envelopeAmplitude * Math.sin(propagationPhase)
    };
}

function fraunhoferPairAt(screenPositionM, geometry) {
    return {
        first: fraunhoferSlitAmplitude({
            screenPositionM,
            slitWidthM: geometry.slitWidthM,
            slitCenterM: -geometry.slitSeparationM / 2,
            wavelengthM: geometry.wavelengthM,
            screenDistanceM: geometry.screenDistanceM
        }),
        second: fraunhoferSlitAmplitude({
            screenPositionM,
            slitWidthM: geometry.slitWidthM,
            slitCenterM: geometry.slitSeparationM / 2,
            wavelengthM: geometry.wavelengthM,
            screenDistanceM: geometry.screenDistanceM
        })
    };
}

function createFraunhoferDistribution(options, pathCount, markerStates = null) {
    const geometry = validateFraunhoferGeometry({
        ...DEFAULT_DOUBLE_SLIT_GEOMETRY,
        ...options
    });
    if (pathCount === 2) validateIndependentSlits(geometry);
    const positions = new Float64Array(geometry.binCount);
    const intensities = new Float64Array(geometry.binCount);
    const incoherentIntensities = pathCount === 2 ? new Float64Array(geometry.binCount) : null;
    const interferenceTerms = pathCount === 2 ? new Float64Array(geometry.binCount) : null;
    const markerOverlap = pathCount === 2
        ? pathMarkerOverlap(markerStates.first, markerStates.second)
        : null;
    const step = 2 * geometry.detectorHalfWidthM / (geometry.binCount - 1);

    for (let index = 0; index < geometry.binCount; index += 1) {
        const position = -geometry.detectorHalfWidthM + index * step;
        const pair = pathCount === 2 ? fraunhoferPairAt(position, geometry) : null;
        const first = pathCount === 2
            ? pair.first
            : fraunhoferSlitAmplitude({
                screenPositionM: position,
                slitWidthM: geometry.slitWidthM,
                slitCenterM: 0,
                wavelengthM: geometry.wavelengthM,
                screenDistanceM: geometry.screenDistanceM
            });
        if (pathCount === 2) {
            const second = pair.second;
            const productRe = first.re * second.re + first.im * second.im;
            const productIm = first.re * second.im - first.im * second.re;
            const incoherent = complexMagnitudeSquared(first) + complexMagnitudeSquared(second);
            const crossTerm = 2 * (markerOverlap.re * productRe - markerOverlap.im * productIm);
            incoherentIntensities[index] = incoherent;
            interferenceTerms[index] = crossTerm;
            intensities[index] = Math.max(0, incoherent + crossTerm);
        } else {
            intensities[index] = complexMagnitudeSquared(first);
        }
        positions[index] = position;
    }

    const probabilities = normalizeWeights(intensities);
    const cumulative = new Float64Array(geometry.binCount);
    let running = 0;
    for (let index = 0; index < probabilities.length; index += 1) {
        running += probabilities[index];
        cumulative[index] = running;
    }
    cumulative[cumulative.length - 1] = 1;

    return {
        positions,
        intensities,
        incoherentIntensities,
        interferenceTerms,
        probabilities,
        cumulative,
        domain: Object.freeze({
            min: -geometry.detectorHalfWidthM,
            max: geometry.detectorHalfWidthM
        }),
        step,
        geometry: Object.freeze({ ...geometry }),
        markerOverlap: markerOverlap ? Object.freeze(markerOverlap) : null,
        model: pathCount === 2 ? 'two-path-marker-overlap' : 'single-slit'
    };
}

export function createDoubleSlitDistribution(options = {}) {
    return createFraunhoferDistribution(options, 2, binaryWhichPathMarkers(false));
}

export function createWhichPathDistribution({ detectorEnabled = false, ...options } = {}) {
    return createFraunhoferDistribution(options, 2, binaryWhichPathMarkers(Boolean(detectorEnabled)));
}

export function createDecoherenceDistribution({ coherence = 1, ...options } = {}) {
    return createFraunhoferDistribution(options, 2, partialCoherenceMarkers(coherence));
}

function distributionView(positions, probabilities, geometry, step, label) {
    const cumulative = new Float64Array(probabilities.length);
    let running = 0;
    for (let index = 0; index < probabilities.length; index += 1) {
        running += probabilities[index];
        cumulative[index] = running;
    }
    cumulative[cumulative.length - 1] = 1;
    return {
        positions,
        probabilities,
        cumulative,
        domain: Object.freeze({ min: -geometry.detectorHalfWidthM, max: geometry.detectorHalfWidthM }),
        geometry: Object.freeze({ ...geometry }),
        step,
        model: label
    };
}

export function createQuantumEraserDistribution(options = {}) {
    const geometry = validateFraunhoferGeometry({ ...DEFAULT_DOUBLE_SLIT_GEOMETRY, ...options });
    validateIndependentSlits(geometry);
    const positions = new Float64Array(geometry.binCount);
    const plusWeights = new Float64Array(geometry.binCount);
    const minusWeights = new Float64Array(geometry.binCount);
    const incoherentIntensities = new Float64Array(geometry.binCount);
    const crossTerms = new Float64Array(geometry.binCount);
    const step = 2 * geometry.detectorHalfWidthM / (geometry.binCount - 1);

    for (let index = 0; index < geometry.binCount; index += 1) {
        const position = -geometry.detectorHalfWidthM + index * step;
        const { first, second } = fraunhoferPairAt(position, geometry);
        const incoherent = complexMagnitudeSquared(first) + complexMagnitudeSquared(second);
        const cross = 2 * (first.re * second.re + first.im * second.im);
        positions[index] = position;
        incoherentIntensities[index] = incoherent;
        crossTerms[index] = cross;
        // The 1/4 includes the initial 1/sqrt(2) path amplitude and
        // the 1/sqrt(2) projection onto the +/- eraser basis.
        plusWeights[index] = Math.max(0, (incoherent + cross) / 4);
        minusWeights[index] = Math.max(0, (incoherent - cross) / 4);
    }

    const combinedWeights = new Float64Array(2 * geometry.binCount);
    combinedWeights.set(plusWeights, 0);
    combinedWeights.set(minusWeights, geometry.binCount);
    const normalizedJoint = normalizeWeights(combinedWeights);
    const plusJointProbabilities = normalizedJoint.slice(0, geometry.binCount);
    const minusJointProbabilities = normalizedJoint.slice(geometry.binCount);
    const plusMarginal = plusJointProbabilities.reduce((sum, value) => sum + value, 0);
    const minusMarginal = minusJointProbabilities.reduce((sum, value) => sum + value, 0);
    const plusConditionalProbabilities = Float64Array.from(plusJointProbabilities, value => value / plusMarginal);
    const minusConditionalProbabilities = Float64Array.from(minusJointProbabilities, value => value / minusMarginal);
    const marginalProbabilities = Float64Array.from(
        plusJointProbabilities,
        (value, index) => value + minusJointProbabilities[index]
    );
    const jointCumulative = new Float64Array(normalizedJoint.length);
    let running = 0;
    for (let index = 0; index < normalizedJoint.length; index += 1) {
        running += normalizedJoint[index];
        jointCumulative[index] = running;
    }
    jointCumulative[jointCumulative.length - 1] = 1;

    return {
        positions,
        plusWeights,
        minusWeights,
        incoherentIntensities,
        crossTerms,
        plusJointProbabilities,
        minusJointProbabilities,
        jointProbabilities: normalizedJoint,
        jointCumulative,
        markerMarginals: Object.freeze({ plus: plusMarginal, minus: minusMarginal }),
        marginalDistribution: distributionView(positions, marginalProbabilities, geometry, step, 'eraser-unsorted-marginal'),
        plusConditionalDistribution: distributionView(positions, plusConditionalProbabilities, geometry, step, 'eraser-plus-conditional'),
        minusConditionalDistribution: distributionView(positions, minusConditionalProbabilities, geometry, step, 'eraser-minus-conditional'),
        geometry: Object.freeze({ ...geometry }),
        step,
        model: 'quantum-eraser-joint'
    };
}

export function sampleQuantumEraserEvents(distribution, count, random = Math.random) {
    const sampleCount = positiveInteger(count, 'count');
    if (!distribution?.jointCumulative?.length || !distribution?.positions?.length) {
        throw new TypeError('quantum eraser distribution must contain joint probabilities and detector positions');
    }
    const binCount = distribution.positions.length;
    const events = new Array(sampleCount);
    for (let eventIndex = 0; eventIndex < sampleCount; eventIndex += 1) {
        const draw = finiteNumber(random(), 'random draw');
        if (draw < 0 || draw >= 1) throw new RangeError('random draw must be at least 0 and less than 1');
        let low = 0;
        let high = distribution.jointCumulative.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (draw <= distribution.jointCumulative[middle]) high = middle;
            else low = middle + 1;
        }
        events[eventIndex] = {
            outcome: low < binCount ? 'plus' : 'minus',
            binIndex: low % binCount
        };
    }
    return events;
}

export class QuantumEraserExperiment {
    constructor(distribution, seed = DEFAULT_SINGLE_PARTICLE_SEED) {
        this.seed = seed;
        this.view = 'all';
        this.setDistribution(distribution);
    }

    setDistribution(distribution) {
        if (distribution?.model !== 'quantum-eraser-joint') throw new TypeError('a quantum eraser joint distribution is required');
        this.jointDistribution = distribution;
        this.allCounts = new Uint32Array(distribution.positions.length);
        this.plusCounts = new Uint32Array(distribution.positions.length);
        this.minusCounts = new Uint32Array(distribution.positions.length);
        this.recentEvents = [];
        this.ensembleTotal = 0;
        this.random = createSeededRandom(this.seed);
    }

    setView(view) {
        if (!['all', 'plus', 'minus'].includes(view)) throw new RangeError('eraser view must be all, plus, or minus');
        this.view = view;
    }

    reset(random = createSeededRandom(this.seed)) {
        this.allCounts.fill(0);
        this.plusCounts.fill(0);
        this.minusCounts.fill(0);
        this.recentEvents.length = 0;
        this.ensembleTotal = 0;
        this.random = random;
    }

    emit(count) {
        const events = sampleQuantumEraserEvents(this.jointDistribution, count, this.random);
        for (const event of events) {
            this.ensembleTotal += 1;
            this.allCounts[event.binIndex] += 1;
            if (event.outcome === 'plus') this.plusCounts[event.binIndex] += 1;
            else this.minusCounts[event.binIndex] += 1;
            this.recentEvents.push({ ...event, sequence: this.ensembleTotal });
        }
        if (this.recentEvents.length > 220) this.recentEvents.splice(0, this.recentEvents.length - 220);
        return events;
    }

    get distribution() {
        if (this.view === 'plus') return this.jointDistribution.plusConditionalDistribution;
        if (this.view === 'minus') return this.jointDistribution.minusConditionalDistribution;
        return this.jointDistribution.marginalDistribution;
    }

    get counts() {
        if (this.view === 'plus') return this.plusCounts;
        if (this.view === 'minus') return this.minusCounts;
        return this.allCounts;
    }

    get recent() {
        if (this.view === 'all') return this.recentEvents;
        return this.recentEvents.filter(event => event.outcome === this.view);
    }

    get total() {
        return this.counts.reduce((sum, value) => sum + value, 0);
    }

    moments() {
        return detectionMoments(this.distribution, this.counts);
    }
}

export const ENTANGLED_PAIR_OUTCOMES = Object.freeze(['++', '+-', '-+', '--']);
export const POLARIZATION_SINGLET_STATE = Object.freeze({
    hh: 0,
    hv: 1 / Math.sqrt(2),
    vh: -1 / Math.sqrt(2),
    vv: 0
});

export function polarizationAnalyzerBasis(angleDegrees) {
    const degrees = finiteNumber(angleDegrees, 'analyzer angle');
    const theta = degrees * Math.PI / 180;
    return Object.freeze({
        plus: Object.freeze({ h: Math.cos(theta), v: Math.sin(theta) }),
        minus: Object.freeze({ h: -Math.sin(theta), v: Math.cos(theta) })
    });
}

function singletProjectionAmplitude(aliceState, bobState) {
    return POLARIZATION_SINGLET_STATE.hh * aliceState.h * bobState.h +
        POLARIZATION_SINGLET_STATE.hv * aliceState.h * bobState.v +
        POLARIZATION_SINGLET_STATE.vh * aliceState.v * bobState.h +
        POLARIZATION_SINGLET_STATE.vv * aliceState.v * bobState.v;
}

export function createPolarizationSingletDistribution({ aliceAngleDeg = 0, bobAngleDeg = 0 } = {}) {
    const aliceAngle = finiteNumber(aliceAngleDeg, 'aliceAngleDeg');
    const bobAngle = finiteNumber(bobAngleDeg, 'bobAngleDeg');
    const aliceBasis = polarizationAnalyzerBasis(aliceAngle);
    const bobBasis = polarizationAnalyzerBasis(bobAngle);
    const stateFor = (basis, sign) => sign === '+' ? basis.plus : basis.minus;
    const amplitudes = new Float64Array(ENTANGLED_PAIR_OUTCOMES.length);
    const bornWeights = new Float64Array(ENTANGLED_PAIR_OUTCOMES.length);

    ENTANGLED_PAIR_OUTCOMES.forEach((outcome, index) => {
        const amplitude = singletProjectionAmplitude(
            stateFor(aliceBasis, outcome[0]),
            stateFor(bobBasis, outcome[1])
        );
        amplitudes[index] = amplitude;
        bornWeights[index] = amplitude * amplitude;
    });
    const probabilities = normalizeWeights(bornWeights);
    const cumulative = new Float64Array(probabilities.length);
    let running = 0;
    for (let index = 0; index < probabilities.length; index += 1) {
        running += probabilities[index];
        cumulative[index] = running;
    }
    cumulative[cumulative.length - 1] = 1;
    const probability = outcome => probabilities[ENTANGLED_PAIR_OUTCOMES.indexOf(outcome)];
    const aliceMarginals = Object.freeze({
        plus: probability('++') + probability('+-'),
        minus: probability('-+') + probability('--')
    });
    const bobMarginals = Object.freeze({
        plus: probability('++') + probability('-+'),
        minus: probability('+-') + probability('--')
    });
    const correlation = probability('++') - probability('+-') - probability('-+') + probability('--');

    return {
        outcomes: ENTANGLED_PAIR_OUTCOMES,
        amplitudes,
        probabilities,
        cumulative,
        aliceBasis,
        bobBasis,
        aliceMarginals,
        bobMarginals,
        correlation,
        aliceAngleDeg: aliceAngle,
        bobAngleDeg: bobAngle,
        model: 'photon-polarization-singlet'
    };
}

export function sampleEntangledPairs(distribution, count, random = Math.random) {
    const sampleCount = positiveInteger(count, 'count');
    if (distribution?.model !== 'photon-polarization-singlet') {
        throw new TypeError('a photon-polarization singlet distribution is required');
    }
    const outcomes = new Array(sampleCount);
    for (let eventIndex = 0; eventIndex < sampleCount; eventIndex += 1) {
        const draw = finiteNumber(random(), 'random draw');
        if (draw < 0 || draw >= 1) throw new RangeError('random draw must be at least 0 and less than 1');
        let index = 0;
        while (index < distribution.cumulative.length - 1 && draw > distribution.cumulative[index]) index += 1;
        outcomes[eventIndex] = distribution.outcomes[index];
    }
    return outcomes;
}

export class EntanglementExperiment {
    constructor(distribution, seed = DEFAULT_SINGLE_PARTICLE_SEED) {
        this.seed = seed;
        this.setDistribution(distribution);
    }

    setDistribution(distribution) {
        if (distribution?.model !== 'photon-polarization-singlet') {
            throw new TypeError('a photon-polarization singlet distribution is required');
        }
        this.distribution = distribution;
        this.counts = new Uint32Array(ENTANGLED_PAIR_OUTCOMES.length);
        this.total = 0;
        this.recent = [];
        this.random = createSeededRandom(this.seed);
    }

    reset(random = createSeededRandom(this.seed)) {
        this.counts.fill(0);
        this.total = 0;
        this.recent.length = 0;
        this.random = random;
    }

    emit(count) {
        const outcomes = sampleEntangledPairs(this.distribution, count, this.random);
        for (const outcome of outcomes) {
            const index = ENTANGLED_PAIR_OUTCOMES.indexOf(outcome);
            this.counts[index] += 1;
            this.total += 1;
            this.recent.push({ outcome, sequence: this.total });
        }
        if (this.recent.length > 80) this.recent.splice(0, this.recent.length - 80);
        return outcomes;
    }

    measuredSummary() {
        if (this.total === 0) {
            return {
                total: 0,
                correlation: 0,
                alice: { plus: 0, minus: 0 },
                bob: { plus: 0, minus: 0 }
            };
        }
        const [pp, pm, mp, mm] = this.counts;
        return {
            total: this.total,
            correlation: (pp - pm - mp + mm) / this.total,
            alice: { plus: (pp + pm) / this.total, minus: (mp + mm) / this.total },
            bob: { plus: (pp + mp) / this.total, minus: (pm + mm) / this.total }
        };
    }
}

export const CHSH_SIGN_CONVENTION = 'E(a,b)+E(a,bPrime)+E(aPrime,b)-E(aPrime,bPrime)';
export const CHSH_LOCAL_BOUND = 2;
export const CHSH_TSIRELSON_BOUND = 2 * Math.sqrt(2);
export const CHSH_MAX_VIOLATION_PRESET = Object.freeze({
    aDeg: 0,
    aPrimeDeg: 45,
    bDeg: 22.5,
    bPrimeDeg: 157.5,
    bPrimeEquivalentDeg: -22.5
});
export const CHSH_COHORTS = Object.freeze([
    Object.freeze({ key: 'ab', aliceSetting: 'a', bobSetting: 'b', sign: 1 }),
    Object.freeze({ key: 'abPrime', aliceSetting: 'a', bobSetting: 'bPrime', sign: 1 }),
    Object.freeze({ key: 'aPrimeB', aliceSetting: 'aPrime', bobSetting: 'b', sign: 1 }),
    Object.freeze({ key: 'aPrimeBPrime', aliceSetting: 'aPrime', bobSetting: 'bPrime', sign: -1 })
]);

function chshAngles(options = {}) {
    return Object.freeze({
        aDeg: finiteNumber(options.aDeg ?? CHSH_MAX_VIOLATION_PRESET.aDeg, 'aDeg'),
        aPrimeDeg: finiteNumber(options.aPrimeDeg ?? CHSH_MAX_VIOLATION_PRESET.aPrimeDeg, 'aPrimeDeg'),
        bDeg: finiteNumber(options.bDeg ?? CHSH_MAX_VIOLATION_PRESET.bDeg, 'bDeg'),
        bPrimeDeg: finiteNumber(options.bPrimeDeg ?? CHSH_MAX_VIOLATION_PRESET.bPrimeDeg, 'bPrimeDeg')
    });
}

function cohortAngles(angles, cohort) {
    return {
        aliceAngleDeg: cohort.aliceSetting === 'a' ? angles.aDeg : angles.aPrimeDeg,
        bobAngleDeg: cohort.bobSetting === 'b' ? angles.bDeg : angles.bPrimeDeg
    };
}

function polarizationAngularDistance(firstDeg, secondDeg) {
    const raw = Math.abs((firstDeg - secondDeg) * Math.PI / 180) % Math.PI;
    return Math.min(raw, Math.PI - raw);
}

export function localHiddenVariableExpectedCorrelation(aliceAngleDeg, bobAngleDeg) {
    const distance = polarizationAngularDistance(
        finiteNumber(aliceAngleDeg, 'aliceAngleDeg'),
        finiteNumber(bobAngleDeg, 'bobAngleDeg')
    );
    return -1 + 4 * distance / Math.PI;
}

export function localAlicePolarizationResponse(aliceAngleDeg, lambda) {
    const angle = finiteNumber(aliceAngleDeg, 'aliceAngleDeg') * Math.PI / 180;
    const hidden = finiteNumber(lambda, 'lambda');
    return Math.cos(2 * (angle - hidden)) >= 0 ? '+' : '-';
}

export function localBobPolarizationResponse(bobAngleDeg, lambda) {
    const angle = finiteNumber(bobAngleDeg, 'bobAngleDeg') * Math.PI / 180;
    const hidden = finiteNumber(lambda, 'lambda');
    return Math.cos(2 * (angle - hidden)) >= 0 ? '-' : '+';
}

export function calculateChshS(correlations) {
    return finiteNumber(correlations.ab, 'E(a,b)') +
        finiteNumber(correlations.abPrime, 'E(a,bPrime)') +
        finiteNumber(correlations.aPrimeB, 'E(aPrime,b)') -
        finiteNumber(correlations.aPrimeBPrime, 'E(aPrime,bPrime)');
}

export function createChshConfiguration({ model = 'quantum', ...angleOptions } = {}) {
    if (!['quantum', 'local'].includes(model)) throw new RangeError('CHSH model must be quantum or local');
    const angles = chshAngles(angleOptions);
    const distributions = {};
    const expectedCorrelations = {};
    for (const cohort of CHSH_COHORTS) {
        const selected = cohortAngles(angles, cohort);
        if (model === 'quantum') {
            const distribution = createPolarizationSingletDistribution(selected);
            distributions[cohort.key] = distribution;
            expectedCorrelations[cohort.key] = distribution.correlation;
        } else {
            expectedCorrelations[cohort.key] = localHiddenVariableExpectedCorrelation(
                selected.aliceAngleDeg,
                selected.bobAngleDeg
            );
        }
    }
    return {
        model,
        angles,
        distributions: Object.freeze(distributions),
        expectedCorrelations: Object.freeze(expectedCorrelations),
        expectedS: calculateChshS(expectedCorrelations),
        signConvention: CHSH_SIGN_CONVENTION,
        modelName: model === 'quantum' ? 'Quantum photon polarization' : 'Example local hidden-variable model'
    };
}

export function sampleChshTrial(configuration, random = Math.random) {
    if (!configuration?.expectedCorrelations || !['quantum', 'local'].includes(configuration.model)) {
        throw new TypeError('a valid CHSH configuration is required');
    }
    // Settings are selected first with separate random draws. The physical
    // outcome/hidden-variable draw follows and cannot affect those choices.
    const aliceSetting = random() < 0.5 ? 'a' : 'aPrime';
    const bobSetting = random() < 0.5 ? 'b' : 'bPrime';
    const cohort = CHSH_COHORTS.find(item =>
        item.aliceSetting === aliceSetting && item.bobSetting === bobSetting
    );
    const selected = cohortAngles(configuration.angles, cohort);
    let outcome;
    let lambda = null;
    if (configuration.model === 'quantum') {
        outcome = sampleEntangledPairs(configuration.distributions[cohort.key], 1, random)[0];
    } else {
        lambda = random() * Math.PI;
        outcome = localAlicePolarizationResponse(selected.aliceAngleDeg, lambda) +
            localBobPolarizationResponse(selected.bobAngleDeg, lambda);
    }
    return {
        cohort: cohort.key,
        aliceSetting,
        bobSetting,
        aliceAngleDeg: selected.aliceAngleDeg,
        bobAngleDeg: selected.bobAngleDeg,
        outcome,
        lambda
    };
}

function emptyChshCohorts() {
    return Object.fromEntries(CHSH_COHORTS.map(cohort => [cohort.key, {
        total: 0,
        counts: new Uint32Array(ENTANGLED_PAIR_OUTCOMES.length)
    }]));
}

function cohortSummary(cohort) {
    if (cohort.total === 0) {
        return { total: 0, correlation: 0, uncertainty: null, alicePlus: 0, bobPlus: 0 };
    }
    const [pp, pm, mp, mm] = cohort.counts;
    const correlation = (pp - pm - mp + mm) / cohort.total;
    return {
        total: cohort.total,
        correlation,
        uncertainty: Math.sqrt(Math.max(0, 1 - correlation * correlation) / cohort.total),
        alicePlus: (pp + pm) / cohort.total,
        bobPlus: (pp + mp) / cohort.total
    };
}

export class ChshExperiment {
    constructor(configuration, seed = DEFAULT_SINGLE_PARTICLE_SEED) {
        this.seed = seed;
        this.setConfiguration(configuration);
    }

    setConfiguration(configuration) {
        if (!configuration?.expectedCorrelations) throw new TypeError('a CHSH configuration is required');
        this.configuration = configuration;
        this.cohorts = emptyChshCohorts();
        this.total = 0;
        this.recent = [];
        this.random = createSeededRandom(this.seed);
    }

    reset(random = createSeededRandom(this.seed)) {
        this.cohorts = emptyChshCohorts();
        this.total = 0;
        this.recent.length = 0;
        this.random = random;
    }

    emit(count) {
        const sampleCount = positiveInteger(count, 'count');
        const trials = new Array(sampleCount);
        for (let index = 0; index < sampleCount; index += 1) {
            const trial = sampleChshTrial(this.configuration, this.random);
            const cohort = this.cohorts[trial.cohort];
            cohort.total += 1;
            cohort.counts[ENTANGLED_PAIR_OUTCOMES.indexOf(trial.outcome)] += 1;
            this.total += 1;
            this.recent.push({ ...trial, sequence: this.total });
            trials[index] = trial;
        }
        if (this.recent.length > 80) this.recent.splice(0, this.recent.length - 80);
        return trials;
    }

    summary() {
        const cohorts = Object.fromEntries(CHSH_COHORTS.map(({ key }) => [key, cohortSummary(this.cohorts[key])]));
        const correlations = Object.fromEntries(CHSH_COHORTS.map(({ key }) => [key, cohorts[key].correlation]));
        const allPopulated = CHSH_COHORTS.every(({ key }) => cohorts[key].total > 0);
        const measuredS = allPopulated ? calculateChshS(correlations) : 0;
        const uncertainty = allPopulated
            ? Math.sqrt(CHSH_COHORTS.reduce((sum, { key }) => sum + cohorts[key].uncertainty ** 2, 0))
            : null;
        return {
            total: this.total,
            cohorts,
            measuredS,
            absoluteS: Math.abs(measuredS),
            uncertainty,
            expectedS: this.configuration.expectedS
        };
    }
}

export function createSingleSlitFraunhoferDistribution(options = {}) {
    return createFraunhoferDistribution(options, 1);
}
