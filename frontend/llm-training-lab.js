'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const parameterApi = window.MicroCompLlmParameters;
    const tokenizerApi = window.MicroCompCharacterTokenizer;
    const datasetApi = window.MicroCompLlmDatasets;
    const clientApi = window.MicroCompLocalTrainingClient;
    const cloudApi = window.MicroCompCloudTrainingClient;
    const reportApi = window.MicroCompTrainingReport;
    const visualizationApi = window.MicroCompTransformerVisualization;
    if (!parameterApi || !tokenizerApi || !datasetApi || !clientApi
        || !cloudApi || !reportApi || !visualizationApi) {
        throw new Error('The LLM Training Lab could not load its local modules.');
    }

    const one = selector => document.querySelector(selector);
    const all = selector => Array.from(document.querySelectorAll(selector));
    const formatInteger = value => Number(value).toLocaleString('en-US');
    const liveRegion = one('#llm-live-region');
    const announce = message => {
        liveRegion.textContent = '';
        window.requestAnimationFrame(() => { liveRegion.textContent = message; });
    };

    const dataset = datasetApi.CYBERSECURITY_ALERTS;
    const datasetSummary = datasetApi.summarize(dataset);
    const vocabulary = tokenizerApi.createVocabulary(dataset.allTexts);
    const tokenizer = tokenizerApi.createTokenizer(vocabulary);
    const TOKENIZER_PREVIEW_LIMIT = 160;
    const validationAreas = [
        'Identity and access',
        'Application security',
        'Endpoint security',
        'Email security',
        'Data governance',
        'Network security'
    ];
    const heldOutRecords = dataset.validation.map((text, index) => {
        const marker = '. response:';
        const split = text.indexOf(marker);
        if (split < 0) throw new Error('A validation record is missing its response marker.');
        return {
            id: `held-out-${index + 1}`,
            area: validationAreas[index],
            alert: text.slice(0, split + 1),
            prefix: text.slice(0, split + marker.length),
            response: text.slice(split + marker.length)
        };
    });
    const rankingChallenges = heldOutRecords.map((record, index) => {
        const distractors = heldOutRecords.filter(item => item.id !== record.id).slice(0, 3);
        const candidates = [...distractors];
        candidates.splice(index % 4, 0, record);
        return {
            ...record,
            candidates: candidates.map(item => ({
                id: item.id,
                text: item.response,
                area: item.area
            }))
        };
    });

    function renderDataset() {
        one('#dataset-records').textContent = formatInteger(datasetSummary.documentCount);
        one('#dataset-characters').textContent = formatInteger(datasetSummary.totalCharacters);
        one('#dataset-training').textContent = formatInteger(datasetSummary.trainingDocuments);
        one('#dataset-validation').textContent = formatInteger(datasetSummary.validationDocuments);
        one('#vocabulary-size-badge').textContent = `${vocabulary.length}-token vocabulary`;

        const sampleList = one('#dataset-samples');
        sampleList.replaceChildren(...dataset.training.slice(0, 3).map((text, index) => {
            const item = document.createElement('li');
            item.dataset.record = String(index + 1).padStart(2, '0');
            item.textContent = text;
            return item;
        }));

        const frequencies = tokenizerApi.commonCharacters(dataset.allTexts);
        one('#common-characters').replaceChildren(...frequencies.map(item => {
            const chip = document.createElement('span');
            const character = document.createElement('strong');
            const count = document.createElement('small');
            character.textContent = item.display;
            count.textContent = formatInteger(item.count);
            chip.append(character, count);
            chip.title = `${item.display}: ${formatInteger(item.count)} occurrences`;
            return chip;
        }));
    }

    function renderTokenization() {
        const input = one('#tokenizer-input').value;
        const characters = Array.from(input.normalize('NFC'));
        const previewText = characters.slice(0, TOKENIZER_PREVIEW_LIMIT).join('');
        const details = tokenizer.tokenDetails(previewText);
        const allDetails = tokenizer.tokenDetails(input);
        one('#tokenizer-character-count').textContent =
            `${characters.length.toLocaleString('en-US')} character${characters.length === 1 ? '' : 's'} entered`;
        const hiddenCount = Math.max(0, characters.length - details.length);
        one('#tokenizer-preview-note').textContent = hiddenCount
            ? `Showing the first ${details.length} tokens · ${hiddenCount.toLocaleString('en-US')} not visualized`
            : `Showing all ${details.length} token${details.length === 1 ? '' : 's'}`;

        const tokenNodes = details.map(detail => {
            const chip = document.createElement('span');
            chip.className = `token-chip${detail.unknown ? ' is-unknown' : ''}`;
            chip.textContent = detail.display;
            chip.title = `${detail.display}, token ID ${detail.id}${detail.unknown ? ', unknown character' : ''}`;
            return chip;
        });
        const idNodes = details.map(detail => {
            const chip = document.createElement('span');
            chip.className = `token-chip${detail.unknown ? ' is-unknown' : ''}`;
            chip.textContent = String(detail.id);
            chip.title = `Token ID ${detail.id} for ${detail.display}`;
            return chip;
        });
        if (!details.length) {
            const emptyTokens = document.createElement('span');
            emptyTokens.className = 'token-chip';
            emptyTokens.textContent = 'No input';
            tokenNodes.push(emptyTokens);
        }
        one('#character-tokens').replaceChildren(...tokenNodes);
        one('#token-ids').replaceChildren(...idNodes);
        const unknownCount = allDetails.filter(detail => detail.unknown).length;
        one('#unknown-token-note').textContent = unknownCount
            ? `${unknownCount.toLocaleString('en-US')} unknown in entered text`
            : 'All entered characters recognized';
    }

    const architectureDefaults = Object.freeze({
        contextLength: 128,
        embeddingDimension: 64,
        attentionHeads: 4,
        transformerLayers: 3,
        feedForwardDimension: 128,
        tiedEmbeddings: false
    });

    function readArchitecture() {
        return {
            vocabularySize: vocabulary.length,
            contextLength: Number(one('#context-length').value),
            embeddingDimension: Number(one('#embedding-dimension').value),
            attentionHeads: Number(one('#attention-heads').value),
            transformerLayers: Number(one('#transformer-layers').value),
            feedForwardDimension: Number(one('#feed-forward-dimension').value),
            tiedEmbeddings: one('#tied-embeddings').checked
        };
    }

    function updatePromptGuidance() {
        const promptField = one('#prompt-input');
        if (!promptField) return;
        const characters = Array.from(promptField.value.normalize('NFC'));
        const contextLength = Number(one('#context-length').value);
        const ignored = Math.max(0, characters.length - contextLength);
        const contextStatus = one('#prompt-context-status');
        contextStatus.textContent = ignored
            ? `${characters.length} characters entered · the model will use only the newest ${contextLength} and ignore the first ${ignored}.`
            : `${characters.length} characters · all fit in the ${contextLength}-character context.`;
        contextStatus.classList.toggle('is-warning', ignored > 0);

        const unknownDetails = tokenizer.tokenDetails(promptField.value)
            .filter(detail => detail.unknown);
        const unknownCharacters = [...new Set(
            unknownDetails.map(detail => detail.display)
        )];
        const vocabularyWarning = one('#prompt-vocabulary-warning');
        vocabularyWarning.textContent = unknownDetails.length
            ? `${unknownDetails.length} prompt character${unknownDetails.length === 1 ? '' : 's'} will become <unk> (ID 3): ${unknownCharacters.slice(0, 5).join(', ')}${unknownCharacters.length > 5 ? ', …' : ''}. Lowercase text best matches this dataset.`
            : 'All prompt characters are in the model vocabulary.';
        vocabularyWarning.classList.toggle('is-warning', unknownDetails.length > 0);
    }

    function renderArchitecture() {
        const result = parameterApi.validateConfiguration(readArchitecture());
        one('#parameter-total').textContent = Number.isFinite(result.total) ? formatInteger(result.total) : 'Invalid';
        one('#budget-percentage').textContent = Number.isFinite(result.budgetPercent)
            ? `${result.budgetPercent.toFixed(1)}% of available parameters`
            : 'Parameter budget unavailable';
        const meter = one('.budget-meter');
        const boundedPercent = Math.max(0, Math.min(100, result.budgetPercent || 0));
        one('#budget-meter-fill').style.width = `${boundedPercent}%`;
        meter.classList.toggle('is-over-budget', result.total > parameterApi.PARAMETER_LIMIT);
        meter.setAttribute('aria-valuenow', String(Math.max(0, Number.isFinite(result.total) ? result.total : 0)));
        meter.setAttribute('aria-valuetext', `${result.budgetPercent.toFixed(1)} percent of the parameter budget`);

        const errors = one('#architecture-errors');
        errors.hidden = result.valid;
        errors.replaceChildren();
        if (!result.valid) {
            const list = document.createElement('ul');
            result.errors.forEach(message => {
                const item = document.createElement('li');
                item.textContent = message;
                list.append(item);
            });
            errors.append(list);
        }

        const layerRows = [
            ['Token embedding', result.layers.tokenEmbedding],
            ['Position embedding', result.layers.positionEmbedding],
            ...result.blockLayers.map(block => [block.name, block.parameters]),
            ['Final layer norm', result.layers.finalLayerNorm],
            ['Output bias', result.layers.outputBias],
            ['Output projection', result.layers.outputProjection]
        ];
        one('#parameter-breakdown').replaceChildren(...layerRows.map(([name, value]) => {
            const row = document.createElement('div');
            const term = document.createElement('dt');
            const description = document.createElement('dd');
            term.textContent = name;
            description.textContent = formatInteger(value);
            row.append(term, description);
            return row;
        }));
        one('#pipeline-blocks').textContent = `${result.configuration.transformerLayers} × attention + FFN`;
        one('#training-start').disabled = !result.valid
            || (trainingMode === 'cloud' && !cloudClient.connected);
        const stride = one('#training-stride');
        stride.max = String(result.configuration.contextLength);
        if (Number(stride.value) > result.configuration.contextLength) {
            stride.value = String(result.configuration.contextLength);
        }
        updatePromptGuidance();
        return result;
    }

    function resetArchitecture() {
        one('#context-length').value = String(architectureDefaults.contextLength);
        one('#embedding-dimension').value = String(architectureDefaults.embeddingDimension);
        one('#attention-heads').value = String(architectureDefaults.attentionHeads);
        one('#transformer-layers').value = String(architectureDefaults.transformerLayers);
        one('#feed-forward-dimension').value = String(architectureDefaults.feedForwardDimension);
        one('#tied-embeddings').checked = architectureDefaults.tiedEmbeddings;
        renderArchitecture();
        announce('Classroom architecture preset restored.');
    }

    const stageNames = ['Data', 'Tokenization', 'Architecture', 'Training', 'Prediction Lab', 'Analysis'];
    let activeStage = 0;

    function showStage(index, options = {}) {
        const boundedIndex = Math.max(0, Math.min(stageNames.length - 1, index));
        activeStage = boundedIndex;
        const tabs = all('[role="tab"][data-stage]');
        const panels = all('.stage-panel[role="tabpanel"]');
        tabs.forEach((tab, tabIndex) => {
            const selected = tabIndex === boundedIndex;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        panels.forEach((panel, panelIndex) => { panel.hidden = panelIndex !== boundedIndex; });
        one('#previous-stage').disabled = boundedIndex === 0;
        one('#next-stage').disabled = boundedIndex === stageNames.length - 1;
        one('#next-stage').textContent = boundedIndex < stageNames.length - 1
            ? `Next: ${stageNames[boundedIndex + 1]} →`
            : 'Workflow complete';
        one('#stage-position').textContent = `Stage ${boundedIndex + 1} of ${stageNames.length} · ${stageNames[boundedIndex]}`;
        if (options.focusTab) tabs[boundedIndex].focus();
        if (options.focusPanel) panels[boundedIndex].querySelector('h2')?.focus({ preventScroll: true });
        if (options.announce !== false) announce(`${stageNames[boundedIndex]} stage selected.`);
    }

    all('[role="tab"][data-stage]').forEach((tab, index, tabs) => {
        tab.addEventListener('click', () => showStage(index));
        tab.addEventListener('keydown', event => {
            let nextIndex;
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = tabs.length - 1;
            if (nextIndex !== undefined) {
                event.preventDefault();
                showStage(nextIndex, { focusTab: true });
            }
        });
    });
    one('#previous-stage').addEventListener('click', () => showStage(activeStage - 1));
    one('#next-stage').addEventListener('click', () => showStage(activeStage + 1));

    one('#tokenizer-input').addEventListener('input', renderTokenization);
    one('#prompt-input').addEventListener('input', updatePromptGuidance);
    all('[data-prompt-example]').forEach(button => {
        button.addEventListener('click', () => {
            one('#prompt-input').value = button.dataset.promptExample;
            updatePromptGuidance();
            one('#prompt-input').focus();
            announce(`Prompt starter selected: ${button.textContent}.`);
        });
    });
    one('#architecture-form').addEventListener('input', renderArchitecture);
    one('#architecture-form').addEventListener('change', renderArchitecture);
    one('#reset-architecture').addEventListener('click', resetArchitecture);

    const trainingClient = new clientApi.LocalTrainingClient(
        new URL('../llm-training-lab/inference-worker.js?v=3.1', window.location.href)
    );
    const cloudClient = new cloudApi.CloudTrainingClient();
    let trainingMode = 'local';
    let currentModelSource = null;
    let currentRunId = null;
    let trainingStatus = 'ready';
    let totalSteps = Number(one('#training-steps').value);
    let trainHistory = [];
    let validationHistory = [];
    let snapshots = [];
    let replayTimer = null;
    let latestMemory = null;
    let currentModelVocabSize = vocabulary.length;
    let currentParameterCount = null;
    let cloudJobSnapshot = null;
    let activeSession = null;
    let currentTrainingSeed = 4242;
    let baselineComparable = false;
    let latestRanking = null;

    function selectTrainingMode(mode) {
        if (!['local', 'cloud'].includes(mode)) return;
        if (['starting', 'running', 'paused'].includes(trainingStatus)) {
            one(`#training-mode-${trainingMode}`).checked = true;
            announce('Finish or cancel the current run before changing training mode.');
            return;
        }
        trainingMode = mode;
        all('[data-mode-card]').forEach(card => {
            card.classList.toggle('mode-card-selected', card.dataset.modeCard === mode);
        });
        one('#cloud-connection-form').hidden = mode !== 'cloud';
        const local = mode === 'local';
        one('#training-privacy-title').textContent =
            local ? 'LOCAL TRAINING' : 'TEMPORARY CLOUD TRAINING';
        one('#training-privacy-text').textContent = local
            ? 'Training runs in a Web Worker on this device. Completed models are saved to browser storage; cancelled and incomplete runs are not persisted.'
            : 'The bundled dataset and selected configuration are sent to the managed Python service. Cloud weights are temporary; download or save the verified package locally before expiration.';
        one('#training-notice-title').textContent =
            local ? 'LOCAL AND OBSERVABLE' : 'CLOUD AND TEMPORARY';
        one('#training-notice-text').textContent = local
            ? 'Training data, weights, optimizer state, and replay snapshots stay inside this browser. The UI receives metrics and bounded educational views, never model tensors.'
            : 'The service streams measured loss and progress. Detailed tensor replay remains available for local runs; a cloud model can be downloaded, validated, and continued in this browser.';
        one('#training-runtime-badge').textContent = local
            ? 'Worker training · CPU reference'
            : cloudClient.connected ? 'Cloud service · connected' : 'Cloud service · connection required';
        one('#training-start').textContent = local ? 'Start local training' : 'Start cloud training';
        one('#training-pause').hidden = !local;
        one('#training-resume').hidden = !local;
        setTrainingControls(currentModelSource ? 'completed' : 'ready');
        announce(`${local ? 'Local' : 'Cloud'} training mode selected.`);
    }

    all('input[name="training-mode"]').forEach(input => {
        input.addEventListener('change', event => selectTrainingMode(event.target.value));
    });

    one('#cloud-connection-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = one('#cloud-connect');
        const status = one('#cloud-connection-status');
        button.disabled = true;
        status.textContent = 'Creating an anonymous cloud session…';
        try {
            const session = await cloudClient.connect(
                one('#cloud-service-url').value,
                one('#cloud-access-key').value
            );
            one('#cloud-access-key').value = '';
            status.textContent = `Connected for this page session (${session.session_id.slice(0, 8)}…).`;
            one('#training-runtime-badge').textContent = 'Cloud service · connected';
            setTrainingControls('ready');
            announce('Connected to the MicroComp Cloud training service.');
        } catch (error) {
            status.textContent = `Connection failed: ${error.message}`;
            announce(`Cloud connection failed: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    });

    function formatBytes(value) {
        const bytes = Number(value) || 0;
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }

    function modelAction(label, action, runId, className = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.dataset.modelAction = action;
        button.dataset.runId = runId;
        if (className) button.className = className;
        return button;
    }

    function renderSavedModels(models) {
        const grid = one('#my-models-grid');
        if (!models.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-model-library';
            empty.textContent = 'No completed models are stored yet. Train a model here or import a verified .microcomp-model package.';
            grid.replaceChildren(empty);
            return;
        }
        grid.replaceChildren(...models.map(model => {
            const card = document.createElement('article');
            card.className = `saved-model-card${model.runId === currentRunId ? ' is-active' : ''}`;
            card.dataset.runId = model.runId;
            const title = document.createElement('h4');
            title.textContent = model.name;
            const meta = document.createElement('dl');
            meta.className = 'saved-model-meta';
            [
                ['Dataset', model.dataset],
                ['Parameters', formatInteger(model.parameterCount)],
                ['Training steps', formatInteger(model.trainingSteps)],
                ['Validation loss', Number.isFinite(model.validationLoss)
                    ? model.validationLoss.toFixed(4) : 'Not recorded'],
                ['Created', new Date(model.completedAt).toLocaleString()],
                ['Size', formatBytes(model.sizeBytes)]
            ].forEach(([termText, descriptionText]) => {
                const container = document.createElement('div');
                const term = document.createElement('dt');
                const description = document.createElement('dd');
                term.textContent = termText;
                description.textContent = descriptionText;
                container.append(term, description);
                meta.append(container);
            });
            const preview = document.createElement('pre');
            preview.className = 'saved-model-preview';
            preview.textContent = model.previewText || 'No checkpoint preview was included.';
            const actions = document.createElement('div');
            actions.className = 'model-card-actions';
            actions.append(
                modelAction(model.runId === currentRunId ? 'Loaded' : 'Load', 'load', model.runId),
                modelAction('Rename', 'rename', model.runId),
                modelAction('Duplicate', 'duplicate', model.runId),
                modelAction('Export', 'export', model.runId),
                modelAction('Delete', 'delete', model.runId, 'danger-action')
            );
            if (model.runId === currentRunId) actions.firstElementChild.disabled = true;
            card.append(title, meta, preview, actions);
            return card;
        }));
    }

    function setLibraryStatus(message, error = false) {
        const status = one('#model-library-status');
        status.textContent = message;
        status.classList.toggle('is-error', error);
    }

    async function refreshSavedModels(message = null) {
        try {
            const result = await trainingClient.listSaved();
            renderSavedModels(result.models);
            setLibraryStatus(message || `${result.models.length} completed model${result.models.length === 1 ? '' : 's'} stored in this browser.`);
        } catch (error) {
            setLibraryStatus(`Model library unavailable: ${error.message}`, true);
        }
    }

    async function loadStoredModel(runId) {
        setLibraryStatus('Loading model tensors in the worker…');
        const result = await trainingClient.loadSaved(runId);
        currentRunId = runId;
        currentModelSource = 'local';
        trainingStatus = 'completed';
        currentModelVocabSize = result.model.vocabularySize;
        currentParameterCount = result.metadata.parameterCount;
        currentTrainingSeed = Number(result.training?.seed ?? 4242);
        baselineComparable = String(result.trainingEngineIdentifier || '')
            .startsWith('microcomp-tfjs-training-');
        snapshots = result.replay || [];
        one('#playground-generate').disabled = false;
        one('#playground-model-state').textContent = 'Stored local model loaded';
        one('#playground-engine-label').textContent = 'Local worker inference';
        one('#generated-output').textContent =
            'This stored model is ready. Enter a prompt and generate text.';
        if (snapshots.length) {
            one('#replay-scrubber').max = String(snapshots.length - 1);
            one('#replay-scrubber').disabled = false;
            one('#replay-play').disabled = snapshots.length < 2;
            renderSnapshot(snapshots.length - 1);
        } else {
            one('#explorer-summary').textContent =
                'This portable package contains weights and scalar training history, but no replay tensors. Train locally to capture synchronized transformer views.';
            one('#transformer-token-flow').textContent =
                'Detailed transformer replay is unavailable for this imported package.';
        }
        reportFromStored(result);
        renderRankingChallenge();
        await refreshSavedModels(`Loaded “${result.metadata.name}” directly into the Playground.`);
        announce(`Loaded ${result.metadata.name} into the Playground.`);
    }

    function chartPoint(step, loss) {
        const losses = [...trainHistory, ...validationHistory].map(point => point.loss);
        const minimum = Math.min(...losses, loss);
        const maximum = Math.max(...losses, loss);
        const span = Math.max(.1, maximum - minimum);
        const x = 35 + ((step / Math.max(1, totalSteps)) * 545);
        const y = 20 + (((maximum + span * .1 - loss) / (span * 1.2)) * 140);
        return `${x.toFixed(1)},${Math.max(20, Math.min(160, y)).toFixed(1)}`;
    }

    function renderCharts() {
        one('#train-loss-line').setAttribute(
            'points', trainHistory.map(point => chartPoint(point.step, point.loss)).join(' ')
        );
        one('#validation-loss-line').setAttribute(
            'points', validationHistory.map(point => chartPoint(point.step, point.loss)).join(' ')
        );
    }

    function seconds(value) {
        if (!Number.isFinite(value)) return '—';
        if (value < 60) return `${value.toFixed(1)} s`;
        return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
    }

    function addTrainingEvent(message) {
        const item = document.createElement('li');
        item.textContent = message;
        const log = one('#training-events');
        log.append(item);
        while (log.children.length > 200) log.firstElementChild.remove();
        log.scrollTop = log.scrollHeight;
    }

    function setTrainingControls(status) {
        trainingStatus = status;
        const statusLabels = {
            ready: 'Ready to train',
            starting: trainingMode === 'cloud' ? 'Queueing cloud job' : 'Constructing model in worker',
            queued: 'Cloud job queued',
            initializing: 'Cloud model initializing',
            running: trainingMode === 'cloud' ? 'Training in MicroComp Cloud' : 'Training in worker',
            paused: 'Training paused',
            cancelled: 'Training cancelled · not saved',
            completed: trainingMode === 'cloud'
                ? 'Cloud training complete · download before expiration'
                : 'Training complete · saving locally',
            expired: 'Cloud model expired',
            failed: 'Training failed'
        };
        one('#training-status').textContent = statusLabels[status] || status;
        const active = ['starting', 'queued', 'initializing', 'running', 'paused'].includes(status);
        one('#training-start').disabled = active
            || !parameterApi.validateConfiguration(readArchitecture()).valid
            || (trainingMode === 'cloud' && !cloudClient.connected);
        one('#training-pause').disabled = trainingMode !== 'local' || status !== 'running';
        one('#training-resume').disabled = trainingMode !== 'local' || status !== 'paused';
        one('#training-cancel').disabled = ![
            'starting', 'queued', 'initializing', 'running', 'paused'
        ].includes(status);
        all('#architecture-form select, #architecture-form input, #training-config-form input')
            .forEach(control => { control.disabled = active; });
        all('input[name="training-mode"]').forEach(control => {
            control.disabled = active;
        });
    }

    function updateMetrics(event) {
        one('#metric-step').textContent = `${event.step} / ${event.totalSteps}`;
        if (Number.isFinite(event.trainLoss)) {
            one('#metric-train-loss').textContent = event.trainLoss.toFixed(4);
        }
        if (Number.isFinite(event.latestValidationLoss)) {
            one('#metric-validation-loss').textContent =
                event.latestValidationLoss.toFixed(4);
        }
        one('#metric-elapsed').textContent = seconds(event.elapsedSeconds);
        one('#metric-tokens').textContent = formatInteger(event.tokensProcessed);
        one('#metric-remaining').textContent = seconds(event.estimatedRemainingSeconds);
        one('#preview-progress-fill').style.width =
            `${(event.step / Math.max(1, event.totalSteps)) * 100}%`;
        if (event.memory) {
            latestMemory = event.memory;
            one('#checkpoint-memory').textContent =
                `${(event.memory.tensorflowBytes / 1048576).toFixed(2)} MiB`;
        }
    }

    function sessionFromHistory(options = {}) {
        return {
            completed: true,
            mode: options.mode || currentModelSource || trainingMode,
            datasetName: 'Synthetic Cybersecurity Alerts and Responses',
            trainingDocuments: datasetSummary.trainingDocuments,
            validationDocuments: datasetSummary.validationDocuments,
            parameterCount: options.parameterCount ?? currentParameterCount,
            tokensProcessed: options.tokensProcessed ?? 0,
            steps: options.steps ?? 0,
            trainHistory: options.trainHistory || trainHistory,
            validationHistory: options.validationHistory || validationHistory,
            temperature: Number(one('#temperature').value)
        };
    }

    function renderTrainingReport(session) {
        activeSession = session;
        const report = reportApi.buildTrainingReport(session);
        one('#training-report-title').textContent = report.title;
        one('#training-report-source').textContent = report.available
            ? `Measured ${session.mode} session`
            : 'Waiting for a completed session';
        one('#training-report-content').replaceChildren(...report.sections.map(section => {
            const article = document.createElement('article');
            article.className = 'report-section';
            const heading = document.createElement('h4');
            const paragraph = document.createElement('p');
            heading.textContent = section.heading;
            paragraph.textContent = section.text;
            article.append(heading, paragraph);
            return article;
        }));
    }

    function reportFromStored(result) {
        const history = result.history || [];
        const storedTraining = history
            .filter(item => Number.isFinite(item.trainLoss))
            .map(item => ({ step: item.step, loss: item.trainLoss }));
        const storedValidation = history
            .filter(item => Number.isFinite(item.validationLoss))
            .map(item => ({ step: item.step, loss: item.validationLoss }));
        renderTrainingReport(sessionFromHistory({
            mode: 'local',
            parameterCount: result.metadata.parameterCount,
            tokensProcessed: result.finalMetrics?.tokensProcessed || 0,
            steps: result.finalMetrics?.step || result.metadata.trainingSteps || 0,
            trainHistory: storedTraining,
            validationHistory: storedValidation
        }));
    }

    function ordinal(value) {
        const suffix = value % 10 === 1 && value % 100 !== 11 ? 'st'
            : value % 10 === 2 && value % 100 !== 12 ? 'nd'
                : value % 10 === 3 && value % 100 !== 13 ? 'rd' : 'th';
        return `${value}${suffix}`;
    }

    function selectedRankingChallenge() {
        return rankingChallenges[Number(one('#ranking-challenge').value) || 0];
    }

    function renderRankingChallenge() {
        const challenge = selectedRankingChallenge();
        one('#ranking-alert-text').textContent = challenge.alert;
        one('#ranking-results').hidden = true;
        one('#ranking-set-results').hidden = true;
        latestRanking = null;
        const available = currentModelSource === 'local'
            && trainingStatus === 'completed' && baselineComparable;
        const evaluateButton = one('#ranking-evaluate');
        const evaluateAllButton = one('#ranking-evaluate-all');
        const trainingShortcut = one('#ranking-training-shortcut');
        evaluateButton.disabled = !available;
        evaluateAllButton.disabled = !available;
        evaluateButton.textContent = available
            ? 'Compare before and after training'
            : 'Train a model to enable comparison';
        trainingShortcut.hidden = available;
        one('#ranking-status-message').textContent = available
            ? 'Ready to compare the trained model with its exact deterministic initialization.'
            : currentModelSource === 'cloud'
                ? 'Save and continue the cloud model locally before running worker-side evaluation.'
                : currentModelSource === 'local' && !baselineComparable
                    ? 'This imported model does not include a comparable browser initialization. Train a browser model here for an exact before/after comparison.'
                    : 'Train or load a browser-trained local model to run this evaluation.';
    }

    function rankingCandidate(result, id) {
        return result.candidates.find(candidate => candidate.id === id);
    }

    function challengeCandidate(challenge, id) {
        return challenge.candidates.find(candidate => candidate.id === id);
    }

    function renderRankingCharacter() {
        if (!latestRanking) return;
        const position = Number(one('#ranking-character-position').value) || 0;
        const trained = latestRanking.trained.detail[position];
        const baseline = latestRanking.baseline.detail[position];
        if (!trained || !baseline) return;
        one('#ranking-expected-character').textContent = trained.expected;
        one('#ranking-baseline-character').textContent =
            `${baseline.predicted}${baseline.correct ? ' ✓' : ' ✗'}`;
        one('#ranking-trained-character').textContent =
            `${trained.predicted}${trained.correct ? ' ✓' : ' ✗'}`;
        const maximum = Math.max(...trained.topChoices.map(item => item.probability), 1e-9);
        one('#ranking-probabilities').replaceChildren(...trained.topChoices.map(item => {
            const row = document.createElement('div');
            row.className = 'explorer-bar';
            const label = document.createElement('span');
            const meter = document.createElement('i');
            const value = document.createElement('b');
            label.textContent = `${item.token} · ${item.id}`;
            meter.style.width = `${Math.max(2, item.probability / maximum * 100)}%`;
            value.textContent = `${(item.probability * 100).toFixed(2)}%`;
            row.append(label, meter, value);
            return row;
        }));
    }

    function renderRanking(result) {
        const challenge = selectedRankingChallenge();
        latestRanking = result;
        const correctId = challenge.id;
        const baselineRank = result.baseline.candidates.findIndex(
            item => item.id === correctId
        ) + 1;
        const trainedRank = result.trained.candidates.findIndex(
            item => item.id === correctId
        ) + 1;
        const baselineCorrect = rankingCandidate(result.baseline, correctId);
        const trainedCorrect = rankingCandidate(result.trained, correctId);
        const selected = result.trained.candidates[0];
        const selectedCorrectly = selected.id === correctId;
        const selectedPlan = challengeCandidate(challenge, selected.id);
        const referencePlan = challengeCandidate(challenge, correctId);

        one('#ranking-selected-area').textContent = selectedPlan.area;
        one('#ranking-selected-response').textContent = selectedPlan.text.trim();
        one('#ranking-reference-area').textContent = referencePlan.area;
        one('#ranking-reference-response').textContent = referencePlan.text.trim();
        one('#ranking-human-outcome').textContent =
            selectedCorrectly ? 'Matched reference' : 'Selected a different plan';
        one('#ranking-human-explanation').textContent = selectedCorrectly
            ? 'The trained model ranked the held-out response plan first.'
            : 'The trained model chose a readable plan, but it did not match the held-out reference.';
        const outcome = one('.decision-outcome');
        outcome.classList.toggle('is-match', selectedCorrectly);
        outcome.classList.toggle('is-different', !selectedCorrectly);

        one('#baseline-correct-rank').textContent =
            `${ordinal(baselineRank)} of ${result.baseline.candidates.length}`;
        one('#baseline-correct-loss').textContent =
            `Average loss ${baselineCorrect.averageLoss.toFixed(4)}`;
        one('#trained-correct-rank').textContent =
            `${ordinal(trainedRank)} of ${result.trained.candidates.length}`;
        one('#trained-correct-loss').textContent =
            `Average loss ${trainedCorrect.averageLoss.toFixed(4)}`;
        one('#ranking-selected-result').textContent =
            selectedCorrectly ? 'Correct response' : 'Different response';
        one('#ranking-character-count').textContent =
            String(result.trained.scoredCharactersPerCandidate);
        one('#ranking-correct-response').textContent =
            `Held-out correct response: ${challenge.response.trim()}`;

        const rankChange = baselineRank - trainedRank;
        const lossChange = baselineCorrect.averageLoss - trainedCorrect.averageLoss;
        const verdict = one('#ranking-verdict');
        const heading = document.createElement('strong');
        const paragraph = document.createElement('p');
        heading.textContent = selectedCorrectly
            ? 'The trained model ranked the correct readable response first.'
            : 'The trained model did not rank the correct response first.';
        paragraph.textContent =
            `The correct response moved from ${ordinal(baselineRank)} to ${ordinal(trainedRank)} place. `
            + `Its measured average next-character loss ${lossChange > 0 ? 'decreased' : lossChange < 0 ? 'increased' : 'did not change'} by ${Math.abs(lossChange).toFixed(4)}. `
            + `${rankChange > 0 ? 'Training improved its rank.' : rankChange < 0 ? 'Training reduced its rank.' : 'Its rank was unchanged.'} `
            + 'All displayed responses are curated validation candidates; the model only scored them.';
        verdict.replaceChildren(heading, paragraph);

        one('#ranking-table-body').replaceChildren(...result.trained.candidates.map(
            (candidate, trainedIndex) => {
                const row = document.createElement('tr');
                const baselineIndex = result.baseline.candidates.findIndex(
                    item => item.id === candidate.id
                );
                const baseline = result.baseline.candidates[baselineIndex];
                const correct = candidate.id === correctId;
                const selectedRow = trainedIndex === 0;
                row.classList.toggle('is-correct', correct);
                row.classList.toggle('is-selected', selectedRow);
                const responseCell = document.createElement('td');
                const responseArea = document.createElement('strong');
                responseArea.textContent = challengeCandidate(
                    challenge, candidate.id
                ).area;
                const responseText = document.createElement('span');
                responseText.textContent = candidate.text.trim();
                responseCell.append(responseArea, responseText);
                const baselineCell = document.createElement('td');
                baselineCell.textContent =
                    `${ordinal(baselineIndex + 1)} · ${baseline.averageLoss.toFixed(4)}`;
                const trainedCell = document.createElement('td');
                trainedCell.textContent =
                    `${ordinal(trainedIndex + 1)} · ${candidate.averageLoss.toFixed(4)}`;
                const scoreCell = document.createElement('td');
                scoreCell.textContent = `${(candidate.relativeScore * 100).toFixed(1)}%`;
                const resultCell = document.createElement('td');
                if (correct) {
                    const label = document.createElement('span');
                    label.className = 'ranking-result-label';
                    label.textContent = 'Correct held-out response';
                    resultCell.append(label);
                }
                if (selectedRow) {
                    const label = document.createElement('span');
                    label.className = 'ranking-result-label';
                    label.textContent = 'Model selected';
                    resultCell.append(label);
                }
                row.append(responseCell, baselineCell, trainedCell, scoreCell, resultCell);
                return row;
            }
        ));

        const selector = one('#ranking-character-position');
        selector.replaceChildren(...result.trained.detail.map(item => {
            const option = document.createElement('option');
            option.value = String(item.position - 1);
            option.textContent = `${item.position}: expected ${item.expected}`;
            return option;
        }));
        one('#ranking-results').hidden = false;
        one('#ranking-status-message').textContent =
            `Evaluation complete. ${result.trained.scoredCharactersPerCandidate} characters were scored equally for each response.`;
        renderRankingCharacter();
    }

    function renderRankingSet(result) {
        const baselineById = new Map(result.baseline.map(item => [
            item.challengeId, item
        ]));
        let baselineCorrect = 0;
        let trainedCorrect = 0;
        const rows = rankingChallenges.map((challenge, index) => {
            const trained = result.trained[index];
            const baseline = baselineById.get(challenge.id);
            const trainedSelection = trained.ranking.candidates[0];
            const baselineSelection = baseline.ranking.candidates[0];
            const matched = trainedSelection.id === challenge.id;
            if (matched) trainedCorrect += 1;
            if (baselineSelection.id === challenge.id) baselineCorrect += 1;
            const selectedPlan = challengeCandidate(challenge, trainedSelection.id);
            const referencePlan = challengeCandidate(challenge, challenge.id);
            const row = document.createElement('tr');
            const alertCell = document.createElement('td');
            alertCell.textContent = challenge.alert.replace(/^alert:\s*/, '');
            const selectedCell = document.createElement('td');
            const selectedArea = document.createElement('strong');
            selectedArea.textContent = selectedPlan.area;
            const selectedText = document.createElement('span');
            selectedText.textContent = selectedPlan.text.trim();
            selectedCell.append(selectedArea, selectedText);
            const referenceCell = document.createElement('td');
            const referenceArea = document.createElement('strong');
            referenceArea.textContent = referencePlan.area;
            const referenceText = document.createElement('span');
            referenceText.textContent = referencePlan.text.trim();
            referenceCell.append(referenceArea, referenceText);
            const resultCell = document.createElement('td');
            resultCell.className = matched ? 'result-match' : 'result-different';
            resultCell.textContent = matched ? 'Matched reference' : 'Different plan';
            row.append(alertCell, selectedCell, referenceCell, resultCell);
            return row;
        });
        const change = trainedCorrect - baselineCorrect;
        one('#ranking-set-baseline').textContent =
            `${baselineCorrect} of ${rankingChallenges.length}`;
        one('#ranking-set-trained').textContent =
            `${trainedCorrect} of ${rankingChallenges.length}`;
        one('#ranking-set-change').textContent =
            `${change > 0 ? '+' : ''}${change} correct`;
        one('#ranking-set-summary').textContent =
            `The trained model matched ${trainedCorrect} of ${rankingChallenges.length} held-out reference plans. `
            + `The deterministic untrained baseline matched ${baselineCorrect}. `
            + 'This is a small educational validation set, not a real-world security benchmark.';
        one('#ranking-set-table-body').replaceChildren(...rows);
        one('#ranking-set-results').hidden = false;
    }

    function tokenDisplay(tokenId) {
        const token = vocabulary[tokenId] ?? `ID ${tokenId}`;
        if (token === ' ') return 'space';
        if (token === '\n') return '\\n';
        return token;
    }

    function barNodes(values, kind) {
        const ranked = values.map((value, id) => ({ value, id }))
            .sort((left, right) => (
                kind === 'logit'
                    ? Math.abs(right.value) - Math.abs(left.value)
                    : right.value - left.value
            ) || left.id - right.id)
            .slice(0, 12);
        const maximum = Math.max(...ranked.map(item => Math.abs(item.value)), 1e-9);
        return ranked.map(item => {
            const row = document.createElement('div');
            row.className = 'explorer-bar';
            const label = document.createElement('span');
            const meter = document.createElement('i');
            const value = document.createElement('b');
            label.textContent = `${tokenDisplay(item.id)} · ${item.id}`;
            meter.style.width = `${Math.max(2, Math.abs(item.value) / maximum * 100)}%`;
            value.textContent = kind === 'probability'
                ? `${(item.value * 100).toFixed(2)}%`
                : item.value.toFixed(3);
            row.append(label, meter, value);
            return row;
        });
    }

    function renderEmbeddingEvolution() {
        const svg = one('#embedding-evolution');
        svg.replaceChildren();
        if (!snapshots.length) return;
        const tokenIds = snapshots[0].embeddings.tokenIds;
        one('#embedding-series-label').textContent =
            `${tokenDisplay(tokenIds[0])} and ${tokenDisplay(tokenIds[1])} · dimension 1`;
        const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        axis.setAttribute('x1', '20');
        axis.setAttribute('x2', '345');
        axis.setAttribute('y1', '90');
        axis.setAttribute('y2', '90');
        axis.setAttribute('class', 'embedding-axis');
        svg.append(axis);
        const series = [0, 1].map(tokenIndex => snapshots.map(snapshot => {
            const width = snapshot.embeddings.shape[1];
            return snapshot.embeddings.values[tokenIndex * width] || 0;
        }));
        const maximum = Math.max(.001, ...series.flat().map(Math.abs));
        series.forEach((values, index) => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            const points = values.map((value, point) => {
                const x = 20 + (point / Math.max(1, values.length - 1)) * 325;
                const y = 90 - (value / maximum) * 70;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
            line.setAttribute('points', points);
            line.setAttribute('class', index ? 'embedding-line-secondary' : 'embedding-line');
            svg.append(line);
        });
    }

    function renderSnapshot(index) {
        const snapshot = snapshots[index];
        if (!snapshot) return;
        one('#replay-scrubber').value = String(index);
        one('#replay-position').textContent =
            `Snapshot ${index + 1} of ${snapshots.length} · step ${snapshot.step}`;
        one('#explorer-summary').textContent =
            `Step ${snapshot.step}: training loss ${snapshot.trainLoss.toFixed(4)}, validation loss ${snapshot.validationLoss.toFixed(4)}, ${formatInteger(snapshot.parameterCount)} parameters.`;
        one('#checkpoint-output').textContent = snapshot.sample || '(stopped at <eos>)';
        one('#checkpoint-step').textContent = String(snapshot.step);
        one('#checkpoint-loss').textContent = snapshot.trainLoss.toFixed(4);
        one('#checkpoint-parameters').textContent = formatInteger(snapshot.parameterCount);
        if (!visualizationApi.hasEducationalTensors(snapshot)) {
            one('#explorer-summary').textContent =
                `Step ${snapshot.step}: scalar cloud measurements are available, but this engine did not export internal tensors.`;
            one('#transformer-token-flow').textContent =
                'Tensor-level replay is available for local browser training snapshots.';
            return;
        }
        const flow = visualizationApi.tokenFlow(snapshot, vocabulary);
        const flowNodes = [];
        flow.forEach((item, flowIndex) => {
            const chip = document.createElement('span');
            chip.className = `token-flow-chip${item.selected ? ' is-current' : ''}`;
            chip.textContent = `${tokenDisplay(item.id)} · ${item.id}`;
            chip.title = `Input position ${item.position}, token ID ${item.id}`;
            flowNodes.push(chip);
            if (flowIndex < flow.length - 1) {
                const arrow = document.createElement('span');
                arrow.className = 'token-flow-arrow';
                arrow.textContent = '→';
                arrow.setAttribute('aria-hidden', 'true');
                flowNodes.push(arrow);
            }
        });
        ['Embeddings', `${readArchitecture().transformerLayers} decoder blocks`, 'Logits'].forEach(label => {
            const arrow = document.createElement('span');
            arrow.className = 'token-flow-arrow';
            arrow.textContent = '→';
            arrow.setAttribute('aria-hidden', 'true');
            const stage = document.createElement('strong');
            stage.className = 'token-flow-stage';
            stage.textContent = label;
            flowNodes.push(arrow, stage);
        });
        one('#transformer-token-flow').replaceChildren(...flowNodes);
        const [heads, sequence] = snapshot.attention.shape;
        one('#attention-shape').textContent = `${sequence} × ${sequence}`;
        const headSelector = one('#attention-head');
        if (headSelector.options.length !== heads) {
            headSelector.replaceChildren(...Array.from({ length: heads }, (_, head) => {
                const option = document.createElement('option');
                option.value = String(head);
                option.textContent = String(head + 1);
                return option;
            }));
        }
        headSelector.disabled = false;
        const selectedHead = Math.min(Number(headSelector.value) || 0, heads - 1);
        headSelector.value = String(selectedHead);
        const matrix = one('#attention-matrix');
        matrix.style.gridTemplateColumns = `repeat(${sequence}, minmax(0, 1fr))`;
        const headStart = selectedHead * sequence * sequence;
        const selectedAttention = snapshot.attention.values.slice(
            headStart, headStart + sequence * sequence
        );
        matrix.replaceChildren(...selectedAttention.map((value, cellIndex) => {
            const cell = document.createElement('span');
            cell.className = 'attention-cell';
            cell.style.backgroundColor = `rgba(36, 200, 192, ${Math.max(.06, value)})`;
            cell.textContent = value >= .1 ? value.toFixed(2) : '';
            cell.title = `Query ${Math.floor(cellIndex / sequence)}, key ${cellIndex % sequence}: ${value.toFixed(4)}`;
            return cell;
        }));
        one('#explorer-logits').replaceChildren(...barNodes(snapshot.logits, 'logit'));
        one('#explorer-probabilities').replaceChildren(
            ...barNodes(snapshot.probabilities, 'probability')
        );
        const selected = snapshot.selectedTokenId;
        one('#selected-token').textContent = tokenDisplay(selected);
        one('#selected-token-detail').textContent =
            `Token ID ${selected} had ${(snapshot.probabilities[selected] * 100).toFixed(2)}% probability and was the highest-probability next token in this checkpoint view.`;
        const maximumActivation = Math.max(
            ...snapshot.activations.map(item => item.meanAbsolute), 1e-9
        );
        one('#layer-activations').replaceChildren(...snapshot.activations.map(item => {
            const row = document.createElement('div');
            row.className = 'explorer-bar';
            const label = document.createElement('span');
            const meter = document.createElement('i');
            const value = document.createElement('b');
            label.textContent = item.name;
            meter.style.width = `${item.meanAbsolute / maximumActivation * 100}%`;
            value.textContent = item.meanAbsolute.toFixed(4);
            row.append(label, meter, value);
            return row;
        }));
        renderEmbeddingEvolution();
    }

    function addSnapshot(snapshot) {
        snapshots.push(snapshot);
        const scrubber = one('#replay-scrubber');
        scrubber.max = String(snapshots.length - 1);
        scrubber.disabled = false;
        one('#replay-play').disabled = snapshots.length < 2;
        renderSnapshot(snapshots.length - 1);
        addTrainingEvent(
            `checkpoint step ${snapshot.step} · loss ${snapshot.trainLoss.toFixed(4)} · sample captured`
        );
    }

    trainingClient.onTrainingEvent(event => {
        if (currentRunId && event.runId !== currentRunId) return;
        const data = event.data;
        if (event.eventType === 'LIFECYCLE') {
            setTrainingControls(data.status);
            addTrainingEvent(`${data.status} at step ${data.step}`);
        } else if (event.eventType === 'PROGRESS') {
            updateMetrics(data);
            trainHistory.push({ step: data.step, loss: data.trainLoss });
            if (Number.isFinite(data.validationLoss)) {
                validationHistory.push({ step: data.step, loss: data.validationLoss });
                addTrainingEvent(
                    `validation step ${data.step} · loss ${data.validationLoss.toFixed(4)}`
                );
            }
            renderCharts();
        } else if (event.eventType === 'SNAPSHOT') {
            addSnapshot(data);
        } else if (event.eventType === 'COMPLETED') {
            updateMetrics(data);
            currentModelSource = 'local';
            baselineComparable = true;
            setTrainingControls('completed');
            one('#playground-generate').disabled = false;
            one('#playground-model-state').textContent = 'Completed local model';
            one('#playground-engine-label').textContent = 'Local worker inference';
            addTrainingEvent(`completed · ${formatInteger(data.tokensProcessed)} tokens processed`);
            renderTrainingReport(sessionFromHistory({
                mode: 'local',
                parameterCount: data.parameterCount || currentParameterCount,
                tokensProcessed: data.tokensProcessed,
                steps: data.step
            }));
            renderRankingChallenge();
            announce('Local model training completed. The trained model is available in the playground.');
        } else if (event.eventType === 'PERSISTED') {
            one('#training-status').textContent = 'Training complete · saved in this browser';
            addTrainingEvent(`persisted after completion · ${data.completedAt}`);
            refreshSavedModels('Training completed and the model was saved in this browser.');
        } else if (event.eventType === 'PERSISTENCE_FAILED') {
            one('#training-status').textContent = 'Training complete · browser save failed';
            addTrainingEvent(`persistence failed · ${data.message}`);
        } else if (event.eventType === 'CANCELLED') {
            updateMetrics(data);
            setTrainingControls('cancelled');
            addTrainingEvent('cancelled · incomplete model was not saved');
        } else if (event.eventType === 'FAILED' || event.eventType === 'WORKER_FAILED') {
            setTrainingControls('failed');
            addTrainingEvent(`failed · ${data.error?.message || data.message}`);
            announce(`Training failed: ${data.error?.message || data.message}`);
        }
    });

    function workerConfiguration() {
        const architecture = readArchitecture();
        return {
            vocab_size: architecture.vocabularySize,
            context_length: architecture.contextLength,
            embedding_dim: architecture.embeddingDimension,
            attention_heads: architecture.attentionHeads,
            transformer_blocks: architecture.transformerLayers,
            feed_forward_dim: architecture.feedForwardDimension,
            dropout: 0,
            tie_embeddings: architecture.tiedEmbeddings
        };
    }

    function trainingOptions() {
        return {
            learningRate: Number(one('#training-learning-rate').value),
            batchSize: Number(one('#training-batch-size').value),
            steps: Number(one('#training-steps').value),
            validationInterval: Number(one('#training-validation-interval').value),
            snapshotInterval: Number(one('#training-snapshot-interval').value),
            gradientClipNorm: Number(one('#training-gradient-clip').value),
            stride: Number(one('#training-stride').value),
            seed: Number(one('#training-seed').value),
            validationBatches: 4,
            samplePrompt: 'alert: ',
            sampleMaxNewTokens: 24,
            sampleTemperature: .8,
            sampleTopK: Math.min(12, vocabulary.length)
        };
    }

    function cloudTrainingPayload() {
        const options = trainingOptions();
        return {
            dataset_id: dataset.id,
            model: workerConfiguration(),
            stride: options.stride,
            training: {
                learning_rate: options.learningRate,
                batch_size: options.batchSize,
                steps: options.steps,
                validation_interval: options.validationInterval,
                checkpoint_interval: options.snapshotInterval,
                gradient_clip_norm: options.gradientClipNorm,
                seed: options.seed,
                validation_batches: options.validationBatches,
                sample_prompt: options.samplePrompt,
                sample_max_new_tokens: options.sampleMaxNewTokens,
                sample_temperature: options.sampleTemperature,
                sample_top_k: options.sampleTopK
            }
        };
    }

    function cloudProgress(data) {
        return {
            step: data.step,
            totalSteps: data.total_steps,
            trainLoss: data.train_loss,
            validationLoss: data.validation_loss,
            latestValidationLoss: data.validation_loss,
            gradientNorm: data.gradient_norm,
            tokensProcessed: data.tokens_processed,
            elapsedSeconds: data.elapsed_seconds,
            estimatedRemainingSeconds: data.estimated_remaining_seconds
        };
    }

    async function finishCloudTraining() {
        cloudJobSnapshot = await cloudClient.status(currentRunId);
        if (cloudJobSnapshot.state !== 'completed') {
            setTrainingControls(cloudJobSnapshot.state);
            return;
        }
        currentModelSource = 'cloud';
        baselineComparable = false;
        currentParameterCount = cloudJobSnapshot.parameter_count;
        const metrics = cloudProgress(cloudJobSnapshot.progress);
        updateMetrics(metrics);
        setTrainingControls('completed');
        one('#playground-generate').disabled = false;
        one('#playground-model-state').textContent = 'Temporary cloud model loaded';
        one('#playground-engine-label').textContent = 'MicroComp Cloud inference';
        one('#cloud-model-actions').hidden = false;
        one('#cloud-model-expiry').textContent =
            `Cloud copy expires by ${new Date(cloudJobSnapshot.expires_at).toLocaleString()}.`;
        renderTrainingReport(sessionFromHistory({
            mode: 'cloud',
            parameterCount: cloudJobSnapshot.parameter_count,
            tokensProcessed: metrics.tokensProcessed,
            steps: metrics.step
        }));
        renderRankingChallenge();
        addTrainingEvent(`completed · cloud package ready · expires ${cloudJobSnapshot.expires_at}`);
        announce('Cloud training completed. Download the model or save it to this browser before it expires.');
    }

    async function startCloudTraining() {
        if (!cloudClient.connected) throw new Error('Connect to the cloud service first.');
        const job = await cloudClient.createJob(cloudTrainingPayload());
        currentRunId = job.job_id;
        currentParameterCount = job.parameter_count;
        currentModelSource = null;
        cloudJobSnapshot = job;
        one('#checkpoint-parameters').textContent = formatInteger(job.parameter_count);
        one('#training-runtime-badge').textContent = 'Python reference · cloud CPU';
        setTrainingControls(job.state);
        addTrainingEvent(`cloud job queued · ${formatInteger(job.parameter_count)} parameters`);
        try {
            await cloudClient.streamEvents(job.job_id, event => {
                if (event.event === 'state') {
                    const state = event.data.state === 'training' ? 'running' : event.data.state;
                    setTrainingControls(state);
                    addTrainingEvent(`cloud state · ${event.data.state}`);
                } else if (event.event === 'progress') {
                    const metrics = cloudProgress(event.data);
                    updateMetrics(metrics);
                    if (Number.isFinite(metrics.trainLoss)) {
                        trainHistory.push({ step: metrics.step, loss: metrics.trainLoss });
                    }
                    if (Number.isFinite(metrics.validationLoss)) {
                        validationHistory.push({
                            step: metrics.step,
                            loss: metrics.validationLoss
                        });
                    }
                    renderCharts();
                    if (event.data.sample) {
                        one('#checkpoint-output').textContent = event.data.sample;
                        one('#checkpoint-step').textContent = String(metrics.step);
                        one('#checkpoint-loss').textContent = metrics.trainLoss.toFixed(4);
                    }
                }
            });
        } catch (error) {
            if (error.name === 'AbortError') return;
            throw error;
        }
        await finishCloudTraining();
    }

    one('#training-start').addEventListener('click', async () => {
        const architecture = renderArchitecture();
        if (!architecture.valid) return;
        trainHistory = [];
        validationHistory = [];
        snapshots = [];
        totalSteps = Number(one('#training-steps').value);
        currentRunId = null;
        currentModelSource = null;
        baselineComparable = false;
        currentTrainingSeed = Number(one('#training-seed').value);
        currentParameterCount = architecture.total;
        cloudJobSnapshot = null;
        one('#cloud-model-actions').hidden = true;
        one('#training-events').replaceChildren();
        one('#train-loss-line').setAttribute('points', '');
        one('#validation-loss-line').setAttribute('points', '');
        one('#metric-step').textContent = `0 / ${totalSteps}`;
        one('#metric-train-loss').textContent = '—';
        one('#metric-validation-loss').textContent = '—';
        one('#metric-elapsed').textContent = '0.0 s';
        one('#metric-tokens').textContent = '0';
        one('#metric-remaining').textContent = '—';
        one('#preview-progress-fill').style.width = '0%';
        one('#checkpoint-output').textContent = trainingMode === 'cloud'
            ? 'Queueing the managed Python training job…'
            : 'Constructing model and baseline checkpoint…';
        one('#replay-scrubber').disabled = true;
        one('#replay-play').disabled = true;
        one('#playground-generate').disabled = true;
        renderRankingChallenge();
        setTrainingControls('starting');
        addTrainingEvent(trainingMode === 'cloud'
            ? 'start requested · contacting managed Python service'
            : 'start requested · loading local TensorFlow.js runtime');
        try {
            if (trainingMode === 'cloud') {
                await startCloudTraining();
                return;
            }
            currentRunId = `local-${Date.now().toString(36)}`;
            const started = await trainingClient.start({
                runId: currentRunId,
                datasetId: dataset.id,
                configuration: workerConfiguration(),
                training: trainingOptions()
            });
            one('#training-runtime-badge').textContent = started.runtime;
            one('#checkpoint-parameters').textContent =
                formatInteger(started.parameterCount);
            currentParameterCount = started.parameterCount;
            addTrainingEvent(
                `model constructed · ${formatInteger(started.parameterCount)} parameters · ${started.runtime}`
            );
        } catch (error) {
            setTrainingControls('failed');
            addTrainingEvent(`start failed · ${error.message}`);
            announce(`Training could not start: ${error.message}`);
        }
    });

    one('#training-pause').addEventListener('click', async () => {
        try {
            await trainingClient.pause(currentRunId);
            setTrainingControls('paused');
            announce('Training paused at the next worker step boundary.');
        } catch (error) {
            announce(error.message);
        }
    });
    one('#training-resume').addEventListener('click', async () => {
        try {
            await trainingClient.resume(currentRunId);
            setTrainingControls('running');
            announce('Training resumed.');
        } catch (error) {
            announce(error.message);
        }
    });
    one('#training-cancel').addEventListener('click', async () => {
        try {
            if (trainingMode === 'cloud') {
                cloudClient.stopEvents();
                await cloudClient.cancel(currentRunId);
                setTrainingControls('cancelled');
            } else {
                await trainingClient.cancel(currentRunId);
            }
            one('#training-status').textContent = 'Cancellation requested';
            announce('Cancellation requested. The incomplete model will not be saved.');
        } catch (error) {
            announce(error.message);
        }
    });

    function updateTrainingExpectation(steps) {
        const note = one('#training-expectation');
        if (steps <= 50) {
            note.innerHTML = '<strong>Quick demonstration:</strong> This run makes the learning process visible, but generated text will usually remain fragmented or incoherent.';
        } else if (steps <= 200) {
            note.innerHTML = '<strong>Longer classroom run:</strong> The model gets more opportunities to learn character patterns, but coherent or correct responses are not guaranteed.';
        } else {
            note.innerHTML = '<strong>Extended experiment:</strong> More steps can lower training loss while increasing memorization or overfitting risk. Watch validation loss.';
        }
    }

    one('#training-steps').addEventListener('input', event => {
        totalSteps = Number(event.target.value) || 1;
        one('#metric-step').textContent = `0 / ${totalSteps}`;
        updateTrainingExpectation(totalSteps);
    });

    one('#ranking-challenge').addEventListener('change', renderRankingChallenge);
    one('#ranking-training-shortcut').addEventListener('click', () => {
        showStage(3, { focusTab: true, focusPanel: true });
        one('#training-start').focus({ preventScroll: true });
        announce('Training stage selected. Configure the run, then choose Start local training.');
    });
    one('#ranking-character-position').addEventListener(
        'change', renderRankingCharacter
    );
    function setRankingButtonsBusy(busy) {
        one('#ranking-evaluate').disabled = busy;
        one('#ranking-evaluate-all').disabled = busy;
    }

    one('#ranking-evaluate').addEventListener('click', async event => {
        if (!currentRunId || currentModelSource !== 'local'
            || trainingStatus !== 'completed' || !baselineComparable) {
            renderRankingChallenge();
            return;
        }
        const challenge = selectedRankingChallenge();
        setRankingButtonsBusy(true);
        one('#ranking-results').hidden = true;
        one('#ranking-status-message').textContent =
            'Scoring every readable response in the worker…';
        try {
            const result = await trainingClient.rankResponses(currentRunId, {
                prefix: challenge.prefix,
                candidates: challenge.candidates,
                correctId: challenge.id,
                baselineSeed: currentTrainingSeed
            });
            renderRanking(result);
            announce(
                `Response ranking complete. The correct answer ranked ${
                    ordinal(result.trained.candidates.findIndex(
                        item => item.id === challenge.id
                    ) + 1)
                }.`
            );
        } catch (error) {
            one('#ranking-status-message').textContent =
                `Response ranking failed: ${error.message}`;
            announce(`Response ranking failed: ${error.message}`);
        } finally {
            setRankingButtonsBusy(false);
        }
    });

    one('#ranking-evaluate-all').addEventListener('click', async () => {
        if (!currentRunId || currentModelSource !== 'local'
            || trainingStatus !== 'completed' || !baselineComparable) {
            renderRankingChallenge();
            return;
        }
        setRankingButtonsBusy(true);
        one('#ranking-set-results').hidden = true;
        one('#ranking-status-message').textContent =
            `Scoring ${rankingChallenges.length} held-out alerts in the worker…`;
        try {
            const result = await trainingClient.rankResponseSet(currentRunId, {
                baselineSeed: currentTrainingSeed,
                challenges: rankingChallenges.map(challenge => ({
                    challengeId: challenge.id,
                    prefix: challenge.prefix,
                    candidates: challenge.candidates,
                    correctId: challenge.id
                }))
            });
            renderRankingSet(result);
            one('#ranking-status-message').textContent =
                'All held-out alerts have been evaluated with measured model scores.';
            announce('Held-out evaluation scorecard complete.');
        } catch (error) {
            one('#ranking-status-message').textContent =
                `Held-out evaluation failed: ${error.message}`;
            announce(`Held-out evaluation failed: ${error.message}`);
        } finally {
            setRankingButtonsBusy(false);
        }
    });

    one('#replay-scrubber').addEventListener('input', event => {
        renderSnapshot(Number(event.target.value));
    });
    one('#attention-head').addEventListener('change', () => {
        renderSnapshot(Number(one('#replay-scrubber').value));
    });
    one('#replay-play').addEventListener('click', () => {
        if (replayTimer !== null) {
            window.clearInterval(replayTimer);
            replayTimer = null;
            one('#replay-play').textContent = 'Play replay';
            return;
        }
        one('#replay-scrubber').value = '0';
        renderSnapshot(0);
        one('#replay-play').textContent = 'Stop replay';
        replayTimer = window.setInterval(() => {
            const next = Number(one('#replay-scrubber').value) + 1;
            if (next >= snapshots.length) {
                window.clearInterval(replayTimer);
                replayTimer = null;
                one('#replay-play').textContent = 'Play replay';
                return;
            }
            renderSnapshot(next);
        }, 800);
    });

    one('#temperature').addEventListener('input', event => {
        one('#temperature-value').textContent = Number(event.target.value).toFixed(1);
        if (activeSession?.completed) {
            renderTrainingReport({ ...activeSession, temperature: Number(event.target.value) });
        }
    });

    function appendChat(role, text) {
        const turn = document.createElement('p');
        turn.className = `chat-turn${role === 'model' ? ' is-model' : ''}`;
        turn.textContent = `${role === 'model' ? 'Generated continuation' : 'Prompt'}: ${text}`;
        one('#chat-history').append(turn);
    }

    one('#playground-form').addEventListener('submit', async event => {
        event.preventDefault();
        if (!currentRunId || trainingStatus !== 'completed') return;
        const prompt = one('#prompt-input').value;
        const seed = Number(one('#generation-seed').value);
        const temperature = Number(one('#temperature').value);
        const maximumTokens = Math.max(1, Math.min(160, Number(one('#maximum-tokens').value) || 80));
        const topK = Math.max(1, Math.min(currentModelVocabSize, Number(one('#top-k').value) || 12));
        one('#top-k').value = String(topK);
        one('#maximum-tokens').value = String(maximumTokens);
        const button = one('#playground-generate');
        button.disabled = true;
        one('#generated-output').textContent = currentModelSource === 'cloud'
            ? 'Generating in the temporary cloud model…'
            : 'Generating in the worker…';
        appendChat('user', prompt);
        try {
            const result = currentModelSource === 'cloud'
                ? await cloudClient.generate(currentRunId, {
                    prompt,
                    temperature,
                    top_k: topK,
                    max_new_tokens: maximumTokens,
                    seed
                })
                : await trainingClient.generate(currentRunId, prompt, {
                    temperature,
                    topK,
                    maxNewTokens: maximumTokens,
                    seed
                });
            one('#generated-output').textContent =
                result.text || '(generation stopped at <eos>)';
            appendChat('model', result.text || '(stopped at <eos>)');
            const count = result.generatedTokenIds?.length;
            announce(Number.isFinite(count)
                ? `The trained model generated ${count} new tokens.`
                : 'The cloud model returned generated text.');
        } catch (error) {
            one('#generated-output').textContent = error.message;
            appendChat('model', `Generation unavailable: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    });

    one('#clear-chat').addEventListener('click', () => {
        one('#chat-history').replaceChildren();
        one('#generated-output').textContent = 'Generation history cleared. Enter another prompt.';
        announce('Generation history cleared.');
    });

    async function fetchCloudPackage() {
        if (currentModelSource !== 'cloud' || !currentRunId) {
            throw new Error('No completed cloud model is selected.');
        }
        return cloudClient.download(currentRunId);
    }

    one('#cloud-download-model').addEventListener('click', async event => {
        event.target.disabled = true;
        try {
            const downloaded = await fetchCloudPackage();
            const url = URL.createObjectURL(new Blob(
                [downloaded.bytes], { type: 'application/zip' }
            ));
            const link = document.createElement('a');
            link.href = url;
            link.download = downloaded.fileName;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            announce('The portable cloud model package was downloaded.');
        } catch (error) {
            announce(`Cloud download failed: ${error.message}`);
        } finally {
            event.target.disabled = false;
        }
    });

    one('#cloud-continue-local').addEventListener('click', async event => {
        event.target.disabled = true;
        try {
            const cloudJobId = currentRunId;
            const downloaded = await fetchCloudPackage();
            setLibraryStatus('Validating the cloud package before browser storage…');
            const imported = await trainingClient.importModel(
                downloaded.fileName, downloaded.bytes
            );
            one('#training-mode-local').checked = true;
            selectTrainingMode('local');
            await loadStoredModel(imported.model.runId);
            one('#cloud-model-actions').hidden = true;
            setLibraryStatus('Cloud model verified, saved, and loaded for local inference.');
            addTrainingEvent(`cloud model ${cloudJobId.slice(0, 8)}… continued locally`);
            announce('The cloud model is now persistent in this browser and loaded locally.');
        } catch (error) {
            setLibraryStatus(`Cloud handoff failed: ${error.message}`, true);
            announce(`Cloud handoff failed: ${error.message}`);
        } finally {
            event.target.disabled = false;
        }
    });

    one('#cloud-delete-model').addEventListener('click', async event => {
        if (currentModelSource !== 'cloud' || !currentRunId) return;
        if (!window.confirm('Delete this temporary cloud model now? Download it first if you need a copy.')) return;
        event.target.disabled = true;
        try {
            await cloudClient.delete(currentRunId);
            currentRunId = null;
            currentModelSource = null;
            baselineComparable = false;
            trainingStatus = 'ready';
            one('#cloud-model-actions').hidden = true;
            one('#playground-generate').disabled = true;
            one('#playground-model-state').textContent = 'Cloud model deleted';
            setTrainingControls('ready');
            renderRankingChallenge();
            announce('The cloud model and its temporary artifacts were deleted.');
        } catch (error) {
            announce(`Cloud deletion failed: ${error.message}`);
        } finally {
            event.target.disabled = false;
        }
    });

    one('#refresh-models').addEventListener('click', () => refreshSavedModels());
    one('#import-model-button').addEventListener('click', () => {
        one('#import-model-file').click();
    });
    one('#import-model-file').addEventListener('change', async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.microcomp-model')) {
            setLibraryStatus('Import rejected: choose a .microcomp-model file.', true);
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            setLibraryStatus('Import rejected: package exceeds the 20 MiB limit.', true);
            return;
        }
        setLibraryStatus(`Validating checksums and model structure for ${file.name}…`);
        try {
            await trainingClient.importModel(file.name, await file.arrayBuffer());
            await refreshSavedModels(`Imported ${file.name}. All file and tensor checksums were verified.`);
            announce(`${file.name} was imported and verified.`);
        } catch (error) {
            setLibraryStatus(`Import rejected: ${error.message}`, true);
            announce(`Model import failed: ${error.message}`);
        }
    });
    one('#my-models-grid').addEventListener('click', async event => {
        const button = event.target.closest('button[data-model-action]');
        if (!button) return;
        const { modelAction: action, runId } = button.dataset;
        button.disabled = true;
        try {
            if (action === 'load') {
                await loadStoredModel(runId);
            } else if (action === 'rename') {
                const existingName = button.closest('.saved-model-card')
                    .querySelector('h4').textContent;
                const name = window.prompt('Model name (1–120 characters)', existingName);
                if (name === null) return;
                await trainingClient.renameSaved(runId, name);
                await refreshSavedModels('Model renamed.');
            } else if (action === 'duplicate') {
                await trainingClient.duplicateSaved(runId);
                await refreshSavedModels('Model duplicated as an independent browser copy.');
            } else if (action === 'export') {
                setLibraryStatus('Building a checksum-verified portable package…');
                const exported = await trainingClient.exportSaved(runId);
                const url = URL.createObjectURL(new Blob(
                    [exported.bytes], { type: 'application/zip' }
                ));
                const link = document.createElement('a');
                link.href = url;
                link.download = exported.fileName;
                link.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                setLibraryStatus(`Exported ${exported.fileName} with the canonical five-file layout.`);
            } else if (action === 'delete') {
                const name = button.closest('.saved-model-card')
                    .querySelector('h4').textContent;
                if (!window.confirm(`Delete “${name}” from this browser? This cannot be undone unless you exported a copy.`)) return;
                await trainingClient.deleteSaved(runId);
                if (currentRunId === runId) {
                    currentRunId = null;
                    trainingStatus = 'ready';
                    currentModelSource = null;
                    baselineComparable = false;
                    one('#playground-generate').disabled = true;
                    one('#playground-model-state').textContent = 'Train or load a model';
                    one('#generated-output').textContent =
                        'The loaded model was deleted. Train or load another model.';
                    renderRankingChallenge();
                }
                await refreshSavedModels('Model deleted from this browser.');
            }
        } catch (error) {
            setLibraryStatus(
                `${action[0].toUpperCase()}${action.slice(1)} failed: ${error.message}`,
                true
            );
        } finally {
            button.disabled = false;
        }
    });

    window.addEventListener('pagehide', () => {
        if (replayTimer !== null) window.clearInterval(replayTimer);
        cloudClient.disconnect();
        trainingClient.dispose();
    }, { once: true });
    window.addEventListener('pageshow', () => {
        // Browsers may restore form control values after DOMContentLoaded.
        // Recalculate every message that depends on those restored values.
        renderTokenization();
        updatePromptGuidance();
        updateTrainingExpectation(Number(one('#training-steps').value) || 1);
    });
    renderDataset();
    one('#ranking-challenge').replaceChildren(...rankingChallenges.map(
        (challenge, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = `Challenge ${index + 1}: ${challenge.alert
                .replace(/^alert:\s*/, '').replace(/\.$/, '')}`;
            return option;
        }
    ));
    renderTokenization();
    renderArchitecture();
    updateTrainingExpectation(Number(one('#training-steps').value));
    setTrainingControls('ready');
    renderRankingChallenge();
    refreshSavedModels();
    const requestedStage = stageNames.findIndex(name => (
        `#stage-${name.toLowerCase().replace(/\s+/g, '-')}` === window.location.hash
    ));
    showStage(requestedStage >= 0 ? requestedStage : 0, { announce: false });
});
