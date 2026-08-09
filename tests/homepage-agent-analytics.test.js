'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const analytics = read('frontend/analytics.js');
const app = read('frontend/app.js');
const homepage = read('frontend/index.html');
const backend = read('backend/app.py');

test('homepage agent funnel emits privacy-safe interaction events', () => {
    for (const eventName of [
        'chat_open',
        'chat_close',
        'persona_change',
        'chat_message_sent',
        'chat_response',
        'voice_start',
        'voice_connected',
        'voice_end',
        'voice_error'
    ]) {
        assert.match(app, new RegExp(`trackAgentEvent\\('${eventName}'`));
    }
    assert.match(app, /category: 'homepage_agent'/);
    assert.match(app, /responseTimeMs/);
    assert.doesNotMatch(app, /trackAgentEvent\([^;]+(?:text|data\.response)/s);
});

test('shared analytics exposes a bounded custom-event transport', () => {
    assert.match(analytics, /window\.microcompTrack = sendInteraction/);
    assert.match(analytics, /eventType: 'interaction'/);
    assert.match(analytics, /'category', 'persona', 'source', 'outcome', 'messageNumber', 'responseTimeMs', 'errorType'/);
    assert.doesNotMatch(analytics, /prompt|messageText|responseText|history/);
    assert.match(homepage, /analytics\.js\?v=1\.1/);
    assert.match(homepage, /app\.js\?v=1\.8/);
});

test('backend stores and reports agent event metadata without conversation content', () => {
    assert.match(backend, /\{"active_time", "time_spent", "interaction"\}/);
    for (const column of [
        'event_name',
        'event_category',
        'event_persona',
        'event_source',
        'event_outcome',
        'event_value'
    ]) {
        assert.match(backend, new RegExp(`\\("${column}"`));
    }
    assert.match(backend, /Homepage Agent Engagement/);
    assert.match(backend, /Visitor prompts and assistant responses are never stored in analytics/);
    assert.match(backend, /event_category = 'homepage_agent'/);
});
