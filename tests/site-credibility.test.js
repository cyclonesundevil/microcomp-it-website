'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const publicPages = [
    'index.html',
    'demo-lab.html',
    'black-hole-playground.html',
    'lensing-simulator.html',
    'universe-explorer.html',
    'nfl-predictor.html',
    'demo-lab/cybersecurity-simulation.html',
    'demo-lab/llm-inference-capabilities.html'
];

function read(relativePath) {
    return fs.readFileSync(path.join(frontend, relativePath), 'utf8');
}

test('all styled public pages use the same shared stylesheet release', () => {
    for (const relativePath of [...publicPages, 'preview-review.html']) {
        assert.match(
            read(relativePath),
            /(?:\.\.\/)?styles\.css\?v=3\.0/,
            `${relativePath} does not use shared stylesheet v3.0`
        );
    }
});

test('internal navigation stays in the current tab', () => {
    for (const relativePath of publicPages) {
        const html = read(relativePath);
        const anchors = html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g);
        for (const match of anchors) {
            const [anchor, href] = match;
            const external = /^(?:https?:)?\/\//.test(href);
            if (!external) {
                assert.doesNotMatch(
                    anchor,
                    /target="_blank"/,
                    `${relativePath} opens internal link ${href} in a new tab`
                );
            }
        }
    }
});

test('external new-tab links retain opener protection', () => {
    for (const relativePath of publicPages) {
        const html = read(relativePath);
        const anchors = html.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g);
        for (const match of anchors) {
            const anchor = match[0];
            if (/target="_blank"/.test(anchor)) {
                assert.match(anchor, /rel="[^"]*noopener[^"]*"/);
            }
        }
    }
});

test('primary navigation remains concise', () => {
    const homeNav = read('index.html').match(/<nav>([\s\S]*?)<\/nav>/)[1];
    const demoNav = read('demo-lab.html').match(/<nav>([\s\S]*?)<\/nav>/)[1];
    assert.ok((homeNav.match(/<a\b/g) || []).length <= 4);
    assert.ok((demoNav.match(/<a\b/g) || []).length <= 4);
    assert.doesNotMatch(homeNav, /Lensing Simulator|Universe Explorer|NFL Predictor/);
});

test('demo copy emphasizes value instead of URL continuity', () => {
    const copy = `${read('index.html')}\n${read('demo-lab.html')}`;
    assert.doesNotMatch(
        copy,
        /same URL|existing location|direct links|without changing existing/i
    );
    assert.match(copy, /interactive demonstrations spanning cybersecurity/);
    assert.match(copy, /engineering, data, and decision-making/);
});

test('public text files are valid UTF-8 without mojibake markers', () => {
    const mojibake = /\uFFFD|Ã.|Â[\s\S]|â(?:€|€™|€œ|€œ|€“|€”)/;
    for (const relativePath of publicPages) {
        assert.doesNotMatch(read(relativePath), mojibake, relativePath);
    }
});

test('sitemap covers every indexable public experience consistently', () => {
    const sitemap = read('sitemap.xml');
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map(match => match[1]);
    const expected = publicPages.map(relativePath => (
        relativePath === 'index.html'
            ? 'https://microcompit.com/'
            : `https://microcompit.com/${relativePath}`
    ));
    assert.deepEqual([...urls].sort(), [...expected].sort());
    assert.doesNotMatch(sitemap, /www\.microcompit\.com|preview-review|llm-training-lab\.html/);
    assert.equal((sitemap.match(/<lastmod>2026-08-08<\/lastmod>/g) || []).length, expected.length);
});

test('canonical URLs use the same hostname as sitemap and social metadata', () => {
    for (const relativePath of [
        'llm-training-lab.html',
        'preview-review.html',
        'demo-lab/llm-training-simulation.html'
    ]) {
        assert.doesNotMatch(read(relativePath), /https:\/\/www\.microcompit\.com/);
    }
});
