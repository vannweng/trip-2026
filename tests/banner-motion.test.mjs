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
