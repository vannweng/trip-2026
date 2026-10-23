import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('banner pause and resume keep the visual state and accessible control in sync', () => {
    const app = vm.createContext({ document: { addEventListener() {} } });
    vm.runInContext(script, app);
    const classes = new Set();
    const header = {
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            }
        }
    };
    const attributes = { 'aria-pressed': 'false' };
    const button = {
        getAttribute: name => attributes[name],
        setAttribute: (name, value) => { attributes[name] = value; },
        closest: selector => {
            assert.equal(selector, 'header');
            return header;
        }
    };

    app.toggleBannerMotion(button);
    assert.ok(classes.has('motion-paused'));
    assert.equal(attributes['aria-pressed'], 'true');
    assert.equal(attributes['aria-label'], '播放封面動畫');
    assert.equal(button.title, attributes['aria-label']);

    app.toggleBannerMotion(button);
    assert.ok(!classes.has('motion-paused'));
    assert.equal(attributes['aria-pressed'], 'false');
    assert.equal(attributes['aria-label'], '暫停封面動畫');
    assert.equal(button.title, attributes['aria-label']);
});

test('night decorations are hidden from assistive technology and paused outside dark mode', () => {
    assert.match(html, /<div class="banner-night-sky" aria-hidden="true">/);
    assert.equal((html.match(/class="banner-star"/g) || []).length, 6);
    assert.match(html, /class="banner-meteor"/);
    for (const name of ['moon-sway', 'star-twinkle', 'meteor-pass']) {
        assert.match(html, new RegExp(`@keyframes ${name}`));
        assert.match(html, new RegExp(`animation: ${name}[^;]*;\\s*animation-play-state: paused;`));
    }
    assert.match(html, /\[data-theme="dark"\] :is\(\.banner-moon, \.banner-star, \.banner-meteor\) \{ animation-play-state: running; \}/);
    assert.match(html, /header\.motion-paused :is\(\.banner-moon, \.banner-star, \.banner-meteor\) \{ animation-play-state: paused; \}/);
    assert.match(html, /animation: meteor-pass 19s linear 5s infinite;/);
});

test('motion control is in the toolbar and reduced motion removes night animation and meteors', () => {
    const toolbar = html.match(/<div class="header-btn-wrap">([\s\S]*?)<\/div>/)[1];
    assert.match(toolbar, /class="banner-motion-toggle icon-btn"/);
    assert.equal((html.match(/class="banner-motion-toggle icon-btn"/g) || []).length, 1);
    assert.match(html, /\.banner-moon,\s*\.banner-star \{ animation: none !important; \}/);
    assert.match(html, /\.banner-meteor,\s*header \.header-btn-wrap \.banner-motion-toggle\.icon-btn \{ display: none; \}/);
    const mobileShore = html.match(/@media \(max-width: 720px\)[\s\S]*?\.banner-shore \{([^}]+)\}/)[1];
    assert.match(mobileShore, /right: -4%;/);
    assert.doesNotMatch(html, /right: -20%;/);
});
