'use strict';

(function initializeInferencePage() {
    const PROTOCOL_VERSION = '1.0';
    const MODEL_ID = 'python-parity-v1';
    const pending = new Map();
    let requestSequence = 0;
    let modelReady = false;

    const one = selector => document.querySelector(selector);
    const workerUrl = new URL(
        'llm-training-lab/inference-worker.js?v=1.0',
        new URL('..', window.location.href)
    );
    const fixtureUrl = new URL(
        'llm-training-lab/fixtures/python-parity-v1.json',
        new URL('..', window.location.href)
    );
    const worker = new Worker(workerUrl);

    function setStatus(message, state = 'pending') {
        one('#engine-status').textContent = message;
        one('#runtime-dot').className = `status-dot ${state}`;
    }

    function request(type, payload = {}) {
        requestSequence += 1;
        const requestId = `ui-${requestSequence}`;
        return new Promise((resolve, reject) => {
            pending.set(requestId, { resolve, reject });
            worker.postMessage({
                protocolVersion: PROTOCOL_VERSION,
                requestId,
                type,
                payload
            });
        });
    }

    worker.addEventListener('message', event => {
        const message = event.data;
        const awaiting = pending.get(message?.requestId);
        if (!awaiting) return;
        pending.delete(message.requestId);
        if (message.type === 'ERROR') {
            awaiting.reject(new Error(message.payload?.message || 'The inference worker failed.'));
        } else {
            awaiting.resolve(message.payload);
        }
    });

    worker.addEventListener('error', event => {
        setStatus(`Worker error: ${event.message}`, 'error');
        pending.forEach(item => item.reject(new Error(event.message)));
        pending.clear();
    });

    function renderCapability(name, capability) {
        const state = one(`#${name}-state`);
        const detail = one(`#${name}-detail`);
        const card = one(`#${name}-card`);
        const enabled = capability.enabledForInference;
        state.textContent = enabled
            ? 'Active'
            : capability.available ? 'Available · idle' : 'Unavailable';
        state.className = `capability-state ${capability.available ? 'available' : 'unavailable'}`;
        detail.textContent = capability.detail;
        card.classList.toggle('enabled', enabled);
    }

    function renderCapabilities(capabilities) {
        one('#selected-runtime').textContent = capabilities.selectedRuntime;
        one('#runtime-reason').textContent = capabilities.selectionReason;
        renderCapability('webgpu', capabilities.webgpu);
        renderCapability('wasm', capabilities.webassembly);
        renderCapability('cpu', capabilities.cpu);
    }

    function renderModel(model) {
        const config = model.configuration;
        one('#model-state').textContent = 'Ready';
        one('#model-state').className = 'summary-pill passed';
        one('#model-architecture').textContent = model.architectureIdentifier;
        one('#model-parameters').textContent = model.parameterCount.toLocaleString();
        one('#model-context').textContent = `${config.context_length} characters`;
        one('#model-vocabulary').textContent = `${model.vocabularySize} tokens`;
        one('#model-blocks').textContent =
            `${config.transformer_blocks} / ${config.attention_heads}`;
        one('#model-tensor-count').textContent = String(model.tensors.length);
        const body = one('#tensor-table-body');
        body.replaceChildren(...model.tensors.map(tensor => {
            const row = document.createElement('tr');
            [tensor.name, `[${tensor.shape.join(', ')}]`, tensor.parameters.toLocaleString()]
                .forEach(value => {
                    const cell = document.createElement('td');
                    cell.textContent = value;
                    row.append(cell);
                });
            return row;
        }));
    }

    function renderCompatibility(result) {
        const checkNames = [
            'tokenizer', 'parameterCount', 'tensorNamesAndShapes',
            'manifest', 'logits', 'generation'
        ];
        checkNames.forEach(name => {
            const item = one(`[data-check="${name}"]`);
            const passed = result[name] === true;
            item.className = passed ? 'passed' : 'failed';
            item.querySelector('span').textContent = passed ? '\u2713' : '\u2717';
        });
        const allPassed = checkNames.every(name => result[name] === true);
        one('#parity-summary').textContent = allPassed ? '6 / 6 passed' : 'Review required';
        one('#parity-summary').className = `summary-pill ${allPassed ? 'passed' : 'failed'}`;
        one('#maximum-logit-error').textContent = result.maximumAbsoluteError.toExponential(3);
        one('#logit-tolerance').textContent = result.logitTolerance.toExponential(1);
        if (!allPassed) throw new Error('One or more Python compatibility checks failed.');
    }

    function setControlsEnabled(enabled) {
        [
            '#inference-prompt', '#inference-temperature', '#inference-top-k',
            '#inference-maximum', '#inference-seed', '#generate-button', '#forward-button'
        ].forEach(selector => {
            one(selector).disabled = !enabled;
        });
        if (enabled) updatePromptCompatibility();
    }

    function displayGeneratedText(text) {
        return String(text || '').replace(/\uFFFD/g, '<unk>');
    }

    function updatePromptCompatibility() {
        if (!modelReady) return;
        const prompt = one('#inference-prompt').value.normalize('NFC');
        const unsupported = [...prompt].filter(
            character => !['a', 'b', ' '].includes(character)
        );
        const guidance = one('#inference-prompt-guidance');
        const compatible = prompt.length > 0 && unsupported.length === 0;
        one('#generate-button').disabled = !compatible;
        guidance.classList.toggle('is-error', !compatible);
        guidance.textContent = compatible
            ? 'Compatible fixture prompt. Supported characters: a, b, and space.'
            : unsupported.length
                ? `This untrained fixture cannot evaluate ${unsupported.length} unsupported character${unsupported.length === 1 ? '' : 's'}. Use only a, b, and space, or open the Training Lab.`
                : 'Enter at least one supported character: a, b, or space.';
    }

    async function loadRuntime() {
        try {
            const capabilities = await request('PROBE_CAPABILITIES');
            renderCapabilities(capabilities);
            setStatus('Capabilities detected. Loading the Python parity fixture.');
            const loaded = await request('LOAD_FIXTURE', {
                modelId: MODEL_ID,
                url: fixtureUrl.href
            });
            renderModel(loaded.model);
            renderCompatibility(loaded.compatibility);
            modelReady = true;
            setControlsEnabled(true);
            one('#inference-output').textContent =
                `Python parity fixture ready.\nDeterministic check output: ${displayGeneratedText(loaded.compatibility.generatedText) || '(EOS)'}`;
            setStatus('Model ready · Python compatibility checks passed', 'ready');
        } catch (error) {
            one('#model-state').textContent = 'Error';
            one('#model-state').className = 'summary-pill failed';
            one('#inference-output').textContent = error.message;
            setStatus(error.message, 'error');
        }
    }

    one('#inference-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (!modelReady) return;
        const button = one('#generate-button');
        button.disabled = true;
        setStatus('Generating in the worker&hellip;'.replace('&hellip;', '\u2026'));
        try {
            const result = await request('GENERATE', {
                modelId: MODEL_ID,
                prompt: one('#inference-prompt').value,
                options: {
                    temperature: Number(one('#inference-temperature').value),
                    topK: Number(one('#inference-top-k').value),
                    maxNewTokens: Number(one('#inference-maximum').value),
                    seed: Number(one('#inference-seed').value)
                }
            });
            one('#inference-output').textContent =
                displayGeneratedText(result.text) || '(generation stopped at <eos>)';
            setStatus(`Generation complete · ${result.generatedTokenIds.length} new tokens`, 'ready');
        } catch (error) {
            one('#inference-output').textContent = error.message;
            setStatus(error.message, 'error');
        } finally {
            updatePromptCompatibility();
        }
    });

    one('#inference-prompt').addEventListener('input', updatePromptCompatibility);

    one('#forward-button').addEventListener('click', async () => {
        if (!modelReady) return;
        const button = one('#forward-button');
        button.disabled = true;
        setStatus('Running a deterministic forward pass in the worker.');
        try {
            const result = await request('FORWARD', {
                modelId: MODEL_ID,
                tokenIds: [[1, 5, 6, 4]]
            });
            const vocabulary = result.shape[2];
            const last = result.values.slice(-vocabulary);
            const list = one('#logit-list');
            list.replaceChildren(...last.map((value, tokenId) => {
                const entry = document.createElement('span');
                entry.textContent = `ID ${tokenId}: ${value.toFixed(7)}`;
                return entry;
            }));
            one('#logit-output').hidden = false;
            setStatus(`Forward pass complete · logits shape [${result.shape.join(', ')}]`, 'ready');
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    window.addEventListener('pagehide', () => {
        if (modelReady) {
            worker.postMessage({
                protocolVersion: PROTOCOL_VERSION,
                requestId: 'dispose-pagehide',
                type: 'DISPOSE',
                payload: { modelId: MODEL_ID }
            });
        }
        worker.terminate();
    }, { once: true });

    loadRuntime();
}());
