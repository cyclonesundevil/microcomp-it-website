const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'frontend/theme.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');

function luminance(hex) {
    const channels = hex.match(/[a-f\d]{2}/gi).map(value => {
        const channel = parseInt(value, 16) / 255;
        return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
    const lighter = Math.max(luminance(first), luminance(second));
    const darker = Math.min(luminance(first), luminance(second));
    return (lighter + 0.05) / (darker + 0.05);
}

test('theme control supports and cycles through all three color schemes', () => {
    assert.match(script, /const themes = \['dark', 'moderate', 'light'\]/);
    assert.match(script, /themes\[\(currentIndex \+ 1\) % themes\.length\]/);
    assert.match(script, /saved.*themes\.includes\(saved\)/s);
    assert.match(script, /removeAttribute\('aria-pressed'\)/);
    assert.match(script, /color scheme selected\. Switch to/);
});

test('moderate palette defines accessible core color pairs', () => {
    assert.match(styles, /:root\[data-theme="moderate"\]/);
    assert.ok(contrastRatio('f7f9fc', '263445') >= 4.5, 'primary text must meet WCAG AA');
    assert.ok(contrastRatio('cbd5e1', '263445') >= 4.5, 'secondary text must meet WCAG AA');
    assert.ok(contrastRatio('10232b', '73dce8') >= 4.5, 'primary button must meet WCAG AA');
    assert.ok(contrastRatio('73dce8', '263445') >= 3, 'accent UI components must meet WCAG AA');
});
