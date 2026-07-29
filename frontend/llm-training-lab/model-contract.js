'use strict';

(function exposeModelContract(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompModelContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModelContract() {
    const ARCHITECTURE_ID = 'microcomp.char-decoder-transformer.pre-norm.v1';
    const FORMAT_VERSION = '1.0';
    const PARAMETER_LIMIT = 200000;
    const WEIGHT_FORMAT = 'concatenated-little-endian-float32-row-major';
    const MODEL_FIELDS = Object.freeze([
        'attention_heads', 'context_length', 'dropout', 'embedding_dim',
        'feed_forward_dim', 'tie_embeddings', 'transformer_blocks', 'vocab_size'
    ]);
    const MANIFEST_FIELDS = Object.freeze([
        'architecture_identifier', 'context_length', 'creation_timestamp', 'files',
        'format_version', 'model_hyperparameters', 'normalization', 'parameter_count',
        'parameter_limit', 'position_representation', 'tensor_count', 'tensors',
        'tied_input_output_embeddings', 'tokenizer_type',
        'training_dataset_identifier', 'training_dataset_sha256',
        'training_engine_identifier', 'vocabulary_size', 'weight_format'
    ]);

    function exactKeys(value, expected) {
        return value && typeof value === 'object' && !Array.isArray(value)
            && Object.keys(value).sort().join('\u0000') === [...expected].sort().join('\u0000');
    }

    function integer(value, minimum, maximum, name) {
        if (!Number.isInteger(value) || value < minimum || value > maximum) {
            throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}.`);
        }
    }

    function validateConfiguration(config) {
        if (!exactKeys(config, MODEL_FIELDS)) throw new TypeError('Model configuration fields do not match specification v1.');
        integer(config.vocab_size, 5, 512, 'vocab_size');
        integer(config.context_length, 2, 256, 'context_length');
        integer(config.embedding_dim, 4, 256, 'embedding_dim');
        integer(config.attention_heads, 1, 16, 'attention_heads');
        integer(config.transformer_blocks, 1, 8, 'transformer_blocks');
        integer(config.feed_forward_dim, 4, 1024, 'feed_forward_dim');
        if (typeof config.dropout !== 'number' || !Number.isFinite(config.dropout)
            || config.dropout < 0 || config.dropout > 0.5) {
            throw new TypeError('dropout must be a finite number from 0.0 through 0.5.');
        }
        if (typeof config.tie_embeddings !== 'boolean') throw new TypeError('tie_embeddings must be Boolean.');
        if (config.embedding_dim % config.attention_heads !== 0) {
            throw new RangeError('embedding_dim must be divisible by attention_heads.');
        }
        if (config.embedding_dim / config.attention_heads < 4) {
            throw new RangeError('Each attention head must have at least four dimensions.');
        }
        const count = countParameters(config);
        if (count.total > PARAMETER_LIMIT) {
            throw new RangeError(`Configuration exceeds the ${PARAMETER_LIMIT}-parameter limit.`);
        }
        return config;
    }

    function countParameters(config) {
        const V = config.vocab_size;
        const T = config.context_length;
        const D = config.embedding_dim;
        const L = config.transformer_blocks;
        const F = config.feed_forward_dim;
        const perBlock = (4 * D * D) + (2 * D * F) + (9 * D) + F;
        const layers = {
            token_embedding: V * D,
            position_embedding: T * D,
            decoder_blocks: L * perBlock,
            final_layer_norm: 2 * D,
            language_model_head_bias: V,
            language_model_head_weight: config.tie_embeddings ? 0 : D * V
        };
        return {
            layers,
            perBlock,
            total: Object.values(layers).reduce((sum, value) => sum + value, 0)
        };
    }

    function tensorDefinitions(config) {
        validateConfiguration(config);
        const V = config.vocab_size;
        const T = config.context_length;
        const D = config.embedding_dim;
        const F = config.feed_forward_dim;
        const definitions = [
            { name: 'token_embedding.weight', shape: [V, D] },
            { name: 'position_embedding.weight', shape: [T, D] }
        ];
        for (let index = 0; index < config.transformer_blocks; index += 1) {
            const prefix = `blocks.${index}`;
            definitions.push(
                { name: `${prefix}.ln1.weight`, shape: [D] },
                { name: `${prefix}.ln1.bias`, shape: [D] },
                { name: `${prefix}.attention.q_proj.weight`, shape: [D, D] },
                { name: `${prefix}.attention.q_proj.bias`, shape: [D] },
                { name: `${prefix}.attention.k_proj.weight`, shape: [D, D] },
                { name: `${prefix}.attention.k_proj.bias`, shape: [D] },
                { name: `${prefix}.attention.v_proj.weight`, shape: [D, D] },
                { name: `${prefix}.attention.v_proj.bias`, shape: [D] },
                { name: `${prefix}.attention.out_proj.weight`, shape: [D, D] },
                { name: `${prefix}.attention.out_proj.bias`, shape: [D] },
                { name: `${prefix}.ln2.weight`, shape: [D] },
                { name: `${prefix}.ln2.bias`, shape: [D] },
                { name: `${prefix}.ff_up.weight`, shape: [F, D] },
                { name: `${prefix}.ff_up.bias`, shape: [F] },
                { name: `${prefix}.ff_down.weight`, shape: [D, F] },
                { name: `${prefix}.ff_down.bias`, shape: [D] }
            );
        }
        definitions.push(
            { name: 'final_norm.weight', shape: [D] },
            { name: 'final_norm.bias', shape: [D] },
            { name: 'lm_head.bias', shape: [V] }
        );
        if (!config.tie_embeddings) definitions.push({ name: 'lm_head.weight', shape: [V, D] });
        return definitions.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    }

    function product(shape) {
        return shape.reduce((result, size) => result * size, 1);
    }

    function validateManifest(manifest, tokenizerDocument) {
        if (!exactKeys(manifest, MANIFEST_FIELDS)) throw new TypeError('Manifest fields do not match format 1.0.');
        if (manifest.format_version !== FORMAT_VERSION) throw new Error('Unsupported package format.');
        if (manifest.architecture_identifier !== ARCHITECTURE_ID) throw new Error('Unsupported architecture.');
        if (manifest.normalization !== 'pre-normalization'
            || manifest.position_representation !== 'learned-position-embedding'
            || manifest.tokenizer_type !== 'character'
            || manifest.weight_format !== WEIGHT_FORMAT
            || manifest.parameter_limit !== PARAMETER_LIMIT) {
            throw new Error('Manifest constants do not conform to specification v1.');
        }
        const config = validateConfiguration(manifest.model_hyperparameters);
        if (manifest.vocabulary_size !== config.vocab_size
            || manifest.context_length !== config.context_length
            || manifest.tied_input_output_embeddings !== config.tie_embeddings
            || tokenizerDocument.tokens.length !== config.vocab_size) {
            throw new Error('Manifest duplicates inconsistent model values.');
        }
        const count = countParameters(config);
        if (manifest.parameter_count !== count.total) throw new Error('Manifest parameter count is invalid.');
        if (typeof manifest.creation_timestamp !== 'string'
            || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(manifest.creation_timestamp)
            || Number.isNaN(Date.parse(manifest.creation_timestamp))) {
            throw new Error('Manifest creation timestamp is invalid.');
        }
        if (typeof manifest.training_dataset_identifier !== 'string'
            || !manifest.training_dataset_identifier.length
            || manifest.training_dataset_identifier.length > 200
            || !/^[0-9a-f]{64}$/.test(manifest.training_dataset_sha256)
            || typeof manifest.training_engine_identifier !== 'string'
            || !/^[a-z0-9][a-z0-9._-]*-(?:v)?[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.training_engine_identifier)) {
            throw new Error('Manifest provenance fields are invalid.');
        }
        const fileNames = ['tokenizer.json', 'training-config.json', 'training-history.json', 'weights.bin'];
        if (!exactKeys(manifest.files, fileNames)) throw new Error('Manifest file records are invalid.');
        fileNames.forEach(name => {
            const record = manifest.files[name];
            if (!exactKeys(record, ['byte_length', 'sha256'])
                || !Number.isInteger(record.byte_length) || record.byte_length < 0
                || !/^[0-9a-f]{64}$/.test(record.sha256)) {
                throw new Error(`Manifest file record is invalid for ${name}.`);
            }
        });
        const expected = tensorDefinitions(config);
        if (!Array.isArray(manifest.tensors) || manifest.tensor_count !== expected.length
            || manifest.tensors.length !== expected.length) {
            throw new Error('Manifest tensor count is invalid.');
        }
        let offset = 0;
        let elements = 0;
        manifest.tensors.forEach((record, index) => {
            const definition = expected[index];
            const required = ['byte_length', 'byte_order', 'dtype', 'layout', 'name', 'offset', 'sha256', 'shape'];
            if (!exactKeys(record, required) || record.name !== definition.name
                || JSON.stringify(record.shape) !== JSON.stringify(definition.shape)
                || record.dtype !== 'float32' || record.layout !== 'row-major'
                || record.byte_order !== 'little' || record.offset !== offset) {
                throw new Error(`Tensor record is invalid at index ${index}.`);
            }
            const length = product(record.shape) * 4;
            if (record.byte_length !== length || !/^[0-9a-f]{64}$/.test(record.sha256)) {
                throw new Error(`Tensor byte contract is invalid for ${record.name}.`);
            }
            offset += length;
            elements += product(record.shape);
        });
        if (elements !== count.total) throw new Error('Tensor element count does not match parameter count.');
        return { config, definitions: expected, weightByteLength: offset };
    }

    function decodeWeightBuffer(manifest, buffer) {
        const { definitions, weightByteLength } = validateManifest(
            manifest,
            { tokens: Array.from({ length: manifest.vocabulary_size }) }
        );
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== weightByteLength) {
            throw new Error('weights.bin byte length is invalid.');
        }
        const view = new DataView(buffer);
        const tensors = {};
        definitions.forEach((definition, index) => {
            const record = manifest.tensors[index];
            const values = new Float32Array(product(definition.shape));
            for (let item = 0; item < values.length; item += 1) {
                const value = view.getFloat32(record.offset + (item * 4), true);
                if (!Number.isFinite(value)) throw new Error(`Non-finite tensor value in ${definition.name}.`);
                values[item] = value;
            }
            tensors[definition.name] = values;
        });
        return tensors;
    }

    function fixtureTensors(manifest, recipe) {
        if (recipe !== 'global-index-mod29-v1') throw new Error('Unsupported fixture weight recipe.');
        const { definitions } = validateManifest(
            manifest,
            { tokens: Array.from({ length: manifest.vocabulary_size }) }
        );
        const tensors = {};
        let globalIndex = 0;
        definitions.forEach(definition => {
            const values = new Float32Array(product(definition.shape));
            for (let index = 0; index < values.length; index += 1) {
                values[index] = Math.fround(((globalIndex % 29) - 14) / 100);
                globalIndex += 1;
            }
            tensors[definition.name] = values;
        });
        return tensors;
    }

    return Object.freeze({
        ARCHITECTURE_ID,
        FORMAT_VERSION,
        MANIFEST_FIELDS,
        MODEL_FIELDS,
        PARAMETER_LIMIT,
        WEIGHT_FORMAT,
        countParameters,
        decodeWeightBuffer,
        exactKeys,
        fixtureTensors,
        product,
        tensorDefinitions,
        validateConfiguration,
        validateManifest
    });
}));
