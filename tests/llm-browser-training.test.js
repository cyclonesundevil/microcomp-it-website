'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const tf = require('../frontend/llm-training-lab/vendor/tf.min.js');
const contract = require('../frontend/llm-training-lab/model-contract.js');
const inferenceCore = require('../frontend/llm-training-lab/inference-core.js');
const trainingCore = require('../frontend/llm-training-lab/training-core.js');
const runnerApi = require('../frontend/llm-training-lab/training-runner.js');
const pythonFixture = JSON.parse(fs.readFileSync(
    path.join(
        root, 'frontend', 'llm-training-lab', 'fixtures', 'python-parity-v1.json'
    ),
    'utf8'
));

const tokenizerDocument = {
    schema_version: '1.0',
    type: 'character',
    normalization: 'NFC',
    reserved_tokens: ['<pad>', '<bos>', '<eos>', '<unk>'],
    tokens: ['<pad>', '<bos>', '<eos>', '<unk>', ' ', 'a', 'b'],
    unknown_behavior: 'encode as <unk>; decode as Unicode replacement character'
};
const configuration = {
    vocab_size: 7,
    context_length: 4,
    embedding_dim: 4,
    attention_heads: 1,
    transformer_blocks: 1,
    feed_forward_dim: 4,
    dropout: 0,
    tie_embeddings: false
};
const dataset = {
    training: ['ab ab ab ab', 'ba ba ba ba'],
    validation: ['ab ab ab', 'ba ba ba']
};
const trainingOptions = {
    learningRate: 0.01,
    batchSize: 1,
    steps: 3,
    validationInterval: 1,
    snapshotInterval: 3,
    gradientClipNorm: 0.25,
    seed: 19,
    validationBatches: 1,
    stride: 4,
    samplePrompt: 'ab',
    sampleMaxNewTokens: 2,
    sampleTemperature: 1,
    sampleTopK: 1
};

test.before(async () => {
    await tf.setBackend('cpu');
    await tf.ready();
});

function createModel(seed = 19) {
    return new trainingCore.TensorFlowTinyLlm(
        configuration,
        tokenizerDocument,
        inferenceCore.initializedTensors(configuration, seed)
    );
}

async function completedRun(runId, emit = () => {}, options = {}) {
    const run = new runnerApi.BrowserTrainingRun({
        runId,
        configuration,
        tokenizerDocument,
        dataset,
        options: { ...trainingOptions, ...options },
        initialTensors: inferenceCore.initializedTensors(configuration, 19),
        emit
    });
    return { run, result: await run.run() };
}

test('dataset windows follow BOS/EOS stream and next-token rules', () => {
    const tokenizer = new (require('../frontend/llm-training-lab/inference-tokenizer.js')
        .CharacterTokenizer)(tokenizerDocument);
    const windows = trainingCore.datasetWindows(['ab', 'ab'], tokenizer, 2, 2);
    assert.deepEqual(windows, [
        { input: [1, 5], target: [5, 6] },
        { input: [6, 2], target: [2, 1] },
        { input: [1, 5], target: [5, 6] }
    ]);
});

test('one real AdamW step is finite and globally clipped', () => {
    const model = createModel();
    try {
        const metrics = model.trainBatch(
            { input: [[1, 5, 6, 4]], target: [[5, 6, 4, 2]] },
            trainingOptions
        );
        assert.ok(Number.isFinite(metrics.loss));
        assert.ok(Number.isFinite(metrics.gradientNorm));
        assert.ok(metrics.appliedGradientNorm <= trainingOptions.gradientClipNorm);
        assert.deepEqual(trainingCore.ADAM, {
            beta1: 0.9,
            beta2: 0.999,
            epsilon: 1e-8,
            weightDecay: 0.01
        });
    } finally {
        model.dispose();
    }
});

test('TensorFlow training forward pass matches canonical Python logits', () => {
    const model = new trainingCore.TensorFlowTinyLlm(
        pythonFixture.manifest.model_hyperparameters,
        pythonFixture.tokenizer,
        contract.fixtureTensors(
            pythonFixture.manifest, pythonFixture.weight_recipe
        )
    );
    try {
        const logits = tf.tidy(() => {
            const input = tf.tensor2d(
                pythonFixture.input_token_ids,
                [1, pythonFixture.input_token_ids.length],
                'int32'
            );
            return Array.from(model.forward(input).logits.dataSync());
        });
        let maximumAbsoluteError = 0;
        logits.forEach((value, index) => {
            maximumAbsoluteError = Math.max(
                maximumAbsoluteError,
                Math.abs(value - pythonFixture.expected_logits[index])
            );
        });
        assert.ok(maximumAbsoluteError <= pythonFixture.logit_tolerance);
    } finally {
        model.dispose();
    }
});

test('tied embeddings train as one shared parameter tensor', () => {
    const tied = { ...configuration, tie_embeddings: true };
    const model = new trainingCore.TensorFlowTinyLlm(
        tied,
        tokenizerDocument,
        inferenceCore.initializedTensors(tied, 19)
    );
    try {
        assert.equal('lm_head.weight' in model.variables, false);
        assert.equal(model.parameterCount, contract.countParameters(tied).total);
        const metrics = model.trainBatch(
            { input: [[1, 5, 6, 4]], target: [[5, 6, 4, 2]] },
            trainingOptions
        );
        assert.ok(Number.isFinite(metrics.loss));
    } finally {
        model.dispose();
    }
});

test('same seed, data, configuration, and runtime reproduce training exactly', async () => {
    const first = await completedRun('deterministic-a');
    const second = await completedRun('deterministic-b');
    assert.deepEqual(
        first.result.history.map(item => item.trainLoss),
        second.result.history.map(item => item.trainLoss)
    );
    assert.deepEqual(
        first.result.snapshots.map(item => item.sample),
        second.result.snapshots.map(item => item.sample)
    );
    Object.keys(first.result.tensors).forEach(name => {
        assert.deepEqual(
            Array.from(first.result.tensors[name]),
            Array.from(second.result.tensors[name]),
            name
        );
    });
    assert.equal(tf.memory().numTensors, 0);
});

test('training reports validation, real snapshots, and bounded explorer data', async () => {
    const { result } = await completedRun('observable');
    assert.equal(result.status, 'completed');
    assert.equal(result.history.length, trainingOptions.steps);
    assert.ok(result.history.every(item => Number.isFinite(item.trainLoss)));
    assert.ok(result.history.every(item => Number.isFinite(item.latestValidationLoss)));
    assert.equal(result.snapshots.length, 2);
    result.snapshots.forEach(snapshot => {
        assert.ok(Number.isFinite(snapshot.validationLoss));
        assert.equal(snapshot.parameterCount, contract.countParameters(configuration).total);
        assert.ok(snapshot.attention.values.length > 0);
        assert.equal(snapshot.logits.length, configuration.vocab_size);
        assert.equal(snapshot.probabilities.length, configuration.vocab_size);
        assert.ok(snapshot.activations.length >= 3);
        assert.ok(snapshot.embeddings.values.length > 0);
    });
});

test('pause and resume stop progress at a worker step boundary', async () => {
    let run;
    let pausedStep = null;
    let resumed = false;
    const emitted = [];
    run = new runnerApi.BrowserTrainingRun({
        runId: 'pause-resume',
        configuration,
        tokenizerDocument,
        dataset,
        options: { ...trainingOptions, steps: 4, snapshotInterval: 4 },
        initialTensors: inferenceCore.initializedTensors(configuration, 19),
        emit(type, data) {
            emitted.push(type);
            if (type === 'PROGRESS' && data.step === 1 && !resumed) {
                pausedStep = data.step;
                run.pause();
                setTimeout(() => {
                    assert.equal(run.model.step, pausedStep);
                    resumed = true;
                    run.resume();
                }, 5);
            }
        }
    });
    const result = await run.run();
    assert.equal(result.status, 'completed');
    assert.equal(resumed, true);
    assert.ok(emitted.filter(type => type === 'LIFECYCLE').length >= 3);
});

test('cancel disposes an incomplete run without producing completion data', async () => {
    let run;
    run = new runnerApi.BrowserTrainingRun({
        runId: 'cancel',
        configuration,
        tokenizerDocument,
        dataset,
        options: { ...trainingOptions, steps: 8, snapshotInterval: 4 },
        initialTensors: inferenceCore.initializedTensors(configuration, 19),
        emit(type, data) {
            if (type === 'PROGRESS' && data.step === 1) run.cancel();
        }
    });
    const result = await run.run();
    assert.equal(result.status, 'cancelled');
    assert.equal(result.step, 1);
    assert.equal('tensors' in result, false);
    assert.equal(tf.memory().numTensors, 0);
});

test('worker, persistence, and UI expose the real training lifecycle', () => {
    const worker = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab/inference-worker.js'), 'utf8'
    );
    [
        'START_TRAINING', 'PAUSE_TRAINING', 'RESUME_TRAINING',
        'CANCEL_TRAINING', 'GET_TRAINING_STATE', 'LIST_SAVED_MODELS',
        'LOAD_SAVED_MODEL'
    ].forEach(command => assert.ok(worker.includes(`'${command}'`), command));

    const storage = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab/training-storage.js'), 'utf8'
    );
    assert.match(storage, /run\.status !== 'completed'/);
    assert.doesNotMatch(storage, /paused|running|cancelled/);

    const page = fs.readFileSync(
        path.join(root, 'frontend/demo-lab/llm-training-simulation.html'), 'utf8'
    );
    [
        'Real training and validation loss', 'Inside the Transformer',
        'Embedding evolution', 'Attention matrix', 'Probability distribution',
        'Next-token selection', 'Layer outputs', 'Replay training'
    ].forEach(marker => assert.ok(page.includes(marker), marker));
    assert.doesNotMatch(page, /Simulated training and validation loss|scripted demonstration/i);
});
