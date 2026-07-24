'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'frontend/demo-lab/cybersecurity-simulation.html'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'frontend/cyber-lab.js'), 'utf8');

test('lab route includes core playback, accessibility, visualization, and report surfaces', () => {
    ['id="start"', 'id="pause"', 'id="step"', 'id="reset"', 'id="replay"',
        'id="topology"', 'id="flow-table"', 'id="alert-list"', 'id="defense-list"',
        'id="report-content"', 'aria-live="polite"', 'id="reduced-motion"'
    ].forEach(marker => assert.ok(page.includes(marker), `missing ${marker}`));
});

test('lab prominently labels all activity simulated', () => {
    assert.match(page, /All attacks, hosts, traffic, logs, credentials, and outcomes are simulated/);
    assert.match(page, /does not send attack traffic or connect to external targets/);
});

test('controller has no outbound network API use', () => {
    assert.doesNotMatch(controller, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

test('Demo Lab directory links to the simulation route', () => {
    const directory = fs.readFileSync(path.join(root, 'frontend/demo-lab.html'), 'utf8');
    assert.match(directory, /demo-lab\/cybersecurity-simulation\.html/);
});
