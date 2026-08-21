import {
    DEFAULT_DOUBLE_SLIT_GEOMETRY,
    DEFAULT_SINGLE_PARTICLE_SEED,
    CHSH_LOCAL_BOUND,
    CHSH_TSIRELSON_BOUND,
    ChshExperiment,
    DetectionExperiment,
    EntanglementExperiment,
    QuantumEraserExperiment,
    createDecoherenceDistribution,
    createDoubleSlitDistribution,
    createChshConfiguration,
    createPolarizationSingletDistribution,
    createQuantumEraserDistribution,
    createWhichPathDistribution,
    createSeededRandom,
    createSingleParticleDistribution,
    idealComplementarity,
} from './quantum-playground-model.mjs?v=1.6';
import {
    REALITY_ANGLE_GRID_DEG,
    REALITY_BENCHMARK_SCENARIOS,
    RealityExperiment,
    createRealityCandidate
} from './quantum-reality-model.mjs?v=1.1';

const EXPERIMENTS = Object.freeze({
    single: { title: 'Single Particle', phase: 'Live' },
    'double-slit': { title: 'Double-Slit Interference', phase: 'Live' },
    'which-path': { title: 'Which-Path Measurement', phase: 'Live' },
    decoherence: { title: 'Decoherence / Partial Coherence', phase: 'Live' },
    'quantum-eraser': { title: 'Quantum Eraser', phase: 'Live' },
    entanglement: { title: 'Photon Polarization Entanglement', phase: 'Live' },
    'bell-test': { title: 'Bell / CHSH Test', phase: 'Live' },
    'build-reality': { title: 'Build Your Own Reality', phase: 'Live' }
});

const EXPERIMENT_GUIDANCE = Object.freeze({
    single: {
        intro: 'Prepare a probability distribution, emit one event at a time, and watch stable statistics emerge from unpredictable detections.',
        seeing: 'The teal curve is the calculated probability distribution. Purple marks are sampled detections. The source pulse is an interface cue, not a measured trajectory.'
    },
    'double-slit': {
        intro: 'Combine two complex path amplitudes and let individual sampled impacts reveal interference statistically.',
        seeing: 'The calculated teal curve contains a single-slit diffraction envelope and two-path fringes. Each purple impact is sampled from that normalized distribution; no fringe locations are painted into the renderer.'
    },
    'which-path': {
        intro: 'Compare indistinguishable paths with paths correlated to distinguishable marker states.',
        seeing: 'Detector OFF preserves the amplitude cross term. Detector ON uses orthogonal marker states, so the sampled marginal retains the diffraction envelope without interference. This is a physical correlation model, not a consciousness rule.'
    },
    decoherence: {
        intro: 'Vary marker-state overlap to see partial coherence change fringe visibility continuously.',
        seeing: 'The slider constructs normalized marker states. Their overlap weights the calculated interference cross term; the decorative apparatus does not directly alter the plotted pattern.'
    },
    'quantum-eraser': {
        intro: 'Sort one joint detector-and-marker ensemble into complementary conditional subsets.',
        seeing: 'Marker + and Marker − subsets reveal complementary conditional fringes. All events together remain non-interfering. Sorting correlations does not change the past or send information backward in time.'
    },
    entanglement: {
        intro: 'Emit polarization-singlet photon pairs and compare one jointly sampled outcome at two analyzer settings.',
        seeing: 'Bars show calculated Born probabilities and sampled joint pair counts. Each local stream is theoretically 50/50; correlations appear only when Alice and Bob compare paired records. No message is sent between them.'
    },
    'bell-test': {
        intro: 'Randomly choose analyzer settings, accumulate four cohorts, and compare quantum and Bell-local correlation models.',
        seeing: 'Each cohort displays sampled correlations beside model expectations. Finite S can fluctuate; σS is only an approximate standard error, not a p-value or proof of an interpretation.'
    },
    'build-reality': {
        intro: 'Construct an explicit outcome mechanism and test it against equal-angle anticorrelation, CHSH, the full quantum curve, and local marginals.',
        seeing: 'The cyan curve is the quantum target and purple points come from candidate-generated outcomes. The ledger is derived from the mechanism API. A match is qualified by any assumption the candidate had to relax.'
    }
});

class QuantumPlaygroundController {
    constructor(root = document) {
        this.canvas = root.getElementById('quantum-canvas');
        this.context = this.canvas.getContext('2d');
        this.stage = root.getElementById('quantum-stage');
        this.pulse = root.getElementById('quantum-flight-pulse');
        this.title = root.getElementById('quantum-experiment-title');
        this.status = root.getElementById('quantum-status-badge');
        this.eventCount = root.getElementById('quantum-event-count');
        this.totalReadout = root.getElementById('quantum-total-readout');
        this.totalLabel = root.getElementById('quantum-total-label');
        this.meanReadout = root.getElementById('quantum-mean-readout');
        this.meanLabel = root.getElementById('quantum-mean-label');
        this.spreadReadout = root.getElementById('quantum-spread-readout');
        this.spreadLabel = root.getElementById('quantum-spread-label');
        this.randomReadout = root.getElementById('quantum-random-readout');
        this.liveSummary = root.getElementById('quantum-live-summary');
        this.experimentIntro = root.getElementById('quantum-experiment-intro');
        this.seeingCopy = root.getElementById('quantum-seeing-copy');
        this.emptyState = root.getElementById('quantum-empty-state');
        this.batchSize = root.getElementById('quantum-batch-size');
        this.batchLabel = root.getElementById('quantum-batch-label');
        this.fixedSeed = root.getElementById('quantum-fixed-seed');
        this.seed = root.getElementById('quantum-seed');
        this.emitOneButton = root.getElementById('quantum-emit-one');
        this.emitBatchButton = root.getElementById('quantum-emit-batch');
        this.runButton = root.getElementById('quantum-run-toggle');
        this.resetButton = root.getElementById('quantum-reset');
        this.controlNote = root.getElementById('quantum-control-note');
        this.doubleSlitControls = root.getElementById('quantum-double-slit-controls');
        this.whichPathControls = root.getElementById('quantum-which-path-controls');
        this.whichPathDetector = root.getElementById('quantum-which-path-detector');
        this.markerState = root.getElementById('quantum-marker-state');
        this.decoherenceControls = root.getElementById('quantum-decoherence-controls');
        this.coherence = root.getElementById('quantum-coherence');
        this.coherenceValue = root.getElementById('quantum-coherence-value');
        this.visibility = root.getElementById('quantum-visibility');
        this.distinguishability = root.getElementById('quantum-distinguishability');
        this.eraserControls = root.getElementById('quantum-eraser-controls');
        this.eraserViewButtons = [...root.querySelectorAll('[data-eraser-view]')];
        this.plusCount = root.getElementById('quantum-plus-count');
        this.minusCount = root.getElementById('quantum-minus-count');
        this.entanglementControls = root.getElementById('quantum-entanglement-controls');
        this.aliceAngle = root.getElementById('quantum-alice-angle');
        this.bobAngle = root.getElementById('quantum-bob-angle');
        this.aliceAngleValue = root.getElementById('quantum-alice-angle-value');
        this.bobAngleValue = root.getElementById('quantum-bob-angle-value');
        this.jointCountReadouts = ['pp', 'pm', 'mp', 'mm'].map(key => root.getElementById(`quantum-count-${key}`));
        this.aliceMarginal = root.getElementById('quantum-alice-marginal');
        this.bobMarginal = root.getElementById('quantum-bob-marginal');
        this.chshControls = root.getElementById('quantum-chsh-controls');
        this.chshModel = root.getElementById('quantum-chsh-model');
        this.chshPreset = root.getElementById('quantum-chsh-preset');
        this.chshAngles = {
            aDeg: root.getElementById('quantum-chsh-a'),
            aPrimeDeg: root.getElementById('quantum-chsh-ap'),
            bDeg: root.getElementById('quantum-chsh-b'),
            bPrimeDeg: root.getElementById('quantum-chsh-bp')
        };
        this.chshAngleValues = {
            aDeg: root.getElementById('quantum-chsh-a-value'),
            aPrimeDeg: root.getElementById('quantum-chsh-ap-value'),
            bDeg: root.getElementById('quantum-chsh-b-value'),
            bPrimeDeg: root.getElementById('quantum-chsh-bp-value')
        };
        this.chshCohortReadouts = {
            ab: root.getElementById('quantum-chsh-ab'),
            abPrime: root.getElementById('quantum-chsh-abp'),
            aPrimeB: root.getElementById('quantum-chsh-apb'),
            aPrimeBPrime: root.getElementById('quantum-chsh-apbp')
        };
        this.chshS = root.getElementById('quantum-chsh-s');
        this.chshAbsoluteS = root.getElementById('quantum-chsh-abs-s');
        this.chshExpectedS = root.getElementById('quantum-chsh-expected-s');
        this.chshSigma = root.getElementById('quantum-chsh-sigma');
        this.realityControls = root.getElementById('quantum-reality-controls');
        this.realityMode = root.getElementById('quantum-reality-mode');
        this.realityHiddenDistribution = root.getElementById('quantum-reality-hidden-distribution');
        this.realityResponseShape = root.getElementById('quantum-reality-response-shape');
        this.realityParameters = {
            hiddenBias: root.getElementById('quantum-reality-bias'),
            responseSoftness: root.getElementById('quantum-reality-softness'),
            localNoise: root.getElementById('quantum-reality-local-noise'),
            sharedSourceNoise: root.getElementById('quantum-reality-shared-noise'),
            dependenceStrength: root.getElementById('quantum-reality-dependence')
        };
        this.realityParameterValues = {
            hiddenBias: root.getElementById('quantum-reality-bias-value'),
            responseSoftness: root.getElementById('quantum-reality-softness-value'),
            localNoise: root.getElementById('quantum-reality-local-noise-value'),
            sharedSourceNoise: root.getElementById('quantum-reality-shared-noise-value'),
            dependenceStrength: root.getElementById('quantum-reality-dependence-value')
        };
        this.realityBenchmark = root.getElementById('quantum-reality-benchmark');
        this.realityLedger = {
            locality: root.getElementById('quantum-ledger-locality'),
            independence: root.getElementById('quantum-ledger-independence'),
            signaling: root.getElementById('quantum-ledger-signaling'),
            response: root.getElementById('quantum-ledger-response'),
            additional: root.getElementById('quantum-ledger-additional')
        };
        this.realityDiagnostics = {
            s: root.getElementById('quantum-reality-s'),
            rmse: root.getElementById('quantum-reality-rmse'),
            aliceSignal: root.getElementById('quantum-reality-alice-signal'),
            bobSignal: root.getElementById('quantum-reality-bob-signal')
        };
        this.realityChallenges = [1, 2, 3].map(number => root.getElementById(`quantum-challenge-${['one', 'two', 'three'][number - 1]}`));
        this.realityVerdict = root.getElementById('quantum-reality-verdict');
        this.realityAudit = root.getElementById('quantum-reality-audit');
        this.slitWidth = root.getElementById('quantum-slit-width');
        this.slitSeparation = root.getElementById('quantum-slit-separation');
        this.wavelength = root.getElementById('quantum-wavelength');
        this.screenDistance = root.getElementById('quantum-screen-distance');
        this.slitWidthValue = root.getElementById('quantum-slit-width-value');
        this.slitSeparationValue = root.getElementById('quantum-slit-separation-value');
        this.wavelengthValue = root.getElementById('quantum-wavelength-value');
        this.screenDistanceValue = root.getElementById('quantum-screen-distance-value');
        this.observationTitle = root.getElementById('quantum-observation-title');
        this.observationCopy = root.getElementById('quantum-observation-copy');
        this.physicsTitle = root.getElementById('quantum-physics-title');
        this.physicsCopy = root.getElementById('quantum-physics-copy');
        this.mathCopy = root.getElementById('quantum-math-copy');
        this.experimentButtons = [...root.querySelectorAll('[data-experiment]')];
        this.guideButtons = [...root.querySelectorAll('[data-guide-experiment]')];
        this.activeExperiment = 'single';
        this.runTimer = null;
        this.experiments = {
            single: new DetectionExperiment(createSingleParticleDistribution()),
            'double-slit': new DetectionExperiment(createDoubleSlitDistribution()),
            'which-path': new DetectionExperiment(createWhichPathDistribution()),
            decoherence: new DetectionExperiment(createDecoherenceDistribution({ coherence: 0.5 })),
            'quantum-eraser': new QuantumEraserExperiment(createQuantumEraserDistribution()),
            entanglement: new EntanglementExperiment(createPolarizationSingletDistribution({
                aliceAngleDeg: 0,
                bobAngleDeg: 22.5
            })),
            'bell-test': new ChshExperiment(createChshConfiguration()),
            'build-reality': new RealityExperiment(createRealityCandidate())
        };
        this.resizeObserver = null;
    }

    initialize() {
        this.experimentButtons.forEach(button => {
            button.addEventListener('click', () => this.selectExperiment(button.dataset.experiment));
            button.addEventListener('keydown', event => this.navigateExperimentList(event, button));
        });
        this.guideButtons.forEach(button => {
            button.addEventListener('click', () => {
                this.selectExperiment(button.dataset.guideExperiment);
                this.title.focus({ preventScroll: true });
                document.getElementById('quantum-workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
        this.emitOneButton.addEventListener('click', () => this.emit(1, true));
        this.emitBatchButton.addEventListener('click', () => this.emit(Number(this.batchSize.value), true));
        this.runButton.addEventListener('click', () => this.toggleRun());
        this.resetButton.addEventListener('click', () => this.reset());
        this.fixedSeed.addEventListener('change', () => this.reset());
        this.seed.addEventListener('change', () => this.reset());
        [this.slitWidth, this.slitSeparation, this.wavelength, this.screenDistance]
            .forEach(control => control.addEventListener('input', () => this.updateDoubleSlitGeometry(control)));
        this.whichPathDetector.addEventListener('change', () => this.updateWhichPathMeasurement());
        this.coherence.addEventListener('input', () => this.updateDecoherence());
        this.eraserViewButtons.forEach(button => {
            button.addEventListener('click', () => this.selectEraserView(button.dataset.eraserView));
        });
        [this.aliceAngle, this.bobAngle].forEach(control => {
            control.addEventListener('input', () => this.updateEntanglementAngles());
        });
        this.chshModel.addEventListener('change', () => this.updateChshConfiguration());
        Object.values(this.chshAngles).forEach(control => {
            control.addEventListener('input', () => this.updateChshConfiguration());
        });
        this.chshPreset.addEventListener('click', () => this.applyChshPreset());
        [this.realityMode, this.realityHiddenDistribution, this.realityResponseShape]
            .forEach(control => control.addEventListener('change', () => this.updateRealityCandidate()));
        Object.values(this.realityParameters).forEach(control => {
            control.addEventListener('input', () => this.updateRealityCandidate());
        });
        this.realityBenchmark.addEventListener('click', () => {
            this.emit(REALITY_BENCHMARK_SCENARIOS.length * 500, false);
        });

        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
            this.resizeObserver.observe(this.stage);
        } else {
            window.addEventListener('resize', () => this.resizeCanvas());
        }
        this.updateDoubleSlitGeometry();
        this.updateDecoherence();
        this.updateEntanglementAngles();
        this.updateChshConfiguration();
        this.updateRealityCandidate();
        this.selectExperiment('single');
        this.resizeCanvas();
    }

    navigateExperimentList(event, currentButton) {
        const directions = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
        if (!(event.key in directions)) return;
        event.preventDefault();
        const currentIndex = this.experimentButtons.indexOf(currentButton);
        const nextIndex = (currentIndex + directions[event.key] + this.experimentButtons.length) % this.experimentButtons.length;
        const next = this.experimentButtons[nextIndex];
        next.focus();
        this.selectExperiment(next.dataset.experiment);
    }

    createRandom() {
        if (this.fixedSeed.checked) {
            const seedValue = this.seed.value.trim() || DEFAULT_SINGLE_PARTICLE_SEED;
            this.seed.value = seedValue;
            return createSeededRandom(seedValue);
        }
        const entropy = `${Date.now()}-${globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0] ?? Math.random()}`;
        return createSeededRandom(entropy);
    }

    activeState() {
        return this.experiments[this.activeExperiment] || null;
    }

    doubleSlitGeometry() {
        return {
            slitWidthM: Number(this.slitWidth.value) * 1e-6,
            slitSeparationM: Number(this.slitSeparation.value) * 1e-6,
            wavelengthM: Number(this.wavelength.value) * 1e-9,
            screenDistanceM: Number(this.screenDistance.value) / 100,
            detectorHalfWidthM: DEFAULT_DOUBLE_SLIT_GEOMETRY.detectorHalfWidthM,
            binCount: DEFAULT_DOUBLE_SLIT_GEOMETRY.binCount
        };
    }

    updateDoubleSlitGeometry(changedControl = null) {
        if (Number(this.slitSeparation.value) < Number(this.slitWidth.value)) {
            if (changedControl === this.slitSeparation) this.slitWidth.value = this.slitSeparation.value;
            else this.slitSeparation.value = this.slitWidth.value;
        }
        this.slitSeparation.min = this.slitWidth.value;
        this.slitWidthValue.textContent = `${this.slitWidth.value} μm`;
        this.slitSeparationValue.textContent = `${this.slitSeparation.value} μm`;
        this.wavelengthValue.textContent = `${this.wavelength.value} nm`;
        this.screenDistanceValue.textContent = `${(Number(this.screenDistance.value) / 100).toFixed(2)} m`;
        this.slitWidth.setAttribute('aria-valuetext', `${this.slitWidth.value} micrometers`);
        this.slitSeparation.setAttribute('aria-valuetext', `${this.slitSeparation.value} micrometers center to center`);
        this.wavelength.setAttribute('aria-valuetext', `${this.wavelength.value} nanometers`);
        this.screenDistance.setAttribute('aria-valuetext', `${(Number(this.screenDistance.value) / 100).toFixed(2)} meters`);
        this.experiments['double-slit'].setDistribution(
            createDoubleSlitDistribution(this.doubleSlitGeometry())
        );
        this.rebuildWhichPathDistribution();
        this.rebuildDecoherenceDistribution();
        this.rebuildQuantumEraserDistribution();
        if (['double-slit', 'which-path', 'decoherence', 'quantum-eraser'].includes(this.activeExperiment)) this.reset();
    }

    rebuildWhichPathDistribution() {
        this.experiments['which-path'].setDistribution(createWhichPathDistribution({
            ...this.doubleSlitGeometry(),
            detectorEnabled: this.whichPathDetector.checked
        }));
    }

    updateWhichPathMeasurement() {
        this.rebuildWhichPathDistribution();
        this.markerState.textContent = this.whichPathDetector.checked
            ? 'ON — orthogonal path markers'
            : 'OFF — indistinguishable markers';
        if (this.activeExperiment === 'which-path') this.reset();
    }

    rebuildDecoherenceDistribution() {
        this.experiments.decoherence.setDistribution(createDecoherenceDistribution({
            ...this.doubleSlitGeometry(),
            coherence: Number(this.coherence.value)
        }));
    }

    updateDecoherence() {
        const gamma = Number(this.coherence.value);
        const { visibility, distinguishability } = idealComplementarity(gamma);
        this.coherenceValue.textContent = `γ = ${gamma.toFixed(2)}`;
        this.visibility.textContent = `V = ${visibility.toFixed(2)}`;
        this.distinguishability.textContent = `D = ${distinguishability.toFixed(2)}`;
        this.coherence.setAttribute('aria-valuetext', `coherence overlap gamma ${gamma.toFixed(2)}`);
        this.rebuildDecoherenceDistribution();
        if (this.activeExperiment === 'decoherence') this.reset();
    }

    rebuildQuantumEraserDistribution() {
        this.experiments['quantum-eraser'].setDistribution(
            createQuantumEraserDistribution(this.doubleSlitGeometry())
        );
    }

    selectEraserView(view) {
        const state = this.experiments['quantum-eraser'];
        state.setView(view);
        this.eraserViewButtons.forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.eraserView === view));
        });
        if (this.activeExperiment === 'quantum-eraser') {
            this.updateReadouts();
            this.draw();
        }
    }

    updateEntanglementAngles() {
        const aliceAngleDeg = Number(this.aliceAngle.value);
        const bobAngleDeg = Number(this.bobAngle.value);
        this.aliceAngleValue.textContent = `${aliceAngleDeg}°`;
        this.bobAngleValue.textContent = `${bobAngleDeg}°`;
        this.aliceAngle.setAttribute('aria-valuetext', `${aliceAngleDeg} degrees`);
        this.bobAngle.setAttribute('aria-valuetext', `${bobAngleDeg} degrees`);
        this.experiments.entanglement.setDistribution(createPolarizationSingletDistribution({
            aliceAngleDeg,
            bobAngleDeg
        }));
        if (this.activeExperiment === 'entanglement') this.reset();
    }

    updateChshConfiguration() {
        const options = { model: this.chshModel.value };
        Object.entries(this.chshAngles).forEach(([key, control]) => {
            options[key] = Number(control.value);
            this.chshAngleValues[key].textContent = `${control.value}°`;
            control.setAttribute('aria-valuetext', `${control.value} degrees`);
        });
        this.experiments['bell-test'].setConfiguration(createChshConfiguration(options));
        if (this.activeExperiment === 'bell-test') this.reset();
    }

    applyChshPreset() {
        this.chshAngles.aDeg.value = '0';
        this.chshAngles.aPrimeDeg.value = '45';
        this.chshAngles.bDeg.value = '22.5';
        this.chshAngles.bPrimeDeg.value = '157.5';
        this.updateChshConfiguration();
    }

    realityCandidateOptions() {
        return {
            mode: this.realityMode.value,
            hiddenDistribution: this.realityHiddenDistribution.value,
            responseShape: this.realityResponseShape.value,
            ...Object.fromEntries(Object.entries(this.realityParameters).map(([key, control]) => [key, Number(control.value)]))
        };
    }

    updateRealityCandidate() {
        Object.entries(this.realityParameters).forEach(([key, control]) => {
            this.realityParameterValues[key].textContent = Number(control.value).toFixed(2);
            control.setAttribute('aria-valuetext', `${Number(control.value).toFixed(2)}`);
        });
        const localMechanism = this.realityMode.value !== 'nonlocal-quantum';
        this.realityHiddenDistribution.disabled = !localMechanism;
        this.realityResponseShape.disabled = !localMechanism;
        this.realityParameters.hiddenBias.disabled = !localMechanism || this.realityHiddenDistribution.value !== 'axial-biased';
        this.realityParameters.responseSoftness.disabled = !localMechanism || this.realityResponseShape.value !== 'soft';
        this.realityParameters.localNoise.disabled = !localMechanism;
        this.realityParameters.sharedSourceNoise.disabled = !localMechanism;
        this.realityParameters.dependenceStrength.disabled = this.realityMode.value !== 'measurement-dependent';
        this.experiments['build-reality'].setCandidate(createRealityCandidate(this.realityCandidateOptions()));
        if (this.activeExperiment === 'build-reality') this.reset();
    }

    reset() {
        this.pause();
        this.activeState()?.reset(this.createRandom());
        this.status.textContent = this.activeState() ? 'Ready' : 'Preview';
        this.controlNote.textContent = 'Ready. A fixed seed makes the same reset-and-run sequence reproducible.';
        this.updateReadouts();
        this.draw();
    }

    selectExperiment(experimentId) {
        if (!EXPERIMENTS[experimentId]) return;
        this.activeExperiment = experimentId;
        this.experimentButtons.forEach(button => {
            const active = button.dataset.experiment === experimentId;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        this.guideButtons.forEach(button => {
            const active = button.dataset.guideExperiment === experimentId;
            if (active) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
        });
        const experiment = EXPERIMENTS[experimentId];
        this.title.textContent = experiment.title;
        this.experimentIntro.textContent = EXPERIMENT_GUIDANCE[experimentId].intro;
        this.seeingCopy.textContent = EXPERIMENT_GUIDANCE[experimentId].seeing;
        this.canvas.setAttribute('aria-label', `${experiment.title} visualization. ${EXPERIMENT_GUIDANCE[experimentId].seeing}`);
        const isLive = Boolean(this.experiments[experimentId]);
        const usesSlits = ['double-slit', 'which-path', 'decoherence', 'quantum-eraser'].includes(experimentId);
        this.emitOneButton.disabled = !isLive;
        this.emitBatchButton.disabled = !isLive;
        this.runButton.disabled = !isLive;
        this.batchSize.disabled = !isLive;
        this.fixedSeed.disabled = !isLive;
        this.seed.disabled = !isLive;
        this.doubleSlitControls.hidden = !usesSlits;
        this.whichPathControls.hidden = experimentId !== 'which-path';
        this.decoherenceControls.hidden = experimentId !== 'decoherence';
        this.eraserControls.hidden = experimentId !== 'quantum-eraser';
        this.entanglementControls.hidden = experimentId !== 'entanglement';
        this.chshControls.hidden = experimentId !== 'bell-test';
        this.realityControls.hidden = experimentId !== 'build-reality';
        this.updateEmissionLabels(['entanglement', 'bell-test', 'build-reality'].includes(experimentId));
        this.updateEducation(experimentId);
        this.controlNote.textContent = isLive
            ? 'A fixed seed makes the same reset-and-run sequence reproducible.'
            : `${experiment.phase}. The selector is active now so later experiments can reuse this shell.`;
        this.reset();
    }

    updateEmissionLabels(isPairExperiment) {
        this.batchLabel.textContent = isPairExperiment ? 'Pair batch size' : 'Batch size';
        [...this.batchSize.options].forEach(option => {
            option.textContent = `${Number(option.value).toLocaleString()} ${isPairExperiment ? 'pairs' : 'particles'}`;
        });
        this.emitOneButton.innerHTML = isPairExperiment
            ? '<i class="fa-solid fa-link" aria-hidden="true"></i> Emit one pair'
            : '<i class="fa-solid fa-atom" aria-hidden="true"></i> Emit one';
        this.emitBatchButton.innerHTML = isPairExperiment
            ? '<i class="fa-solid fa-burst" aria-hidden="true"></i> Emit pair batch'
            : '<i class="fa-solid fa-burst" aria-hidden="true"></i> Emit batch';
    }

    updateEducation(experimentId) {
        if (experimentId === 'build-reality') {
            this.observationTitle.textContent = 'Can You Reproduce Quantum Mechanics?';
            this.observationCopy.textContent = 'Build an outcome-generating mechanism, then test it against equal-angle anticorrelation, the complete photon-polarization correlation curve, CHSH, and operational no-signaling. Matching one favored setting is not enough.';
            this.physicsTitle.textContent = 'Mechanisms and assumptions—not an S slider';
            this.physicsCopy.innerHTML = 'Local candidates enforce <code>A=A(a,λ)</code> and <code>B=B(b,λ)</code>. Measurement-independent candidates draw <code>p(λ|a,b)=p(λ)</code>. Explicit alternative modes can relax one assumption, and the ledger reports that fact. Setting dependence is not automatically called “superdeterminism.”';
            this.mathCopy.innerHTML = 'The fixed 7×7 angle grid is compared with <code>E<sub>Q</sub>(a,b)=−cos[2(a−b)]</code> using full-curve RMSE. No-signaling is tested separately from locality by comparing <code>P(A|a,b)</code> across Bob settings and <code>P(B|a,b)</code> across Alice settings. Every row comes from auditable sampled trials; no user code, direct correlation control, or hard-coded Challenge 3 verdict is used.';
            return;
        }
        if (experimentId === 'bell-test') {
            this.observationTitle.textContent = 'Four setting cohorts accumulate in one Bell run';
            this.observationCopy.textContent = 'Each trial independently chooses one Alice setting and one Bob setting, then samples one joint outcome. Both reference models are theoretically no-signaling; finite local marginals provide sampling evidence, while comparing cohorts reveals the CHSH structure.';
            this.physicsTitle.textContent = 'Quantum and example local models';
            this.physicsCopy.innerHTML = 'The quantum option reuses photon-polarization Born probabilities. The comparison option uses <code>λ∼U(0,π)</code>, local responses <code>A(a,λ)=sgn[cos2(a−λ)]</code> and <code>B(b,λ)=−sgn[cos2(b−λ)]</code>. It is one example local hidden-variable model, not every classical theory.';
            this.mathCopy.innerHTML = '<code>S=E(a,b)+E(a,b′)+E(a′,b)−E(a′,b′)</code>. Local hidden-variable models satisfying Bell assumptions such as locality and measurement independence obey <code>|S|≤2</code>; quantum theory obeys <code>|S|≤2√2</code> for expectation values. A violation rules out the relevant local preassigned-outcome class under those assumptions—not every hidden-variable theory or any quantum interpretation. It does not prove faster-than-light communication, instantaneous information transfer, or consciousness-caused collapse. Finite measured estimates can fluctuate around either asymptotic bound; measured S and approximate uncertainty are shown separately from the expected value.';
            return;
        }
        if (experimentId === 'entanglement') {
            this.observationTitle.textContent = 'Local randomness, joint polarization correlation';
            this.observationCopy.textContent = 'The Born-rule model predicts exactly 50/50 local marginals independent of the remote analyzer. Finite sampled streams approach that prediction; angle-dependent structure appears when the paired records are compared.';
            this.physicsTitle.textContent = 'Photon-polarization singlet state';
            this.physicsCopy.innerHTML = 'The source prepares <code>|Ψ−⟩=(|H⟩A|V⟩B−|V⟩A|H⟩B)/√2</code>. All four outcomes are Born-rule projections onto the selected polarization analyzer bases and each emitted pair is one joint sample.';
            this.mathCopy.innerHTML = '<code>P(++)=P(−−)=½sin²(a−b)</code>, <code>P(+−)=P(−+)=½cos²(a−b)</code>, so <code>E(a,b)=−cos[2(a−b)]</code>. Neither photon signals the other, Alice does not send Bob an outcome, and these correlations cannot enable faster-than-light communication.';
            return;
        }
        if (experimentId === 'quantum-eraser') {
            this.observationTitle.textContent = 'Interference appears only in correlated subsets';
            this.observationCopy.textContent = 'All detector events remain non-interfering. Sorting the same jointly sampled events by Marker + or Marker − reveals complementary interference and anti-interference patterns.';
            this.physicsTitle.textContent = 'A path-hiding marker basis, not deleted history';
            this.physicsCopy.innerHTML = 'Orthogonal path markers are measured in the <code>|+⟩=(|M₁⟩+|M₂⟩)/√2</code> and <code>|−⟩=(|M₁⟩−|M₂⟩)/√2</code> basis, which does not reveal the original path. This does not physically delete a previously recorded classical fact.';
            this.mathCopy.innerHTML = 'The joint channels use <code>P(x,+) ∝ |ψ₁+ψ₂|²</code> and <code>P(x,−) ∝ |ψ₁−ψ₂|²</code> with one shared normalization. Their sum is the non-interfering marginal. The quantum eraser does not change the past; no information travels backward in time, and no faster-than-light signaling occurs. Interference is visible only after correlating detector events with the appropriate marker outcome.';
            return;
        }
        if (experimentId === 'decoherence') {
            this.observationTitle.textContent = 'Partial coherence softens the fringes';
            this.observationCopy.textContent = 'Move γ between zero and one. Individual impacts remain random, while accumulated fringe contrast changes continuously inside the same diffraction envelope.';
            this.physicsTitle.textContent = 'Reduced coherence from marker overlap';
            this.physicsCopy.innerHTML = 'Normalized marker states <code>|M₁⟩=(1,0)</code> and <code>|M₂⟩=(γ, √(1−γ²))</code> generate <code>⟨M₁|M₂⟩=γ</code>. Correlation with unobserved environmental or marker degrees of freedom suppresses off-diagonal terms in the reduced path density matrix.';
            this.mathCopy.innerHTML = '<code>P(x) ∝ |ψ₁|² + |ψ₂|² + 2 Re[γ ψ₁*ψ₂]</code>. In this ideal pure symmetric model, <code>V=|γ|</code>, <code>D=√(1−|γ|²)</code>, and <code>V²+D²=1</code>; generally complementarity gives <code>V²+D²≤1</code>. Partial measurement and environmental decoherence can yield the same reduced coherence loss without being microscopically identical processes.';
            return;
        }
        if (experimentId === 'which-path') {
            this.observationTitle.textContent = 'Path information removes the cross term';
            this.observationCopy.textContent = 'With the detector off, indistinguishable path markers preserve fringes. With it on, orthogonal markers make the alternatives distinguishable and the accumulated detections retain only the slit envelope.';
            this.physicsTitle.textContent = 'Measurement correlates path and marker';
            this.physicsCopy.innerHTML = 'The path becomes correlated (entangled) with a marker or measurement system. The interference term is weighted by <code>γ = ⟨M₁|M₂⟩</code>: detector OFF gives <code>γ = 1</code>; perfectly distinguishable markers give <code>γ = 0</code>. Human consciousness is not part of this calculation.';
            this.mathCopy.innerHTML = '<code>P(x) = |ψ₁|² + |ψ₂|² + 2 Re[γ ψ₁*ψ₂]</code>. Orthogonal marker states have zero overlap, so the cross term vanishes while each finite-width slit’s diffraction contribution remains.';
            return;
        }
        if (experimentId === 'double-slit') {
            this.observationTitle.textContent = 'Interference emerges one event at a time';
            this.observationCopy.textContent = 'Each impact is sampled independently. As detections accumulate, bright and dark fringes emerge inside the finite-width slit diffraction envelope.';
            this.physicsTitle.textContent = 'Coherent amplitudes, not painted fringes';
            this.physicsCopy.innerHTML = 'Each slit contributes a complex Fraunhofer amplitude. The model adds <code>ψ₁(x) + ψ₂(x)</code>, computes <code>|ψ₁ + ψ₂|²</code>, normalizes it, and samples every detector event from that result.';
            this.mathCopy.innerHTML = 'For slit width <code>a</code>, separation <code>d</code>, wavelength <code>λ</code>, screen distance <code>L</code>, and <code>sinθ = x/√(L²+x²)</code>, each slit has a <code>sinc(πa sinθ/λ)</code> envelope and a position-dependent complex phase. No fringe positions are stored in the renderer.';
            return;
        }
        this.observationTitle.textContent = 'Random events build a stable pattern';
        this.observationCopy.textContent = 'One detection cannot reveal the prepared distribution. As the sample grows, the histogram approaches the teal expected-probability curve.';
        this.physicsTitle.textContent = 'What is calculated?';
        this.physicsCopy.innerHTML = 'Phase 1 samples a normalized Gaussian <code>|ψ(x)|²</code> across a dimensionless detector. It represents a prepared wavepacket, not a claim that the particle follows the animated line.';
        this.mathCopy.innerHTML = 'The detector probability is proportional to <code>exp[-(x-μ)²/(2σ²)]</code>, then normalized so the discrete probabilities sum to one. Each impact is drawn independently from that distribution.';
    }

    emit(count, animate) {
        const state = this.activeState();
        if (!state) return;
        try {
            state.emit(count);
        } catch (error) {
            this.status.textContent = 'Error';
            this.liveSummary.textContent = `The simulation could not continue: ${error.message}`;
            this.emptyState.hidden = false;
            this.emptyState.textContent = 'The simulation encountered an error. Reset the experiment and try again.';
            return;
        }
        this.status.textContent = this.runTimer ? 'Running' : 'Measured';
        if (animate && !['entanglement', 'bell-test', 'build-reality'].includes(this.activeExperiment)) this.animatePulse();
        this.updateReadouts();
        this.draw();
    }

    animatePulse() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        this.pulse.classList.remove('emit');
        void this.pulse.offsetWidth;
        this.pulse.classList.add('emit');
    }

    toggleRun() {
        if (this.runTimer) this.pause();
        else this.run();
    }

    run() {
        if (!this.activeState() || this.runTimer) return;
        const tick = () => {
            const requested = Number(this.batchSize.value);
            this.emit(Math.min(requested, 100), false);
        };
        this.runTimer = window.setInterval(tick, 180);
        this.runButton.setAttribute('aria-pressed', 'true');
        this.runButton.innerHTML = '<i class="fa-solid fa-pause" aria-hidden="true"></i> Pause';
        this.status.textContent = 'Running';
        this.controlNote.textContent = 'Running. Pause to inspect the current sample, or Reset to clear it.';
        tick();
    }

    pause() {
        const wasRunning = Boolean(this.runTimer);
        if (this.runTimer) window.clearInterval(this.runTimer);
        this.runTimer = null;
        this.runButton.setAttribute('aria-pressed', 'false');
        this.runButton.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i> Run';
        if (wasRunning) {
            this.status.textContent = 'Paused';
            this.controlNote.textContent = 'Paused. Continue the same sample with Run, or clear all observations with Reset.';
        }
    }

    updateReadouts() {
        const state = this.activeState();
        if (this.activeExperiment === 'build-reality') {
            this.updateRealityReadouts(state);
            return;
        }
        if (this.activeExperiment === 'bell-test') {
            this.updateChshReadouts(state);
            return;
        }
        if (this.activeExperiment === 'entanglement') {
            this.updateEntanglementReadouts(state);
            return;
        }
        this.totalLabel.textContent = 'Total detections';
        this.meanLabel.textContent = 'Sample mean';
        this.spreadLabel.textContent = 'Sample spread';
        const moments = state ? state.moments() : { count: 0, mean: 0, standardDeviation: 0 };
        const label = moments.count === 1 ? 'detection' : 'detections';
        this.eventCount.textContent = `${moments.count.toLocaleString()} ${label}`;
        this.totalReadout.textContent = moments.count.toLocaleString();
        this.meanReadout.textContent = moments.mean.toFixed(3);
        this.spreadReadout.textContent = moments.standardDeviation.toFixed(3);
        this.randomReadout.textContent = this.fixedSeed.checked ? 'Seeded' : 'Unseeded';
        const eraser = this.experiments['quantum-eraser'];
        this.plusCount.textContent = eraser.plusCounts.reduce((sum, value) => sum + value, 0).toLocaleString();
        this.minusCount.textContent = eraser.minusCounts.reduce((sum, value) => sum + value, 0).toLocaleString();
        this.liveSummary.textContent = moments.count
            ? `Detector contains ${moments.count} detections. Sample mean ${moments.mean.toFixed(3)} and sample spread ${moments.standardDeviation.toFixed(3)}.`
            : 'Detector is ready with zero detections.';
        this.updateEmptyState(moments.count);
    }

    updateEntanglementReadouts(state) {
        const measured = state.measuredSummary();
        const theoretical = state.distribution;
        this.totalLabel.textContent = 'Emitted pairs';
        this.meanLabel.textContent = 'Measured E';
        this.spreadLabel.textContent = 'Theoretical E';
        this.eventCount.textContent = `${state.total.toLocaleString()} ${state.total === 1 ? 'pair' : 'pairs'}`;
        this.totalReadout.textContent = state.total.toLocaleString();
        this.meanReadout.textContent = measured.correlation.toFixed(3);
        this.spreadReadout.textContent = theoretical.correlation.toFixed(3);
        this.randomReadout.textContent = this.fixedSeed.checked ? 'Seeded' : 'Unseeded';
        state.counts.forEach((count, index) => { this.jointCountReadouts[index].textContent = count.toLocaleString(); });
        this.aliceMarginal.textContent = `+: ${measured.alice.plus.toFixed(3)} · −: ${measured.alice.minus.toFixed(3)}`;
        this.bobMarginal.textContent = `+: ${measured.bob.plus.toFixed(3)} · −: ${measured.bob.minus.toFixed(3)}`;
        this.liveSummary.textContent = state.total
            ? `${state.total} entangled pairs. Measured correlation ${measured.correlation.toFixed(3)}; theoretical ${theoretical.correlation.toFixed(3)}. Alice local plus ${measured.alice.plus.toFixed(3)}; Bob local plus ${measured.bob.plus.toFixed(3)}.`
            : 'Entangled-pair source is ready with zero emitted pairs.';
        this.updateEmptyState(state.total);
    }

    updateChshReadouts(state) {
        const summary = state.summary();
        this.totalLabel.textContent = 'Bell-test pairs';
        this.meanLabel.textContent = 'Measured |S|';
        this.spreadLabel.textContent = 'Expected |S|';
        this.eventCount.textContent = `${state.total.toLocaleString()} ${state.total === 1 ? 'trial' : 'trials'}`;
        this.totalReadout.textContent = state.total.toLocaleString();
        this.meanReadout.textContent = summary.absoluteS.toFixed(3);
        this.spreadReadout.textContent = Math.abs(summary.expectedS).toFixed(3);
        this.randomReadout.textContent = this.fixedSeed.checked ? 'Seeded' : 'Unseeded';
        Object.entries(summary.cohorts).forEach(([key, cohort]) => {
            this.chshCohortReadouts[key].textContent = `N ${cohort.total.toLocaleString()} · E ${cohort.correlation.toFixed(3)} · A+ ${cohort.alicePlus.toFixed(3)} · B+ ${cohort.bobPlus.toFixed(3)}`;
        });
        this.chshS.textContent = summary.measuredS.toFixed(3);
        this.chshAbsoluteS.textContent = summary.absoluteS.toFixed(3);
        this.chshExpectedS.textContent = summary.expectedS.toFixed(3);
        this.chshSigma.textContent = summary.uncertainty === null ? '—' : summary.uncertainty.toFixed(3);
        this.liveSummary.textContent = state.total
            ? `${state.total} Bell trials. Measured S ${summary.measuredS.toFixed(3)}, absolute S ${summary.absoluteS.toFixed(3)}, expected S ${summary.expectedS.toFixed(3)}, approximate uncertainty ${summary.uncertainty?.toFixed(3) ?? 'unavailable'}.`
            : 'Bell-test source is ready with four empty setting cohorts.';
        this.updateEmptyState(state.total);
    }

    updateEmptyState(total) {
        const empty = total === 0;
        this.emptyState.hidden = !empty;
        this.emptyState.textContent = this.activeExperiment === 'build-reality'
            ? 'No benchmark trials yet. Emit trials or run the balanced benchmark to evaluate this candidate.'
            : this.activeExperiment === 'bell-test'
                ? 'No pair trials yet. Emit pairs to begin filling all four setting cohorts.'
                : 'No observations yet. Emit one event or a batch to begin.';
    }

    updateRealityReadouts(state) {
        const summary = state.summary();
        const ledger = summary.ledger;
        this.totalLabel.textContent = 'Auditable trials';
        this.meanLabel.textContent = 'Full-curve RMSE';
        this.spreadLabel.textContent = 'Measured |S|';
        this.eventCount.textContent = `${state.total.toLocaleString()} ${state.total === 1 ? 'trial' : 'trials'}`;
        this.totalReadout.textContent = state.total.toLocaleString();
        this.meanReadout.textContent = summary.gridRmse === null ? '—' : summary.gridRmse.toFixed(3);
        this.spreadReadout.textContent = summary.measuredS === null ? '—' : Math.abs(summary.measuredS).toFixed(3);
        this.randomReadout.textContent = this.fixedSeed.checked ? 'Seeded' : 'Unseeded';

        this.realityLedger.locality.textContent = state.candidate.config.mode === 'nonlocal-quantum'
            ? 'Bell-local factorization not imposed'
            : ledger.locality[0].toUpperCase() + ledger.locality.slice(1);
        this.realityLedger.independence.textContent = ledger.measurementIndependence[0].toUpperCase() + ledger.measurementIndependence.slice(1);
        this.realityLedger.signaling.textContent = this.noSignalingEvidenceText(summary, state.candidate.config.mode);
        this.realityLedger.response.textContent = ledger.responseType;
        this.realityLedger.additional.textContent = ledger.additionalAssumptions.join('; ');

        this.realityDiagnostics.s.textContent = summary.measuredS === null
            ? '—'
            : `${summary.measuredS.toFixed(3)} ± ${summary.approximateSigmaS.toFixed(3)} approx.`;
        this.realityDiagnostics.rmse.textContent = summary.gridRmse === null ? '—' : summary.gridRmse.toFixed(3);
        const marginalUncertainty = summary.noSignaling.approximateDifferenceUncertainty;
        this.realityDiagnostics.aliceSignal.textContent = summary.noSignaling.tested
            ? `${summary.noSignaling.aliceMaxDelta.toFixed(3)} (approx. σ ${marginalUncertainty.toFixed(3)})`
            : '—';
        this.realityDiagnostics.bobSignal.textContent = summary.noSignaling.tested
            ? `${summary.noSignaling.bobMaxDelta.toFixed(3)} (approx. σ ${marginalUncertainty.toFixed(3)})`
            : '—';

        this.realityChallenges[0].textContent = summary.equalAngleRmse === null
            ? 'Awaiting data'
            : summary.equalAngleRmse < 0.12 ? `Reproduced (RMSE ${summary.equalAngleRmse.toFixed(3)})` : `Not reproduced (RMSE ${summary.equalAngleRmse.toFixed(3)})`;
        this.realityChallenges[1].textContent = summary.gridRmse === null
            ? 'Awaiting data'
            : summary.gridRmse < 0.12 ? `Reproduced (RMSE ${summary.gridRmse.toFixed(3)})` : `Not reproduced (RMSE ${summary.gridRmse.toFixed(3)})`;
        const bellViolation = summary.measuredS !== null && Math.abs(summary.measuredS) > 2.15;
        const assumptionsPreserved = ledger.locality === 'preserved' && ledger.measurementIndependence === 'preserved';
        this.realityChallenges[2].textContent = summary.measuredS === null
            ? 'Awaiting data'
            : bellViolation && assumptionsPreserved
                ? 'Candidate-generated violation observed; inspect full benchmark and finite uncertainty'
                : bellViolation
                    ? state.candidate.config.mode === 'nonlocal-quantum'
                        ? 'Violation generated by the Quantum Born Joint Reference; Bell-local factorization is not imposed'
                        : 'Violation generated after relaxing measurement independence'
                    : 'Bell violation not reproduced';

        this.realityVerdict.dataset.level = summary.verdict.level;
        this.realityVerdict.querySelector('strong').textContent = summary.verdict.title;
        this.realityVerdict.querySelector('p').textContent = summary.verdict.explanation;
        const latest = state.auditTrail.at(-1);
        this.realityAudit.textContent = latest
            ? `#${latest.sequence} · ${latest.scenarioId} · a=${latest.aliceAngleDeg}° · b=${latest.bobAngleDeg}° · λ=${latest.lambda === null ? 'not used' : latest.lambda.toFixed(6)} · outcome=${latest.outcome} · ${state.candidate.config.mode === 'nonlocal-quantum' ? 'Bell-local factorization not imposed' : `locality ${latest.assumptions.locality}`} · measurement independence ${latest.assumptions.measurementIndependence}`
            : 'No trial emitted.';
        this.liveSummary.textContent = state.total
            ? `${state.total} auditable model trials. ${summary.verdict.title}. ${summary.verdict.explanation}`
            : 'Candidate model is ready with zero benchmark trials.';
        this.updateEmptyState(state.total);
    }

    noSignalingEvidenceText(summary, mode) {
        if (!summary.noSignaling.tested) return 'Awaiting conditional-marginal evidence';
        const uncertainty = summary.noSignaling.approximateDifferenceUncertainty.toFixed(3);
        if (summary.noSignaling.evidence === 'detectable-remote-setting-dependence') {
            return `Detectable remote-setting dependence appears in the sampled local marginals (approx. difference σ ${uncertainty}).`;
        }
        if (mode === 'nonlocal-quantum') {
            return `The Born-rule reference is theoretically no-signaling; this finite sample is consistent with that prediction (approx. difference σ ${uncertainty}).`;
        }
        return `Observed marginals are consistent with no-signaling within sampling uncertainty (approx. difference σ ${uncertainty}).`;
    }

    resizeCanvas() {
        const bounds = this.stage.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(320, Math.round(bounds.width));
        const height = Math.max(320, Math.round(bounds.height));
        this.canvas.width = Math.round(width * pixelRatio);
        this.canvas.height = Math.round(height * pixelRatio);
        this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        this.draw(width, height);
    }

    draw(width = this.canvas.clientWidth, height = this.canvas.clientHeight) {
        const ctx = this.context;
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        const state = this.activeState();
        if (!state) {
            this.drawUnavailableState(ctx, width, height);
            return;
        }
        if (this.activeExperiment === 'build-reality') this.drawRealityExperiment(ctx, width, height, state);
        else if (this.activeExperiment === 'bell-test') this.drawChshExperiment(ctx, width, height, state);
        else if (this.activeExperiment === 'entanglement') this.drawEntanglementExperiment(ctx, width, height, state);
        else this.drawDetectionExperiment(ctx, width, height, state);
    }

    drawUnavailableState(ctx, width, height) {
        const experiment = EXPERIMENTS[this.activeExperiment];
        ctx.fillStyle = '#a0aec0';
        ctx.textAlign = 'center';
        ctx.font = '600 18px Inter, sans-serif';
        ctx.fillText(experiment.title, width / 2, height / 2 - 12);
        ctx.font = '14px Inter, sans-serif';
        ctx.fillText('Visualization unavailable; use the numerical summary or reset.', width / 2, height / 2 + 18);
    }

    drawRealityExperiment(ctx, width, height, state) {
        const summary = state.summary();
        const compact = width < 600;
        const plot = { left: width * 0.1, right: width * (compact ? 0.9 : 0.68), top: height * 0.13, bottom: height * 0.82 };
        const xFor = delta => plot.left + delta / 90 * (plot.right - plot.left);
        const yFor = correlation => plot.top + (1 - (correlation + 1) / 2) * (plot.bottom - plot.top);
        ctx.font = '12px Inter, sans-serif';
        ctx.strokeStyle = 'rgba(160, 174, 192, 0.35)';
        ctx.lineWidth = 1;
        [-1, 0, 1].forEach(value => {
            ctx.beginPath();
            ctx.moveTo(plot.left, yFor(value));
            ctx.lineTo(plot.right, yFor(value));
            ctx.stroke();
            ctx.fillStyle = '#a0aec0';
            ctx.textAlign = 'right';
            ctx.fillText(value.toFixed(0), plot.left - 10, yFor(value) + 4);
        });
        ctx.textAlign = 'center';
        REALITY_ANGLE_GRID_DEG.forEach(delta => {
            ctx.fillStyle = '#a0aec0';
            ctx.fillText(`${delta}°`, xFor(delta), plot.bottom + 22);
        });
        ctx.fillText('|a − b|', (plot.left + plot.right) / 2, plot.bottom + 45);

        const byDifference = REALITY_ANGLE_GRID_DEG.map(delta => {
            const cells = summary.grid.filter(item => Math.abs(item.scenario.aliceAngleDeg - item.scenario.bobAngleDeg) === delta && item.total > 0);
            const total = cells.reduce((sum, item) => sum + item.total, 0);
            return {
                delta,
                measured: total ? cells.reduce((sum, item) => sum + item.correlation * item.total, 0) / total : null,
                target: -Math.cos(2 * delta * Math.PI / 180)
            };
        });
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        byDifference.forEach((point, index) => {
            const x = xFor(point.delta);
            const y = yFor(point.target);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        byDifference.filter(point => point.measured !== null).forEach(point => {
            ctx.fillStyle = '#805ad5';
            ctx.beginPath();
            ctx.arc(xFor(point.delta), yFor(point.measured), 5, 0, Math.PI * 2);
            ctx.fill();
        });

        if (!compact) {
            const panelX = width * 0.73;
            ctx.textAlign = 'left';
            ctx.fillStyle = '#f0f7fa';
            ctx.font = '700 13px Inter, sans-serif';
            ctx.fillText('CANDIDATE BENCHMARK', panelX, plot.top);
            ctx.font = '12px Inter, sans-serif';
            const rows = [
                ['Trials', state.total.toLocaleString()],
                ['CHSH S', summary.measuredS === null ? '—' : summary.measuredS.toFixed(3)],
                ['Curve RMSE', summary.gridRmse === null ? '—' : summary.gridRmse.toFixed(3)],
                ['Local model status', state.candidate.config.mode === 'nonlocal-quantum' ? 'factorization not imposed' : summary.ledger.locality],
                ['Meas. independence', summary.ledger.measurementIndependence],
                ['Marginal evidence', summary.noSignaling.tested
                    ? (summary.noSignaling.evidence === 'consistent-with-no-signaling' ? 'consistent' : 'dependence detected')
                    : 'not sampled']
            ];
            rows.forEach(([label, value], index) => {
                const y = plot.top + 35 + index * 34;
                ctx.fillStyle = '#a0aec0';
                ctx.fillText(label, panelX, y);
                ctx.fillStyle = '#73dce8';
                ctx.fillText(value, panelX, y + 15);
            });
        }
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(plot.left, height * 0.06, 20, 3);
        ctx.fillStyle = '#a0aec0';
        ctx.fillText('Quantum target', plot.left + 28, height * 0.06 + 4);
        ctx.fillStyle = '#805ad5';
        ctx.beginPath();
        ctx.arc(plot.left + 150, height * 0.06 + 1, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a0aec0';
        ctx.fillText('Candidate outcomes', plot.left + 160, height * 0.06 + 4);
    }

    drawChshExperiment(ctx, width, height, state) {
        const summary = state.summary();
        const panels = [
            { key: 'ab', label: 'E(a,b)' },
            { key: 'abPrime', label: 'E(a,b′)' },
            { key: 'aPrimeB', label: 'E(a′,b)' },
            { key: 'aPrimeBPrime', label: 'E(a′,b′)' }
        ];
        const panelWidth = width * 0.4;
        const panelHeight = height * 0.22;
        const left = width * 0.07;
        const top = height * 0.12;
        ctx.font = '12px Inter, sans-serif';
        panels.forEach((panel, index) => {
            const column = index % 2;
            const row = Math.floor(index / 2);
            const x = left + column * width * 0.46;
            const y = top + row * height * 0.3;
            const cohort = summary.cohorts[panel.key];
            const expected = state.configuration.expectedCorrelations[panel.key];
            ctx.strokeStyle = 'rgba(115, 220, 232, 0.22)';
            ctx.strokeRect(x, y, panelWidth, panelHeight);
            const axisLeft = x + panelWidth * 0.12;
            const axisRight = x + panelWidth * 0.88;
            const axisY = y + panelHeight * 0.58;
            ctx.strokeStyle = 'rgba(160, 174, 192, 0.45)';
            ctx.beginPath();
            ctx.moveTo(axisLeft, axisY);
            ctx.lineTo(axisRight, axisY);
            ctx.stroke();
            const pointX = value => axisLeft + ((value + 1) / 2) * (axisRight - axisLeft);
            ctx.fillStyle = '#00f0ff';
            ctx.fillRect(pointX(expected) - 2, axisY - 20, 4, 40);
            ctx.fillStyle = '#805ad5';
            ctx.beginPath();
            ctx.arc(pointX(cohort.correlation), axisY, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.textAlign = 'left';
            ctx.fillStyle = '#f7fafc';
            ctx.fillText(panel.label, x + 12, y + 22);
            ctx.fillStyle = '#a0aec0';
            ctx.fillText(`N ${cohort.total.toLocaleString()}   measured ${cohort.correlation.toFixed(3)}   expected ${expected.toFixed(3)}`, x + 12, y + 42);
            ctx.fillText('−1', axisLeft - 7, axisY + 27);
            ctx.fillText('+1', axisRight - 7, axisY + 27);
        });

        const gaugeY = height * 0.83;
        const gaugeLeft = width * 0.16;
        const gaugeRight = width * 0.84;
        const maxBound = 3.2;
        const gaugeX = value => gaugeLeft + (value / maxBound) * (gaugeRight - gaugeLeft);
        ctx.strokeStyle = 'rgba(160, 174, 192, 0.55)';
        ctx.beginPath();
        ctx.moveTo(gaugeLeft, gaugeY);
        ctx.lineTo(gaugeRight, gaugeY);
        ctx.stroke();
        ctx.fillStyle = '#f6ad55';
        ctx.fillRect(gaugeX(CHSH_LOCAL_BOUND) - 2, gaugeY - 18, 4, 36);
        ctx.fillStyle = '#73dce8';
        ctx.fillRect(gaugeX(CHSH_TSIRELSON_BOUND) - 2, gaugeY - 18, 4, 36);
        ctx.fillStyle = '#805ad5';
        ctx.beginPath();
        ctx.arc(gaugeX(Math.min(maxBound, summary.absoluteS)), gaugeY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#a0aec0';
        ctx.fillText('0', gaugeLeft, gaugeY + 30);
        ctx.fillText('local bound 2', gaugeX(CHSH_LOCAL_BOUND), gaugeY + 30);
        ctx.fillText('Tsirelson 2√2', gaugeX(CHSH_TSIRELSON_BOUND), gaugeY + 30);
        ctx.fillStyle = '#f7fafc';
        ctx.fillText(`${state.configuration.modelName}: measured |S| ${summary.absoluteS.toFixed(3)} · expected |S| ${Math.abs(summary.expectedS).toFixed(3)}`, width / 2, height * 0.96);
    }

    drawEntanglementExperiment(ctx, width, height, state) {
        const centerX = width * 0.5;
        const centerY = height * 0.34;
        const aliceX = width * 0.18;
        const bobX = width * 0.82;
        const stationRadius = Math.max(28, Math.min(width, height) * 0.06);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(115, 220, 232, 0.35)';
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(aliceX, centerY);
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(bobX, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#73dce8';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillStyle = '#a0aec0';
        ctx.fillText('ENTANGLED-PAIR SOURCE', centerX, centerY - 28);

        const drawStation = (x, label, angle, localPlus) => {
            ctx.strokeStyle = '#00f0ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, centerY, stationRadius, 0, Math.PI * 2);
            ctx.stroke();
            const radians = angle * Math.PI / 180;
            ctx.beginPath();
            ctx.moveTo(x - Math.cos(radians) * stationRadius * 0.7, centerY + Math.sin(radians) * stationRadius * 0.7);
            ctx.lineTo(x + Math.cos(radians) * stationRadius * 0.7, centerY - Math.sin(radians) * stationRadius * 0.7);
            ctx.stroke();
            ctx.fillStyle = '#f7fafc';
            ctx.fillText(`${label}  ${angle}°`, x, centerY + stationRadius + 24);
            ctx.fillStyle = '#a0aec0';
            ctx.fillText(`local + ${(localPlus * 100).toFixed(1)}%`, x, centerY + stationRadius + 43);
        };
        const measured = state.measuredSummary();
        drawStation(aliceX, 'ALICE', state.distribution.aliceAngleDeg, measured.alice.plus);
        drawStation(bobX, 'BOB', state.distribution.bobAngleDeg, measured.bob.plus);

        const chartTop = height * 0.62;
        const chartBottom = height * 0.9;
        const chartHeight = chartBottom - chartTop;
        const groupWidth = width * 0.13;
        const startX = width * 0.2;
        const maxCount = Math.max(1, ...state.counts);
        state.distribution.outcomes.forEach((outcome, index) => {
            const x = startX + index * width * 0.2;
            const expectedHeight = state.distribution.probabilities[index] * 2 * chartHeight;
            const observedHeight = (state.counts[index] / maxCount) * chartHeight;
            ctx.fillStyle = 'rgba(0, 240, 255, 0.24)';
            ctx.fillRect(x - groupWidth / 2, chartBottom - expectedHeight, groupWidth, expectedHeight);
            ctx.fillStyle = 'rgba(128, 90, 213, 0.72)';
            ctx.fillRect(x - groupWidth * 0.28, chartBottom - observedHeight, groupWidth * 0.56, observedHeight);
            ctx.fillStyle = '#f7fafc';
            ctx.fillText(outcome.replace('-', '−'), x, chartBottom + 21);
            ctx.fillStyle = '#a0aec0';
            ctx.fillText(`${state.counts[index]}`, x, chartTop - 8);
        });
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0, 240, 255, 0.45)';
        ctx.fillRect(width * 0.04, height * 0.08, 20, 7);
        ctx.fillStyle = '#a0aec0';
        ctx.fillText('Born-rule probability', width * 0.04 + 28, height * 0.08 + 7);
        ctx.fillStyle = 'rgba(128, 90, 213, 0.75)';
        ctx.fillRect(width * 0.04, height * 0.08 + 21, 20, 7);
        ctx.fillStyle = '#a0aec0';
        ctx.fillText('Observed joint pairs', width * 0.04 + 28, height * 0.08 + 28);
        ctx.textAlign = 'center';
        ctx.fillText('Local streams stay 50/50; compare paired records to reveal correlation.', centerX, height * 0.56);
    }

    drawDetectionExperiment(ctx, width, height, state) {
        const sourceX = width * 0.12;
        const detectorX = width * 0.78;
        const centerY = height * 0.5;
        const plotTop = height * 0.1;
        const plotBottom = height * 0.9;
        const plotHeight = plotBottom - plotTop;
        const distribution = state.distribution;
        const yForBin = index => plotTop + (index / (distribution.positions.length - 1)) * plotHeight;

        ctx.strokeStyle = 'rgba(115, 220, 232, 0.22)';
        ctx.setLineDash([5, 8]);
        ctx.beginPath();
        ctx.moveTo(sourceX, centerY);
        ctx.lineTo(detectorX, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#73dce8';
        ctx.beginPath();
        ctx.arc(sourceX, centerY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(115, 220, 232, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sourceX, centerY, 19, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#a0aec0';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SOURCE', sourceX, centerY + 38);

        if (['double-slit', 'which-path', 'decoherence', 'quantum-eraser'].includes(this.activeExperiment)) {
            const barrierX = width * 0.38;
            const openingHalfHeight = Math.max(4, height * 0.012);
            const openingOffset = height * 0.065;
            ctx.strokeStyle = 'rgba(240, 247, 250, 0.72)';
            ctx.lineWidth = 5;
            [[plotTop, centerY - openingOffset - openingHalfHeight],
                [centerY - openingOffset + openingHalfHeight, centerY + openingOffset - openingHalfHeight],
                [centerY + openingOffset + openingHalfHeight, plotBottom]].forEach(([start, end]) => {
                ctx.beginPath();
                ctx.moveTo(barrierX, start);
                ctx.lineTo(barrierX, end);
                ctx.stroke();
            });
            ctx.fillStyle = '#a0aec0';
            ctx.fillText('DOUBLE SLIT', barrierX, plotBottom + 24);
        }

        ctx.strokeStyle = 'rgba(115, 220, 232, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(detectorX, plotTop);
        ctx.lineTo(detectorX, plotBottom);
        ctx.stroke();
        ctx.fillText('DETECTOR', detectorX, plotBottom + 24);

        const maxCount = Math.max(1, ...state.counts);
        for (let index = 0; index < state.counts.length; index += 1) {
            const count = state.counts[index];
            if (!count) continue;
            const barWidth = (count / maxCount) * width * 0.16;
            ctx.fillStyle = 'rgba(128, 90, 213, 0.38)';
            ctx.fillRect(detectorX - barWidth, yForBin(index) - 1, barWidth, 2.2);
        }

        const maximumProbability = Math.max(...distribution.probabilities);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        distribution.probabilities.forEach((probability, index) => {
            const x = detectorX - (probability / maximumProbability) * width * 0.18;
            const y = yForBin(index);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        state.recent.forEach(({ binIndex, sequence, outcome }) => {
            const jitter = ((sequence * 2654435761) >>> 0) / 4294967296;
            const branchColor = this.activeExperiment === 'quantum-eraser' && state.view !== 'all'
                ? (outcome === 'plus' ? '115,220,232' : '255,176,84')
                : '255,255,255';
            ctx.fillStyle = `rgba(${branchColor},${Math.min(1, 0.35 + 0.65 * (sequence / Math.max(1, state.total)))})`;
            ctx.beginPath();
            ctx.arc(detectorX + 4 + jitter * width * 0.12, yForBin(binIndex), 1.7, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.textAlign = 'left';
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(width * 0.05, height * 0.08, 20, 2);
        ctx.fillStyle = '#a0aec0';
        const expectedLabel = this.activeExperiment === 'quantum-eraser'
            ? (state.view === 'all' ? 'Expected unsorted marginal' : `Expected Marker ${state.view === 'plus' ? '+' : '−'} conditional`)
            : 'Expected |ψ(x)|²';
        ctx.fillText(expectedLabel, width * 0.05 + 28, height * 0.08 + 5);
        ctx.fillStyle = 'rgba(128, 90, 213, 0.75)';
        ctx.fillRect(width * 0.05, height * 0.08 + 20, 20, 5);
        ctx.fillStyle = '#a0aec0';
        ctx.fillText('Observed histogram', width * 0.05 + 28, height * 0.08 + 26);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('quantum-canvas');
    if (!canvas) return;
    const controller = new QuantumPlaygroundController(document);
    controller.initialize();
});
