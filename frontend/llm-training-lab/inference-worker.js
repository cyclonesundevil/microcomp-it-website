'use strict';

importScripts(
    'model-contract.js',
    'inference-tokenizer.js',
    'inference-core.js',
    'response-ranking.js'
);

const PROTOCOL_VERSION = '1.0';
const models = new Map();
const trainingRuns = new Map();
const contract = self.MicroCompModelContract;
const tokenizerApi = self.MicroCompInferenceTokenizer;
const core = self.MicroCompInferenceCore;
const rankingApi = self.MicroCompResponseRanking;
let trainingRuntimePromise = null;
let storageRuntimePromise = null;

function response(request, type, payload) {
    self.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        requestId: request.requestId,
        type,
        payload
    });
}

function errorResponse(request, error) {
    response(request, 'ERROR', {
        name: error?.name || 'Error',
        message: error?.message || String(error)
    });
}

async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function probeCapabilities() {
    let adapter = null;
    let webgpuReason = 'navigator.gpu is unavailable';
    if (self.navigator?.gpu) {
        try {
            adapter = await self.navigator.gpu.requestAdapter();
            webgpuReason = adapter ? 'adapter available' : 'no compatible adapter returned';
        } catch (error) {
            webgpuReason = error.message;
        }
    }
    const wasmHeader = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const wasm = typeof WebAssembly === 'object' && WebAssembly.validate(wasmHeader);
    return {
        selectedRuntime: 'cpu-reference-v1',
        selectionReason: 'Specification v1 inference kernels are implemented by the worker-owned float32 CPU reference runtime.',
        webgpu: {
            available: Boolean(adapter),
            enabledForInference: false,
            detail: webgpuReason
        },
        webassembly: {
            available: wasm,
            enabledForInference: false,
            detail: wasm ? 'WebAssembly validation succeeded; accelerated kernels are not bundled in this milestone.' : 'WebAssembly validation failed.'
        },
        cpu: {
            available: true,
            enabledForInference: true,
            detail: `${self.navigator?.hardwareConcurrency || 'unknown'} logical processors reported`
        },
        worker: {
            active: true,
            ownsModelTensors: true
        }
    };
}

function trainingEvent(runId, eventType, data) {
    self.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        requestId: null,
        type: 'TRAINING_EVENT',
        payload: { runId, eventType, data }
    });
}

function ensureStorageRuntime() {
    if (!storageRuntimePromise) {
        storageRuntimePromise = Promise.resolve().then(() => {
            importScripts('datasets.js', 'training-storage.js', 'model-package.js');
            return true;
        });
    }
    return storageRuntimePromise;
}

function ensureTrainingRuntime() {
    if (!trainingRuntimePromise) {
        trainingRuntimePromise = (async () => {
            await ensureStorageRuntime();
            importScripts(
                'vendor/tf.min.js',
                'tokenizer.js',
                'training-core.js',
                'training-runner.js'
            );
            await self.tf.setBackend('cpu');
            await self.tf.ready();
            return {
                backend: self.tf.getBackend(),
                version: self.tf.version.tfjs
            };
        })();
    }
    return trainingRuntimePromise;
}

function tokenizerDocumentFor(dataset) {
    const tokens = self.MicroCompCharacterTokenizer.createVocabulary(dataset.allTexts);
    return {
        schema_version: '1.0',
        type: 'character',
        normalization: 'NFC',
        reserved_tokens: ['<pad>', '<bos>', '<eos>', '<unk>'],
        tokens,
        unknown_behavior: 'encode as <unk>; decode as Unicode replacement character'
    };
}

async function startTraining(request, payload) {
    const runtime = await ensureTrainingRuntime();
    const active = Array.from(trainingRuns.values()).find(
        run => ['running', 'paused'].includes(run.status)
    );
    if (active) throw new Error(`Training run ${active.runId} is already active.`);
    const configuration = contract.validateConfiguration(payload.configuration);
    const dataset = self.MicroCompLlmDatasets.getDataset(
        payload.datasetId || 'cybersecurity-alerts-v1'
    );
    const tokenizerDocument = tokenizerDocumentFor(dataset);
    if (tokenizerDocument.tokens.length !== configuration.vocab_size) {
        throw new Error(
            `Configuration vocabulary size ${configuration.vocab_size} does not match bundled dataset vocabulary ${tokenizerDocument.tokens.length}.`
        );
    }
    const runId = payload.runId || `local-${Date.now().toString(36)}`;
    if (trainingRuns.has(runId) || models.has(runId)) {
        throw new Error(`Run identifier already exists: ${runId}.`);
    }
    const initialTensors = core.initializedTensors(
        configuration, payload.training.seed
    );
    const run = new self.MicroCompTrainingRunner.BrowserTrainingRun({
        runId,
        configuration,
        tokenizerDocument,
        dataset,
        options: payload.training,
        initialTensors,
        emit: (eventType, data) => trainingEvent(runId, eventType, data)
    });
    trainingRuns.set(runId, run);
    response(request, 'TRAINING_STARTED', {
        runId,
        runtime: `tensorflowjs-${runtime.version}-${runtime.backend}`,
        parameterCount: contract.countParameters(configuration).total,
        tokenizer: {
            vocabularySize: tokenizerDocument.tokens.length,
            tokens: tokenizerDocument.tokens
        }
    });
    run.run().then(async completed => {
        if (completed.status !== 'completed') return;
        await ensureStorageRuntime();
        const inferenceModel = new core.TinyLlmCpuModel(
            configuration, tokenizerDocument, completed.tensors
        );
        models.set(runId, inferenceModel);
        const persistenceRecord = {
            runId,
            name: `Tiny LLM ${new Date().toLocaleDateString('en-US')}`,
            status: 'completed',
            completedAt: new Date().toISOString(),
            architectureIdentifier: contract.ARCHITECTURE_ID,
            parameterCount: completed.parameterCount,
            configuration,
            tokenizer: tokenizerDocument,
            training: { ...payload.training },
            finalMetrics: {
                step: completed.step,
                trainLoss: completed.trainLoss,
                validationLoss: completed.validationLoss,
                tokensProcessed: completed.tokensProcessed,
                elapsedSeconds: completed.elapsedSeconds,
                memory: completed.memory
            },
            history: completed.history,
            snapshots: completed.snapshots,
            tensors: completed.tensors,
            datasetIdentifier: dataset.id,
            datasetSha256: await self.MicroCompModelPackage.datasetDigest(dataset),
            trainingEngineIdentifier: 'microcomp-tfjs-training-1.0.0',
            previewText: [...completed.snapshots].reverse()
                .find(item => item.sample)?.sample || ''
        };
        try {
            const saved = await self.MicroCompTrainingStorage.saveCompletedRun(
                persistenceRecord
            );
            trainingEvent(runId, 'PERSISTED', saved);
        } catch (error) {
            trainingEvent(runId, 'PERSISTENCE_FAILED', {
                name: error.name,
                message: error.message
            });
        }
    }).catch(() => {
        // FAILED is emitted by the runner with a structured error.
    }).finally(() => {
        trainingRuns.delete(runId);
    });
}

function compatibilityResult(model, fixture) {
    const actual = model.forward([fixture.input_token_ids]);
    if (actual.logits.length !== fixture.expected_logits.length) {
        throw new Error('Fixture logits length is invalid.');
    }
    let maximumAbsoluteError = 0;
    for (let index = 0; index < actual.logits.length; index += 1) {
        maximumAbsoluteError = Math.max(
            maximumAbsoluteError,
            Math.abs(actual.logits[index] - fixture.expected_logits[index])
        );
    }
    const generation = model.generate(
        fixture.generation.prompt,
        fixture.generation.options
    );
    return {
        tokenizer: model.tokenizer.encode(fixture.tokenizer_probe.text).join(',')
            === fixture.tokenizer_probe.expected_ids.join(','),
        parameterCount: model.parameterCount === fixture.manifest.parameter_count,
        tensorNamesAndShapes: JSON.stringify(model.inspect().tensors.map(item => ({
            name: item.name,
            shape: item.shape
        }))) === JSON.stringify(fixture.manifest.tensors.map(item => ({
            name: item.name,
            shape: item.shape
        }))),
        manifest: true,
        logits: maximumAbsoluteError <= fixture.logit_tolerance,
        maximumAbsoluteError,
        logitTolerance: fixture.logit_tolerance,
        generation: generation.text === fixture.generation.expected_text,
        generatedText: generation.text
    };
}

async function loadFixture(url, modelId) {
    const fetchResponse = await fetch(url, { cache: 'no-store' });
    if (!fetchResponse.ok) throw new Error(`Fixture request failed with HTTP ${fetchResponse.status}.`);
    const fixture = await fetchResponse.json();
    tokenizerApi.validateDocument(fixture.tokenizer);
    contract.validateManifest(fixture.manifest, fixture.tokenizer);
    const tensors = contract.fixtureTensors(fixture.manifest, fixture.weight_recipe);
    const model = new core.TinyLlmCpuModel(
        fixture.manifest.model_hyperparameters,
        fixture.tokenizer,
        tensors
    );
    models.set(modelId, model);
    return {
        model: model.inspect(),
        compatibility: compatibilityResult(model, fixture)
    };
}

async function loadCanonicalDirectory(baseUrl, modelId) {
    const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const [manifestResponse, tokenizerResponse, weightsResponse] = await Promise.all([
        fetch(`${root}manifest.json`, { cache: 'no-store' }),
        fetch(`${root}tokenizer.json`, { cache: 'no-store' }),
        fetch(`${root}weights.bin`, { cache: 'no-store' })
    ]);
    if (![manifestResponse, tokenizerResponse, weightsResponse].every(item => item.ok)) {
        throw new Error('One or more canonical model files could not be loaded.');
    }
    const manifest = await manifestResponse.json();
    const tokenizerDocument = await tokenizerResponse.json();
    const weights = await weightsResponse.arrayBuffer();
    tokenizerApi.validateDocument(tokenizerDocument);
    const validation = contract.validateManifest(manifest, tokenizerDocument);
    if (weights.byteLength !== validation.weightByteLength
        || weights.byteLength !== manifest.files['weights.bin'].byte_length
        || await sha256Hex(weights) !== manifest.files['weights.bin'].sha256) {
        throw new Error('weights.bin integrity validation failed.');
    }
    for (const record of manifest.tensors) {
        const slice = weights.slice(record.offset, record.offset + record.byte_length);
        if (await sha256Hex(slice) !== record.sha256) {
            throw new Error(`Tensor integrity validation failed: ${record.name}.`);
        }
    }
    const tensors = contract.decodeWeightBuffer(manifest, weights);
    const model = new core.TinyLlmCpuModel(
        manifest.model_hyperparameters,
        tokenizerDocument,
        tensors
    );
    models.set(modelId, model);
    return model.inspect();
}

self.addEventListener('message', async event => {
    const request = event.data;
    try {
        if (!request || request.protocolVersion !== PROTOCOL_VERSION
            || typeof request.requestId !== 'string' || typeof request.type !== 'string') {
            throw new Error('Worker message does not match protocol 1.0.');
        }
        const payload = request.payload || {};
        if (request.type === 'PROBE_CAPABILITIES') {
            response(request, 'CAPABILITIES', await probeCapabilities());
            return;
        }
        if (request.type === 'LOAD_FIXTURE') {
            const modelId = payload.modelId || 'python-parity-v1';
            response(request, 'MODEL_READY', await loadFixture(payload.url, modelId));
            return;
        }
        if (request.type === 'LOAD_MODEL_URLS') {
            const modelId = payload.modelId || 'loaded-model';
            response(request, 'MODEL_READY', {
                model: await loadCanonicalDirectory(payload.baseUrl, modelId),
                compatibility: null
            });
            return;
        }
        if (request.type === 'CREATE_MODEL') {
            tokenizerApi.validateDocument(payload.tokenizer);
            const config = contract.validateConfiguration(payload.configuration);
            const tensors = core.initializedTensors(config, payload.seed ?? 4242);
            const model = new core.TinyLlmCpuModel(config, payload.tokenizer, tensors);
            const modelId = payload.modelId || 'browser-model';
            models.set(modelId, model);
            response(request, 'MODEL_READY', { model: model.inspect(), compatibility: null });
            return;
        }
        if (request.type === 'START_TRAINING') {
            await startTraining(request, payload);
            return;
        }
        if (request.type === 'PAUSE_TRAINING'
            || request.type === 'RESUME_TRAINING'
            || request.type === 'CANCEL_TRAINING'
            || request.type === 'GET_TRAINING_STATE') {
            const run = trainingRuns.get(payload.runId);
            if (!run) throw new Error(`Unknown training run: ${payload.runId}.`);
            const action = {
                PAUSE_TRAINING: () => run.pause(),
                RESUME_TRAINING: () => run.resume(),
                CANCEL_TRAINING: () => run.cancel(),
                GET_TRAINING_STATE: () => run.state()
            }[request.type];
            response(request, 'TRAINING_STATE', action());
            return;
        }
        if (request.type === 'LIST_SAVED_MODELS') {
            await ensureStorageRuntime();
            response(request, 'SAVED_MODELS', {
                models: await self.MicroCompTrainingStorage.listCompletedRuns()
            });
            return;
        }
        if (request.type === 'LOAD_SAVED_MODEL') {
            await ensureStorageRuntime();
            const saved = await self.MicroCompTrainingStorage.loadCompletedRun(
                payload.runId
            );
            models.get(saved.runId)?.dispose();
            const model = new core.TinyLlmCpuModel(
                saved.configuration, saved.tokenizer, saved.tensors
            );
            models.set(saved.runId, model);
            response(request, 'MODEL_READY', {
                model: model.inspect(),
                replay: saved.snapshots || [],
                finalMetrics: saved.finalMetrics,
                history: saved.history || [],
                training: saved.training || null,
                datasetIdentifier: saved.datasetIdentifier,
                trainingEngineIdentifier: saved.trainingEngineIdentifier,
                metadata: self.MicroCompTrainingStorage.metadata(saved)
            });
            return;
        }
        if (request.type === 'RENAME_SAVED_MODEL') {
            await ensureStorageRuntime();
            response(request, 'SAVED_MODEL_UPDATED', {
                model: await self.MicroCompTrainingStorage.renameCompletedRun(
                    payload.runId, self.MicroCompModelPackage.boundedName(payload.name)
                )
            });
            return;
        }
        if (request.type === 'DELETE_SAVED_MODEL') {
            await ensureStorageRuntime();
            const deleted = await self.MicroCompTrainingStorage.deleteCompletedRun(
                payload.runId
            );
            models.get(payload.runId)?.dispose();
            models.delete(payload.runId);
            response(request, 'SAVED_MODEL_DELETED', deleted);
            return;
        }
        if (request.type === 'DUPLICATE_SAVED_MODEL') {
            await ensureStorageRuntime();
            const duplicateRunId = payload.duplicateRunId
                || `copy-${crypto.randomUUID?.() || Date.now().toString(36)}`;
            response(request, 'SAVED_MODEL_UPDATED', {
                model: await self.MicroCompTrainingStorage.duplicateCompletedRun(
                    payload.runId, duplicateRunId,
                    payload.name ? self.MicroCompModelPackage.boundedName(payload.name) : null
                )
            });
            return;
        }
        if (request.type === 'EXPORT_SAVED_MODEL') {
            await ensureStorageRuntime();
            const saved = await self.MicroCompTrainingStorage.loadCompletedRun(
                payload.runId
            );
            if (!saved.datasetSha256) {
                const dataset = self.MicroCompLlmDatasets.getDataset(
                    saved.datasetIdentifier || 'cybersecurity-alerts-v1'
                );
                saved.datasetIdentifier = dataset.id;
                saved.datasetSha256 = await self.MicroCompModelPackage.datasetDigest(dataset);
            }
            const exported = await self.MicroCompModelPackage.createPackage(saved);
            response(request, 'MODEL_PACKAGE', {
                fileName: exported.fileName,
                manifest: exported.manifest,
                bytes: exported.bytes.buffer
            });
            return;
        }
        if (request.type === 'IMPORT_MODEL') {
            await ensureStorageRuntime();
            if (typeof payload.fileName !== 'string'
                || !payload.fileName.toLowerCase().endsWith('.microcomp-model')) {
                throw new Error('Imported models must use the .microcomp-model extension.');
            }
            const baseName = payload.fileName.slice(0, -'.microcomp-model'.length);
            const imported = await self.MicroCompModelPackage.importPackage(
                payload.bytes,
                {
                    runId: `imported-${crypto.randomUUID?.() || Date.now().toString(36)}`,
                    name: baseName
                }
            );
            const saved = await self.MicroCompTrainingStorage.saveCompletedRun(imported);
            response(request, 'MODEL_IMPORTED', {
                model: saved,
                checksumsVerified: true
            });
            return;
        }
        const model = models.get(payload.modelId);
        if (!model) throw new Error(`Unknown worker model: ${payload.modelId}.`);
        if (request.type === 'INSPECT') {
            response(request, 'MODEL_INSPECTION', model.inspect());
        } else if (request.type === 'FORWARD') {
            const result = model.forward(payload.tokenIds);
            response(request, 'LOGITS', {
                shape: result.shape,
                values: Array.from(result.logits)
            });
        } else if (request.type === 'RANK_RESPONSES') {
            const seed = Number(payload.baselineSeed);
            if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
                throw new RangeError('Baseline seed is invalid.');
            }
            const trained = rankingApi.rankResponses(
                model, payload.prefix, payload.candidates, payload.correctId
            );
            const baseline = new core.TinyLlmCpuModel(
                model.config,
                model.tokenizer.document,
                core.initializedTensors(model.config, seed)
            );
            try {
                response(request, 'RESPONSE_RANKING', {
                    prefix: payload.prefix,
                    correctId: payload.correctId,
                    parameterCount: model.parameterCount,
                    baselineSeed: seed,
                    trained,
                    baseline: rankingApi.rankResponses(
                        baseline, payload.prefix, payload.candidates, payload.correctId
                    )
                });
            } finally {
                baseline.dispose();
            }
        } else if (request.type === 'RANK_RESPONSE_SET') {
            const seed = Number(payload.baselineSeed);
            if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
                throw new RangeError('Baseline seed is invalid.');
            }
            if (!Array.isArray(payload.challenges) || payload.challenges.length < 1
                || payload.challenges.length > 12) {
                throw new RangeError('Provide 1 through 12 held-out challenges.');
            }
            const baseline = new core.TinyLlmCpuModel(
                model.config,
                model.tokenizer.document,
                core.initializedTensors(model.config, seed)
            );
            try {
                const evaluate = candidateModel => payload.challenges.map(challenge => ({
                    challengeId: challenge.challengeId,
                    correctId: challenge.correctId,
                    ranking: rankingApi.rankResponses(
                        candidateModel,
                        challenge.prefix,
                        challenge.candidates,
                        challenge.correctId
                    )
                }));
                response(request, 'RESPONSE_RANKING_SET', {
                    parameterCount: model.parameterCount,
                    baselineSeed: seed,
                    trained: evaluate(model),
                    baseline: evaluate(baseline)
                });
            } finally {
                baseline.dispose();
            }
        } else if (request.type === 'GENERATE') {
            response(request, 'GENERATED', model.generate(payload.prompt, payload.options));
        } else if (request.type === 'DISPOSE') {
            model.dispose();
            models.delete(payload.modelId);
            response(request, 'DISPOSED', { modelId: payload.modelId });
        } else {
            throw new Error(`Unsupported worker message: ${request.type}.`);
        }
    } catch (error) {
        errorResponse(request || { requestId: 'unknown' }, error);
    }
});
