'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontend = path.resolve(__dirname, '..', 'frontend');
const capabilityPaths = [
    'black-hole-playground.html',
    'lensing-simulator.html',
    'universe-explorer.html',
    'nfl-predictor.html',
    path.join('demo-lab', 'cybersecurity-simulation.html'),
    path.join('demo-lab', 'llm-training-simulation.html'),
    path.join('demo-lab', 'llm-inference-capabilities.html')
];

function read(relativePath) {
    return fs.readFileSync(path.join(frontend, relativePath), 'utf8');
}

function region(document, tag) {
    return document.match(
        new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'i')
    )?.[0] || '';
}

test('capability pages use neutral navigation without sales contact links', () => {
    capabilityPaths.forEach(relativePath => {
        const document = read(relativePath);
        const header = region(document, 'header');
        const footer = region(document, 'footer');
        const chrome = `${header}\n${footer}`;

        assert.ok(header, `${relativePath}: missing header`);
        assert.match(header, />Home<\/a>/, `${relativePath}: missing Home link`);
        assert.match(
            header,
            />Demo Lab<\/a>/,
            `${relativePath}: missing Demo Lab link`
        );
        assert.match(
            header,
            /\bdata-theme-toggle\b/,
            `${relativePath}: missing theme control`
        );
        assert.doesNotMatch(
            chrome,
            /href="[^"]*index\.html#contact"/i,
            `${relativePath}: capability chrome contains a Contact CTA`
        );
        assert.doesNotMatch(
            chrome,
            />\s*Contact\s*<\/a>/i,
            `${relativePath}: capability chrome contains a Contact link`
        );
    });
});

test('commercial calls to action remain on the homepage and Demo Lab directory', () => {
    const homepage = read('index.html');
    const directory = read('demo-lab.html');

    assert.match(
        homepage,
        /onclick="window\.startQuote\(\); return false;"[^>]*>Get a Quote<\/a>/i
    );
    assert.match(homepage, /<section id="contact"/i);
    assert.match(directory, /href="index\.html#contact"[^>]*>Contact<\/a>/i);
});
