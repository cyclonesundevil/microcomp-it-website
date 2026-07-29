'use strict';

(function exposeTrainingStorage(root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompTrainingStorage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTrainingStorage(root) {
    const DATABASE_NAME = 'microcomp-llm-training-lab';
    const DATABASE_VERSION = 2;
    const MODEL_STORE = 'completed-models';

    function requestPromise(request) {
        return new Promise((resolve, reject) => {
            request.addEventListener('success', () => resolve(request.result), { once: true });
            request.addEventListener('error', () => reject(
                request.error || new Error('IndexedDB request failed.')
            ), { once: true });
        });
    }

    function openDatabase() {
        if (!root.indexedDB) {
            return Promise.reject(new Error('IndexedDB is unavailable in this worker.'));
        }
        const request = root.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.addEventListener('upgradeneeded', () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(MODEL_STORE)) {
                database.createObjectStore(MODEL_STORE, { keyPath: 'runId' });
            }
        });
        return requestPromise(request);
    }

    function transactionPromise(transaction) {
        return new Promise((resolve, reject) => {
            transaction.addEventListener('complete', resolve, { once: true });
            transaction.addEventListener('abort', () => reject(
                transaction.error || new Error('IndexedDB transaction aborted.')
            ), { once: true });
            transaction.addEventListener('error', () => reject(
                transaction.error || new Error('IndexedDB transaction failed.')
            ), { once: true });
        });
    }

    function previewText(record) {
        if (typeof record.previewText === 'string') return record.previewText;
        const snapshots = Array.isArray(record.snapshots) ? record.snapshots : [];
        return [...snapshots].reverse().find(item => item?.sample)?.sample || '';
    }

    function estimatedSize(record) {
        if (Number.isInteger(record.packageSizeBytes) && record.packageSizeBytes >= 0) {
            return record.packageSizeBytes;
        }
        const tensorBytes = Object.values(record.tensors || {}).reduce(
            (sum, tensor) => sum + (tensor?.byteLength || 0), 0
        );
        const metadata = JSON.stringify({
            configuration: record.configuration,
            tokenizer: record.tokenizer,
            training: record.training,
            finalMetrics: record.finalMetrics,
            history: record.history,
            snapshots: record.snapshots
        });
        return tensorBytes + new TextEncoder().encode(metadata).length;
    }

    function metadata(record) {
        return {
            runId: record.runId,
            name: record.name || `Tiny LLM ${record.completedAt.slice(0, 10)}`,
            dataset: record.datasetIdentifier || 'cybersecurity-alerts-v1',
            completedAt: record.completedAt,
            parameterCount: record.parameterCount,
            trainingSteps: record.finalMetrics?.step ?? record.training?.steps ?? 0,
            validationLoss: record.finalMetrics?.validationLoss ?? null,
            sizeBytes: estimatedSize(record),
            previewText: previewText(record),
            snapshotCount: Array.isArray(record.snapshots) ? record.snapshots.length : 0,
            configuration: record.configuration
        };
    }

    async function saveCompletedRun(run) {
        if (!run || run.status !== 'completed' || !run.completedAt
            || !run.tensors || typeof run.tensors !== 'object') {
            throw new Error('Only a completed training run may be persisted.');
        }
        const database = await openDatabase();
        try {
            const transaction = database.transaction(MODEL_STORE, 'readwrite');
            const completed = transactionPromise(transaction);
            const store = transaction.objectStore(MODEL_STORE);
            const normalized = {
                ...run,
                name: run.name || `Tiny LLM ${run.completedAt.slice(0, 10)}`,
                previewText: previewText(run)
            };
            store.put(normalized);
            await completed;
        } finally {
            database.close();
        }
        return metadata(run);
    }

    async function listCompletedRuns() {
        const database = await openDatabase();
        try {
            const records = await requestPromise(
                database.transaction(MODEL_STORE, 'readonly')
                    .objectStore(MODEL_STORE)
                    .getAll()
            );
            return records.filter(record => record.status === 'completed')
                .map(metadata)
                .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
        } finally {
            database.close();
        }
    }

    async function loadCompletedRun(runId) {
        const database = await openDatabase();
        try {
            const record = await requestPromise(
                database.transaction(MODEL_STORE, 'readonly')
                    .objectStore(MODEL_STORE)
                    .get(runId)
            );
            if (!record || record.status !== 'completed') {
                throw new Error(`Completed model was not found: ${runId}.`);
            }
            return record;
        } finally {
            database.close();
        }
    }

    async function renameCompletedRun(runId, name) {
        const normalizedName = String(name ?? '').trim();
        if (!normalizedName || normalizedName.length > 120) {
            throw new Error('Model name must contain 1 to 120 characters.');
        }
        const database = await openDatabase();
        try {
            const transaction = database.transaction(MODEL_STORE, 'readwrite');
            const completed = transactionPromise(transaction);
            const store = transaction.objectStore(MODEL_STORE);
            const record = await requestPromise(store.get(runId));
            if (!record || record.status !== 'completed') {
                throw new Error(`Completed model was not found: ${runId}.`);
            }
            record.name = normalizedName;
            store.put(record);
            await completed;
            return metadata(record);
        } finally {
            database.close();
        }
    }

    async function deleteCompletedRun(runId) {
        const database = await openDatabase();
        try {
            const transaction = database.transaction(MODEL_STORE, 'readwrite');
            const completed = transactionPromise(transaction);
            const store = transaction.objectStore(MODEL_STORE);
            const record = await requestPromise(store.get(runId));
            if (!record || record.status !== 'completed') {
                throw new Error(`Completed model was not found: ${runId}.`);
            }
            store.delete(runId);
            await completed;
            return { runId };
        } finally {
            database.close();
        }
    }

    async function duplicateCompletedRun(runId, duplicateRunId, name) {
        const source = await loadCompletedRun(runId);
        const duplicate = typeof structuredClone === 'function'
            ? structuredClone(source)
            : source;
        duplicate.runId = duplicateRunId;
        duplicate.name = name || `${source.name || 'Tiny LLM'} copy`;
        duplicate.completedAt = new Date().toISOString();
        duplicate.importedAt = undefined;
        await saveCompletedRun(duplicate);
        return metadata(duplicate);
    }

    return Object.freeze({
        DATABASE_NAME,
        MODEL_STORE,
        deleteCompletedRun,
        duplicateCompletedRun,
        listCompletedRuns,
        loadCompletedRun,
        metadata,
        renameCompletedRun,
        saveCompletedRun
    });
}));
