'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../frontend/llm-training-lab/inference-core.js');
const ranking = require('../frontend/llm-training-lab/response-ranking.js');

const root = path.resolve(__dirname, '..');
const tokenizer = {
    schema_version: '1.0',
    type: 'character',
    normalization: 'NFC',
    reserved_tokens: ['<pad>', '<bos>', '<eos>', '<unk>'],
    tokens: ['<pad>', '<bos>', '<eos>', '<unk>', ' ', 'a', 'b'],
    unknown_behavior: 'encode as <unk>; decode as Unicode replacement character'
};
const configuration = {
    vocab_size: 7,
    context_length: 8,
    embedding_dim: 4,
    attention_heads: 1,
    transformer_blocks: 1,
    feed_forward_dim: 4,
    dropout: 0,
    tie_embeddings: false
};

test('response ranking returns finite equal-length scores and bounded details', () => {
    const model = new core.TinyLlmCpuModel(
        configuration, tokenizer, core.initializedTensors(configuration, 19)
    );
    try {
        const result = ranking.rankResponses(model, 'ab', [
            { id: 'correct', text: ' ababa' },
            { id: 'other', text: ' babab' }
        ], 'correct');
        assert.equal(result.scoredCharactersPerCandidate, 6);
        assert.equal(result.candidates.length, 2);
        assert.equal(result.detail.length, 6);
        assert.ok(result.candidates.every(candidate => (
            Number.isFinite(candidate.averageLoss)
            && candidate.evaluatedCharacters === 6
            && candidate.characterAccuracy >= 0
            && candidate.characterAccuracy <= 1
        )));
        const scoreTotal = result.candidates.reduce(
            (sum, candidate) => sum + candidate.relativeScore, 0
        );
        assert.ok(Math.abs(scoreTotal - 1) < 1e-12);
        assert.ok(result.detail.every(item => (
            item.topChoices.length === 5
            && item.topChoices.every(choice => Number.isFinite(choice.probability))
        )));
        assert.ok([1, 2].includes(ranking.correctRank(result, 'correct')));
    } finally {
        model.dispose();
    }
});

test('response ranking uses an equal score window when candidates differ in length', () => {
    const model = new core.TinyLlmCpuModel(
        configuration, tokenizer, core.initializedTensors(configuration, 7)
    );
    try {
        const result = ranking.rankResponses(model, 'ab', [
            { id: 'short', text: ' ab' },
            { id: 'long', text: ' ababa' }
        ], 'short');
        assert.equal(result.scoredCharactersPerCandidate, 3);
        assert.deepEqual(
            result.candidates.map(candidate => candidate.evaluatedCharacters),
            [3, 3]
        );
    } finally {
        model.dispose();
    }
});

test('ranking rejects malformed or excessive candidate input', () => {
    const model = new core.TinyLlmCpuModel(
        configuration, tokenizer, core.initializedTensors(configuration, 7)
    );
    try {
        assert.throws(
            () => ranking.rankResponses(model, 'ab', [{ id: 'one', text: ' a' }], 'one'),
            /2 through 6/
        );
        assert.throws(
            () => ranking.rankResponses(model, 'ab', [
                { id: 'same', text: ' a' }, { id: 'same', text: ' b' }
            ], 'same'),
            /unique ID/
        );
    } finally {
        model.dispose();
    }
});

test('worker, client, and page expose guided response ranking', () => {
    const worker = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab/inference-worker.js'), 'utf8'
    );
    const client = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab/local-training-client.js'), 'utf8'
    );
    const page = fs.readFileSync(
        path.join(root, 'frontend/demo-lab/llm-training-simulation.html'), 'utf8'
    );
    assert.match(worker, /RANK_RESPONSES/);
    assert.match(worker, /initializedTensors\(model\.config, seed\)/);
    assert.match(client, /rankResponses\(modelId, payload\)/);
    [
        'Choose a response plan for a security alert',
        'Human-readable held-out evaluation',
        'Untrained baseline',
        'Correct-response microscope',
        'Why tiny models struggle with open-ended generation'
    ].forEach(marker => assert.ok(page.includes(marker), marker));
});

test('hidden local/cloud controls cannot be forced visible by layout rules', () => {
    const styles = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab.css'), 'utf8'
    );
    assert.match(styles, /\.llm-lab-page \[hidden\]\s*\{[^}]*display:\s*none !important/s);
});

test('prediction comparison exposes its training prerequisite instead of a silent button', () => {
    const page = fs.readFileSync(
        path.join(root, 'frontend/demo-lab/llm-training-simulation.html'), 'utf8'
    );
    const controller = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab.js'), 'utf8'
    );
    const styles = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab.css'), 'utf8'
    );
    assert.ok(page.includes('Train a model to enable comparison'));
    assert.ok(page.includes('id="ranking-training-shortcut"'));
    assert.ok(page.includes('llm-training-lab.css?v=1.4'));
    assert.ok(page.includes('llm-training-lab.js?v=3.4'));
    assert.match(controller, /showStage\(3, \{ focusTab: true, focusPanel: true \}\)/);
    assert.match(controller, /#ranking-status-message/);
    assert.match(styles, /\.llm-lab-page \.lab-action-primary:disabled/);
});

test('Prediction Lab exposes readable single-alert and full-set outcomes', () => {
    const worker = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab/inference-worker.js'), 'utf8'
    );
    const client = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab/local-training-client.js'), 'utf8'
    );
    const page = fs.readFileSync(
        path.join(root, 'frontend/demo-lab/llm-training-simulation.html'), 'utf8'
    );
    const controller = fs.readFileSync(
        path.join(root, 'frontend/llm-training-lab.js'), 'utf8'
    );
    assert.match(worker, /RANK_RESPONSE_SET/);
    assert.match(worker, /Provide 1 through 12 held-out challenges/);
    assert.match(client, /rankResponseSet\(modelId, payload\)/);
    [
        'Plain-language result',
        'Model recommendation',
        'Held-out reference',
        'Evaluate all held-out alerts',
        'Readable evaluation scorecard',
        'Inspect the measured ranking evidence'
    ].forEach(marker => assert.ok(page.includes(marker), marker));
    assert.ok(page.includes('local-training-client.js?v=1.2'));
    assert.match(controller, /validationAreas/);
    assert.match(controller, /renderRankingSet/);
    assert.match(controller, /inference-worker\.js\?v=3\.1/);
    assert.match(controller, /Matched reference/);
    assert.match(controller, /small educational validation set/);
});

test('untrained inference fixture rejects unsupported human-language prompts clearly', () => {
    const page = fs.readFileSync(
        path.join(root, 'frontend/demo-lab/llm-inference-capabilities.html'), 'utf8'
    );
    const controller = fs.readFileSync(
        path.join(root, 'frontend/llm-inference-page.js'), 'utf8'
    );
    assert.ok(page.includes('Untrained fixture check'));
    assert.ok(page.includes('id="inference-prompt-guidance"'));
    assert.ok(page.includes('llm-inference-page.js?v=1.1'));
    assert.match(controller, /updatePromptCompatibility/);
    assert.match(controller, /displayGeneratedText/);
    assert.match(controller, /Use only a, b, and space/);
});
