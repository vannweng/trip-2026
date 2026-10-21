import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const app = vm.createContext({ URL, document: { addEventListener() {} } });
vm.runInContext(script, app);

test('directions retain every destination in order and safely encode address characters', () => {
    const stops = ['沖縄県那覇市若狭1-25-11', 'A&B / テスト #1', '26.6603253,127.8958949', '恩納村仲泊1229-8'];
    const url = new URL(app.buildDayMapUrl(stops));
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('travelmode'), 'driving');
    assert.equal(url.searchParams.get('origin'), stops[0]);
    assert.equal(url.searchParams.get('destination'), stops.at(-1));
    assert.deepEqual(url.searchParams.get('waypoints').split('|'), stops.slice(1, -1));
});

test('confirmed place link uses its destination coordinates rather than the viewport or address search', () => {
    const href = 'https://www.google.com/maps/place/岸本食堂/@26.6601413,127.8955933,20z/data=!3d26.6602546!4d127.8958564!3d26.6603253!4d127.8958949';
    assert.equal(app.getDayMapDestination({ href, title: 'old address' }), '26.6603253,127.8958949');
});

test('short lodging links use the confirmed address; search links keep just the address', () => {
    assert.equal(app.getDayMapDestination({ href: 'https://maps.app.goo.gl/FyrKLhVA2pELcgvx8?g_st=il', title: '沖縄県国頭郡恩納村字仲泊1229-8' }), '沖縄県国頭郡恩納村字仲泊1229-8');
    const href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('店名 (說明) 沖繩縣浦添市西洲3-1-1');
    assert.equal(app.getDayMapDestination({ href, title: '' }), '沖繩縣浦添市西洲3-1-1');
});

test('mobile segments preserve every leg and connect at their shared destination', () => {
    for (const count of [2, 5, 6, 9, 10, 11]) {
        const stops = Array.from({ length: count }, (_, index) => `Stop ${index + 1}`);
        const segments = Array.from(app.splitDayMapStops(stops), segment => Array.from(segment));
        assert.ok(segments.every(segment => segment.length >= 2 && segment.length <= 5));
        assert.deepEqual(segments.flatMap((segment, index) => index ? segment.slice(1) : segment), stops);
        segments.slice(1).forEach((segment, index) => assert.equal(segment[0], segments[index].at(-1)));
        for (const segment of segments) {
            const url = new URL(app.buildDayMapUrl(segment));
            assert.ok((url.searchParams.get('waypoints')?.split('|').length || 0) <= 3);
        }
    }
});

test('missing destinations do not produce a misleading partial route', () => {
    assert.equal(app.buildDayMapUrl([]), null);
    assert.equal(app.buildDayMapUrl(['one stop']), null);
    assert.equal(app.buildDayMapUrl(['origin', '', 'destination']), null);
});
