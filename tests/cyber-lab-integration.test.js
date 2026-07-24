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
        'id="report-content"', 'aria-live="polite"', 'id="reduced-motion"',
        'id="attack-type"', 'id="recovery"', 'id="metric-allowed"', 'id="metric-server-rps"', 'id="metric-blocked"'
    ].forEach(marker => assert.ok(page.includes(marker), `missing ${marker}`));
});

test('lab prominently labels all activity simulated', () => {
    assert.match(page, /All attacks, hosts, traffic, logs, credentials, and outcomes are simulated/);
    assert.match(page, /does not send attack traffic or connect to external targets/);
});

test('controller has no outbound network API use', () => {
    assert.doesNotMatch(controller, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

test('controller wires the reference playback and configuration interactions', () => {
    ['#start', '#pause', '#step', '#reset', '#replay', '#speed', '#difficulty', '#mode', '#attack-type', '#recovery', '#reduced-motion'].forEach(selector => {
        assert.ok(controller.includes(selector), `controller missing ${selector}`);
    });
    assert.match(controller, /type:\s*'PAUSE'/);
    assert.match(controller, /type:\s*'RESUME'/);
    assert.match(controller, /advance\('STEP'\)/);
});

test('DoS UI explains all six guided learning checkpoints', () => {
    ['DDoS uses several fictional sources', 'queueing raises latency', 'service effectively unavailable',
        'Rate limiting rejects requests', 'Autoscaling adds capacity', 'Layered defenses work'
    ].forEach(copy => assert.ok(controller.includes(copy), `missing guide copy: ${copy}`));
});

test('upstream protection is visible in topology, metrics, events, and report rendering', () => {
    ['upstream-node', 'topology-counter', 'flow-interrupted', 'metric-server-rps',
        'upstreamTrafficFiltered', 'availabilityImprovement', 'DEFENSE_TRIGGERED'
    ].forEach(marker => {
        const surfaces = `${controller}\n${page}\n${fs.readFileSync(path.join(root, 'frontend/cyber-lab.css'), 'utf8')}`;
        assert.ok(surfaces.includes(marker), `missing upstream surface: ${marker}`);
    });
});

test('shared controls use reducer lifecycle and pure filtering/export helpers', () => {
    ["type: 'START'", "type: actionType", "advance('STEP')", 'E.filterEvents', 'E.serializeReportJson',
        'E.serializeReportCsv', 'E.compareReports', 'clearTransientUi'
    ].forEach(marker => assert.ok(controller.includes(marker), `missing shared control path: ${marker}`));
    assert.doesNotMatch(controller, /state\.status\s*=\s*['"](?:running|paused)['"]/);
});

test('speed changes scheduler timing without advancing virtual state', () => {
    const speedHandler = controller.slice(controller.indexOf("$('#speed').addEventListener"), controller.indexOf("$('#start').addEventListener"));
    assert.match(speedHandler, /setInterval/);
    assert.doesNotMatch(speedHandler, /advance\s*\(/);
});

test('reduced motion keeps a textual static-flow explanation', () => {
    const css = fs.readFileSync(path.join(root, 'frontend/cyber-lab.css'), 'utf8');
    assert.ok(page.includes('id="motion-status"'));
    assert.ok(controller.includes('Static flow view enabled'));
    assert.match(css, /\.reduce-motion/);
    assert.match(css, /prefers-reduced-motion/);
});

test('Demo Lab directory links to the simulation route', () => {
    const directory = fs.readFileSync(path.join(root, 'frontend/demo-lab.html'), 'utf8');
    assert.match(directory, /demo-lab\/cybersecurity-simulation\.html/);
});
