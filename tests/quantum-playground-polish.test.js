import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    CHSH_MAX_VIOLATION_PRESET,
    createChshConfiguration,
    createPolarizationSingletDistribution
} from '../frontend/quantum-playground-model.mjs';
import {
    REALITY_GRID_SCENARIOS,
    createRealityCandidate,
    evaluateOperationalNoSignaling
} from '../frontend/quantum-reality-model.mjs';

const page = readFileSync(new URL('../frontend/quantum-playground.html', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../frontend/quantum-playground.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend/quantum-playground.css', import.meta.url), 'utf8');
const realityModel = readFileSync(new URL('../frontend/quantum-reality-model.mjs', import.meta.url), 'utf8');

const close = (actual, expected, tolerance = 1e-12) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);

test('Phase 6 through 8 numerical reference fixtures remain unchanged', () => {
    const singlet = createPolarizationSingletDistribution({ aliceAngleDeg: 13, bobAngleDeg: 71 });
    close(singlet.correlation, -Math.cos(2 * (13 - 71) * Math.PI / 180));
    const quantum = createChshConfiguration({ model: 'quantum', ...CHSH_MAX_VIOLATION_PRESET });
    const local = createChshConfiguration({ model: 'local', ...CHSH_MAX_VIOLATION_PRESET });
    close(quantum.expectedS, -2 * Math.sqrt(2));
    close(local.expectedS, -2);
});

test('finite no-signaling evidence retains deltas and approximate uncertainty', () => {
    const summaries = REALITY_GRID_SCENARIOS.map(scenario => ({
        scenario,
        total: 100,
        correlation: scenario.targetCorrelation,
        alicePlus: 0.5,
        bobPlus: 0.5
    }));
    const result = evaluateOperationalNoSignaling(summaries);
    assert.equal(result.evidence, 'consistent-with-no-signaling');
    close(result.aliceMaxDelta, 0);
    close(result.bobMaxDelta, 0);
    close(result.approximateDifferenceUncertainty, Math.sqrt(0.5 / 100));

    summaries.find(item => item.scenario.aliceAngleDeg === 0 && item.scenario.bobAngleDeg === 90).alicePlus = 0.95;
    const dependent = evaluateOperationalNoSignaling(summaries);
    assert.equal(dependent.evidence, 'detectable-remote-setting-dependence');
    close(dependent.aliceMaxDelta, 0.45);
});

test('Born reference terminology is neutral about physical influence and explicit about factorization', () => {
    const candidate = createRealityCandidate({ mode: 'nonlocal-quantum' });
    assert.equal(candidate.ledger.responseType, 'Quantum Born Joint Reference');
    assert.ok(candidate.ledger.additionalAssumptions.includes('Bell-local hidden-variable factorization is not imposed'));
    assert.ok(candidate.ledger.additionalAssumptions.includes('no physical influence or message between Alice and Bob is simulated'));
    assert.match(page, />Quantum Born Joint Reference</);
    assert.doesNotMatch(page, /Nonlocal Born joint response/i);
});

test('user-facing finite-sample wording avoids proof or binary satisfaction claims', () => {
    assert.match(controller, /Observed marginals are consistent with no-signaling within sampling uncertainty/);
    assert.match(controller, /Detectable remote-setting dependence appears in the sampled local marginals/);
    assert.match(controller, /Born-rule reference is theoretically no-signaling; this finite sample is consistent with that prediction/);
    assert.match(controller, /approx\. difference σ/);
    assert.doesNotMatch(`${page}\n${controller}`, /no-signaling is satisfied|satisfied operationally|violated operationally/i);
    assert.match(page, /not a rigorous p-value or an “N-sigma proof.”/);
});

test('guided progression contains the approved experiment sequence in order', () => {
    const sequence = [
        'single', 'double-slit', 'which-path', 'decoherence',
        'quantum-eraser', 'entanglement', 'bell-test', 'build-reality'
    ];
    let position = -1;
    for (const experiment of sequence) {
        const next = page.indexOf(`data-guide-experiment="${experiment}"`, position + 1);
        assert.ok(next > position, `${experiment} should follow the previous guided step`);
        position = next;
    }
    assert.match(page, /probability, through interference and information, to correlations and tests of classes of physical explanations/);
});

test('every experiment has concise introduction and What am I seeing guidance', () => {
    for (const experiment of ['single', 'double-slit', 'which-path', 'decoherence', 'quantum-eraser', 'entanglement', 'bell-test', 'build-reality']) {
        assert.match(controller, new RegExp(`['"]?${experiment.replace('-', '\\-')}['"]?\\s*:`));
    }
    assert.match(page, /id="quantum-experiment-intro"/);
    assert.match(page, /<summary>What am I seeing\?<\/summary>/);
    assert.match(page, /<p class="quantum-panel-label">Observation<\/p>/);
    assert.match(page, /<p class="quantum-panel-label">Explanation<\/p>/);
    assert.match(page, /<summary>Show the math<\/summary>/);
});

test('accessible glossary covers every required concept with keyboard tooltips', () => {
    const terms = [
        'Superposition', 'Coherence', 'Decoherence', 'Entanglement', 'Bell locality',
        'Measurement independence', 'CHSH', 'No-signaling', 'Hidden variable', 'Born rule'
    ];
    for (const term of terms) {
        assert.match(page, new RegExp(`<dfn tabindex="0"[^>]*>${term}</dfn>`));
    }
    assert.match(styles, /quantum-glossary dfn:focus::after/);
});

test('controls, results, canvas fallback, empty state, and errors are accessible', () => {
    const rangeIds = [...page.matchAll(/<input id="([^"]+)" type="range"/g)].map(match => match[1]);
    assert.ok(rangeIds.length >= 15);
    for (const id of rangeIds) {
        assert.match(page, new RegExp(`<label[^>]*>[\\s\\S]*?<input id="${id}" type="range"`));
    }
    assert.match(controller, /setAttribute\('aria-valuetext'/);
    assert.match(page, /class="quantum-readouts" role="status" aria-live="polite"/);
    assert.match(page, /class="quantum-reality-diagnostics" role="status" aria-live="polite"/);
    assert.match(page, /The calculated numerical results and a textual description/);
    assert.match(page, /id="quantum-empty-state"/);
    assert.match(controller, /The simulation encountered an error/);
});

test('keyboard, focus, reduced motion, contrast modes, and state feedback are explicit', () => {
    assert.match(controller, /ArrowDown/);
    assert.match(controller, /ArrowRight/);
    assert.match(controller, /next\.focus\(\)/);
    assert.match(page, /quantum-skip-link/);
    assert.match(styles, /:focus-visible/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(styles, /animation-duration: 0\.01ms/);
    assert.match(styles, /@media \(forced-colors: active\)/);
    assert.match(controller, /status\.textContent = 'Paused'/);
    assert.match(controller, /status\.textContent = this\.activeState\(\) \? 'Ready'/);
    assert.match(controller, /status\.textContent = 'Error'/);
});

test('educational safeguards reject common misleading claims', () => {
    const copy = `${page}\n${controller}\n${realityModel}`;
    assert.doesNotMatch(copy, /consciousness causes collapse/i);
    assert.doesNotMatch(copy, /measurement sends faster-than-light information/i);
    assert.doesNotMatch(copy, /quantum erasure changes the past/i);
    assert.doesNotMatch(copy, /Bell proves (?:the|one) interpretation/i);
    assert.doesNotMatch(copy, /Born Joint Reference[^\n]{0,120}superluminal/i);
    assert.doesNotMatch(copy, /Monte Carlo[^\n]{0,120}(?:proof|rigorous significance)/i);
    assert.match(controller, /does not change the past/);
    assert.match(controller, /does not prove faster-than-light communication/);
    assert.match(controller, /not every hidden-variable theory or any quantum interpretation/);
});

test('Phase 9 does not introduce prohibited new physics', () => {
    const publicCopy = `${page}\n${controller}`;
    assert.doesNotMatch(publicCopy, /delayed[- ]choice|detector loophole|quantum computing|quantum field theory|\bQFT\b/i);
});
