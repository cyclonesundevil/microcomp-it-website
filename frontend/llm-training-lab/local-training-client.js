'use strict';

(function exposeLocalTrainingClient(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompLocalTrainingClient = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createClientApi() {
    const PROTOCOL_VERSION = '1.0';

    class LocalTrainingClient {
        constructor(workerUrl) {
            this.worker = new Worker(workerUrl);
            this.pending = new Map();
            this.listeners = new Set();
            this.sequence = 0;
            this.worker.addEventListener('message', event => this.handleMessage(event.data));
            this.worker.addEventListener('error', event => {
                const error = new Error(event.message || 'The training worker failed.');
                this.pending.forEach(item => item.reject(error));
                this.pending.clear();
                this.listeners.forEach(listener => listener({
                    runId: null,
                    eventType: 'WORKER_FAILED',
                    data: { name: error.name, message: error.message }
                }));
            });
        }

        handleMessage(message) {
            if (message?.type === 'TRAINING_EVENT') {
                this.listeners.forEach(listener => listener(message.payload));
                return;
            }
            const waiting = this.pending.get(message?.requestId);
            if (!waiting) return;
            this.pending.delete(message.requestId);
            if (message.type === 'ERROR') {
                waiting.reject(new Error(message.payload?.message || 'Worker request failed.'));
            } else {
                waiting.resolve(message.payload);
            }
        }

        request(type, payload = {}) {
            this.sequence += 1;
            const requestId = `training-ui-${this.sequence}`;
            return new Promise((resolve, reject) => {
                this.pending.set(requestId, { resolve, reject });
                this.worker.postMessage({
                    protocolVersion: PROTOCOL_VERSION,
                    requestId,
                    type,
                    payload
                });
            });
        }

        onTrainingEvent(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }

        start(payload) { return this.request('START_TRAINING', payload); }
        pause(runId) { return this.request('PAUSE_TRAINING', { runId }); }
        resume(runId) { return this.request('RESUME_TRAINING', { runId }); }
        cancel(runId) { return this.request('CANCEL_TRAINING', { runId }); }
        state(runId) { return this.request('GET_TRAINING_STATE', { runId }); }
        listSaved() { return this.request('LIST_SAVED_MODELS'); }
        loadSaved(runId) { return this.request('LOAD_SAVED_MODEL', { runId }); }
        renameSaved(runId, name) {
            return this.request('RENAME_SAVED_MODEL', { runId, name });
        }
        deleteSaved(runId) {
            return this.request('DELETE_SAVED_MODEL', { runId });
        }
        duplicateSaved(runId, name) {
            return this.request('DUPLICATE_SAVED_MODEL', { runId, name });
        }
        exportSaved(runId) {
            return this.request('EXPORT_SAVED_MODEL', { runId });
        }
        importModel(fileName, bytes) {
            return this.request('IMPORT_MODEL', { fileName, bytes });
        }
        generate(modelId, prompt, options) {
            return this.request('GENERATE', { modelId, prompt, options });
        }
        rankResponses(modelId, payload) {
            return this.request('RANK_RESPONSES', { modelId, ...payload });
        }

        rankResponseSet(modelId, payload) {
            return this.request('RANK_RESPONSE_SET', { modelId, ...payload });
        }

        dispose() {
            this.worker.terminate();
            this.pending.forEach(item => item.reject(new Error('Training client disposed.')));
            this.pending.clear();
            this.listeners.clear();
        }
    }

    return Object.freeze({ LocalTrainingClient, PROTOCOL_VERSION });
}));
