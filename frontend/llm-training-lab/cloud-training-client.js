'use strict';

(function exposeCloudTrainingClient(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MicroCompCloudTrainingClient = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCloudClientApi() {
    const TERMINAL_STATES = new Set(['completed', 'cancelled', 'expired']);

    function normalizeBaseUrl(value) {
        const url = new URL(String(value || '').trim());
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error('Cloud service URL must use HTTP or HTTPS.');
        }
        url.pathname = url.pathname.replace(/\/+$/, '');
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    }

    async function responseError(response) {
        let detail = `Cloud request failed (${response.status}).`;
        try {
            const body = await response.json();
            if (typeof body.detail === 'string') detail = body.detail;
            else if (Array.isArray(body.detail)) {
                detail = body.detail.map(item => item.msg || 'Invalid request.').join(' ');
            }
        } catch (_error) {
            // A non-JSON proxy error still receives a safe status message.
        }
        return new Error(detail);
    }

    function parseSseBlock(block) {
        let id = null;
        let event = 'message';
        const data = [];
        block.split(/\r?\n/).forEach(line => {
            if (line.startsWith(':')) return;
            const separator = line.indexOf(':');
            const field = separator < 0 ? line : line.slice(0, separator);
            const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
            if (field === 'id') id = Number(value);
            if (field === 'event') event = value;
            if (field === 'data') data.push(value);
        });
        if (!data.length) return null;
        return { id, event, data: JSON.parse(data.join('\n')) };
    }

    class CloudTrainingClient {
        constructor(fetchImplementation = globalThis.fetch) {
            if (typeof fetchImplementation !== 'function') {
                throw new Error('This browser does not provide Fetch API support.');
            }
            this.fetch = fetchImplementation;
            this.baseUrl = null;
            this.apiKey = null;
            this.sessionToken = null;
            this.sessionId = null;
            this.streamController = null;
        }

        get connected() {
            return Boolean(this.baseUrl && this.apiKey && this.sessionToken);
        }

        async connect(baseUrl, apiKey) {
            this.disconnect();
            this.baseUrl = normalizeBaseUrl(baseUrl);
            this.apiKey = String(apiKey || '');
            if (this.apiKey.length < 24) {
                this.disconnect();
                throw new Error('The cloud access key must contain at least 24 characters.');
            }
            const response = await this.fetch(`${this.baseUrl}/v1/sessions`, {
                method: 'POST',
                headers: { 'X-API-Key': this.apiKey }
            });
            if (!response.ok) {
                const error = await responseError(response);
                this.disconnect();
                throw error;
            }
            const session = await response.json();
            this.sessionToken = session.session_token;
            this.sessionId = session.session_id;
            return session;
        }

        disconnect() {
            this.stopEvents();
            this.baseUrl = null;
            this.apiKey = null;
            this.sessionToken = null;
            this.sessionId = null;
        }

        headers(json = false) {
            if (!this.connected) throw new Error('Connect to the cloud service first.');
            return {
                'X-API-Key': this.apiKey,
                Authorization: `Bearer ${this.sessionToken}`,
                ...(json ? { 'Content-Type': 'application/json' } : {})
            };
        }

        async request(path, options = {}) {
            const response = await this.fetch(`${this.baseUrl}${path}`, {
                ...options,
                headers: { ...this.headers(Boolean(options.body)), ...(options.headers || {}) }
            });
            if (!response.ok) throw await responseError(response);
            if (response.status === 204) return null;
            return response.json();
        }

        createJob(payload) {
            return this.request('/v1/jobs', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }

        status(jobId) {
            return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`);
        }

        cancel(jobId) {
            return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
                method: 'POST'
            });
        }

        generate(jobId, payload) {
            return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/generate`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }

        delete(jobId) {
            return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, {
                method: 'DELETE'
            });
        }

        async download(jobId) {
            const response = await this.fetch(
                `${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/download`,
                { headers: this.headers(false) }
            );
            if (!response.ok) throw await responseError(response);
            const disposition = response.headers.get('content-disposition') || '';
            const match = disposition.match(/filename="?([^";]+)"?/i);
            return {
                fileName: match?.[1] || `microcomp-cloud-${jobId}.microcomp-model`,
                bytes: await response.arrayBuffer()
            };
        }

        stopEvents() {
            if (this.streamController) this.streamController.abort();
            this.streamController = null;
        }

        async streamEvents(jobId, listener, lastEventId = 0) {
            this.stopEvents();
            const controller = new AbortController();
            this.streamController = controller;
            const response = await this.fetch(
                `${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/events`,
                {
                    headers: {
                        ...this.headers(false),
                        'Last-Event-ID': String(lastEventId)
                    },
                    signal: controller.signal
                }
            );
            if (!response.ok) throw await responseError(response);
            if (!response.body?.getReader) {
                throw new Error('Streaming cloud progress is not supported by this browser.');
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
                    const blocks = buffer.split(/\r?\n\r?\n/);
                    buffer = blocks.pop() || '';
                    for (const block of blocks) {
                        const event = parseSseBlock(block);
                        if (!event) continue;
                        listener(event);
                        if (event.event === 'state'
                            && TERMINAL_STATES.has(event.data.state)) return event;
                    }
                    if (done) return null;
                }
            } finally {
                if (this.streamController === controller) this.streamController = null;
                reader.releaseLock();
            }
        }
    }

    return Object.freeze({
        CloudTrainingClient,
        normalizeBaseUrl,
        parseSseBlock,
        TERMINAL_STATES
    });
}));
