'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cloud = require('../frontend/llm-training-lab/cloud-training-client.js');
const reports = require('../frontend/llm-training-lab/training-report.js');
const transformer = require('../frontend/llm-training-lab/transformer-visualization.js');

const root = path.resolve(__dirname, '..');

test('cloud URL validation accepts HTTP(S) and rejects executable schemes', () => {
    assert.equal(cloud.normalizeBaseUrl('https://training.example/v1/'), 'https://training.example/v1');
    assert.equal(cloud.normalizeBaseUrl('http://localhost:8090/'), 'http://localhost:8090');
    assert.throws(() => cloud.normalizeBaseUrl('javascript:alert(1)'), /HTTP or HTTPS/);
});

test('SSE parser preserves event ID, type, and JSON data', () => {
    assert.deepEqual(cloud.parseSseBlock(
        'id: 12\nevent: progress\ndata: {"step":4,"train_loss":2.5}'
    ), {
        id: 12,
        event: 'progress',
        data: { step: 4, train_loss: 2.5 }
    });
    assert.equal(cloud.parseSseBlock(': heartbeat'), null);
});

test('cloud credentials are memory-only and cleared on disconnect', async () => {
    const calls = [];
    const client = new cloud.CloudTrainingClient(async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({
            session_id: '1234567890abcdef',
            session_token: 'temporary-bearer',
            token_type: 'Bearer',
            anonymous: true
        }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    await client.connect('https://cloud.example', 'a'.repeat(24));
    assert.equal(client.connected, true);
    assert.equal(calls[0].options.headers['X-API-Key'], 'a'.repeat(24));
    client.disconnect();
    assert.equal(client.connected, false);
    assert.equal(client.apiKey, null);
    assert.equal(client.sessionToken, null);
});

test('training report uses only supplied measurements', () => {
    const report = reports.buildTrainingReport({
        completed: true,
        mode: 'local',
        datasetName: 'Synthetic alerts',
        trainingDocuments: 24,
        validationDocuments: 6,
        parameterCount: 113251,
        tokensProcessed: 10240,
        steps: 40,
        temperature: 0.8,
        trainHistory: [{ step: 1, loss: 3 }, { step: 40, loss: 2 }],
        validationHistory: [{ step: 5, loss: 3.1 }, { step: 40, loss: 2.4 }]
    });
    const text = report.sections.map(section => section.text).join(' ');
    assert.equal(report.available, true);
    assert.match(text, /10,240 tokens/);
    assert.match(text, /3\.0000/);
    assert.match(text, /2\.0000/);
    assert.match(text, /2\.4000/);
    assert.match(text, /no output-quality effect is claimed/i);
});

test('training report explicitly reports insufficient history', () => {
    const report = reports.buildTrainingReport({
        completed: true,
        mode: 'cloud',
        datasetName: 'Synthetic alerts',
        trainingDocuments: 24,
        validationDocuments: 6,
        parameterCount: 100000,
        tokensProcessed: 0,
        steps: 0,
        temperature: 1,
        trainHistory: [],
        validationHistory: []
    });
    assert.match(
        report.sections.map(section => section.text).join(' '),
        /does not contain enough|cannot support/i
    );
});

test('transformer view maps replay tokens and rejects scalar-only snapshots', () => {
    const rich = {
        embeddings: { tokenIds: [1, 4], values: [0, 1], shape: [2, 1] },
        attention: { values: [1], shape: [1, 1] },
        logits: [0, 1],
        probabilities: [.25, .75],
        activations: []
    };
    assert.equal(transformer.hasEducationalTensors(rich), true);
    assert.deepEqual(transformer.tokenFlow(rich, ['<pad>', '<bos>', '', '', 'a']), [
        { id: 1, position: 0, token: '<bos>', selected: false },
        { id: 4, position: 1, token: 'a', selected: true }
    ]);
    assert.equal(transformer.hasEducationalTensors({ step: 10 }), false);
});

test('integrated page exposes both modes, cloud handoff, report, and transformer module', () => {
    const page = fs.readFileSync(
        path.join(root, 'frontend/demo-lab/llm-training-simulation.html'), 'utf8'
    );
    const controller = fs.readFileSync(path.join(root, 'frontend/llm-training-lab.js'), 'utf8');
    [
        'training-mode-local',
        'training-mode-cloud',
        'cloud-connection-form',
        'cloud-download-model',
        'cloud-continue-local',
        'training-report-content',
        'transformer-token-flow',
        'chat-history'
    ].forEach(id => assert.match(page, new RegExp(`id="${id}"`)));
    assert.match(controller, /cloudClient\.createJob/);
    assert.match(controller, /trainingClient\.importModel/);
    assert.match(controller, /buildTrainingReport/);
});

test('tokenizer sandbox and Playground communicate their distinct limits', () => {
    const page = fs.readFileSync(
        path.join(root, 'frontend/demo-lab/llm-training-simulation.html'), 'utf8'
    );
    const controller = fs.readFileSync(path.join(root, 'frontend/llm-training-lab.js'), 'utf8');
    assert.match(page, /Tokenizer sandbox/);
    assert.match(page, /does not prompt, train, or generate/);
    assert.match(page, /id="tokenizer-input"[^>]+maxlength="4096"/);
    assert.match(page, /at most 160 token chips are displayed/);
    assert.match(page, /id="prompt-context-status"/);
    assert.match(page, /id="prompt-vocabulary-warning"/);
    assert.match(page, /Maximum new output characters/);
    assert.match(page, /not an instruction-following chatbot/);
    assert.doesNotMatch(page, /Model conversation/);
    assert.match(controller, /TOKENIZER_PREVIEW_LIMIT = 160/);
    assert.match(controller, /will become <unk>/);
    assert.match(controller, /model will use only the newest/);
    assert.match(controller, /addEventListener\('pageshow'/);
    assert.match(page, /llm-training-lab\.css\?v=1\.5/);
    assert.match(page, /llm-training-lab\.js\?v=3\.4/);
});

test('Playground offers curated lowercase prompt starters and honest run guidance', () => {
    const page = fs.readFileSync(
        path.join(root, 'frontend/demo-lab/llm-training-simulation.html'), 'utf8'
    );
    [
        'data-prompt-example="alert: "',
        'data-prompt-example="response: "',
        'data-prompt-example="alert: repeated sign-in failures"',
        'Quick demonstration:',
        'generated text will usually remain fragmented or incoherent'
    ].forEach(marker => assert.ok(page.includes(marker), marker));
});
