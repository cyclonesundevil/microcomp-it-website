'use strict';

(function exposeInferenceCore(root, factory) {
    let contract;
    let tokenizerApi;
    if (typeof module === 'object' && module.exports) {
        contract = require('./model-contract.js');
        tokenizerApi = require('./inference-tokenizer.js');
        module.exports = factory(contract, tokenizerApi);
    } else {
        root.MicroCompInferenceCore = factory(
            root.MicroCompModelContract,
            root.MicroCompInferenceTokenizer
        );
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createInferenceCore(contract, tokenizerApi) {
    if (!contract || !tokenizerApi) throw new Error('Inference dependencies are unavailable.');

    function erf(value) {
        const sign = value < 0 ? -1 : 1;
        const x = Math.abs(value);
        const t = 1 / (1 + (0.3275911 * x));
        const polynomial = (
            ((((1.061405429 * t) - 1.453152027) * t + 1.421413741) * t - 0.284496736)
            * t + 0.254829592
        ) * t;
        return sign * (1 - (polynomial * Math.exp(-(x * x))));
    }

    function gelu(value) {
        return Math.fround(0.5 * value * (1 + erf(value / Math.SQRT2)));
    }

    function linear(input, rows, inputWidth, outputWidth, weight, bias) {
        const output = new Float32Array(rows * outputWidth);
        for (let row = 0; row < rows; row += 1) {
            const inputOffset = row * inputWidth;
            const outputOffset = row * outputWidth;
            for (let out = 0; out < outputWidth; out += 1) {
                let sum = bias[out];
                const weightOffset = out * inputWidth;
                for (let inner = 0; inner < inputWidth; inner += 1) {
                    sum += input[inputOffset + inner] * weight[weightOffset + inner];
                }
                output[outputOffset + out] = Math.fround(sum);
            }
        }
        return output;
    }

    function layerNorm(input, rows, width, weight, bias) {
        const output = new Float32Array(input.length);
        for (let row = 0; row < rows; row += 1) {
            const offset = row * width;
            let mean = 0;
            for (let index = 0; index < width; index += 1) mean += input[offset + index];
            mean /= width;
            let variance = 0;
            for (let index = 0; index < width; index += 1) {
                const difference = input[offset + index] - mean;
                variance += difference * difference;
            }
            variance /= width;
            const inverse = 1 / Math.sqrt(variance + 1e-5);
            for (let index = 0; index < width; index += 1) {
                output[offset + index] = Math.fround(
                    ((input[offset + index] - mean) * inverse * weight[index]) + bias[index]
                );
            }
        }
        return output;
    }

    function add(left, right) {
        const output = new Float32Array(left.length);
        for (let index = 0; index < left.length; index += 1) {
            output[index] = Math.fround(left[index] + right[index]);
        }
        return output;
    }

    function causalAttention(input, batch, sequence, config, tensors, prefix) {
        const width = config.embedding_dim;
        const heads = config.attention_heads;
        const headWidth = width / heads;
        const rows = batch * sequence;
        const project = name => linear(
            input,
            rows,
            width,
            width,
            tensors[`${prefix}.attention.${name}.weight`],
            tensors[`${prefix}.attention.${name}.bias`]
        );
        const query = project('q_proj');
        const key = project('k_proj');
        const value = project('v_proj');
        const attended = new Float32Array(input.length);
        const scale = 1 / Math.sqrt(headWidth);

        for (let batchIndex = 0; batchIndex < batch; batchIndex += 1) {
            for (let head = 0; head < heads; head += 1) {
                const headOffset = head * headWidth;
                for (let queryPosition = 0; queryPosition < sequence; queryPosition += 1) {
                    const scores = new Float32Array(queryPosition + 1);
                    let maximum = -Infinity;
                    const queryOffset = ((batchIndex * sequence + queryPosition) * width) + headOffset;
                    for (let keyPosition = 0; keyPosition <= queryPosition; keyPosition += 1) {
                        const keyOffset = ((batchIndex * sequence + keyPosition) * width) + headOffset;
                        let score = 0;
                        for (let inner = 0; inner < headWidth; inner += 1) {
                            score += query[queryOffset + inner] * key[keyOffset + inner];
                        }
                        score = Math.fround(score * scale);
                        scores[keyPosition] = score;
                        if (score > maximum) maximum = score;
                    }
                    let denominator = 0;
                    for (let keyPosition = 0; keyPosition < scores.length; keyPosition += 1) {
                        scores[keyPosition] = Math.fround(
                            Math.exp(scores[keyPosition] - maximum)
                        );
                        denominator += scores[keyPosition];
                    }
                    const outputOffset = ((batchIndex * sequence + queryPosition) * width) + headOffset;
                    for (let inner = 0; inner < headWidth; inner += 1) {
                        let result = 0;
                        for (let keyPosition = 0; keyPosition < scores.length; keyPosition += 1) {
                            const valueOffset = ((batchIndex * sequence + keyPosition) * width) + headOffset;
                            result += (scores[keyPosition] / denominator) * value[valueOffset + inner];
                        }
                        attended[outputOffset + inner] = Math.fround(result);
                    }
                }
            }
        }
        return linear(
            attended,
            rows,
            width,
            width,
            tensors[`${prefix}.attention.out_proj.weight`],
            tensors[`${prefix}.attention.out_proj.bias`]
        );
    }

    function feedForward(input, rows, config, tensors, prefix) {
        const up = linear(
            input,
            rows,
            config.embedding_dim,
            config.feed_forward_dim,
            tensors[`${prefix}.ff_up.weight`],
            tensors[`${prefix}.ff_up.bias`]
        );
        for (let index = 0; index < up.length; index += 1) up[index] = gelu(up[index]);
        return linear(
            up,
            rows,
            config.feed_forward_dim,
            config.embedding_dim,
            tensors[`${prefix}.ff_down.weight`],
            tensors[`${prefix}.ff_down.bias`]
        );
    }

    function xorshiftGenerator(seed) {
        let state = (Number(seed) >>> 0) || 0x6d2b79f5;
        return function random() {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            return (state >>> 0) / 4294967296;
        };
    }

    function initializedTensors(config, seed = 4242) {
        const random = xorshiftGenerator(seed);
        const normal = () => {
            const first = Math.max(Number.EPSILON, random());
            const second = random();
            return Math.fround(Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second) * 0.02);
        };
        const tensors = {};
        contract.tensorDefinitions(config).forEach(definition => {
            const values = new Float32Array(contract.product(definition.shape));
            const isNormWeight = definition.name === 'final_norm.weight'
                || /\.ln[12]\.weight$/.test(definition.name);
            const isBias = definition.name.endsWith('.bias');
            for (let index = 0; index < values.length; index += 1) {
                values[index] = isNormWeight ? 1 : isBias ? 0 : normal();
            }
            tensors[definition.name] = values;
        });
        return tensors;
    }

    class TinyLlmCpuModel {
        constructor(config, tokenizerDocument, tensors) {
            this.config = contract.validateConfiguration({ ...config });
            this.tokenizer = new tokenizerApi.CharacterTokenizer(tokenizerDocument);
            if (this.tokenizer.vocabSize !== this.config.vocab_size) {
                throw new Error('Tokenizer vocabulary size does not match model configuration.');
            }
            const definitions = contract.tensorDefinitions(this.config);
            const names = Object.keys(tensors).sort();
            if (JSON.stringify(names) !== JSON.stringify(definitions.map(item => item.name))) {
                throw new Error('Model tensor names do not match specification v1.');
            }
            this.tensors = {};
            definitions.forEach(definition => {
                const value = tensors[definition.name];
                if (!(value instanceof Float32Array)
                    || value.length !== contract.product(definition.shape)
                    || Array.from(value).some(item => !Number.isFinite(item))) {
                    throw new Error(`Tensor is invalid: ${definition.name}.`);
                }
                this.tensors[definition.name] = value;
            });
            this.parameterCount = definitions.reduce(
                (sum, definition) => sum + contract.product(definition.shape), 0
            );
        }

        inspect() {
            return {
                architectureIdentifier: contract.ARCHITECTURE_ID,
                runtime: 'cpu-reference-v1',
                parameterCount: this.parameterCount,
                configuration: { ...this.config },
                vocabularySize: this.tokenizer.vocabSize,
                tensors: contract.tensorDefinitions(this.config).map(item => ({
                    name: item.name,
                    shape: [...item.shape],
                    parameters: contract.product(item.shape)
                }))
            };
        }

        forward(batchTokenIds) {
            if (!Array.isArray(batchTokenIds) || !batchTokenIds.length
                || !batchTokenIds.every(row => Array.isArray(row))) {
                throw new TypeError('Token IDs must have shape [batch, sequence].');
            }
            const batch = batchTokenIds.length;
            const sequence = batchTokenIds[0].length;
            if (sequence < 1 || sequence > this.config.context_length
                || !batchTokenIds.every(row => row.length === sequence)) {
                throw new RangeError('Sequence shape is invalid.');
            }
            batchTokenIds.flat().forEach(id => {
                if (!Number.isInteger(id) || id < 0 || id >= this.config.vocab_size) {
                    throw new RangeError(`Token ID ${id} is invalid.`);
                }
            });
            const D = this.config.embedding_dim;
            const rows = batch * sequence;
            const tokenEmbedding = this.tensors['token_embedding.weight'];
            const positionEmbedding = this.tensors['position_embedding.weight'];
            let hidden = new Float32Array(rows * D);
            for (let batchIndex = 0; batchIndex < batch; batchIndex += 1) {
                for (let position = 0; position < sequence; position += 1) {
                    const token = batchTokenIds[batchIndex][position];
                    const targetOffset = ((batchIndex * sequence + position) * D);
                    for (let inner = 0; inner < D; inner += 1) {
                        hidden[targetOffset + inner] = Math.fround(
                            tokenEmbedding[(token * D) + inner]
                            + positionEmbedding[(position * D) + inner]
                        );
                    }
                }
            }
            for (let block = 0; block < this.config.transformer_blocks; block += 1) {
                const prefix = `blocks.${block}`;
                const normalizedAttention = layerNorm(
                    hidden, rows, D,
                    this.tensors[`${prefix}.ln1.weight`],
                    this.tensors[`${prefix}.ln1.bias`]
                );
                hidden = add(
                    hidden,
                    causalAttention(
                        normalizedAttention, batch, sequence, this.config, this.tensors, prefix
                    )
                );
                const normalizedFeedForward = layerNorm(
                    hidden, rows, D,
                    this.tensors[`${prefix}.ln2.weight`],
                    this.tensors[`${prefix}.ln2.bias`]
                );
                hidden = add(
                    hidden,
                    feedForward(
                        normalizedFeedForward, rows, this.config, this.tensors, prefix
                    )
                );
            }
            hidden = layerNorm(
                hidden, rows, D,
                this.tensors['final_norm.weight'],
                this.tensors['final_norm.bias']
            );
            const outputWeight = this.config.tie_embeddings
                ? this.tensors['token_embedding.weight']
                : this.tensors['lm_head.weight'];
            const logits = linear(
                hidden,
                rows,
                D,
                this.config.vocab_size,
                outputWeight,
                this.tensors['lm_head.bias']
            );
            return { logits, shape: [batch, sequence, this.config.vocab_size] };
        }

        generate(prompt, options = {}) {
            if (typeof prompt !== 'string' || Array.from(prompt).length > 4096) {
                throw new TypeError('Prompt must be a string of at most 4,096 characters.');
            }
            const temperature = Number(options.temperature ?? 0.8);
            const topK = Number(options.topK ?? 12);
            const maximum = Number(options.maxNewTokens ?? 80);
            const seed = options.seed === null ? null : Number(options.seed ?? 4242);
            if (!Number.isFinite(temperature) || temperature < 0.05 || temperature > 5) {
                throw new RangeError('Temperature must be from 0.05 through 5.0.');
            }
            if (!Number.isInteger(topK) || topK < 1 || topK > this.tokenizer.vocabSize) {
                throw new RangeError('top-k is invalid.');
            }
            if (!Number.isInteger(maximum) || maximum < 1 || maximum > 256) {
                throw new RangeError('Maximum new tokens is invalid.');
            }
            if (seed !== null && (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)) {
                throw new RangeError('Seed is invalid.');
            }
            const random = seed === null ? Math.random : xorshiftGenerator(seed);
            const tokenIds = this.tokenizer.encode(prompt);
            if (!tokenIds.length) tokenIds.push(this.tokenizer.bosId);
            const generatedIds = [];
            for (let step = 0; step < maximum; step += 1) {
                const context = tokenIds.slice(-this.config.context_length);
                const result = this.forward([context]);
                const offset = (context.length - 1) * this.config.vocab_size;
                const ranked = Array.from(
                    { length: this.config.vocab_size },
                    (_, id) => ({ id, logit: result.logits[offset + id] / temperature })
                ).sort((left, right) => right.logit - left.logit || left.id - right.id)
                    .slice(0, topK);
                const maximumLogit = Math.max(...ranked.map(item => item.logit));
                const weights = ranked.map(item => Math.exp(item.logit - maximumLogit));
                const total = weights.reduce((sum, value) => sum + value, 0);
                let threshold = random() * total;
                let selected = ranked.at(-1).id;
                for (let index = 0; index < ranked.length; index += 1) {
                    threshold -= weights[index];
                    if (threshold <= 0) {
                        selected = ranked[index].id;
                        break;
                    }
                }
                if (selected === this.tokenizer.eosId) break;
                tokenIds.push(selected);
                generatedIds.push(selected);
            }
            return {
                text: this.tokenizer.decode(tokenIds),
                generatedTokenIds: generatedIds,
                totalTokenIds: tokenIds.length
            };
        }

        dispose() {
            Object.values(this.tensors).forEach(tensor => tensor.fill(0));
            this.tensors = {};
        }
    }

    return Object.freeze({
        TinyLlmCpuModel,
        erf,
        gelu,
        initializedTensors,
        xorshiftGenerator
    });
}));
