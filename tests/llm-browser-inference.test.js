'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const inferenceDirectory = path.join(root, 'frontend', 'llm-training-lab');
const fixture = JSON.parse(fs.readFileSync(
    path.join(inferenceDirectory, 'fixtures', 'python-parity-v1.json'),
    'utf8'
));
const contract = require('../frontend/llm-training-lab/model-contract.js');
const tokenizerApi = require('../frontend/llm-training-lab/inference-tokenizer.js');
const core = require('../frontend/llm-training-lab/inference-core.js');
const capabilityPagePath = path.join(
    root, 'frontend', 'demo-lab', 'llm-inference-capabilities.html'
);

function fixtureModel() {
    return new core.TinyLlmCpuModel(
        fixture.manifest.model_hyperparameters,
        fixture.tokenizer,
        contract.fixtureTensors(fixture.manifest, fixture.weight_recipe)
    );
}

test('browser tokenizer matches the Python fixture including unknown characters', () => {
    const tokenizer = new tokenizerApi.CharacterTokenizer(fixture.tokenizer);
    assert.deepEqual(
        tokenizer.encode(fixture.tokenizer_probe.text),
        fixture.tokenizer_probe.expected_ids
    );
    assert.equal(tokenizer.decode([5, 6, 3, 4]), 'ab\ufffd ');
    assert.deepEqual(tokenizer.encode('a\u0301'), tokenizer.encode('\u00e1'));
});

test('parameter count, canonical tensor names, and shapes match Python', () => {
    const configuration = fixture.manifest.model_hyperparameters;
    const count = contract.countParameters(configuration);
    const definitions = contract.tensorDefinitions(configuration);
    assert.equal(count.total, fixture.manifest.parameter_count);
    assert.deepEqual(
        definitions.map(item => ({ name: item.name, shape: item.shape })),
        fixture.manifest.tensors.map(item => ({ name: item.name, shape: item.shape }))
    );
    assert.equal(
        definitions.reduce((total, item) => total + contract.product(item.shape), 0),
        count.total
    );
});

test('Python-produced manifest passes the strict browser contract', () => {
    const result = contract.validateManifest(fixture.manifest, fixture.tokenizer);
    assert.equal(result.weightByteLength, fixture.manifest.files['weights.bin'].byte_length);
    assert.equal(result.definitions.length, fixture.manifest.tensor_count);
});

test('browser forward logits stay within the Python numerical tolerance', () => {
    const result = fixtureModel().forward([fixture.input_token_ids]);
    assert.deepEqual(result.shape, fixture.logit_shape);
    let maximumAbsoluteError = 0;
    result.logits.forEach((value, index) => {
        maximumAbsoluteError = Math.max(
            maximumAbsoluteError,
            Math.abs(value - fixture.expected_logits[index])
        );
    });
    assert.ok(
        maximumAbsoluteError <= fixture.logit_tolerance,
        `maximum absolute error ${maximumAbsoluteError} exceeds ${fixture.logit_tolerance}`
    );
});

test('causal masking prevents future tokens from changing earlier logits', () => {
    const model = fixtureModel();
    const first = model.forward([[1, 5, 6, 4]]).logits;
    const second = model.forward([[1, 5, 4, 4]]).logits;
    const width = fixture.manifest.vocabulary_size;
    for (let index = 0; index < 2 * width; index += 1) {
        assert.equal(first[index], second[index]);
    }
});

test('top-k one generation matches the deterministic Python result', () => {
    const generated = fixtureModel().generate(
        fixture.generation.prompt,
        fixture.generation.options
    );
    assert.equal(generated.text, fixture.generation.expected_text);
});

test('shared worker owns tensors and preserves the inference command contract', () => {
    const worker = fs.readFileSync(path.join(inferenceDirectory, 'inference-worker.js'), 'utf8');
    ['PROBE_CAPABILITIES', 'LOAD_FIXTURE', 'LOAD_MODEL_URLS', 'CREATE_MODEL',
        'INSPECT', 'FORWARD', 'GENERATE', 'DISPOSE'].forEach(command => {
        assert.ok(worker.includes(`'${command}'`), `missing worker command ${command}`);
    });
    assert.match(worker, /const models = new Map\(\)/);
    assert.match(worker, /ownsModelTensors: true/);
    assert.doesNotMatch(
        fs.readFileSync(path.join(inferenceDirectory, 'inference-core.js'), 'utf8'),
        /\b(?:optimizer|AdamW?|backward|gradient|checkpointing)\b/i
    );
});

test('capability route exposes WebGPU, WebAssembly, and CPU fallback status', () => {
    const page = fs.readFileSync(capabilityPagePath, 'utf8');
    assert.match(page, /<title>Tiny LLM Browser Inference \| MicroComp IT<\/title>/);
    assert.match(page, /id="webgpu-state"/);
    assert.match(page, /id="wasm-state"/);
    assert.match(page, /id="cpu-state"/);
    assert.match(page, /Worker-owned tensors/);
    assert.match(page, /No optimizer, gradients, training loop/);
    assert.match(
        fs.readFileSync(path.join(root, 'frontend', 'sitemap.xml'), 'utf8'),
        /demo-lab\/llm-inference-capabilities\.html/
    );
});

test('capability page resolves local assets and has accessible controls', () => {
    const page = fs.readFileSync(capabilityPagePath, 'utf8');
    const references = [...page.matchAll(/(?:href|src)="([^"]+\.(?:css|js|svg)(?:\?[^"]*)?)"/g)]
        .map(match => match[1])
        .filter(reference => !reference.startsWith('http'));
    references.forEach(reference => {
        const resolved = path.resolve(
            path.dirname(capabilityPagePath),
            reference.split('?')[0]
        );
        assert.ok(fs.existsSync(resolved), `missing local asset: ${reference}`);
    });
    [
        'class="skip-link"', 'aria-live="polite"', 'for="inference-prompt"',
        'for="inference-temperature"', 'id="generate-button"', 'id="forward-button"'
    ].forEach(marker => assert.ok(page.includes(marker), `missing ${marker}`));
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    const styles = fs.readFileSync(path.join(root, 'frontend', 'llm-inference.css'), 'utf8');
    assert.match(styles, /:focus-visible/);
    assert.match(styles, /@media \(max-width: 860px\)/);
    assert.match(styles, /prefers-reduced-motion/);
});

test('UI controller communicates through a worker and never constructs model tensors', () => {
    const controller = fs.readFileSync(
        path.join(root, 'frontend', 'llm-inference-page.js'),
        'utf8'
    );
    assert.match(controller, /new Worker\(workerUrl\)/);
    assert.match(controller, /request\('LOAD_FIXTURE'/);
    assert.match(controller, /request\('GENERATE'/);
    assert.match(controller, /request\('FORWARD'/);
    assert.doesNotMatch(controller, /Float32Array|TinyLlmCpuModel|fixtureTensors|decodeWeightBuffer/);
});
