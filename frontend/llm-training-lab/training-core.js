'use strict';

(function exposeTrainingCore(root, factory) {
    let tfApi;
    let contract;
    let tokenizerApi;
    let inferenceCore;
    if (typeof module === 'object' && module.exports) {
        tfApi = require('./vendor/tf.min.js');
        contract = require('./model-contract.js');
        tokenizerApi = require('./inference-tokenizer.js');
        inferenceCore = require('./inference-core.js');
        module.exports = factory(tfApi, contract, tokenizerApi, inferenceCore);
    } else {
        root.MicroCompTrainingCore = factory(
            root.tf,
            root.MicroCompModelContract,
            root.MicroCompInferenceTokenizer,
            root.MicroCompInferenceCore
        );
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTrainingCore(
    tf, contract, tokenizerApi, inferenceCore
) {
    if (!tf || !contract || !tokenizerApi || !inferenceCore) {
        throw new Error('Browser training dependencies are unavailable.');
    }

    const ENGINE_ID = 'microcomp-tfjs-training-1.0.0';
    const ADAM = Object.freeze({
        beta1: 0.9,
        beta2: 0.999,
        epsilon: 1e-8,
        weightDecay: 0.01
    });

    function integer(value, minimum, maximum, name) {
        if (!Number.isInteger(value) || value < minimum || value > maximum) {
            throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}.`);
        }
        return value;
    }

    function finite(value, minimum, maximum, name) {
        if (typeof value !== 'number' || !Number.isFinite(value)
            || value < minimum || value > maximum) {
            throw new RangeError(`${name} must be from ${minimum} through ${maximum}.`);
        }
        return value;
    }

    function validateTrainingOptions(options) {
        const validated = {
            learningRate: finite(options.learningRate, 0.000001, 1, 'learningRate'),
            batchSize: integer(options.batchSize, 1, 64, 'batchSize'),
            steps: integer(options.steps, 1, 100000, 'steps'),
            validationInterval: integer(
                options.validationInterval, 1, 100000, 'validationInterval'
            ),
            snapshotInterval: integer(
                options.snapshotInterval, 1, 100000, 'snapshotInterval'
            ),
            gradientClipNorm: finite(
                options.gradientClipNorm, 0.01, 100, 'gradientClipNorm'
            ),
            seed: integer(options.seed, 0, 2147483647, 'seed'),
            validationBatches: integer(
                options.validationBatches ?? 4, 1, 128, 'validationBatches'
            ),
            stride: integer(options.stride, 1, 256, 'stride'),
            samplePrompt: String(options.samplePrompt ?? 'alert: ').slice(0, 512),
            sampleMaxNewTokens: integer(
                options.sampleMaxNewTokens ?? 48, 1, 256, 'sampleMaxNewTokens'
            ),
            sampleTemperature: finite(
                options.sampleTemperature ?? 0.8, 0.05, 5, 'sampleTemperature'
            ),
            sampleTopK: integer(options.sampleTopK ?? 12, 1, 512, 'sampleTopK')
        };
        if (validated.validationInterval > validated.steps) {
            validated.validationInterval = validated.steps;
        }
        if (validated.snapshotInterval > validated.steps) {
            validated.snapshotInterval = validated.steps;
        }
        return Object.freeze(validated);
    }

    function xorshift(seed) {
        let state = (Number(seed) >>> 0) || 0x6d2b79f5;
        return function random() {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            return (state >>> 0) / 4294967296;
        };
    }

    function shuffle(values, random) {
        for (let index = values.length - 1; index > 0; index -= 1) {
            const target = Math.floor(random() * (index + 1));
            [values[index], values[target]] = [values[target], values[index]];
        }
        return values;
    }

    function datasetWindows(documents, tokenizer, contextLength, stride) {
        const stream = [];
        documents.forEach(document => {
            stream.push(...tokenizer.encode(document, { addBos: true, addEos: true }));
        });
        const windows = [];
        for (let start = 0; start + contextLength < stream.length; start += stride) {
            windows.push({
                input: stream.slice(start, start + contextLength),
                target: stream.slice(start + 1, start + contextLength + 1)
            });
        }
        if (!windows.length) {
            throw new Error('The dataset does not contain a complete training window.');
        }
        return windows;
    }

    function createBatchScheduler(windows, batchSize, seed) {
        const random = xorshift(seed);
        let order = shuffle(Array.from({ length: windows.length }, (_, index) => index), random);
        let cursor = 0;
        return function nextBatch() {
            const input = [];
            const target = [];
            for (let index = 0; index < batchSize; index += 1) {
                if (cursor >= order.length) {
                    order = shuffle(
                        Array.from({ length: windows.length }, (_, item) => item),
                        random
                    );
                    cursor = 0;
                }
                const selected = windows[order[cursor]];
                cursor += 1;
                input.push(selected.input);
                target.push(selected.target);
            }
            return { input, target };
        };
    }

    function dropout(value, rate, seed) {
        return rate > 0 ? tf.dropout(value, rate, undefined, seed) : value;
    }

    function linear(input, weight, bias, outputWidth) {
        const inputShape = input.shape;
        const rows = input.size / inputShape.at(-1);
        return input.reshape([rows, inputShape.at(-1)])
            .matMul(weight.transpose())
            .add(bias)
            .reshape([...inputShape.slice(0, -1), outputWidth]);
    }

    function layerNorm(input, weight, bias) {
        const mean = input.mean(-1, true);
        const centered = input.sub(mean);
        const variance = centered.square().mean(-1, true);
        return centered.mul(variance.add(1e-5).rsqrt()).mul(weight).add(bias);
    }

    function exactGelu(input) {
        return input.mul(0.5).mul(tf.erf(input.div(Math.SQRT2)).add(1));
    }

    class TensorFlowTinyLlm {
        constructor(configuration, tokenizerDocument, initialTensors) {
            this.config = contract.validateConfiguration({ ...configuration });
            this.tokenizer = new tokenizerApi.CharacterTokenizer(tokenizerDocument);
            if (this.tokenizer.vocabSize !== this.config.vocab_size) {
                throw new Error('Tokenizer vocabulary does not match the model.');
            }
            const definitions = contract.tensorDefinitions(this.config);
            this.variables = {};
            definitions.forEach(definition => {
                const values = initialTensors[definition.name];
                if (!(values instanceof Float32Array)
                    || values.length !== contract.product(definition.shape)) {
                    throw new Error(`Initial tensor is invalid: ${definition.name}.`);
                }
                const initial = tf.tensor(values, definition.shape, 'float32');
                this.variables[definition.name] = tf.variable(
                    initial, true, definition.name
                );
                initial.dispose();
            });
            this.variableList = definitions.map(item => this.variables[item.name]);
            this.moments = {};
            this.velocities = {};
            definitions.forEach(definition => {
                const momentInitial = tf.zeros(definition.shape);
                const velocityInitial = tf.zeros(definition.shape);
                this.moments[definition.name] = tf.variable(
                    momentInitial, false, `adam_m_${definition.name}`
                );
                this.velocities[definition.name] = tf.variable(
                    velocityInitial, false, `adam_v_${definition.name}`
                );
                momentInitial.dispose();
                velocityInitial.dispose();
            });
            this.parameterCount = definitions.reduce(
                (sum, item) => sum + contract.product(item.shape), 0
            );
            if (this.parameterCount !== contract.countParameters(this.config).total) {
                throw new Error('Actual browser parameter count does not match the formula.');
            }
            this.step = 0;
        }

        forward(tokenIds, { training = false, seed = 0, capture = false } = {}) {
            const config = this.config;
            const B = tokenIds.shape[0];
            const S = tokenIds.shape[1];
            const D = config.embedding_dim;
            const H = config.attention_heads;
            const Dh = D / H;
            if (S < 1 || S > config.context_length) {
                throw new RangeError('Sequence length is outside the model context.');
            }
            const positions = tf.range(0, S, 1, 'int32');
            const tokenEmbeddings = tf.gather(
                this.variables['token_embedding.weight'], tokenIds
            );
            const positionEmbeddings = tf.gather(
                this.variables['position_embedding.weight'], positions
            ).reshape([1, S, D]);
            let hidden = tokenEmbeddings.add(positionEmbeddings);
            hidden = training ? dropout(hidden, config.dropout, seed) : hidden;
            const artifacts = capture ? {
                attention: [],
                activations: [{ name: 'embeddings', tensor: hidden }]
            } : null;

            for (let block = 0; block < config.transformer_blocks; block += 1) {
                const prefix = `blocks.${block}`;
                const normalized = layerNorm(
                    hidden,
                    this.variables[`${prefix}.ln1.weight`],
                    this.variables[`${prefix}.ln1.bias`]
                );
                const project = name => linear(
                    normalized,
                    this.variables[`${prefix}.attention.${name}.weight`],
                    this.variables[`${prefix}.attention.${name}.bias`],
                    D
                ).reshape([B, S, H, Dh]).transpose([0, 2, 1, 3]);
                const query = project('q_proj');
                const key = project('k_proj');
                const value = project('v_proj');
                let scores = query.matMul(key, false, true).div(Math.sqrt(Dh));
                const mask = tf.linalg.bandPart(tf.ones([S, S], 'bool'), -1, 0)
                    .reshape([1, 1, S, S]);
                scores = tf.where(mask, scores, tf.fill(scores.shape, -Infinity));
                let attention = tf.softmax(scores, -1);
                if (training) attention = dropout(attention, config.dropout, seed + block + 1);
                const attended = attention.matMul(value)
                    .transpose([0, 2, 1, 3])
                    .reshape([B, S, D]);
                let projected = linear(
                    attended,
                    this.variables[`${prefix}.attention.out_proj.weight`],
                    this.variables[`${prefix}.attention.out_proj.bias`],
                    D
                );
                if (training) projected = dropout(projected, config.dropout, seed + block + 101);
                hidden = hidden.add(projected);
                const ffNormalized = layerNorm(
                    hidden,
                    this.variables[`${prefix}.ln2.weight`],
                    this.variables[`${prefix}.ln2.bias`]
                );
                const expanded = exactGelu(linear(
                    ffNormalized,
                    this.variables[`${prefix}.ff_up.weight`],
                    this.variables[`${prefix}.ff_up.bias`],
                    config.feed_forward_dim
                ));
                let reduced = linear(
                    expanded,
                    this.variables[`${prefix}.ff_down.weight`],
                    this.variables[`${prefix}.ff_down.bias`],
                    D
                );
                if (training) reduced = dropout(reduced, config.dropout, seed + block + 201);
                hidden = hidden.add(reduced);
                if (capture) {
                    artifacts.attention.push(attention);
                    artifacts.activations.push({ name: `block ${block + 1}`, tensor: hidden });
                }
            }
            hidden = layerNorm(
                hidden,
                this.variables['final_norm.weight'],
                this.variables['final_norm.bias']
            );
            if (capture) artifacts.activations.push({ name: 'final norm', tensor: hidden });
            const outputWeight = config.tie_embeddings
                ? this.variables['token_embedding.weight']
                : this.variables['lm_head.weight'];
            const logits = linear(
                hidden,
                outputWeight,
                this.variables['lm_head.bias'],
                config.vocab_size
            );
            return { logits, artifacts };
        }

        lossTensor(inputs, targets, seed) {
            const { logits } = this.forward(inputs, { training: true, seed });
            const labels = tf.oneHot(targets, this.config.vocab_size);
            return labels.mul(tf.logSoftmax(logits, -1)).sum(-1).mean().neg();
        }

        trainBatch(batch, options) {
            this.step += 1;
            return tf.tidy(() => {
                const inputs = tf.tensor2d(
                    batch.input.flat(), [batch.input.length, this.config.context_length], 'int32'
                );
                const targets = tf.tensor2d(
                    batch.target.flat(), [batch.target.length, this.config.context_length], 'int32'
                );
                const calculated = tf.variableGrads(
                    () => this.lossTensor(inputs, targets, options.seed + this.step),
                    this.variableList
                );
                const gradients = this.variableList.map(variable => {
                    const gradient = calculated.grads[variable.name];
                    if (!gradient) throw new Error(`Missing gradient for ${variable.name}.`);
                    return gradient;
                });
                const normTensor = tf.sqrt(tf.addN(gradients.map(value => value.square().sum())));
                const gradientNorm = normTensor.dataSync()[0];
                if (!Number.isFinite(gradientNorm)) {
                    throw new Error('Training produced a non-finite gradient norm.');
                }
                const scale = Math.min(1, options.gradientClipNorm / Math.max(gradientNorm, 1e-12));
                const beta1Correction = 1 - (ADAM.beta1 ** this.step);
                const beta2Correction = 1 - (ADAM.beta2 ** this.step);
                this.variableList.forEach((variable, index) => {
                    const name = Object.keys(this.variables)[index];
                    const gradient = gradients[index].mul(scale);
                    const moment = this.moments[name];
                    const velocity = this.velocities[name];
                    moment.assign(moment.mul(ADAM.beta1).add(gradient.mul(1 - ADAM.beta1)));
                    velocity.assign(
                        velocity.mul(ADAM.beta2).add(gradient.square().mul(1 - ADAM.beta2))
                    );
                    const normalizedMoment = moment.div(beta1Correction);
                    const normalizedVelocity = velocity.div(beta2Correction);
                    const update = normalizedMoment
                        .div(normalizedVelocity.sqrt().add(ADAM.epsilon))
                        .add(variable.mul(ADAM.weightDecay));
                    variable.assign(variable.sub(update.mul(options.learningRate)));
                });
                const loss = calculated.value.dataSync()[0];
                if (!Number.isFinite(loss)) throw new Error('Training loss became non-finite.');
                return {
                    loss,
                    gradientNorm,
                    appliedGradientNorm: Math.min(
                        gradientNorm, options.gradientClipNorm
                    )
                };
            });
        }

        validationLoss(windows, maximumBatches, batchSize) {
            const losses = [];
            for (let start = 0; start < windows.length
                && losses.length < maximumBatches; start += batchSize) {
                const batchWindows = windows.slice(start, start + batchSize);
                const value = tf.tidy(() => {
                    const input = tf.tensor2d(
                        batchWindows.flatMap(item => item.input),
                        [batchWindows.length, this.config.context_length],
                        'int32'
                    );
                    const target = tf.tensor2d(
                        batchWindows.flatMap(item => item.target),
                        [batchWindows.length, this.config.context_length],
                        'int32'
                    );
                    const { logits } = this.forward(input);
                    const labels = tf.oneHot(target, this.config.vocab_size);
                    return labels.mul(tf.logSoftmax(logits, -1))
                        .sum(-1).mean().neg().dataSync()[0];
                });
                losses.push(value);
            }
            return losses.reduce((sum, value) => sum + value, 0) / losses.length;
        }

        explorerSnapshot(prompt, embeddingTokenIds) {
            const encoded = this.tokenizer.encode(prompt);
            const tokenIds = (encoded.length ? encoded : [this.tokenizer.bosId])
                .slice(-Math.min(this.config.context_length, 16));
            const result = tf.tidy(() => {
                const input = tf.tensor2d(tokenIds, [1, tokenIds.length], 'int32');
                const forward = this.forward(input, { capture: true });
                const logits = forward.logits
                    .slice([0, tokenIds.length - 1, 0], [1, 1, this.config.vocab_size])
                    .reshape([this.config.vocab_size]);
                const probabilities = tf.softmax(logits);
                const attention = forward.artifacts.attention[0]
                    .slice([0, 0, 0, 0], [1, this.config.attention_heads, tokenIds.length, tokenIds.length])
                    .reshape([this.config.attention_heads, tokenIds.length, tokenIds.length]);
                const activations = forward.artifacts.activations.map(item => ({
                    name: item.name,
                    meanAbsolute: item.tensor.abs().mean().dataSync()[0],
                    rootMeanSquare: item.tensor.square().mean().sqrt().dataSync()[0]
                }));
                return {
                    tokenIds: [...tokenIds],
                    attention: {
                        shape: [...attention.shape],
                        values: Array.from(attention.dataSync())
                    },
                    logits: Array.from(logits.dataSync()),
                    probabilities: Array.from(probabilities.dataSync()),
                    activations
                };
            });
            const embedding = this.variables['token_embedding.weight'].dataSync();
            const dimensions = Math.min(this.config.embedding_dim, 8);
            const selectedIds = embeddingTokenIds.slice(0, 12);
            result.embeddings = {
                tokenIds: [...selectedIds],
                shape: [selectedIds.length, dimensions],
                values: selectedIds.flatMap(id => Array.from(
                    embedding.slice(
                        id * this.config.embedding_dim,
                        id * this.config.embedding_dim + dimensions
                    )
                ))
            };
            let selectedTokenId = 0;
            result.probabilities.forEach((value, index) => {
                if (value > result.probabilities[selectedTokenId]) selectedTokenId = index;
            });
            result.selectedTokenId = selectedTokenId;
            return result;
        }

        exportTensors() {
            const output = {};
            Object.entries(this.variables).forEach(([name, variable]) => {
                output[name] = new Float32Array(variable.dataSync());
            });
            return output;
        }

        createInferenceModel() {
            return new inferenceCore.TinyLlmCpuModel(
                this.config,
                this.tokenizer.document,
                this.exportTensors()
            );
        }

        memory() {
            const current = tf.memory();
            return {
                tensorCount: current.numTensors,
                tensorflowBytes: current.numBytes,
                parameterBytes: this.parameterCount * 4,
                optimizerSlotBytes: this.parameterCount * 8
            };
        }

        dispose() {
            Object.values(this.variables).forEach(value => value.dispose());
            Object.values(this.moments).forEach(value => value.dispose());
            Object.values(this.velocities).forEach(value => value.dispose());
            this.variables = {};
            this.moments = {};
            this.velocities = {};
        }
    }

    return Object.freeze({
        ADAM,
        ENGINE_ID,
        TensorFlowTinyLlm,
        createBatchScheduler,
        datasetWindows,
        validateTrainingOptions,
        xorshift
    });
}));
