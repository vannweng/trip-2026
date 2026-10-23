import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const startup = html.match(/<script data-theme-init>([\s\S]*?)<\/script>/)[1];
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function createThemeApp({ preference = null, systemDark = false, blocked = false } = {}) {
    const classes = new Set();
    const root = {
        dataset: {},
        classList: { add: name => classes.add(name), remove: name => classes.delete(name) }
    };
    const timers = new Map();
    let timerId = 0;
    const status = { dataset: {}, textContent: '' };
    const attributes = {};
    const button = { setAttribute: (name, value) => { attributes[name] = value; } };
    const meta = { content: '#edf7f7' };
    const warnings = [];
    const media = {
        matches: systemDark,
        addEventListener(name, callback) {
            assert.equal(name, 'change');
            this.change = callback;
        }
    };
    const storage = {
        value: preference,
        blocked,
        getItem(key) {
            assert.equal(key, 'okinawa_theme_2026');
            if (this.blocked) throw new Error('Storage blocked');
            return this.value;
        },
        setItem(key, value) {
            assert.equal(key, 'okinawa_theme_2026');
            if (this.blocked) throw new Error('Storage blocked');
            this.value = value;
        }
    };
    const app = vm.createContext({
        document: {
            documentElement: root,
            addEventListener() {},
            querySelector: () => meta,
            getElementById: id => ({ themeStatus: status, themeToggle: button })[id]
        },
        window: { matchMedia: () => media },
        localStorage: storage,
        setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        console: { warn: (...args) => warnings.push(args) }
    });
    vm.runInContext(startup, app);
    vm.runInContext(script, app);
    return { app, root, classes, status, attributes, meta, media, storage, warnings, timers };
}

test('first paint follows system theme unless a saved preference overrides it', () => {
    for (const systemDark of [false, true]) {
        const expected = systemDark ? 'dark' : 'light';
        const { root, meta, classes } = createThemeApp({ systemDark });
        assert.equal(root.dataset.theme, expected);
        assert.equal(root.dataset.themePreference, 'system');
        assert.equal(meta.content, systemDark ? '#0c1823' : '#edf7f7');
        assert.equal(classes.has('theme-animated'), false);
    }
    for (const preference of ['light', 'dark']) {
        const { root } = createThemeApp({ preference, systemDark: preference === 'light' });
        assert.equal(root.dataset.theme, preference);
        assert.equal(root.dataset.themePreference, preference);
    }
    const { root } = createThemeApp({ preference: 'invalid', systemDark: true });
    assert.equal(root.dataset.theme, 'dark');
    assert.equal(root.dataset.themePreference, 'system');
});

test('theme toggles sync persistence, browser chrome, accessible labels and animation state', () => {
    const { app, root, classes, attributes, meta, status, storage } = createThemeApp();
    app.initTheme();
    assert.equal(attributes['aria-pressed'], 'false');
    assert.equal(attributes['aria-label'], '切換至深色模式');
    app.toggleTheme();
    assert.equal(root.dataset.theme, 'dark');
    assert.equal(root.dataset.themePreference, 'dark');
    assert.equal(classes.has('theme-animated'), true);
    assert.equal(attributes['aria-pressed'], 'true');
    assert.equal(attributes['aria-label'], '切換至淺色模式');
    assert.equal(meta.content, '#0c1823');
    assert.equal(storage.value, 'dark');
    assert.equal(status.textContent, '已切換至深色模式');
    app.toggleTheme();
    assert.equal(root.dataset.theme, 'light');
    assert.equal(storage.value, 'light');
    assert.equal(attributes['aria-pressed'], 'false');
    assert.equal(meta.content, '#edf7f7');
});

test('system changes apply only until the user explicitly chooses a theme', () => {
    const { app, root, media } = createThemeApp();
    app.initTheme();
    media.change({ matches: true });
    assert.equal(root.dataset.theme, 'dark');
    media.change({ matches: false });
    assert.equal(root.dataset.theme, 'light');
    app.toggleTheme();
    media.change({ matches: false });
    assert.equal(root.dataset.theme, 'dark');
});

test('rapid reversals cancel old cleanup and restore normal interaction transitions afterward', () => {
    const { app, root, classes, timers } = createThemeApp();
    app.initTheme();
    app.toggleTheme();
    app.toggleTheme();
    app.toggleTheme();
    assert.equal(root.dataset.theme, 'dark');
    assert.equal(timers.size, 1);
    assert.equal(classes.has('theme-animated'), true);
    [...timers.values()][0]();
    assert.equal(classes.has('theme-animated'), false);
});

test('blocked storage reports errors without preventing theme changes and can recover', () => {
    const { app, root, status, storage, warnings } = createThemeApp({ blocked: true });
    app.initTheme();
    assert.match(status.textContent, /無法讀取/);
    assert.equal(status.dataset.error, 'true');
    app.toggleTheme();
    assert.equal(root.dataset.theme, 'dark');
    assert.match(status.textContent, /無法記住偏好/);
    assert.equal(status.dataset.error, 'true');
    assert.equal(warnings.length, 2);
    storage.blocked = false;
    app.toggleTheme();
    assert.equal(storage.value, 'light');
    assert.equal(status.dataset.error, 'false');
    assert.equal(root.dataset.themeStorageError, undefined);
});

test('theme scenes use independent transforms, hidden decoration and reduced-motion overrides', () => {
    assert.match(html, /class="banner-moon" aria-hidden="true"/);
    assert.match(html, /\[data-theme="dark"\] \.banner-shore \{ translate: 0 220px; \}/);
    assert.match(html, /\[data-theme="dark"\] \.banner-moon \{ translate: 0 0; opacity: 1; \}/);
    assert.match(html, /theme-animated \.banner-shore \{ transition: translate 0\.85s/);
    assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{\s*\.theme-animated header::after,[\s\S]*?transition: none;/);
    assert.match(html, /\[data-theme="dark"\] \{\s*color-scheme: dark;/);
});
