'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'frontend/demo-lab/cybersecurity-simulation.html'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'frontend/cyber-lab.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'frontend/cyber-lab-engine.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend/cyber-lab.css'), 'utf8');
const homePage = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const sharedStyles = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
const promoStyles = fs.readFileSync(path.join(root, 'frontend/homepage-cyber-promo.css'), 'utf8');
const analytics = fs.readFileSync(path.join(root, 'frontend/analytics.js'), 'utf8');

function contrastRatio(foreground, background) {
    const luminance = hex => {
        const channels = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
        const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
    };
    const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

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
        const surfaces = `${controller}\n${page}\n${styles}\n${engine}`;
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
    assert.ok(page.includes('id="motion-status"'));
    assert.ok(controller.includes('Static flow view enabled'));
    assert.match(styles, /\.reduce-motion/);
    assert.match(styles, /prefers-reduced-motion/);
});

test('shared defense effects have visible strip, node badges, and distinct visual semantics', () => {
    ['id="defense-effect-strip"', 'renderDefenseEffects', 'defenseEffectsForHost',
        'flow-interrupted', 'flow-offloaded', 'flow-capacity', 'flow-protected', 'flow-detected',
        'effect-preventive', 'effect-detective', 'effect-resilience'
    ].forEach(marker => {
        assert.ok(`${page}\n${controller}\n${styles}`.includes(marker), `missing defense visual: ${marker}`);
    });
});

test('Phase 3 network scenarios expose dedicated outcomes, guidance, visuals, and reports', () => {
    [
        'SPECIALIZED_SCENARIO_PROFILES', 'stepMitm', 'stepPassword', 'stepEavesdropping',
        'routeIntegrity', 'certificateStatus', 'successfulTakeovers', 'encryptedPackets',
        'networkOutcomeMetrics', 'observableEvidence'
    ].forEach(marker => assert.ok(engine.includes(marker), `engine missing Phase 3 marker: ${marker}`));
    [
        'id="scenario-outcome-strip"', 'id="metric-rps-label"', 'id="metric-allowed-label"',
        'id="metric-server-label"', 'id="metric-blocked-label"'
    ].forEach(marker => assert.ok(page.includes(marker), `page missing Phase 3 surface: ${marker}`));
    [
        'renderScenarioOutcomes', 'scenarioGuidance', 'Scenario-specific outcomes',
        'Route integrity', 'Prevented takeovers', 'Content visibility'
    ].forEach(marker => assert.ok(controller.includes(marker), `controller missing Phase 3 surface: ${marker}`));
    assert.match(styles, /\.scenario-outcome-strip/);
    assert.match(styles, /\.scenario-outcome/);
});

test('Phase 4 web and identity scenarios expose safe domain models and mock inbox UI', () => {
    [
        'stepSqli', 'stepXss', 'stepPhishing', 'markedRequests', 'recordsAtRisk',
        'unsafeRenders', 'sessionsAtRisk', 'mockMessages', 'protectedIdentities',
        'inert: true'
    ].forEach(marker => assert.ok(engine.includes(marker), `engine missing Phase 4 marker: ${marker}`));
    assert.ok(page.includes('id="mock-inbox"'));
    [
        'Mock inbox · inert metadata only', 'mock-message', 'Request handling',
        'Browser policy', 'Campaign variant'
    ].forEach(marker => assert.ok(controller.includes(marker), `controller missing Phase 4 UI: ${marker}`));
    assert.match(styles, /\.mock-inbox/);
    assert.match(styles, /\.mock-message/);
});

test('password spraying renders every active fictional source and routes it to identity', () => {
    [
        "const actorTarget = state.scenario.id === 'password' ? 'identity' : ingress",
        'passwordSourceCount', 'actorVisible', 'sourceNumber <= passwordSourceCount',
        "['actor2', actorTarget]", "['actor5', actorTarget]"
    ].forEach(marker => assert.ok(controller.includes(marker), `missing password topology behavior: ${marker}`));
});

test('Phase 5 organizational scenarios expose dedicated engines and seven-stage APT UI', () => {
    [
        'stepMalware', 'stepInsider', 'stepZeroDay', 'stepApt',
        'infectedEndpoints', 'baselineDeviations', 'signatureMisses',
        'completedStages', 'exfiltrationBlocked', '`APT_${stage.toUpperCase()'
    ].forEach(marker => assert.ok(engine.includes(marker), `engine missing Phase 5 marker: ${marker}`));
    [
        "s.phases.length * 4", 'Malware profile', 'Insider variant',
        'Signature status', 'APT stage', 'Exfiltrated units'
    ].forEach(marker => assert.ok(controller.includes(marker), `controller missing Phase 5 UI: ${marker}`));
    [
        'Initial access', 'Persistence', 'Discovery', 'Privilege expansion',
        'Lateral movement', 'Collection', 'Exfiltration outcome'
    ].forEach(stage => assert.ok(engine.includes(stage), `APT stage missing: ${stage}`));
});

test('malware profile UI exposes beginner briefing, bounded paths, metrics, and static summaries', () => {
    [
        'MALWARE_PROFILES', 'malwareProfileForSeed',
        'Ransomware-like', 'Worm-like', 'Credential-stealing', 'Botnet-like',
        "['workstation', 'files', 'database']", "['web', 'workstation', 'files']",
        "['workstation', 'identity', 'web']", "['workstation', 'edge', 'internet']",
        'Initial infection', 'Local execution', 'Discovery',
        'Attempted spread or access', 'Infrastructure impact', 'Containment or recovery',
        'outcomeExplanation', 'systemsTargeted', 'systemsAffected', 'systemsProtected'
    ].forEach(marker => assert.ok(engine.includes(marker), `engine missing malware profile marker: ${marker}`));
    [
        'malwareMetricLabels', 'malwareOutcomeValues',
        'Initial infection:', 'Path:', 'Affected:', 'Protected:',
        'Synthetic files affected', 'Unauthorized access', 'Abnormal outbound flows',
        'state.scenarioState?.profileId', 'initial-infection', 'initial infection point'
    ].forEach(marker => assert.ok(controller.includes(marker), `controller missing malware profile UI: ${marker}`));
    assert.match(styles, /\.topology-node\.initial-infection::before/);
    assert.match(styles, /content: "INITIAL"/);
    assert.match(controller, /Static flow view enabled/);
});

test('cyber lab light theme uses explicit high-contrast text, surfaces, and controls', () => {
    [
        '--cyber-text: #102a43', '--cyber-cyan: #00695c', '--cyber-blue: #005a9c',
        '--cyber-red: #a51d36', 'color: var(--cyber-text)',
        '.cyber-lab-page .cyber-hero h1',
        ':root[data-theme="light"] .scenario-card.selected',
        ':root[data-theme="light"] .lab-panel',
        ':root[data-theme="light"] .topology-node',
        ':root[data-theme="light"] .playback .action-primary',
        ':root[data-theme="light"] .report-score'
    ].forEach(marker => assert.ok(styles.includes(marker), `light theme missing contrast rule: ${marker}`));
    assert.doesNotMatch(styles, /color:\s*var\(--text-color,\s*#f7fbff\)/);
    assert.ok(page.includes('cyber-lab.css?v=1.5'), 'light theme stylesheet cache version was not updated');
});

test('light topology communicates penetration with color and non-color cues', () => {
    [
        'Penetration risk', 'Attack activity reached an at-risk asset',
        'Controlled', 'Observed', 'aria-label="Topology status legend"'
    ].forEach(marker => assert.ok(page.includes(marker), `topology legend missing: ${marker}`));
    [
        '.topology-node.status-at-risk::after', 'content: "AT RISK"',
        ':root[data-theme="light"] .flow-links .severity-high',
        'stroke: #a51d36', 'stroke-width: 2.8',
        ':root[data-theme="light"] .topology-node.status-at-risk',
        'background: #fff0f3', 'border: 3px solid #a51d36'
    ].forEach(marker => assert.ok(styles.includes(marker), `light penetration cue missing: ${marker}`));
});

test('paused and completed simulations freeze flow animation and explain the static state', () => {
    [
        "topology.classList.toggle('is-paused', state.status === 'paused')",
        "topology.classList.toggle('is-complete', state.status === 'complete')",
        'Simulation paused. Flow paths are frozen and no attack activity is advancing.',
        'Simulation complete. Flow paths are stopped at the final recorded state.',
        'Paths move only while the simulation is running.'
    ].forEach(marker => assert.ok(controller.includes(marker), `controller missing lifecycle motion cue: ${marker}`));
    [
        '.topology.is-paused .flow-links line',
        '.topology.is-complete .flow-links line',
        'animation-play-state: paused'
    ].forEach(marker => assert.ok(styles.includes(marker), `styles missing lifecycle motion cue: ${marker}`));
    assert.ok(page.includes('cyber-lab.js?v=1.2'), 'controller cache version was not updated');
});

test('Demo Lab directory links to the simulation route', () => {
    const directory = fs.readFileSync(path.join(root, 'frontend/demo-lab.html'), 'utf8');
    assert.match(directory, /demo-lab\/cybersecurity-simulation\.html/);
});

test('homepage prominently promotes the cybersecurity simulation lab', () => {
    [
        'class="cyber-lab-promo"', 'Featured interactive experience',
        'See cyberattacks unfold—then stop them.',
        '11 cybersecurity scenarios', '17</strong><span>Defenses',
        'Launch the Cybersecurity Lab',
        'href="demo-lab/cybersecurity-simulation.html"',
        'Defensive learning with no real targets or attack traffic',
        'styles.css?v=2.1', 'homepage-cyber-promo.css?v=1.3'
    ].forEach(marker => assert.ok(homePage.includes(marker), `homepage promotion missing: ${marker}`));
    [
        '.cyber-lab-promo {', '.cyber-lab-promo-visual',
        '.promo-network', '.promo-stat-grid',
        '@media (max-width: 820px)', '@media (max-width: 520px)'
    ].forEach(marker => assert.ok(sharedStyles.includes(marker), `homepage promotion style missing: ${marker}`));
    [
        'body .demo-preview-section > .cyber-lab-promo',
        'grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr)',
        'linear-gradient(135deg, #071523 0%, #0b2534 55%, #0d3040 100%)',
        'body .cyber-lab-promo .cyber-lab-promo-cta',
        'body .cyber-lab-promo .promo-node',
        'position: absolute', 'place-items: center',
        'body .cyber-lab-promo .promo-stat-grid',
        'content: "Attack source"', 'content: "Edge"', 'content: "Defense"',
        'content: "Application"', 'content: "Records"', 'content: "Monitor"',
        '.promo-network-links', '.promo-attack-route', '.promo-protected-route',
        '@keyframes promo-flow', '@media (prefers-reduced-motion: reduce)',
        'body .cyber-lab-promo .cyber-lab-promo-copy',
        'align-content: center', 'gap: 1rem',
        'justify-self: start', 'margin-top: .4rem',
        '@media (max-width: 900px)', '@media (max-width: 560px)'
    ].forEach(marker => assert.ok(promoStyles.includes(marker), `scoped homepage promotion style missing: ${marker}`));
});

test('Phase 6 accessibility semantics expose state without relying on visual inspection', () => {
    [
        'id="run-status" class="status-pill" role="status" aria-live="polite"',
        'aria-label="Topology status legend"', 'aria-live="polite"',
        'class="visually-hidden" aria-live="polite"'
    ].forEach(marker => assert.ok(page.includes(marker), `page missing accessibility state: ${marker}`));
    [
        'aria-current="true"', "setAttribute('aria-pressed'",
        'Resume simulation activity', 'Pause simulation activity',
        'Simulation paused. Flow paths are frozen',
        'Simulation complete. Flow paths are stopped'
    ].forEach(marker => assert.ok(controller.includes(marker), `controller missing accessibility state: ${marker}`));
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'page IDs must be unique');
});

test('Phase 6 static production route resolves every local stylesheet and script', () => {
    const references = [...page.matchAll(/(?:href|src)="([^"]+\.(?:css|js|svg)(?:\?[^"]*)?)"/g)]
        .map(match => match[1])
        .filter(reference => !reference.startsWith('http'));
    references.forEach(reference => {
        const clean = reference.split('?')[0];
        const resolved = path.resolve(root, 'frontend/demo-lab', clean);
        assert.ok(fs.existsSync(resolved), `missing local asset: ${reference}`);
    });
});

test('UI audit remediation uses contrast-safe primary button states in both themes', () => {
    assert.ok(contrastRatio('03131a', '00f0ff') >= 4.5, 'dark-theme normal button contrast must pass');
    assert.ok(contrastRatio('03131a', '5ff7ff') >= 4.5, 'dark-theme hover button contrast must pass');
    assert.ok(contrastRatio('03131a', '00b9c7') >= 4.5, 'dark-theme active button contrast must pass');
    assert.ok(contrastRatio('ffffff', '047b91') >= 4.5, 'light-theme normal button contrast must pass');
    assert.ok(contrastRatio('ffffff', '03687c') >= 4.5, 'light-theme hover button contrast must pass');
    assert.ok(contrastRatio('ffffff', '02576a') >= 4.5, 'light-theme active button contrast must pass');
    [
        '--primary-button-text', '--primary-button-hover', '--primary-button-active',
        '.btn-primary:focus-visible', 'outline: 3px solid',
        '.btn-primary:disabled', '.btn-primary[aria-disabled="true"]'
    ].forEach(marker => assert.ok(sharedStyles.includes(marker), `missing primary-button state: ${marker}`));
});

test('UI audit remediation preserves topology controls with valid group semantics', () => {
    assert.match(page, /id="topology" class="topology" role="group" aria-labelledby="topology-title" aria-describedby="topology-summary motion-status"/);
    assert.doesNotMatch(page, /id="topology"[^>]+role="img"/);
    assert.doesNotMatch(controller, /topology\.setAttribute\('aria-label'/);
    assert.match(controller, /<button class="topology-node/);
    assert.match(controller, /aria-hidden="true"/);
});

test('UI audit remediation uses native named metric and filter groups', () => {
    assert.match(page, /<section class="metric-grid" aria-labelledby="current-metrics-title">/);
    assert.match(page, /<h3 id="current-metrics-title" class="visually-hidden">Current metrics<\/h3>/);
    assert.match(page, /<fieldset class="filters"><legend class="visually-hidden">Traffic filters<\/legend>/);
    assert.doesNotMatch(page, /class="metric-grid" aria-label=/);
    assert.doesNotMatch(page, /class="filters" aria-label=/);
});

test('UI audit remediation disables analytics only on unsupported local environments', () => {
    assert.match(analytics, /new Set\(\['localhost', '127\.0\.0\.1', '\[::1\]'\]\)/);
    assert.match(analytics, /window\.location\.protocol === 'file:'/);
    assert.match(analytics, /unsupportedDevelopmentHosts\.has\(window\.location\.hostname\)/);
    assert.match(analytics, /navigator\.sendBeacon\('\/api\/track'/);
});
