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
    assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{\s*\.banner-wave \{\s*animation: none;/);
    assert.match(html, /\.banner-crab \{ display: none; \}/);
    assert.match(html, /\.banner-crab-legs \{ animation: none; \}/);
    assert.match(html, /\.banner-moon,\s*\.banner-star \{ animation: none !important; \}/);
    assert.match(html, /\.banner-meteor \{ display: none; \}/);
    const mobileShore = html.match(/@media \(max-width: 720px\)[\s\S]*?\.banner-shore \{([^}]+)\}/)[1];
    assert.match(mobileShore, /right: -4%;/);
    assert.doesNotMatch(html, /right: -20%;/);
});

test('daylight beach uses a static sandbank, three shells and gently moving water', () => {
    const shore = html.match(/<div class="banner-shore" aria-hidden="true">([\s\S]*?)<\/div>/)[1];
    assert.match(shore, /class="banner-coast"[^>]*preserveAspectRatio="none"/);
    assert.match(shore, /<path[^>]*fill="url\(#banner-sand\)"\/>/);
    assert.equal((shore.match(/<use href="#banner-shell-shape"\/>/g) || []).length, 3);
    assert.equal((shore.match(/class="banner-wave /g) || []).length, 3);
    assert.match(html, /animation: shore-flow 6s ease-in-out infinite;/);
    assert.match(html, /0%, 100% \{ transform: translate\(-4px, -4px\); \}/);
    assert.match(html, /50% \{ transform: translate\(3px, 7px\); \}/);
    assert.doesNotMatch(html, /\.banner-wave-foam \{\s*animation-delay:/);
    assert.doesNotMatch(html, /coast-drift|--wave-drift|banner-wave-sand|banner-wave-sea/);
});

test('crab passes briefly between long rests and all daylight motion pauses at night', () => {
    assert.match(html, /animation: crab-pass 23s linear 6s infinite;/);
    assert.match(html, /animation: crab-step 23s linear 6s infinite;/);
    assert.match(html, /@keyframes crab-pass \{\s*0% \{ transform: translateX\(0\); opacity: 0; \}\s*2%, 18% \{ opacity: 1; \}\s*20%, 100% \{ transform: translateX\(100%\); opacity: 0; \}/);
    assert.match(html, /\[data-theme="dark"\] :is\(\.banner-wave, \.banner-crab, \.banner-crab-legs\) \{ animation-play-state: paused; \}/);
});
