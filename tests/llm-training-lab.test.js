'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pagePath = path.join(root, 'frontend/demo-lab/llm-training-simulation.html');
const page = fs.readFileSync(pagePath, 'utf8');
const controller = fs.readFileSync(path.join(root, 'frontend/llm-training-lab.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend/llm-training-lab.css'), 'utf8');
const directory = fs.readFileSync(path.join(root, 'frontend/demo-lab.html'), 'utf8');
const homepage = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const parameters = require('../frontend/llm-training-lab/parameter-count.js');
const tokenizerApi = require('../frontend/llm-training-lab/tokenizer.js');
const datasets = require('../frontend/llm-training-lab/datasets.js');

const classroomConfiguration = {
    vocabularySize: 35,
    contextLength: 128,
    embeddingDimension: 64,
    attentionHeads: 4,
    transformerLayers: 3,
    feedForwardDimension: 128,
    tiedEmbeddings: false
};

test('classroom parameter count matches the Python reference exactly', () => {
    const result = parameters.validateConfiguration(classroomConfiguration);
    assert.equal(result.total, 113251);
    assert.equal(result.valid, true);
    assert.deepEqual(result.layers, {
        tokenEmbedding: 2240,
        positionEmbedding: 8192,
        decoderBlocks: 100416,
        finalLayerNorm: 128,
        outputBias: 35,
        outputProjection: 2240
    });
    assert.deepEqual(result.blockLayers, [
        { name: 'Decoder block 1', parameters: 33472 },
        { name: 'Decoder block 2', parameters: 33472 },
        { name: 'Decoder block 3', parameters: 33472 }
    ]);
});

test('tied embeddings remove exactly one output weight matrix', () => {
    const untied = parameters.countParameters(classroomConfiguration);
    const tied = parameters.countParameters({ ...classroomConfiguration, tiedEmbeddings: true });
    assert.equal(untied.total - tied.total, 35 * 64);
    assert.equal(tied.layers.outputProjection, 0);
});

test('configuration validation rejects incompatible heads and over-budget models', () => {
    const incompatible = parameters.validateConfiguration({
        ...classroomConfiguration,
        embeddingDimension: 48,
        attentionHeads: 5
    });
    assert.equal(incompatible.valid, false);
    assert.match(incompatible.errors.join(' '), /divide evenly/);

    const overBudget = parameters.validateConfiguration({
        ...classroomConfiguration,
        contextLength: 256,
        embeddingDimension: 96,
        transformerLayers: 4,
        feedForwardDimension: 256
    });
    assert.equal(overBudget.valid, false);
    assert.ok(overBudget.total > parameters.PARAMETER_LIMIT);
    assert.match(overBudget.errors.join(' '), /exceeds the 200,000-parameter limit/);
});

test('bundled dataset produces the reference vocabulary and deterministic split summary', () => {
    const dataset = datasets.CYBERSECURITY_ALERTS;
    const summary = datasets.summarize(dataset);
    const vocabulary = tokenizerApi.createVocabulary(dataset.allTexts);
    assert.equal(vocabulary.length, 35);
    assert.equal(summary.trainingDocuments, 24);
    assert.equal(summary.validationDocuments, 6);
    assert.equal(summary.documentCount, 30);
    assert.ok(summary.totalCharacters > 3000);
});

test('character tokenizer exposes tokens, IDs, round trips, and unknown behavior', () => {
    const vocabulary = tokenizerApi.createVocabulary(['alert: test']);
    const tokenizer = tokenizerApi.createTokenizer(vocabulary);
    const details = tokenizer.tokenDetails('a?');
    assert.equal(details[0].character, 'a');
    assert.notEqual(details[0].id, 3);
    assert.deepEqual(details[1], { character: '?', display: '?', id: 3, unknown: true });
    const encoded = tokenizer.encode('alert', { addBos: true, addEos: true });
    assert.equal(encoded[0], 1);
    assert.equal(encoded.at(-1), 2);
    assert.equal(tokenizer.decode(encoded), 'alert');
    assert.equal(tokenizer.decode([3]), '\ufffd');
});

test('training and playground are connected to real worker execution', () => {
    assert.match(page, /Worker training · CPU reference/);
    assert.match(page, /Real training and validation loss/);
    assert.match(page, /Real worker inference/);
    assert.doesNotMatch(page, /Not model-generated|No model is training/);
});

test('canonical routes remain available without public homepage or directory links', () => {
    assert.ok(fs.existsSync(pagePath));
    const redirect = fs.readFileSync(path.join(root, 'frontend/llm-training-lab.html'), 'utf8');
    assert.match(redirect, /demo-lab\/llm-training-simulation\.html/);
    assert.doesNotMatch(directory, /demo-lab\/llm-training-simulation\.html/);
    assert.doesNotMatch(directory, /LLM Training Simulation Lab/);
    assert.doesNotMatch(homepage, /demo-lab\/llm-training-simulation\.html/);
});

test('canonical route resolves all local JavaScript and stylesheet assets', () => {
    const references = [...page.matchAll(/(?:href|src)="([^"]+\.(?:css|js|svg)(?:\?[^"]*)?)"/g)]
        .map(match => match[1])
        .filter(reference => !reference.startsWith('http'));
    references.forEach(reference => {
        const clean = reference.split('?')[0];
        const resolved = path.resolve(path.dirname(pagePath), clean);
        assert.ok(fs.existsSync(resolved), `missing local asset: ${reference}`);
    });
});

test('page includes accessible workflow, labeled controls, and unique IDs', () => {
    [
        'role="tablist"', 'role="tabpanel"', 'aria-live="polite"',
        'aria-label="Local model training controls"', 'for="tokenizer-input"',
        'for="prompt-input"', 'role="progressbar"', 'class="skip-link"'
    ].forEach(marker => assert.ok(page.includes(marker), `missing ${marker}`));
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(styles, /:focus-visible/);
    assert.match(styles, /@media \(max-width: 820px\)/);
    assert.match(styles, /@media \(max-width: 560px\)/);
    assert.match(styles, /prefers-reduced-motion/);
});

test('controller wires architecture, real training, replay, and playground interactions', () => {
    [
        "one('#tokenizer-input').addEventListener('input'",
        "one('#architecture-form').addEventListener('input'",
        "one('#training-start').addEventListener('click'",
        "one('#training-pause').addEventListener('click'",
        "one('#training-resume').addEventListener('click'",
        "one('#training-cancel').addEventListener('click'",
        "one('#replay-scrubber').addEventListener('input'",
        "one('#playground-form').addEventListener('submit'",
        "event.key === 'ArrowRight'",
        'trainingClient.start',
        'trainingClient.generate'
    ].forEach(marker => assert.ok(controller.includes(marker), `missing controller interaction: ${marker}`));
    assert.doesNotMatch(controller, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});
