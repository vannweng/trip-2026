import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function element(extra = {}) {
    const attributes = {};
    const classes = new Set();
    return {
        hidden: false,
        style: {},
        attributes,
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            }
        },
        setAttribute(name, value) { attributes[name] = value; },
        focus() { this.focused = true; },
        scrollIntoView() {},
        ...extra
    };
}

function createApp(document, extras = {}) {
    const app = vm.createContext({
        URL,
        document: { addEventListener() {}, ...document },
        console: { warn() {} },
        ...extras
    });
    vm.runInContext(script, app);
    return app;
}

test('audience URLs preserve other parameters and day, and restore filters', () => {
    const location = { href: 'https://example.com/?gray=off#day3' };
    const buttons = ['all', 'family', 'couple'].map(filter => element({ dataset: { filter } }));
    const cards = ['common', 'family', 'couple'].map(audience => element({ dataset: { audience } }));
    const app = createApp({
        querySelectorAll(selector) {
            if (selector === '.itinerary-filter-btn') return buttons;
            if (selector === '.timeline-card[data-audience]') return cards;
            throw new Error(`Unexpected selector: ${selector}`);
        }
    }, {
        window: { location },
        history: { pushState(_state, _unused, url) { location.href = url; } }
    });
    app.updateTimelineProgress = () => {};
    app.updateDayMaps = () => {};
    app.setTimelineCardStatus = () => {};

    app.applyItineraryFilter('family', { updateUrl: true });
    assert.equal(location.href, 'https://example.com/?gray=off&audience=family#day3');
    assert.equal(app.getItineraryFilterFromUrl(), 'family');
    assert.deepEqual(cards.map(card => card.hidden), [false, false, true]);
    app.applyItineraryFilter('couple', { updateUrl: true });
    assert.equal(app.getItineraryFilterFromUrl(), 'couple');
    assert.deepEqual(cards.map(card => card.hidden), [false, true, false]);
    app.applyItineraryFilter('all', { updateUrl: true });
    assert.equal(location.href, 'https://example.com/?gray=off#day3');
    assert.deepEqual(cards.map(card => card.hidden), [false, false, false]);

    location.href = 'https://example.com/?audience=invalid#day2';
    assert.equal(app.getItineraryFilterFromUrl(), 'all');
});

test('panel changes hide irrelevant filters and can focus the new heading', () => {
    const heading = element();
    const day = element({ id: 'day2', querySelector: () => heading });
    day.classList.add('day-section');
    const expenseHeading = element();
    const expenses = element({ id: 'expenses', querySelector: () => expenseHeading });
    const tabs = [element(), element()];
    const filter = element();
    const app = createApp({
        body: element(),
        getElementById: id => ({ day2: day, expenses })[id],
        querySelector(selector) {
            if (selector === '.itinerary-filter') return filter;
            if (selector === '.sticky-control-panel') return null;
            if (selector === '.day-chip[href="#day2"]') return tabs[0];
            if (selector === '.day-chip[href="#expenses"]') return tabs[1];
            throw new Error(`Unexpected selector: ${selector}`);
        },
        querySelectorAll: selector => selector === '.trip-panel' ? [day, expenses] : tabs
    });
    app.selectDay('day2', { focusHeading: true });
    assert.equal(heading.focused, true);
    assert.equal(filter.hidden, false);
    assert.equal(expenses.hidden, true);
    app.document.activeElement = { closest: () => day };
    app.selectDay('expenses');
    assert.equal(filter.hidden, true);
    assert.equal(day.hidden, true);
    assert.equal(tabs[1].tabIndex, 0);
    assert.equal(expenseHeading.focused, true);
});

test('both day-pagination directions request focus on the destination heading', () => {
    const sections = [0, 1, 2].map(() => element({
        children: [],
        appendChild(child) { this.children.push(child); }
    }));
    const app = createApp({
        querySelectorAll: () => sections,
        createElement: () => element({
            listeners: {},
            addEventListener(name, callback) { this.listeners[name] = callback; },
            append(...children) { this.children = children; }
        })
    });
    app.createDayMap = () => {};
    app.updateDayMaps = () => {};
    const calls = [];
    app.selectDay = (id, options) => calls.push({ id, ...options });
    app.createDayPagination();
    const [previous, next] = sections[1].children[0].children;
    previous.listeners.click();
    next.listeners.click();
    assert.deepEqual(calls.map(call => call.id), ['day1', 'day3']);
    assert.ok(calls.every(call => call.focusHeading && call.scroll && call.updateUrl));
});

test('reservation return links focus the destination and preserve modified clicks', () => {
    const link = element({
        getAttribute: () => '#day2',
        addEventListener(_name, callback) { this.click = callback; }
    });
    const app = createApp({
        querySelectorAll: selector => selector === '.reservation-day-link' ? [link] : []
    });
    const calls = [];
    app.selectDay = (id, options) => calls.push({ id, ...options });
    app.initReservationActions();
    let prevented = false;
    link.click({ button: 0, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(calls[0].id, 'day2');
    assert.equal(calls[0].focusHeading, true);
    prevented = false;
    link.click({ button: 0, ctrlKey: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    assert.equal(calls.length, 1);
});

test('modal tabs support arrow wrapping, Home/End and a single tab stop', () => {
    const tabs = ['checklist', 'clothing'].map(tab => element({
        dataset: { tab },
        listeners: {},
        addEventListener(name, callback) { this.listeners[name] = callback; }
    }));
    const panes = { paneChecklist: element(), paneClothing: element() };
    const app = createApp({
        querySelectorAll: () => tabs,
        getElementById: id => panes[id]
    });
    app.initModalTabs();
    const press = (index, key) => {
        let prevented = false;
        tabs[index].listeners.keydown({ key, preventDefault() { prevented = true; } });
        assert.equal(prevented, true);
    };
    press(0, 'ArrowRight');
    assert.equal(tabs[1].focused, true);
    assert.deepEqual(tabs.map(tab => tab.tabIndex), [-1, 0]);
    assert.equal(panes.paneChecklist.hidden, true);
    press(1, 'ArrowRight');
    assert.deepEqual(tabs.map(tab => tab.tabIndex), [0, -1]);
    press(0, 'ArrowLeft');
    assert.deepEqual(tabs.map(tab => tab.tabIndex), [-1, 0]);
    press(1, 'Home');
    assert.deepEqual(tabs.map(tab => tab.tabIndex), [0, -1]);
    press(0, 'End');
    assert.deepEqual(tabs.map(tab => tab.tabIndex), [-1, 0]);
});

test('checklist reports storage failures without falsely resetting selections', () => {
    const status = element({ textContent: '' });
    const row = element();
    const checkbox = element({ id: 'passport', checked: true, closest: () => row });
    const badges = { checklistStorageStatus: status, checklistCounter: element(), checklistProgress: element() };
    let stored = null;
    let failed = true;
    const app = createApp({
        querySelectorAll: () => [checkbox],
        getElementById: id => badges[id]
    }, {
        confirm: () => true,
        localStorage: {
            setItem(_key, value) {
                if (failed) throw new Error('Storage blocked');
                stored = value;
            },
            getItem() {
                if (failed) throw new Error('Storage blocked');
                return stored;
            },
            removeItem() {
                if (failed) throw new Error('Storage blocked');
                stored = null;
            }
        }
    });
    app.saveChecklistState();
    assert.match(status.textContent, /無法儲存/);
    assert.equal(checkbox.checked, true);
    app.resetPackingChecklist();
    assert.match(status.textContent, /尚未重置/);
    assert.equal(checkbox.checked, true);
    app.loadChecklistState();
    assert.match(status.textContent, /無法讀取/);
    assert.equal(checkbox.checked, true);

    failed = false;
    app.saveChecklistState();
    assert.equal(status.textContent, '');
    assert.equal(JSON.parse(stored).passport, true);
    checkbox.checked = false;
    app.loadChecklistState();
    assert.equal(checkbox.checked, true);
    stored = 'null';
    app.loadChecklistState();
    assert.match(status.textContent, /無法讀取/);
    assert.equal(checkbox.checked, true);
    app.resetPackingChecklist();
    assert.equal(checkbox.checked, false);
    assert.equal(status.textContent, '');
});

test('main content has skip navigation, semantic headings and explicit transitions', () => {
    assert.match(html, /class="skip-link" href="#main-content"/);
    assert.match(html, /<main id="main-content" tabindex="-1">/);
    assert.equal((html.match(/<h2 class="day-title-top" tabindex="-1">/g) || []).length, 7);
    assert.equal((html.match(/<h3 class="place-name">/g) || []).length, 32);
    assert.doesNotMatch(html, /transition:\s*all\b/);
    assert.match(html, /id="checklistStorageStatus" role="status" aria-live="polite"/);
});

test('compact tool buttons use SVG icons with accessible names and tooltips, not emoji', () => {
    const controls = [...html.matchAll(/<(button|a)\b([^>]*class="[^"]*\bicon-btn\b[^"]*"[^>]*)>([\s\S]*?)<\/\1>/g)];
    assert.equal(controls.length, 6);
    for (const [, , attributes, content] of controls) {
        assert.match(attributes, /aria-label="[^"]+"/);
        assert.match(attributes, /title="[^"]+"/);
        assert.match(content, /<svg[^>]*aria-hidden="true"/);
        assert.doesNotMatch(content, /\p{Extended_Pictographic}/u);
        const visibleText = content.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '').trim();
        assert.ok(visibleText === '' || visibleText === '0/34');
    }
});

test('paired destinations each have their own heading and navigation link', () => {
    const rows = [...html.matchAll(/<div class="destination-row">([\s\S]*?)<\/div>/g)];
    assert.equal(rows.length, 4);
    for (const [, content] of rows) {
        assert.equal((content.match(/<h3 class="place-name">/g) || []).length, 1);
        assert.equal((content.match(/class="maps-btn"/g) || []).length, 1);
    }
});

test('highlighted itinerary cards retain rounded corners and space around their content', () => {
    assert.match(html, /\.timeline-card \{\s*margin-inline: -12px;\s*padding: 18px 12px;\s*border-radius: 6px;/);
    assert.doesNotMatch(html, /\.timeline-card\.is-current,\s*\.timeline-card\.is-next \{/);
});

test('backup navigation stays beside the text, including reservation and grouped destination icons', () => {
    assert.match(html, /\.backup-content \{ display: flex; align-items: center;/);
    assert.match(html, /\.backup-content > p \{ flex: 1; min-width: 0; \}/);
    assert.match(html, /\.backup-content > \.maps-btn,\s*\.backup-content > \.reservation-info-btn \{ flex: 0 0 auto; \}/);
    assert.match(html, /\.backup-content \.map-links \{ flex: 0 0 auto; flex-wrap: nowrap; justify-content: flex-end; \}/);
});

test('reservation shortcuts use labeled SVG icons and preserve their targets', () => {
    const links = [...html.matchAll(/<a class="reservation-info-btn"([^>]*)>([\s\S]*?)<\/a>/g)];
    assert.equal(links.length, 4);
    for (const [, attributes, content] of links) {
        assert.match(attributes, /href="#reservation-[^"]+"/);
        assert.match(attributes, /aria-label="查看訂位資訊"/);
        assert.match(attributes, /title="訂位資訊"/);
        assert.match(content, /<svg[^>]*aria-hidden="true"/);
        assert.equal(content.replace(/<[^>]*>/g, '').trim(), '');
    }
});

test('Day 4 confirmed reservation replaces only the dinner backup', () => {
    const card = html.match(/<article class="reservation-card" id="reservation-buchi"[\s\S]*?<\/article>/)[0];
    assert.match(card, /已完成訂位/);
    assert.match(card, /<h3>肉 久茂地<\/h3>/);
    assert.match(card, /2026\/11\/29 18:30（日本時間）/);
    assert.match(card, /6 名（含 1 名兒童）/);
    assert.match(card, /<code>V8P2JS6YKE<\/code>/);
    assert.match(card, /data-copy-code="V8P2JS6YKE"/);
    assert.doesNotMatch(html, /reservation-kushiyaki|Kushiyaki Can/);
    const day4 = html.match(/<section id="day4"[\s\S]*?<\/section>/)[0];
    assert.equal((day4.match(/<details class="backup-plan">/g) || []).length, 2);
    assert.equal((html.match(/<article class="reservation-card"/g) || []).length, 4);
    assert.match(html, /class="reservation-count">4<\/span>/);
});

test('Day 2 NAKAMA reservation updates dinner time and removes only the dinner backup', () => {
    const card = html.match(/<article class="reservation-card" id="reservation-ryukyu-beef"[\s\S]*?<\/article>/)[0];
    assert.match(card, /已完成訂位/);
    assert.match(card, /<h3>琉球燒肉NAKAMA<\/h3>/);
    assert.match(card, /2026\/11\/27 19:00（日本時間）/);
    assert.match(card, /6 名（含 1 名兒童）/);
    assert.match(card, /<code>ZG758REKT3<\/code>/);
    assert.match(card, /data-copy-code="ZG758REKT3"/);
    assert.doesNotMatch(card, /17:00 - 23:00|¥5,000/);
    assert.doesNotMatch(html, /reservation-ryukyu-annex|琉球的牛 恩納別館/);
    const day2 = html.match(/<section id="day2"[\s\S]*?<\/section>/)[0];
    assert.equal((day2.match(/<details class="backup-plan">/g) || []).length, 4);
    const dinner = day2.match(/<article class="timeline-card" data-audience="common">(?:(?!<\/article>)[\s\S])*?<h3 class="place-name">琉球燒肉NAKAMA<\/h3>[\s\S]*?<\/article>/)[0];
    assert.match(dinner, /19:00 - 21:00/);
    assert.match(html, /2 項已訂位/);
});

test('sticky scroll offset follows the navigation height as filters appear and disappear', () => {
    const offsets = [];
    const panel = { offsetHeight: 168 };
    const app = createApp({
        documentElement: { style: { setProperty: (name, value) => offsets.push([name, value]) } },
        querySelector: () => panel
    }, { getComputedStyle: () => ({ top: '8px' }) });
    app.updateStickyOffset();
    panel.offsetHeight = 116;
    app.updateStickyOffset();
    assert.deepEqual(offsets, [['--sticky-offset', '192px'], ['--sticky-offset', '140px']]);
    assert.match(html, /\.reservation-card \{ scroll-margin-top: var\(--sticky-offset, 220px\); \}/);
    assert.match(html, /new ResizeObserver\(updateStickyOffset\)\.observe/);
});
