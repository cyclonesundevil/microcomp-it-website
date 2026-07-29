'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const contract = require('../frontend/llm-training-lab/model-contract.js');
const inference = require('../frontend/llm-training-lab/inference-core.js');
const datasets = require('../frontend/llm-training-lab/datasets.js');
const tokenizerTools = require('../frontend/llm-training-lab/tokenizer.js');
const packages = require('../frontend/llm-training-lab/model-package.js');

const dataset = datasets.CYBERSECURITY_ALERTS;
const tokens = tokenizerTools.createVocabulary(dataset.allTexts);
const tokenizer = {
    schema_version: '1.0',
    type: 'character',
    normalization: 'NFC',
    reserved_tokens: ['<pad>', '<bos>', '<eos>', '<unk>'],
    tokens,
    unknown_behavior: 'encode as <unk>; decode as Unicode replacement character'
};
const configuration = {
    vocab_size: tokens.length,
    context_length: 8,
    embedding_dim: 8,
    attention_heads: 2,
    transformer_blocks: 1,
    feed_forward_dim: 16,
    dropout: 0,
    tie_embeddings: false
};
const training = {
    learningRate: .001,
    batchSize: 1,
    steps: 2,
    validationInterval: 1,
    snapshotInterval: 1,
    gradientClipNorm: 1,
    stride: 1,
    seed: 4242,
    validationBatches: 1,
    samplePrompt: 'alert: ',
    sampleMaxNewTokens: 8,
    sampleTemperature: .8,
    sampleTopK: 12
};

async function completedRecord() {
    return {
        runId: 'package-test',
        name: 'Package test',
        status: 'completed',
        completedAt: '2026-07-28T12:00:00Z',
        architectureIdentifier: contract.ARCHITECTURE_ID,
        parameterCount: contract.countParameters(configuration).total,
        configuration,
        tokenizer,
        training,
        finalMetrics: {
            step: 2,
            trainLoss: 2.5,
            validationLoss: 2.6,
            tokensProcessed: 16,
            elapsedSeconds: .2
        },
        history: [
            {
                step: 1, trainLoss: 2.8, validationLoss: 2.9,
                latestValidationLoss: 2.9, gradientNorm: .7, elapsedSeconds: .1
            },
            {
                step: 2, trainLoss: 2.5, validationLoss: 2.6,
                latestValidationLoss: 2.6, gradientNorm: .5, elapsedSeconds: .2
            }
        ],
        snapshots: [{ step: 2, sample: 'alert: synthetic response' }],
        tensors: inference.initializedTensors(configuration, 7),
        datasetIdentifier: dataset.id,
        datasetSha256: await packages.datasetDigest(dataset),
        trainingEngineIdentifier: 'microcomp-tfjs-training-1.0.0',
        previewText: 'alert: synthetic response'
    };
}

async function rewrittenPackage(exported, mutate) {
    const files = await packages.readZip(exported.bytes);
    await mutate(files);
    return packages.createStoredZip(files);
}

test('export uses .microcomp-model and the exact canonical five-file layout', async () => {
    const exported = await packages.createPackage(await completedRecord());
    assert.equal(exported.fileName, 'Package test.microcomp-model');
    const files = await packages.readZip(exported.bytes);
    assert.deepEqual(Object.keys(files).sort(), [...packages.EXPECTED_FILES].sort());
    const validated = await packages.validatePackage(exported.bytes);
    assert.equal(validated.manifest.parameter_count, 1275);
    assert.equal(validated.manifest.tensor_count, contract.tensorDefinitions(configuration).length);
});

test('export/import preserves every float32 parameter bit and portable metadata', async () => {
    const source = await completedRecord();
    const exported = await packages.createPackage(source);
    const imported = await packages.importPackage(exported.bytes, {
        runId: 'round-trip',
        name: 'Round trip'
    });
    assert.equal(imported.parameterCount, source.parameterCount);
    assert.equal(imported.datasetIdentifier, dataset.id);
    assert.equal(imported.previewText, 'alert: synthetic response');
    Object.keys(source.tensors).forEach(name => {
        assert.deepEqual(
            new Uint8Array(imported.tensors[name].buffer),
            new Uint8Array(source.tensors[name].buffer),
            name
        );
    });
});

test('import rejects corrupt ZIP data and oversized packages before extraction', async () => {
    await assert.rejects(
        packages.validatePackage(new Uint8Array([1, 2, 3, 4])),
        /valid ZIP/
    );
    await assert.rejects(
        packages.validatePackage(new Uint8Array(packages.MAX_PACKAGE_BYTES + 1)),
        /20 MiB/
    );
});

test('import rejects file checksum corruption', async () => {
    const exported = await packages.createPackage(await completedRecord());
    const corrupt = await rewrittenPackage(exported, files => {
        const history = JSON.parse(new TextDecoder().decode(files['training-history.json']));
        history.events[0].train_loss = 1.25;
        files['training-history.json'] = packages.jsonBytes(history);
    });
    await assert.rejects(packages.validatePackage(corrupt), /checksum verification failed/);
});

test('import rejects unknown versions, unexpected tensors, count and shape mismatches', async () => {
    const exported = await packages.createPackage(await completedRecord());
    const cases = [
        {
            change(manifest) { manifest.format_version = '2.0'; },
            error: /Unsupported package format/
        },
        {
            change(manifest) {
                manifest.tensors.push({ ...manifest.tensors.at(-1), name: 'unexpected.weight' });
                manifest.tensor_count += 1;
            },
            error: /tensor count|Tensor record/
        },
        {
            change(manifest) { manifest.parameter_count += 1; },
            error: /parameter count/
        },
        {
            change(manifest) { manifest.tensors[0].shape = [999]; },
            error: /Tensor record/
        }
    ];
    for (const item of cases) {
        const invalid = await rewrittenPackage(exported, files => {
            const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
            item.change(manifest);
            files['manifest.json'] = packages.jsonBytes(manifest);
        });
        await assert.rejects(packages.validatePackage(invalid), item.error);
    }
});

test('Python reference validates a browser-produced package without conversion', async t => {
    const python = path.join(
        root, 'llm-training-lab', 'python-reference', '.venv', 'Scripts', 'python.exe'
    );
    if (!fs.existsSync(python)) return t.skip('Repository Python environment is unavailable.');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'microcomp-package-'));
    const file = path.join(directory, 'browser-export.microcomp-model');
    try {
        const exported = await packages.createPackage(await completedRecord());
        fs.writeFileSync(file, exported.bytes);
        const script = [
            'import sys',
            `sys.path.insert(0, r"${path.join(root, 'llm-training-lab', 'python-reference')}")`,
            'from pathlib import Path',
            'from microcomp_llm.portable import validate_artifact',
            `manifest = validate_artifact(Path(r"${file}"))`,
            'print(manifest["parameter_count"])'
        ].join('\n');
        const result = spawnSync(python, ['-c', script], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), '1275');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('browser imports the Python reference deflated package', async t => {
    const reference = path.join(root, 'llm-training-lab', 'python-reference');
    const python = path.join(reference, '.venv', 'Scripts', 'python.exe');
    if (!fs.existsSync(python)) return t.skip('Repository Python environment is unavailable.');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'microcomp-python-package-'));
    const checkpoint = path.join(directory, 'checkpoint');
    const file = path.join(directory, 'python-export.mcllm');
    try {
        const script = [
            'import sys, torch',
            `sys.path.insert(0, r"${reference}")`,
            'from pathlib import Path',
            'from microcomp_llm.config import ModelConfig, TrainingConfig',
            'from microcomp_llm.dataset import load_curated_dataset',
            'from microcomp_llm.model import TinyDecoderLM',
            'from microcomp_llm.portable import save_checkpoint, export_package',
            'from microcomp_llm.tokenizer import CharacterTokenizer',
            'dataset = load_curated_dataset()',
            'tokenizer = CharacterTokenizer.from_texts(dataset.all_texts)',
            'config = ModelConfig(vocab_size=tokenizer.vocab_size, context_length=8, embedding_dim=8, attention_heads=2, transformer_blocks=1, feed_forward_dim=16, dropout=0.0, tie_embeddings=False)',
            'training = TrainingConfig(steps=2, validation_interval=1, checkpoint_interval=1, validation_batches=1, sample_max_new_tokens=8, sample_top_k=12)',
            'torch.manual_seed(7)',
            'model = TinyDecoderLM(config)',
            `checkpoint = save_checkpoint(Path(r"${checkpoint}"), model, tokenizer, training, [], dataset_identifier=dataset.dataset_id, dataset_sha256=dataset.sha256)`,
            `export_package(checkpoint, Path(r"${file}"))`
        ].join('\n');
        const result = spawnSync(python, ['-c', script], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const validated = await packages.validatePackage(fs.readFileSync(file));
        assert.equal(validated.manifest.training_engine_identifier,
            'microcomp-pytorch-reference-0.1.0');
        assert.equal(validated.manifest.parameter_count, 1275);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('worker, client, and page expose every model-library operation', () => {
    const worker = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab/inference-worker.js'), 'utf8'
    );
    const client = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab/local-training-client.js'), 'utf8'
    );
    const page = fs.readFileSync(
        path.join(root, 'frontend/demo-lab/llm-training-simulation.html'), 'utf8'
    );
    [
        'LIST_SAVED_MODELS', 'LOAD_SAVED_MODEL', 'RENAME_SAVED_MODEL',
        'DELETE_SAVED_MODEL', 'DUPLICATE_SAVED_MODEL', 'EXPORT_SAVED_MODEL',
        'IMPORT_MODEL'
    ].forEach(command => assert.ok(worker.includes(command), command));
    ['listSaved', 'loadSaved', 'renameSaved', 'deleteSaved', 'duplicateSaved',
        'exportSaved', 'importModel'].forEach(method => assert.ok(client.includes(method), method));
    ['My Models', 'model-library-status', 'my-models-grid', '.microcomp-model']
        .forEach(marker => assert.ok(page.includes(marker), marker));
});
