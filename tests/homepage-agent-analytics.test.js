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
    assert.match(homepage, /analytics\.js\?v=1\.2/);
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

test('contact submissions cannot leak message fields into analytics paths', () => {
    assert.match(homepage, /<form id="contact-form"[^>]*method="post"[^>]*action="\/api\/contact"/);
    assert.match(analytics, /return window\.location\.pathname/);
    assert.doesNotMatch(analytics, /window\.location\.search/);
    assert.match(backend, /def sanitized_analytics_path/);
    assert.match(backend, /sanitized_analytics_path\(req_data\.get\('path'\)\)/);
    assert.match(backend, /elif index == path_index:/);
    assert.match(backend, /sanitized_referrer\(value\)/);
});

test('admin distinguishes contact filtering and delivery without storing message bodies', () => {
    assert.match(backend, /CREATE TABLE IF NOT EXISTS contact_events/);
    assert.match(backend, /Contact Form Delivery/);
    assert.match(backend, /record_contact_event\(submission_id, "filtered"/);
    assert.match(backend, /record_contact_event\([\s\S]*?"delivered"/);
    assert.match(backend, /Names, full email addresses, and message contents are not stored here/);
});
