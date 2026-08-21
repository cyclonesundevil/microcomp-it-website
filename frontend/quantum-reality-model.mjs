import {
    CHSH_COHORTS,
    CHSH_MAX_VIOLATION_PRESET,
    calculateChshS,
    createPolarizationSingletDistribution,
    createSeededRandom,
    sampleEntangledPairs
} from './quantum-playground-model.mjs';

export const REALITY_ANGLE_GRID_DEG = Object.freeze([0, 15, 30, 45, 60, 75, 90]);
export const REALITY_MODEL_MODES = Object.freeze(['local', 'measurement-dependent', 'nonlocal-quantum']);
const VERIFIED_REALITY_CANDIDATES = new WeakSet();

const OUTCOMES = Object.freeze(['++', '+-', '-+', '--']);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const signValue = sign => sign === '+' ? 1 : -1;
const angleRadians = degrees => degrees * Math.PI / 180;
const outcomeProduct = outcome => signValue(outcome[0]) * signValue(outcome[1]);
const quantumCorrelation = (aliceAngleDeg, bobAngleDeg) =>
    -Math.cos(2 * angleRadians(aliceAngleDeg - bobAngleDeg));

export const REALITY_GRID_SCENARIOS = Object.freeze(REALITY_ANGLE_GRID_DEG.flatMap(aliceAngleDeg =>
    REALITY_ANGLE_GRID_DEG.map(bobAngleDeg => Object.freeze({
        id: `grid-${aliceAngleDeg}-${bobAngleDeg}`,
        family: 'grid',
        aliceAngleDeg,
        bobAngleDeg,
        targetCorrelation: quantumCorrelation(aliceAngleDeg, bobAngleDeg)
    }))
));

export const REALITY_CHSH_SCENARIOS = Object.freeze(CHSH_COHORTS.map(cohort => Object.freeze({
    id: `chsh-${cohort.key}`,
    family: 'chsh',
    cohort: cohort.key,
    aliceAngleDeg: cohort.aliceSetting === 'a'
        ? CHSH_MAX_VIOLATION_PRESET.aDeg
        : CHSH_MAX_VIOLATION_PRESET.aPrimeDeg,
    bobAngleDeg: cohort.bobSetting === 'b'
        ? CHSH_MAX_VIOLATION_PRESET.bDeg
        : CHSH_MAX_VIOLATION_PRESET.bPrimeDeg,
    targetCorrelation: quantumCorrelation(
        cohort.aliceSetting === 'a' ? CHSH_MAX_VIOLATION_PRESET.aDeg : CHSH_MAX_VIOLATION_PRESET.aPrimeDeg,
        cohort.bobSetting === 'b' ? CHSH_MAX_VIOLATION_PRESET.bDeg : CHSH_MAX_VIOLATION_PRESET.bPrimeDeg
    )
})));

export const REALITY_BENCHMARK_SCENARIOS = Object.freeze([
    ...REALITY_GRID_SCENARIOS,
    ...REALITY_CHSH_SCENARIOS
]);

function boundedNumber(value, fallback, minimum, maximum, name) {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
        throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
    }
    return number;
}

function normalizeConfig(options = {}) {
    const mode = options.mode ?? 'local';
    if (!REALITY_MODEL_MODES.includes(mode)) throw new RangeError('unknown reality model mode');
    const hiddenDistribution = options.hiddenDistribution ?? 'uniform';
    if (!['uniform', 'axial-biased'].includes(hiddenDistribution)) {
        throw new RangeError('hiddenDistribution must be uniform or axial-biased');
    }
    const responseShape = options.responseShape ?? 'threshold';
    if (!['threshold', 'soft'].includes(responseShape)) {
        throw new RangeError('responseShape must be threshold or soft');
    }
    return Object.freeze({
        mode,
        hiddenDistribution,
        hiddenBias: boundedNumber(options.hiddenBias, 0, 0, 0.8, 'hiddenBias'),
        hiddenAxisDeg: boundedNumber(options.hiddenAxisDeg, 0, 0, 180, 'hiddenAxisDeg'),
        responseShape,
        responseSoftness: boundedNumber(options.responseSoftness, 0.35, 0.05, 1, 'responseSoftness'),
        localNoise: boundedNumber(options.localNoise, 0, 0, 0.5, 'localNoise'),
        sharedSourceNoise: boundedNumber(options.sharedSourceNoise, 0, 0, 0.5, 'sharedSourceNoise'),
        dependenceStrength: boundedNumber(options.dependenceStrength, 0.75, 0, 1, 'dependenceStrength')
    });
}

export function localResponseProbabilities(localAngleDeg, lambda, config, party) {
    if (!['alice', 'bob'].includes(party)) throw new RangeError('party must be alice or bob');
    const phase = Math.cos(2 * (angleRadians(localAngleDeg) - lambda));
    const orientation = party === 'alice' ? phase : -phase;
    let plus;
    if (config.responseShape === 'threshold') {
        plus = orientation >= 0 ? 1 : 0;
    } else {
        const sharpness = 1 / config.responseSoftness;
        plus = (1 + Math.tanh(sharpness * orientation) / Math.tanh(sharpness)) / 2;
    }
    plus = plus * (1 - config.localNoise) + (1 - plus) * config.localNoise;
    plus = clamp(plus, 0, 1);
    return Object.freeze({ plus, minus: 1 - plus });
}

function drawSign(probabilities, random) {
    return random() < probabilities.plus ? '+' : '-';
}

function sampleMeasurementIndependentLambda(config, random) {
    if (config.hiddenDistribution === 'uniform' || config.hiddenBias === 0) return random() * Math.PI;
    const axis = angleRadians(config.hiddenAxisDeg);
    while (true) {
        const proposal = random() * Math.PI;
        const acceptance = (1 + config.hiddenBias * Math.cos(2 * (proposal - axis))) / (1 + config.hiddenBias);
        if (random() < acceptance) return proposal;
    }
}

function deterministicLocalProduct(aliceAngleDeg, bobAngleDeg, lambda) {
    const alice = Math.cos(2 * (angleRadians(aliceAngleDeg) - lambda)) >= 0 ? 1 : -1;
    const bob = Math.cos(2 * (angleRadians(bobAngleDeg) - lambda)) >= 0 ? -1 : 1;
    return alice * bob;
}

function sampleSettingDependentLambda(config, aliceAngleDeg, bobAngleDeg, random) {
    const target = quantumCorrelation(aliceAngleDeg, bobAngleDeg);
    while (true) {
        const proposal = sampleMeasurementIndependentLambda(config, random);
        const product = deterministicLocalProduct(aliceAngleDeg, bobAngleDeg, proposal);
        const weight = 1 + config.dependenceStrength * target * product;
        if (random() * 2 <= weight) return proposal;
    }
}

function applySharedSourceNoise(outcome, probability, random) {
    if (random() >= probability) return outcome;
    return `${outcome[0] === '+' ? '-' : '+'}${outcome[1] === '+' ? '-' : '+'}`;
}

function ledgerFor(config) {
    const localityPreserved = config.mode !== 'nonlocal-quantum';
    const measurementIndependencePreserved = config.mode !== 'measurement-dependent';
    return Object.freeze({
        locality: localityPreserved ? 'preserved' : 'relaxed',
        measurementIndependence: measurementIndependencePreserved ? 'preserved' : 'relaxed',
        noSignaling: 'tested from conditional marginals',
        responseType: config.mode === 'nonlocal-quantum'
            ? 'Quantum Born Joint Reference'
            : config.responseShape === 'threshold' && config.localNoise === 0
                ? 'deterministic local responses'
                : 'stochastic local responses',
        additionalAssumptions: config.mode === 'nonlocal-quantum'
            ? Object.freeze([
                'photon-polarization singlet state',
                'Born-rule joint outcomes',
                'Bell-local hidden-variable factorization is not imposed',
                'no physical influence or message between Alice and Bob is simulated'
            ])
            : Object.freeze([
                `${config.hiddenDistribution} hidden-variable distribution`,
                `${config.responseShape} local response shape`,
                `local noise ${config.localNoise.toFixed(2)}`,
                `shared-source noise ${config.sharedSourceNoise.toFixed(2)}`
            ])
    });
}

export function createRealityCandidate(options = {}) {
    const config = normalizeConfig(options);
    const ledger = ledgerFor(config);
    const capabilities = Object.freeze({
        localResponses: config.mode !== 'nonlocal-quantum',
        hiddenVariableMayAccessSettings: config.mode === 'measurement-dependent',
        jointResponseMayAccessBothSettings: config.mode === 'nonlocal-quantum'
    });
    const candidate = Object.freeze({
        id: JSON.stringify(config),
        config,
        ledger,
        capabilities,
        modelApi: Object.freeze({
            hiddenVariableInputs: capabilities.hiddenVariableMayAccessSettings
                ? Object.freeze(['aliceAngleDeg', 'bobAngleDeg', 'random'])
                : Object.freeze(['random']),
            aliceResponseInputs: capabilities.localResponses
                ? Object.freeze(['aliceAngleDeg', 'lambda', 'random'])
                : Object.freeze([]),
            bobResponseInputs: capabilities.localResponses
                ? Object.freeze(['bobAngleDeg', 'lambda', 'random'])
                : Object.freeze([]),
            jointResponseInputs: capabilities.jointResponseMayAccessBothSettings
                ? Object.freeze(['aliceAngleDeg', 'bobAngleDeg', 'random'])
                : Object.freeze([])
        })
    });
    VERIFIED_REALITY_CANDIDATES.add(candidate);
    return candidate;
}

export function sampleRealityTrial(candidate, scenario, random = Math.random) {
    if (!VERIFIED_REALITY_CANDIDATES.has(candidate) || !REALITY_BENCHMARK_SCENARIOS.includes(scenario)) {
        throw new TypeError('candidate and predetermined benchmark scenario are required');
    }
    const { config } = candidate;
    let lambda = null;
    let outcome;
    if (config.mode === 'nonlocal-quantum') {
        const distribution = createPolarizationSingletDistribution({
            aliceAngleDeg: scenario.aliceAngleDeg,
            bobAngleDeg: scenario.bobAngleDeg
        });
        outcome = sampleEntangledPairs(distribution, 1, random)[0];
    } else {
        lambda = config.mode === 'measurement-dependent'
            ? sampleSettingDependentLambda(config, scenario.aliceAngleDeg, scenario.bobAngleDeg, random)
            : sampleMeasurementIndependentLambda(config, random);
        const aliceProbabilities = localResponseProbabilities(
            scenario.aliceAngleDeg, lambda, config, 'alice'
        );
        const bobProbabilities = localResponseProbabilities(
            scenario.bobAngleDeg, lambda, config, 'bob'
        );
        outcome = drawSign(aliceProbabilities, random) + drawSign(bobProbabilities, random);
        outcome = applySharedSourceNoise(outcome, config.sharedSourceNoise, random);
    }
    return Object.freeze({
        scenarioId: scenario.id,
        family: scenario.family,
        cohort: scenario.cohort ?? null,
        aliceAngleDeg: scenario.aliceAngleDeg,
        bobAngleDeg: scenario.bobAngleDeg,
        lambda,
        outcome,
        outcomeProduct: outcomeProduct(outcome),
        candidateId: candidate.id,
        assumptions: candidate.ledger
    });
}

function emptyScenarioState(scenario) {
    return {
        scenario,
        total: 0,
        counts: new Uint32Array(OUTCOMES.length)
    };
}

function summarizeScenario(state) {
    if (state.total === 0) {
        return { total: 0, correlation: 0, alicePlus: 0, bobPlus: 0, targetCorrelation: state.scenario.targetCorrelation };
    }
    const [pp, pm, mp, mm] = state.counts;
    return {
        total: state.total,
        correlation: (pp - pm - mp + mm) / state.total,
        alicePlus: (pp + pm) / state.total,
        bobPlus: (pp + mp) / state.total,
        targetCorrelation: state.scenario.targetCorrelation
    };
}

export function correlationCurveRmse(summaries) {
    const populated = summaries.filter(summary => summary.total > 0);
    if (populated.length !== REALITY_GRID_SCENARIOS.length) return null;
    const mse = populated.reduce((sum, summary) =>
        sum + (summary.correlation - summary.targetCorrelation) ** 2, 0
    ) / populated.length;
    return Math.sqrt(mse);
}

export function evaluateOperationalNoSignaling(gridSummaries) {
    const aliceGroups = new Map();
    const bobGroups = new Map();
    gridSummaries.filter(summary => summary.total > 0).forEach(summary => {
        const { aliceAngleDeg, bobAngleDeg } = summary.scenario;
        if (!aliceGroups.has(aliceAngleDeg)) aliceGroups.set(aliceAngleDeg, []);
        if (!bobGroups.has(bobAngleDeg)) bobGroups.set(bobAngleDeg, []);
        aliceGroups.get(aliceAngleDeg).push(summary);
        bobGroups.get(bobAngleDeg).push(summary);
    });
    const maxRange = (groups, field) => Math.max(0, ...[...groups.values()].map(group => {
        const values = group.map(item => item[field]);
        return values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
    }));
    const minimumN = Math.min(Infinity, ...gridSummaries.filter(item => item.total > 0).map(item => item.total));
    // Worst-case approximate standard error for a difference between two
    // independently estimated Bernoulli marginals with the smallest cohort N.
    const approximateDifferenceUncertainty = Number.isFinite(minimumN) ? Math.sqrt(0.5 / minimumN) : null;
    const tolerance = approximateDifferenceUncertainty === null ? null : Math.max(0.05, 4 * approximateDifferenceUncertainty);
    const aliceMaxDelta = maxRange(aliceGroups, 'alicePlus');
    const bobMaxDelta = maxRange(bobGroups, 'bobPlus');
    return {
        aliceMaxDelta,
        bobMaxDelta,
        approximateDifferenceUncertainty,
        tolerance,
        tested: aliceGroups.size === REALITY_ANGLE_GRID_DEG.length && bobGroups.size === REALITY_ANGLE_GRID_DEG.length,
        satisfied: tolerance !== null && aliceMaxDelta <= tolerance && bobMaxDelta <= tolerance,
        evidence: tolerance === null
            ? 'incomplete'
            : aliceMaxDelta <= tolerance && bobMaxDelta <= tolerance
                ? 'consistent-with-no-signaling'
                : 'detectable-remote-setting-dependence'
    };
}

export function buildRealityVerdict({ candidate, gridRmse, measuredS, noSignaling, equalAngleRmse }) {
    if (gridRmse === null || measuredS === null || !noSignaling.tested) {
        return { level: 'incomplete', title: 'Benchmark incomplete', explanation: 'Populate every predetermined angle pair and all four CHSH cohorts before drawing a conclusion.' };
    }
    const chshMatches = Math.abs(Math.abs(measuredS) - 2 * Math.sqrt(2)) < 0.18;
    const curveMatches = gridRmse < 0.12;
    const equalAngleMatches = equalAngleRmse < 0.12;
    if (chshMatches && curveMatches && equalAngleMatches && noSignaling.satisfied) {
        const relaxed = [
            candidate.ledger.locality === 'relaxed' ? 'locality' : null,
            candidate.ledger.measurementIndependence === 'relaxed' ? 'measurement independence' : null
        ].filter(Boolean);
        const bornReference = candidate.config.mode === 'nonlocal-quantum';
        return {
            level: relaxed.length ? 'qualified' : 'success',
            title: 'Quantum statistics reproduced on this benchmark',
            explanation: bornReference
                ? 'The Quantum Born Joint Reference matched the CHSH and full-grid targets. Bell-local hidden-variable factorization is not imposed; no influence or message between Alice and Bob is simulated. The Born-rule reference is theoretically no-signaling, and the finite sampled marginals are consistent with that prediction.'
                : relaxed.length
                ? `The model matched the CHSH and full-grid targets while explicitly relaxing ${relaxed.join(' and ')}.`
                : 'The model matched the CHSH and full-grid targets while retaining its listed assumptions.'
        };
    }
    const reasons = [];
    if (!equalAngleMatches) reasons.push('equal-angle anticorrelation was not reproduced');
    if (!chshMatches) reasons.push('the maximum-CHSH target was missed');
    if (!curveMatches) reasons.push(`the full correlation curve differs (RMSE ${gridRmse.toFixed(3)})`);
    if (!noSignaling.satisfied) reasons.push('detectable remote-setting dependence appears in the sampled local marginals');
    return {
        level: 'failed',
        title: chshMatches && !curveMatches ? 'One CHSH point is not enough' : 'Model does not reproduce quantum mechanics',
        explanation: `${reasons.join('; ')}. This verdict follows from generated outcomes, not a preset model label.`
    };
}

export class RealityExperiment {
    constructor(candidate, seed = 'quantum-phase-8') {
        this.seed = seed;
        this.setCandidate(candidate);
    }

    setCandidate(candidate) {
        if (!VERIFIED_REALITY_CANDIDATES.has(candidate)) throw new TypeError('a verified reality candidate is required');
        this.candidate = candidate;
        this.reset();
    }

    reset(random) {
        this.random = random ?? createSeededRandom(this.seed);
        this.scenarios = Object.fromEntries(REALITY_BENCHMARK_SCENARIOS.map(scenario => [scenario.id, emptyScenarioState(scenario)]));
        this.total = 0;
        this.nextScenarioIndex = 0;
        this.auditTrail = [];
    }

    emit(count) {
        if (!Number.isInteger(count) || count <= 0) throw new RangeError('count must be a positive integer');
        const trials = new Array(count);
        for (let index = 0; index < count; index += 1) {
            const scenario = REALITY_BENCHMARK_SCENARIOS[this.nextScenarioIndex];
            this.nextScenarioIndex = (this.nextScenarioIndex + 1) % REALITY_BENCHMARK_SCENARIOS.length;
            const trial = sampleRealityTrial(this.candidate, scenario, this.random);
            const state = this.scenarios[scenario.id];
            state.total += 1;
            state.counts[OUTCOMES.indexOf(trial.outcome)] += 1;
            this.total += 1;
            const audited = Object.freeze({ ...trial, sequence: this.total });
            this.auditTrail.push(audited);
            trials[index] = audited;
        }
        return trials;
    }

    summary() {
        const grid = REALITY_GRID_SCENARIOS.map(scenario => ({
            scenario,
            ...summarizeScenario(this.scenarios[scenario.id])
        }));
        const chsh = Object.fromEntries(REALITY_CHSH_SCENARIOS.map(scenario => [
            scenario.cohort,
            summarizeScenario(this.scenarios[scenario.id])
        ]));
        const chshPopulated = Object.values(chsh).every(summary => summary.total > 0);
        const measuredS = chshPopulated ? calculateChshS(Object.fromEntries(
            Object.entries(chsh).map(([key, value]) => [key, value.correlation])
        )) : null;
        const approximateSigmaS = chshPopulated ? Math.sqrt(Object.values(chsh).reduce((sum, cohort) =>
            sum + Math.max(0, 1 - cohort.correlation ** 2) / cohort.total, 0
        )) : null;
        const gridRmse = correlationCurveRmse(grid);
        const diagonal = grid.filter(item => item.scenario.aliceAngleDeg === item.scenario.bobAngleDeg && item.total > 0);
        const equalAngleRmse = diagonal.length === REALITY_ANGLE_GRID_DEG.length
            ? Math.sqrt(diagonal.reduce((sum, item) => sum + (item.correlation + 1) ** 2, 0) / diagonal.length)
            : null;
        const noSignaling = evaluateOperationalNoSignaling(grid);
        const verdict = buildRealityVerdict({
            candidate: this.candidate,
            gridRmse,
            measuredS,
            noSignaling,
            equalAngleRmse
        });
        return {
            total: this.total,
            grid,
            chsh,
            measuredS,
            approximateSigmaS,
            gridRmse,
            equalAngleRmse,
            noSignaling,
            verdict,
            ledger: this.candidate.ledger
        };
    }
}
