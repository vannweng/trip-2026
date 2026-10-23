import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('night decorations are hidden from assistive technology and paused outside dark mode', () => {
    assert.match(html, /<div class="banner-night-sky" aria-hidden="true">/);
    assert.equal((html.match(/class="banner-star"/g) || []).length, 6);
    assert.match(html, /class="banner-meteor"/);
    for (const name of ['moon-sway', 'star-twinkle', 'meteor-pass']) {
        assert.match(html, new RegExp(`@keyframes ${name}`));
        assert.match(html, new RegExp(`animation: ${name}[^;]*;\\s*animation-play-state: paused;`));
    }
    assert.match(html, /\[data-theme="dark"\] :is\(\.banner-moon, \.banner-star, \.banner-meteor\) \{ animation-play-state: running; \}/);
    assert.match(html, /animation: meteor-pass 19s linear 5s infinite;/);
});

test('motion control is removed while reduced motion preserves a static banner', () => {
    assert.doesNotMatch(html, /banner-motion-toggle|motion-paused|toggleBannerMotion/);
    assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{\s*header::before,\s*\.banner-wave \{\s*animation: none;/);
    assert.match(html, /\.banner-moon,\s*\.banner-star \{ animation: none !important; \}/);
    assert.match(html, /\.banner-meteor \{ display: none; \}/);
    const mobileShore = html.match(/@media \(max-width: 720px\)[\s\S]*?\.banner-shore \{([^}]+)\}/)[1];
    assert.match(mobileShore, /right: -4%;/);
    assert.doesNotMatch(html, /right: -20%;/);
});
