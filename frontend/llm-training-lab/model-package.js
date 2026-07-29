'use strict';

(function exposeModelPackage(root, factory) {
    const contract = root?.MicroCompModelContract
        || (typeof require === 'function' ? require('./model-contract.js') : null);
    const tokenizer = root?.MicroCompInferenceTokenizer
        || (typeof require === 'function' ? require('./inference-tokenizer.js') : null);
    const api = factory(root, contract, tokenizer);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompModelPackage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPackageApi(
    root, contract, tokenizerApi
) {
    const EXPECTED_FILES = Object.freeze([
        'manifest.json', 'tokenizer.json', 'training-config.json',
        'training-history.json', 'weights.bin'
    ]);
    const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
    const MAX_JSON_BYTES = 2 * 1024 * 1024;
    const MAX_HISTORY_EVENTS = 250;
    const MAX_HISTORY_SAMPLE_CHARACTERS = 4608;
    const TRAINING_FIELDS = Object.freeze([
        'batch_size', 'checkpoint_interval', 'gradient_clip_norm',
        'learning_rate', 'sample_max_new_tokens', 'sample_prompt',
        'sample_temperature', 'sample_top_k', 'seed', 'steps',
        'validation_batches', 'validation_interval'
    ]);
    const utf8Encoder = new TextEncoder();
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

    class ModelPackageError extends Error {
        constructor(message) {
            super(message);
            this.name = 'ModelPackageError';
        }
    }

    function fail(message) {
        throw new ModelPackageError(message);
    }

    function stableValue(value) {
        if (Array.isArray(value)) return value.map(stableValue);
        if (value && typeof value === 'object' && !(value instanceof Float32Array)) {
            return Object.fromEntries(
                Object.keys(value).sort().map(key => [key, stableValue(value[key])])
            );
        }
        return value;
    }

    function jsonBytes(value) {
        return utf8Encoder.encode(`${JSON.stringify(stableValue(value), null, 2)}\n`);
    }

    async function sha256Hex(value) {
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        const digest = await root.crypto.subtle.digest(
            'SHA-256',
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        );
        return Array.from(
            new Uint8Array(digest),
            byte => byte.toString(16).padStart(2, '0')
        ).join('');
    }

    let crcTable = null;
    function crc32(bytes) {
        if (!crcTable) {
            crcTable = Array.from({ length: 256 }, (_, item) => {
                let value = item;
                for (let bit = 0; bit < 8; bit += 1) {
                    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
                }
                return value >>> 0;
            });
        }
        let result = 0xffffffff;
        for (const byte of bytes) result = crcTable[(result ^ byte) & 0xff] ^ (result >>> 8);
        return (result ^ 0xffffffff) >>> 0;
    }

    function u16(view, offset, value) {
        view.setUint16(offset, value, true);
    }

    function u32(view, offset, value) {
        view.setUint32(offset, value, true);
    }

    function createStoredZip(files) {
        const names = Object.keys(files).sort();
        const encodedNames = names.map(name => utf8Encoder.encode(name));
        const localSize = names.reduce(
            (sum, name, index) => sum + 30 + encodedNames[index].length + files[name].length,
            0
        );
        const centralSize = names.reduce(
            (sum, name, index) => sum + 46 + encodedNames[index].length, 0
        );
        if (localSize + centralSize + 22 > MAX_PACKAGE_BYTES) {
            fail('Export exceeds the 20 MiB model-package limit.');
        }
        const output = new Uint8Array(localSize + centralSize + 22);
        const view = new DataView(output.buffer);
        const records = [];
        let cursor = 0;
        names.forEach((name, index) => {
            const nameBytes = encodedNames[index];
            const content = files[name];
            const checksum = crc32(content);
            const start = cursor;
            u32(view, cursor, 0x04034b50);
            u16(view, cursor + 4, 20);
            u16(view, cursor + 6, 0x0800);
            u16(view, cursor + 8, 0);
            u16(view, cursor + 10, 0);
            u16(view, cursor + 12, 0);
            u32(view, cursor + 14, checksum);
            u32(view, cursor + 18, content.length);
            u32(view, cursor + 22, content.length);
            u16(view, cursor + 26, nameBytes.length);
            u16(view, cursor + 28, 0);
            cursor += 30;
            output.set(nameBytes, cursor);
            cursor += nameBytes.length;
            output.set(content, cursor);
            cursor += content.length;
            records.push({ nameBytes, content, checksum, start });
        });
        const centralStart = cursor;
        records.forEach(record => {
            u32(view, cursor, 0x02014b50);
            u16(view, cursor + 4, 20);
            u16(view, cursor + 6, 20);
            u16(view, cursor + 8, 0x0800);
            u16(view, cursor + 10, 0);
            u16(view, cursor + 12, 0);
            u16(view, cursor + 14, 0);
            u32(view, cursor + 16, record.checksum);
            u32(view, cursor + 20, record.content.length);
            u32(view, cursor + 24, record.content.length);
            u16(view, cursor + 28, record.nameBytes.length);
            u16(view, cursor + 30, 0);
            u16(view, cursor + 32, 0);
            u16(view, cursor + 34, 0);
            u16(view, cursor + 36, 0);
            u32(view, cursor + 38, 0);
            u32(view, cursor + 42, record.start);
            cursor += 46;
            output.set(record.nameBytes, cursor);
            cursor += record.nameBytes.length;
        });
        u32(view, cursor, 0x06054b50);
        u16(view, cursor + 4, 0);
        u16(view, cursor + 6, 0);
        u16(view, cursor + 8, records.length);
        u16(view, cursor + 10, records.length);
        u32(view, cursor + 12, cursor - centralStart);
        u32(view, cursor + 16, centralStart);
        u16(view, cursor + 20, 0);
        return output;
    }

    async function inflateRaw(bytes, expectedSize) {
        if (typeof root.DecompressionStream !== 'function') {
            fail('This browser cannot read compressed model packages.');
        }
        const stream = new Blob([bytes]).stream().pipeThrough(
            new root.DecompressionStream('deflate-raw')
        );
        const output = new Uint8Array(await new Response(stream).arrayBuffer());
        if (output.length !== expectedSize) fail('A ZIP entry expanded to an invalid size.');
        return output;
    }

    function findEndRecord(bytes) {
        const minimum = Math.max(0, bytes.length - 65557);
        for (let index = bytes.length - 22; index >= minimum; index -= 1) {
            if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
                .getUint32(index, true) === 0x06054b50) return index;
        }
        fail('Model package is not a valid ZIP container.');
    }

    async function readZip(value) {
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        if (!bytes.length || bytes.length > MAX_PACKAGE_BYTES) {
            fail('Compressed model package exceeds the 20 MiB limit.');
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const end = findEndRecord(bytes);
        if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0
            || view.getUint16(end + 20, true) !== 0) {
            fail('Multi-disk, commented, or ZIP64 packages are not supported.');
        }
        const count = view.getUint16(end + 10, true);
        if (view.getUint16(end + 8, true) !== count) {
            fail('ZIP entry counts are inconsistent.');
        }
        const centralSize = view.getUint32(end + 12, true);
        let cursor = view.getUint32(end + 16, true);
        if (count !== EXPECTED_FILES.length || cursor + centralSize !== end) {
            fail('Package must contain exactly the five required root files.');
        }
        const entries = [];
        let total = 0;
        for (let index = 0; index < count; index += 1) {
            if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) {
                fail('ZIP central directory is corrupt.');
            }
            const flags = view.getUint16(cursor + 8, true);
            const method = view.getUint16(cursor + 10, true);
            const checksum = view.getUint32(cursor + 16, true);
            const compressedSize = view.getUint32(cursor + 20, true);
            const size = view.getUint32(cursor + 24, true);
            const nameLength = view.getUint16(cursor + 28, true);
            const extraLength = view.getUint16(cursor + 30, true);
            const commentLength = view.getUint16(cursor + 32, true);
            const disk = view.getUint16(cursor + 34, true);
            const external = view.getUint32(cursor + 38, true);
            const localOffset = view.getUint32(cursor + 42, true);
            const next = cursor + 46 + nameLength + extraLength + commentLength;
            if (next > end || flags & 1 || disk !== 0 || ![0, 8].includes(method)
                || ((external >>> 16) & 0xf000) === 0xa000) {
                fail('Package contains an unsafe or unsupported ZIP entry.');
            }
            const name = utf8Decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
            if (!EXPECTED_FILES.includes(name) || name.includes('/') || name.includes('\\')
                || name === '.' || name === '..') {
                fail('Package contains an unexpected or unsafe file.');
            }
            total += size;
            if (total > MAX_PACKAGE_BYTES || compressedSize > MAX_PACKAGE_BYTES) {
                fail('Uncompressed model package exceeds the 20 MiB limit.');
            }
            entries.push({ name, method, checksum, compressedSize, size, localOffset });
            cursor = next;
        }
        if (new Set(entries.map(entry => entry.name)).size !== EXPECTED_FILES.length) {
            fail('Package contains duplicate or missing files.');
        }
        const files = {};
        for (const entry of entries) {
            const offset = entry.localOffset;
            if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) {
                fail('ZIP local header is corrupt.');
            }
            const localFlags = view.getUint16(offset + 6, true);
            const localMethod = view.getUint16(offset + 8, true);
            const nameLength = view.getUint16(offset + 26, true);
            const extraLength = view.getUint16(offset + 28, true);
            const localName = utf8Decoder.decode(
                bytes.slice(offset + 30, offset + 30 + nameLength)
            );
            if (localName !== entry.name || localMethod !== entry.method
                || (localFlags & 1) !== 0) {
                fail('ZIP local and central headers do not agree.');
            }
            const start = offset + 30 + nameLength + extraLength;
            const endOffset = start + entry.compressedSize;
            if (endOffset > bytes.length) fail('ZIP entry is truncated.');
            const compressed = bytes.slice(start, endOffset);
            const content = entry.method === 0
                ? compressed
                : await inflateRaw(compressed, entry.size);
            if (content.length !== entry.size || crc32(content) !== entry.checksum) {
                fail(`ZIP integrity check failed for ${entry.name}.`);
            }
            files[entry.name] = content;
        }
        return files;
    }

    function tensorBytes(record) {
        const definitions = contract.tensorDefinitions(record.configuration);
        const total = definitions.reduce(
            (sum, definition) => sum + contract.product(definition.shape) * 4, 0
        );
        const output = new Uint8Array(total);
        const view = new DataView(output.buffer);
        let offset = 0;
        definitions.forEach(definition => {
            const tensor = record.tensors[definition.name];
            if (!(tensor instanceof Float32Array)
                || tensor.length !== contract.product(definition.shape)) {
                fail(`Stored tensor is missing or has the wrong shape: ${definition.name}.`);
            }
            tensor.forEach(value => {
                if (!Number.isFinite(value)) fail(`Stored tensor is non-finite: ${definition.name}.`);
                view.setFloat32(offset, value, true);
                offset += 4;
            });
        });
        if (Object.keys(record.tensors).sort().join('\0')
            !== definitions.map(item => item.name).join('\0')) {
            fail('Stored model contains unexpected tensors.');
        }
        return output;
    }

    function portableTraining(value) {
        return {
            learning_rate: value.learningRate,
            batch_size: value.batchSize,
            steps: value.steps,
            validation_interval: value.validationInterval,
            checkpoint_interval: value.snapshotInterval,
            gradient_clip_norm: value.gradientClipNorm,
            seed: value.seed,
            validation_batches: value.validationBatches,
            sample_prompt: value.samplePrompt,
            sample_max_new_tokens: value.sampleMaxNewTokens,
            sample_temperature: value.sampleTemperature,
            sample_top_k: value.sampleTopK
        };
    }

    function browserTraining(value) {
        return {
            learningRate: value.learning_rate,
            batchSize: value.batch_size,
            steps: value.steps,
            validationInterval: value.validation_interval,
            snapshotInterval: value.checkpoint_interval,
            gradientClipNorm: value.gradient_clip_norm,
            stride: 1,
            seed: value.seed,
            validationBatches: value.validation_batches,
            samplePrompt: value.sample_prompt,
            sampleMaxNewTokens: value.sample_max_new_tokens,
            sampleTemperature: value.sample_temperature,
            sampleTopK: value.sample_top_k
        };
    }

    function portableHistory(record) {
        const samples = new Map((record.snapshots || []).map(item => [item.step, item.sample]));
        return (record.history || []).slice(-MAX_HISTORY_EVENTS).map(item => ({
            step: item.step,
            train_loss: item.trainLoss,
            validation_loss: item.validationLoss ?? null,
            gradient_norm: item.gradientNorm,
            elapsed_seconds: item.elapsedSeconds,
            sample: samples.get(item.step) ?? null
        }));
    }

    async function createPackage(record) {
        if (!record || record.status !== 'completed') fail('Only completed models can be exported.');
        const config = contract.validateConfiguration(record.configuration);
        tokenizerApi.validateDocument(record.tokenizer);
        const count = contract.countParameters(config).total;
        if (count !== record.parameterCount) fail('Stored parameter count does not match the model.');
        const weights = tensorBytes(record);
        const definitions = contract.tensorDefinitions(config);
        let offset = 0;
        const tensors = [];
        for (const definition of definitions) {
            const byteLength = contract.product(definition.shape) * 4;
            const raw = weights.slice(offset, offset + byteLength);
            tensors.push({
                name: definition.name,
                shape: definition.shape,
                dtype: 'float32',
                layout: 'row-major',
                byte_order: 'little',
                offset,
                byte_length: byteLength,
                sha256: await sha256Hex(raw)
            });
            offset += byteLength;
        }
        const training = {
            schema_version: '1.0',
            model: config,
            training: portableTraining(record.training)
        };
        const history = {
            schema_version: '1.0',
            events: portableHistory(record)
        };
        validateTrainingDocument(training);
        validateHistoryDocument(history, training.training);
        const files = {
            'tokenizer.json': jsonBytes(record.tokenizer),
            'training-config.json': jsonBytes(training),
            'training-history.json': jsonBytes(history),
            'weights.bin': weights
        };
        const fileRecords = {};
        for (const [name, content] of Object.entries(files)) {
            fileRecords[name] = {
                byte_length: content.length,
                sha256: await sha256Hex(content)
            };
        }
        const manifest = {
            format_version: contract.FORMAT_VERSION,
            architecture_identifier: contract.ARCHITECTURE_ID,
            model_hyperparameters: config,
            normalization: 'pre-normalization',
            position_representation: 'learned-position-embedding',
            tokenizer_type: 'character',
            vocabulary_size: config.vocab_size,
            context_length: config.context_length,
            parameter_count: count,
            parameter_limit: contract.PARAMETER_LIMIT,
            tied_input_output_embeddings: config.tie_embeddings,
            tensor_count: tensors.length,
            tensors,
            creation_timestamp: record.completedAt,
            training_dataset_identifier: record.datasetIdentifier || 'cybersecurity-alerts-v1',
            training_dataset_sha256: record.datasetSha256,
            training_engine_identifier: record.trainingEngineIdentifier
                || 'microcomp-tfjs-training-1.0.0',
            weight_format: contract.WEIGHT_FORMAT,
            files: fileRecords
        };
        contract.validateManifest(manifest, record.tokenizer);
        files['manifest.json'] = jsonBytes(manifest);
        return {
            bytes: createStoredZip(files),
            manifest,
            fileName: `${safeFileName(record.name || 'microcomp-tiny-model')}.microcomp-model`
        };
    }

    function parseJson(files, name) {
        const raw = files[name];
        if (!raw || raw.length > MAX_JSON_BYTES) fail(`${name} exceeds the JSON size limit.`);
        let value;
        try {
            value = JSON.parse(utf8Decoder.decode(raw));
        } catch {
            fail(`${name} is not valid UTF-8 JSON.`);
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            fail(`${name} must contain a JSON object.`);
        }
        return value;
    }

    function finiteNonnegative(value) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    }

    function validateTrainingDocument(document) {
        if (!contract.exactKeys(document, ['schema_version', 'model', 'training'])
            || document.schema_version !== '1.0') {
            fail('Training configuration schema or version is unsupported.');
        }
        contract.validateConfiguration(document.model);
        const value = document.training;
        if (!contract.exactKeys(value, TRAINING_FIELDS)) {
            fail('Training configuration fields do not match schema 1.0.');
        }
        const integerBounds = {
            batch_size: [1, 64], steps: [1, 100000],
            validation_interval: [1, 100000], checkpoint_interval: [1, 100000],
            seed: [0, 2147483647], validation_batches: [1, 128],
            sample_max_new_tokens: [1, 256], sample_top_k: [1, 512]
        };
        Object.entries(integerBounds).forEach(([name, [minimum, maximum]]) => {
            if (!Number.isInteger(value[name]) || value[name] < minimum || value[name] > maximum) {
                fail(`Training configuration ${name} is invalid.`);
            }
        });
        if (typeof value.learning_rate !== 'number' || !Number.isFinite(value.learning_rate)
            || value.learning_rate < 1e-6 || value.learning_rate > 1
            || typeof value.gradient_clip_norm !== 'number'
            || !Number.isFinite(value.gradient_clip_norm)
            || value.gradient_clip_norm < .01 || value.gradient_clip_norm > 100
            || typeof value.sample_temperature !== 'number'
            || !Number.isFinite(value.sample_temperature)
            || value.sample_temperature < .05 || value.sample_temperature > 5
            || typeof value.sample_prompt !== 'string' || value.sample_prompt.length > 512) {
            fail('Training configuration contains an out-of-range value.');
        }
        return value;
    }

    function validateHistoryDocument(document, training) {
        if (!contract.exactKeys(document, ['schema_version', 'events'])
            || document.schema_version !== '1.0' || !Array.isArray(document.events)
            || document.events.length > MAX_HISTORY_EVENTS) {
            fail('Training history schema or version is invalid.');
        }
        let priorStep = 0;
        let priorElapsed = -1;
        document.events.forEach(event => {
            if (!contract.exactKeys(event, [
                'elapsed_seconds', 'gradient_norm', 'sample', 'step',
                'train_loss', 'validation_loss'
            ]) || !Number.isInteger(event.step) || event.step <= priorStep
                || event.step > training.steps || !finiteNonnegative(event.train_loss)
                || !finiteNonnegative(event.gradient_norm)
                || !finiteNonnegative(event.elapsed_seconds)
                || event.elapsed_seconds < priorElapsed
                || (event.validation_loss !== null
                    && !finiteNonnegative(event.validation_loss))
                || (event.sample !== null
                    && (typeof event.sample !== 'string'
                        || event.sample.length > MAX_HISTORY_SAMPLE_CHARACTERS))) {
                fail('Training history contains an invalid event.');
            }
            priorStep = event.step;
            priorElapsed = event.elapsed_seconds;
        });
        return document.events;
    }

    async function validatePackage(value) {
        const files = await readZip(value);
        const manifest = parseJson(files, 'manifest.json');
        const tokenizer = parseJson(files, 'tokenizer.json');
        const trainingDocument = parseJson(files, 'training-config.json');
        const historyDocument = parseJson(files, 'training-history.json');
        tokenizerApi.validateDocument(tokenizer);
        const validation = contract.validateManifest(manifest, tokenizer);
        const training = validateTrainingDocument(trainingDocument);
        if (JSON.stringify(trainingDocument.model) !== JSON.stringify(manifest.model_hyperparameters)) {
            fail('Training and manifest model configurations differ.');
        }
        const history = validateHistoryDocument(historyDocument, training);
        for (const name of EXPECTED_FILES.filter(item => item !== 'manifest.json')) {
            const record = manifest.files[name];
            if (record.byte_length !== files[name].length
                || record.sha256 !== await sha256Hex(files[name])) {
                fail(`File checksum verification failed for ${name}.`);
            }
        }
        if (files['weights.bin'].length !== validation.weightByteLength) {
            fail('weights.bin length does not match the tensor table.');
        }
        for (const tensor of manifest.tensors) {
            const raw = files['weights.bin'].slice(
                tensor.offset, tensor.offset + tensor.byte_length
            );
            if (tensor.sha256 !== await sha256Hex(raw)) {
                fail(`Tensor checksum verification failed for ${tensor.name}.`);
            }
        }
        const tensors = contract.decodeWeightBuffer(
            manifest,
            files['weights.bin'].buffer.slice(
                files['weights.bin'].byteOffset,
                files['weights.bin'].byteOffset + files['weights.bin'].byteLength
            )
        );
        return { files, manifest, tokenizer, training, history, tensors };
    }

    async function importPackage(value, options = {}) {
        const validated = await validatePackage(value);
        const { manifest, tokenizer, training, history, tensors } = validated;
        const last = history.at(-1) || null;
        const preview = [...history].reverse().find(item => item.sample)?.sample || '';
        const runId = options.runId || `imported-${Date.now().toString(36)}`;
        return {
            runId,
            name: boundedName(options.name || 'Imported Tiny LLM'),
            status: 'completed',
            completedAt: manifest.creation_timestamp,
            importedAt: new Date().toISOString(),
            architectureIdentifier: manifest.architecture_identifier,
            parameterCount: manifest.parameter_count,
            configuration: manifest.model_hyperparameters,
            tokenizer,
            training: browserTraining(training),
            finalMetrics: {
                step: last?.step || 0,
                trainLoss: last?.train_loss ?? null,
                validationLoss: [...history].reverse()
                    .find(item => item.validation_loss !== null)?.validation_loss ?? null,
                tokensProcessed: (last?.step || 0) * training.batch_size
                    * manifest.context_length,
                elapsedSeconds: last?.elapsed_seconds || 0,
                memory: null
            },
            history: history.map(item => ({
                step: item.step,
                trainLoss: item.train_loss,
                validationLoss: item.validation_loss,
                latestValidationLoss: item.validation_loss,
                gradientNorm: item.gradient_norm,
                elapsedSeconds: item.elapsed_seconds
            })),
            snapshots: [],
            tensors,
            datasetIdentifier: manifest.training_dataset_identifier,
            datasetSha256: manifest.training_dataset_sha256,
            trainingEngineIdentifier: manifest.training_engine_identifier,
            previewText: preview,
            packageSizeBytes: value.byteLength ?? value.length
        };
    }

    function boundedName(value) {
        const name = String(value ?? '').trim();
        if (!name || name.length > 120) fail('Model name must contain 1 to 120 characters.');
        return name;
    }

    function safeFileName(value) {
        return boundedName(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
            .replace(/[. ]+$/g, '').slice(0, 100) || 'microcomp-tiny-model';
    }

    async function datasetDigest(dataset) {
        return sha256Hex(jsonBytes({
            dataset_id: dataset.id,
            training: dataset.training,
            validation: dataset.validation
        }));
    }

    return Object.freeze({
        EXPECTED_FILES,
        MAX_HISTORY_EVENTS,
        MAX_JSON_BYTES,
        MAX_PACKAGE_BYTES,
        ModelPackageError,
        boundedName,
        createPackage,
        createStoredZip,
        datasetDigest,
        importPackage,
        jsonBytes,
        readZip,
        safeFileName,
        sha256Hex,
        validateHistoryDocument,
        validatePackage,
        validateTrainingDocument
    });
}));
