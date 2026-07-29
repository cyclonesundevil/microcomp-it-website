'use strict';

(function exposeTrainingRunner(root, factory) {
    let trainingCore;
    let inferenceCore;
    let tokenizerApi;
    if (typeof module === 'object' && module.exports) {
        trainingCore = require('./training-core.js');
        inferenceCore = require('./inference-core.js');
        tokenizerApi = require('./inference-tokenizer.js');
        module.exports = factory(trainingCore, inferenceCore, tokenizerApi);
    } else {
        root.MicroCompTrainingRunner = factory(
            root.MicroCompTrainingCore,
            root.MicroCompInferenceCore,
            root.MicroCompInferenceTokenizer
        );
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTrainingRunner(
    trainingCore, inferenceCore, tokenizerApi
) {
    if (!trainingCore || !inferenceCore || !tokenizerApi) {
        throw new Error('Training runner dependencies are unavailable.');
    }

    const MAX_BROWSER_STEPS = 500;
    const MAX_REPLAY_SNAPSHOTS = 101;

    function now() {
        return typeof performance === 'object' && performance.now
            ? performance.now()
            : Date.now();
    }

    function yieldToWorker() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    class BrowserTrainingRun {
        constructor({
            runId,
            configuration,
            tokenizerDocument,
            dataset,
            options,
            initialTensors,
            emit
        }) {
            this.runId = runId;
            this.configuration = configuration;
            this.tokenizerDocument = tokenizerDocument;
            this.dataset = dataset;
            this.options = trainingCore.validateTrainingOptions(options);
            if (this.options.steps > MAX_BROWSER_STEPS) {
                throw new RangeError(`Browser training is limited to ${MAX_BROWSER_STEPS} steps.`);
            }
            if (Math.ceil(this.options.steps / this.options.snapshotInterval) + 1
                > MAX_REPLAY_SNAPSHOTS) {
                throw new RangeError(
                    `Replay is limited to ${MAX_REPLAY_SNAPSHOTS} snapshots; increase the snapshot interval.`
                );
            }
            if (this.options.stride > configuration.context_length) {
                throw new RangeError('Dataset stride cannot exceed context length.');
            }
            if (this.options.sampleTopK > configuration.vocab_size) {
                throw new RangeError('Sample top-k cannot exceed vocabulary size.');
            }
            this.initialTensors = initialTensors;
            this.emit = emit;
            this.status = 'ready';
            this.cancelRequested = false;
            this.pauseStarted = null;
            this.pausedMilliseconds = 0;
            this.resumeWaiter = null;
            this.history = [];
            this.snapshots = [];
            this.latestValidationLoss = null;
            this.model = null;
            this.startedAt = null;
            this.tokensProcessed = 0;
        }

        pause() {
            if (this.status !== 'running') throw new Error('Only a running model can pause.');
            this.status = 'paused';
            this.pauseStarted = now();
            this.emit('LIFECYCLE', this.state());
            return this.state();
        }

        resume() {
            if (this.status !== 'paused') throw new Error('Only a paused model can resume.');
            this.pausedMilliseconds += now() - this.pauseStarted;
            this.pauseStarted = null;
            this.status = 'running';
            if (this.resumeWaiter) {
                this.resumeWaiter();
                this.resumeWaiter = null;
            }
            this.emit('LIFECYCLE', this.state());
            return this.state();
        }

        cancel() {
            if (!['running', 'paused'].includes(this.status)) {
                throw new Error('Only an active model can be cancelled.');
            }
            this.cancelRequested = true;
            if (this.status === 'paused' && this.resumeWaiter) {
                this.resumeWaiter();
                this.resumeWaiter = null;
            }
            return this.state();
        }

        elapsedSeconds() {
            if (this.startedAt === null) return 0;
            const paused = this.pausedMilliseconds
                + (this.pauseStarted === null ? 0 : now() - this.pauseStarted);
            return Math.max(0, (now() - this.startedAt - paused) / 1000);
        }

        state(extra = {}) {
            const step = this.model?.step || 0;
            const elapsedSeconds = this.elapsedSeconds();
            const secondsPerStep = step ? elapsedSeconds / step : 0;
            return {
                runId: this.runId,
                status: this.status,
                step,
                totalSteps: this.options.steps,
                tokensProcessed: this.tokensProcessed,
                elapsedSeconds,
                estimatedRemainingSeconds: secondsPerStep * (this.options.steps - step),
                ...extra
            };
        }

        async waitWhilePaused() {
            while (this.status === 'paused' && !this.cancelRequested) {
                await new Promise(resolve => {
                    this.resumeWaiter = resolve;
                });
            }
        }

        checkpoint(trainLoss, validationLoss) {
            const explorer = this.model.explorerSnapshot(
                this.options.samplePrompt,
                Array.from(
                    { length: Math.min(this.configuration.vocab_size - 4, 12) },
                    (_, index) => index + 4
                )
            );
            const inferenceModel = this.model.createInferenceModel();
            let generation;
            try {
                generation = inferenceModel.generate(
                    this.options.samplePrompt,
                    {
                        temperature: this.options.sampleTemperature,
                        topK: this.options.sampleTopK,
                        maxNewTokens: this.options.sampleMaxNewTokens,
                        seed: this.options.seed
                    }
                );
            } finally {
                inferenceModel.dispose();
            }
            const snapshot = {
                index: this.snapshots.length,
                step: this.model.step,
                trainLoss,
                validationLoss,
                sample: generation.text,
                parameterCount: this.model.parameterCount,
                elapsedSeconds: this.elapsedSeconds(),
                ...explorer
            };
            this.snapshots.push(snapshot);
            this.emit('SNAPSHOT', snapshot);
            return snapshot;
        }

        async run() {
            this.status = 'running';
            this.startedAt = now();
            this.emit('LIFECYCLE', this.state());
            const tokenizer = new tokenizerApi.CharacterTokenizer(
                this.tokenizerDocument
            );
            const trainWindows = trainingCore.datasetWindows(
                this.dataset.training,
                tokenizer,
                this.configuration.context_length,
                this.options.stride
            );
            const validationWindows = trainingCore.datasetWindows(
                this.dataset.validation,
                tokenizer,
                this.configuration.context_length,
                this.options.stride
            );
            const nextBatch = trainingCore.createBatchScheduler(
                trainWindows, this.options.batchSize, this.options.seed
            );
            this.model = new trainingCore.TensorFlowTinyLlm(
                this.configuration, this.tokenizerDocument, this.initialTensors
            );
            let lastTrainLoss = null;
            let completion = null;
            try {
                lastTrainLoss = this.model.validationLoss(
                    trainWindows,
                    1,
                    this.options.batchSize
                );
                this.latestValidationLoss = this.model.validationLoss(
                    validationWindows,
                    this.options.validationBatches,
                    this.options.batchSize
                );
                this.checkpoint(lastTrainLoss, this.latestValidationLoss);
                while (this.model.step < this.options.steps) {
                    await this.waitWhilePaused();
                    if (this.cancelRequested) {
                        this.status = 'cancelled';
                        completion = this.state();
                        this.emit('CANCELLED', completion);
                        return completion;
                    }
                    const metrics = this.model.trainBatch(nextBatch(), this.options);
                    lastTrainLoss = metrics.loss;
                    this.tokensProcessed += (
                        this.options.batchSize * this.configuration.context_length
                    );
                    const step = this.model.step;
                    const validationDue = step % this.options.validationInterval === 0
                        || step === this.options.steps;
                    const snapshotDue = step % this.options.snapshotInterval === 0
                        || step === this.options.steps;
                    if (validationDue || snapshotDue) {
                        this.latestValidationLoss = this.model.validationLoss(
                            validationWindows,
                            this.options.validationBatches,
                            this.options.batchSize
                        );
                    }
                    const event = this.state({
                        trainLoss: lastTrainLoss,
                        validationLoss: validationDue ? this.latestValidationLoss : null,
                        latestValidationLoss: this.latestValidationLoss,
                        gradientNorm: metrics.gradientNorm,
                        appliedGradientNorm: metrics.appliedGradientNorm,
                        memory: this.model.memory()
                    });
                    this.history.push(event);
                    this.emit('PROGRESS', event);
                    if (snapshotDue) {
                        this.checkpoint(lastTrainLoss, this.latestValidationLoss);
                    }
                    await yieldToWorker();
                }
                this.status = 'completed';
                completion = this.state({
                    trainLoss: lastTrainLoss,
                    validationLoss: this.latestValidationLoss,
                    memory: this.model.memory(),
                    history: this.history,
                    snapshots: this.snapshots,
                    tensors: this.model.exportTensors(),
                    parameterCount: this.model.parameterCount,
                    trainingEngine: trainingCore.ENGINE_ID
                });
                this.emit('COMPLETED', {
                    ...completion,
                    tensors: undefined
                });
                return completion;
            } catch (error) {
                this.status = 'failed';
                completion = this.state({
                    error: { name: error.name, message: error.message }
                });
                this.emit('FAILED', completion);
                throw error;
            } finally {
                this.model?.dispose();
                this.model = null;
                this.initialTensors = null;
            }
        }
    }

    return Object.freeze({
        BrowserTrainingRun,
        MAX_BROWSER_STEPS,
        MAX_REPLAY_SNAPSHOTS
    });
}));
