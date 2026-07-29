'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const homepagePath = path.join(frontend, 'index.html');
const previewPath = path.join(frontend, 'preview-review.html');
const simulatorPath = path.join(
    frontend, 'demo-lab', 'llm-training-simulation.html'
);
const homepage = fs.readFileSync(homepagePath, 'utf8');
const preview = fs.readFileSync(previewPath, 'utf8');
const simulator = fs.readFileSync(simulatorPath, 'utf8');
const styles = fs.readFileSync(path.join(frontend, 'styles.css'), 'utf8');

function ids(document) {
    return [...document.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
}

function localAssets(document, documentPath) {
    return [...document.matchAll(
        /(?:href|src)="([^"]+\.(?:css|js|svg)(?:\?[^"]*)?)"/g
    )]
        .map(match => match[1])
        .filter(reference => (
            !reference.startsWith('http')
            && !reference.startsWith('/')
        ))
        .map(reference => path.resolve(
            path.dirname(documentPath), reference.split('?')[0]
        ));
}

function htmlFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return htmlFiles(target);
        return entry.isFile() && entry.name.endsWith('.html') ? [target] : [];
    });
}

test('homepage footer exposes a visible ordinary review-access link', () => {
    const footer = homepage.match(/<footer\b[\s\S]*?<\/footer>/i)?.[0] || '';
    const anchor = footer.match(
        /<a\b[^>]*class="preview-review-link"[^>]*href="\/preview-review\.html"[^>]*>[\s\S]*?<\/a>/i
    )?.[0] || '';
    assert.ok(anchor, 'homepage footer review link is missing');
    assert.match(anchor, />Preview Review Access<\/a>/);
    assert.doesNotMatch(anchor, /\b(?:hidden|aria-hidden)\b|style\s*=/i);
    const rule = styles.match(
        /\.footer-details \.preview-review-link\s*\{([^}]*)\}/
    )?.[1] || '';
    assert.ok(rule, 'footer review-link style is missing');
    assert.doesNotMatch(
        rule,
        /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|width\s*:\s*0|height\s*:\s*0|position\s*:\s*(?:absolute|fixed)|left\s*:\s*-/i
    );
    const primaryNavigation = homepage.match(
        /<header\b[\s\S]*?<\/header>/i
    )?.[0] || '';
    assert.doesNotMatch(primaryNavigation, /preview-review\.html/i);
});

test('review index and simulator form the required ordinary-link chain', () => {
    assert.match(
        preview,
        /<a\b[^>]*href="\/demo-lab\/llm-training-simulation\.html"[^>]*>[\s\S]*LLM Training Laboratory &mdash; Private Preview[\s\S]*?<\/a>/i
    );
    assert.match(
        simulator,
        /<a\b[^>]*href="\/preview-review\.html"[^>]*>Preview Review Access<\/a>/i
    );

    const inboundSimulatorLinks = htmlFiles(frontend).flatMap(file => {
        const document = fs.readFileSync(file, 'utf8');
        return [...document.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/gi)]
            .filter(match => (
                match[1] === '/demo-lab/llm-training-simulation.html'
                || match[1].endsWith('/demo-lab/llm-training-simulation.html')
                || match[1] === 'demo-lab/llm-training-simulation.html'
            ))
            .map(() => path.relative(frontend, file));
    });
    assert.deepEqual(inboundSimulatorLinks, ['preview-review.html']);
});

test('both preview pages contain canonical and noindex metadata', () => {
    [preview, simulator].forEach(document => {
        assert.match(
            document,
            /<meta name="robots" content="noindex, nofollow, noarchive">/
        );
    });
    assert.match(
        preview,
        /<link rel="canonical" href="https:\/\/www\.microcompit\.com\/preview-review\.html">/
    );
    assert.match(
        simulator,
        /<link rel="canonical" href="https:\/\/www\.microcompit\.com\/demo-lab\/llm-training-simulation\.html">/
    );
});

test('robots and public discovery files do not expose or block preview routes', () => {
    const robots = fs.readFileSync(path.join(frontend, 'robots.txt'), 'utf8');
    const directory = fs.readFileSync(path.join(frontend, 'demo-lab.html'), 'utf8');
    const sitemap = fs.readFileSync(path.join(frontend, 'sitemap.xml'), 'utf8');
    assert.doesNotMatch(
        robots,
        /Disallow:\s*\/(?:preview-review\.html|demo-lab\/llm-training-simulation\.html)/i
    );
    assert.doesNotMatch(directory, /llm-training-simulation\.html/i);
    assert.doesNotMatch(sitemap, /preview-review|llm-training-simulation/i);

    const discoveryFiles = fs.readdirSync(frontend)
        .filter(name => /^(?:rss|feed).*\.xml$/i.test(name))
        .map(name => fs.readFileSync(path.join(frontend, name), 'utf8'));
    discoveryFiles.forEach(document => {
        assert.doesNotMatch(document, /preview-review|llm-training-simulation/i);
    });

    htmlFiles(frontend).forEach(file => {
        const document = fs.readFileSync(file, 'utf8');
        const structuredData = [...document.matchAll(
            /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
        )].map(match => match[1]).join('\n');
        assert.doesNotMatch(
            structuredData,
            /preview-review|llm-training-simulation/i,
            path.relative(frontend, file)
        );
    });
});

test('initial HTML is meaningful without JavaScript', () => {
    assert.match(preview, /<title>MicroComp IT Preview Review Access<\/title>/);
    assert.match(preview, /<h1[^>]*>MicroComp IT Preview Review Access<\/h1>/);
    assert.match(preview, /unreleased demonstrations provided for/);
    assert.match(preview, /incomplete and are not part of the public Demo Lab release/);
    assert.match(preview, /href="index\.html">Homepage<\/a>/);

    assert.match(simulator, /<title>LLM Training Simulation Lab \| MicroComp IT<\/title>/);
    assert.match(simulator, /<h1[^>]*>Train a tiny language model/);
    assert.match(simulator, /Character-level/);
    ['Data', 'Tokenization', 'Architecture', 'Training', 'Prediction Lab', 'Analysis']
        .forEach(label => assert.ok(simulator.includes(label), label));
    assert.match(simulator, /href="\.\.\/index\.html">Home<\/a>/);
});

test('review pages resolve local assets and preserve unique IDs', () => {
    [
        [preview, previewPath],
        [simulator, simulatorPath]
    ].forEach(([document, documentPath]) => {
        localAssets(document, documentPath).forEach(asset => {
            assert.ok(fs.existsSync(asset), `missing local asset: ${asset}`);
        });
        const documentIds = ids(document);
        assert.equal(
            documentIds.length,
            new Set(documentIds).size,
            `duplicate ID in ${path.basename(documentPath)}`
        );
    });
});

test('Quart hosting applies route-specific X-Robots-Tag headers', () => {
    const backend = fs.readFileSync(path.join(root, 'backend', 'app.py'), 'utf8');
    assert.match(backend, /"\/preview-review\.html"/);
    assert.match(backend, /"\/demo-lab\/llm-training-simulation\.html"/);
    assert.match(
        backend,
        /response\.headers\["X-Robots-Tag"\]\s*=\s*"noindex, nofollow, noarchive"/
    );
    assert.doesNotMatch(backend, /Access-Control-Allow-Origin"\]\s*=\s*"\*".*preview-review/s);
});
