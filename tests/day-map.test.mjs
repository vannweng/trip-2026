import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const app = vm.createContext({ URL, document: { addEventListener() {} } });
vm.runInContext(script, app);
const verifiedPlaces = JSON.parse(readFileSync(new URL('../data/navigation-places.json', import.meta.url), 'utf8'));

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

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
    assert.deepEqual(plain(app.getDayMapDestination({ href, title: 'old address' })), { query: '26.6603253,127.8958949', placeId: '' });
});

test('unidentified lodging links retain the confirmed address and search links retain the venue name', () => {
    assert.deepEqual(plain(app.getDayMapDestination({ href: 'https://maps.app.goo.gl/FyrKLhVA2pELcgvx8?g_st=il', title: '沖縄県国頭郡恩納村字仲泊1229-8' })), { query: '沖縄県国頭郡恩納村字仲泊1229-8', placeId: '' });
    const href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('店名 (說明) 沖繩縣浦添市西洲3-1-1');
    assert.deepEqual(plain(app.getDayMapDestination({ href, title: '' })), { query: '店名 (說明) 沖繩縣浦添市西洲3-1-1', placeId: '' });
});

test('verified business IDs survive in whole-day and segmented directions', () => {
    const keys = ['moribo', 'hoppe', 'parco', 'wakasa', 'junkudo', 'rokkan', 'tomari'];
    const stops = keys.map(key => ({ query: verifiedPlaces[key].name, placeId: verifiedPlaces[key].placeId }));
    for (const segment of [stops, ...app.splitDayMapStops(stops)]) {
        const params = new URL(app.buildDayMapUrl(segment)).searchParams;
        assert.equal(params.get('origin_place_id'), segment[0].placeId);
        assert.equal(params.get('destination_place_id'), segment.at(-1).placeId);
        assert.equal(params.get('origin'), segment[0].query);
        assert.equal(params.get('destination'), segment.at(-1).query);
        assert.deepEqual(params.get('waypoint_place_ids').split('|'), Array.from(segment.slice(1, -1), stop => stop.placeId));
        assert.ok(new URL(app.buildDayMapUrl(segment)).href.length <= 2048);
    }
});

test('the playground and its shopping mall remain distinct stops even at the same street address', () => {
    const links = ['earth', 'rycom', 'rycom', 'nishimatsu', 'rycom'].map(key => ({
        href: 'https://www.google.com/maps/search/?api=1&query=Shared+mall+address',
        title: '同一地址',
        dataset: { placeId: verifiedPlaces[key].placeId, routeQuery: verifiedPlaces[key].name },
        closest: () => null
    }));
    const stops = app.getDayMapStops({ dataset: {}, querySelectorAll: () => links });
    assert.deepEqual(Array.from(stops, stop => stop.placeId), ['earth', 'rycom', 'nishimatsu', 'rycom'].map(key => verifiedPlaces[key].placeId));
    const params = new URL(app.buildDayMapUrl(stops)).searchParams;
    assert.equal(params.get('origin_place_id'), verifiedPlaces.earth.placeId);
    assert.equal(params.get('destination_place_id'), verifiedPlaces.rycom.placeId);
    assert.equal(params.get('origin'), verifiedPlaces.earth.name);
    assert.equal(params.get('destination'), verifiedPlaces.rycom.name);
});

test('daily routes include lodging departure and return without duplicating consecutive stops', () => {
    const lodging = key => ({
        href: `https://www.google.com/maps/search/?api=1&query=${key}`,
        dataset: { placeId: verifiedPlaces[key].placeId, routeQuery: verifiedPlaces[key].name },
        closest: () => null
    });
    const routeApp = vm.createContext({
        URL, document: {
            addEventListener() {},
            querySelector: selector => lodging(selector.match(/data-place-key="([^"]+)"/)[1])
        }
    });
    vm.runInContext(script, routeApp);
    const expected = [
        ['day1', undefined, 'moribo'],
        ['day2', 'moribo', 'moribo'],
        ['day3', 'moribo', 'moribo'],
        ['day4', 'moribo', 'wakasa'],
        ['day5', 'wakasa', undefined]
    ];
    for (const [id, routeStart, routeEnd] of expected) {
        const tag = html.match(new RegExp(`<section id="${id}"[^>]*>`))[0];
        assert.equal(tag.match(/data-route-start="([^"]+)"/)?.[1], routeStart);
        assert.equal(tag.match(/data-route-end="([^"]+)"/)?.[1], routeEnd);
        const links = [lodging('orix'), lodging('tomari')];
        if (routeStart) links.unshift(lodging(routeStart));
        if (routeEnd) links.push(lodging(routeEnd));
        const stops = plain(routeApp.getDayMapStops({
            dataset: { routeStart, routeEnd }, querySelectorAll: () => links
        }));
        assert.equal(stops.length, links.length);
        const url = new URL(routeApp.buildDayMapUrl(stops));
        if (routeStart) assert.equal(url.searchParams.get('origin_place_id'), verifiedPlaces[routeStart].placeId);
        if (routeEnd) assert.equal(url.searchParams.get('destination_place_id'), verifiedPlaces[routeEnd].placeId);
        const segments = plain(routeApp.splitDayMapStops(stops));
        assert.deepEqual(segments[0][0], stops[0]);
        assert.deepEqual(segments.at(-1).at(-1), stops.at(-1));
    }
    const stops = plain(routeApp.getDayMapStops({
        dataset: { routeStart: 'moribo', routeEnd: 'moribo' },
        querySelectorAll: () => [lodging('tomari')]
    }));
    assert.deepEqual(stops.map(stop => stop.placeId), [
        verifiedPlaces.moribo.placeId, verifiedPlaces.tomari.placeId, verifiedPlaces.moribo.placeId
    ]);
});

test('all 48 itinerary and reservation links share consistent destination metadata', () => {
    const links = [...html.matchAll(/<a class="(?:maps-btn|reservation-map-link)"[^>]*>/g)].map(match => {
        return Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value.replaceAll('&amp;', '&')]));
    });
    assert.equal(links.length, 48);
    assert.equal(new Set(links.map(link => link['data-place-key'])).size, 39);
    for (const link of links) {
        const place = verifiedPlaces[link['data-place-key']];
        assert.ok(place, link.href);
        assert.equal(link['data-place-id'], place.placeId);
        assert.equal(link['data-route-query'], place.routeQuery || place.name);
        assert.equal(link.target, '_blank');
        assert.equal(link.rel, 'noopener noreferrer');
        const params = new URL(link.href).searchParams;
        if (link.href.includes('/maps/search/') && link['data-place-key'] !== 'wakasa') {
            assert.equal(params.get('query_place_id'), place.placeId || null);
            assert.equal(params.get('query'), place.routeQuery || place.name);
        }
        const featureIds = [...decodeURIComponent(link.href).matchAll(/!1s(0x[\da-f]+:0x[\da-f]+)/g)];
        if (featureIds.length) assert.equal(featureIds.at(-1)[1], place.featureId);
    }
    assert.equal(verifiedPlaces.toy.placeId, 'ChIJjz7UhaBD5DQRMv-kNkofi0U');
    assert.match(verifiedPlaces.toy.address, /辺土名1094-1/);
    assert.match(verifiedPlaces.kishimotoY.address, /伊野波350-1/);
    assert.match(verifiedPlaces.beachy.address, /恩納6497-1/);
    assert.match(verifiedPlaces.hoppe.address, /内間/);
    assert.match(verifiedPlaces.orix.name, /ORIX/);
});

test('Day 2 restaurant navigation and route stops use NAKAMA instead of the old business', () => {
    const links = [...html.matchAll(/<a\b[^>]*data-place-key="beef"[^>]*>/g)];
    assert.equal(links.length, 2);
    for (const [tag] of links) {
        const href = tag.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&');
        const params = new URL(href).searchParams;
        assert.equal(params.get('query'), '琉球燒肉NAKAMA');
        assert.equal(params.has('query_place_id'), false);
        assert.deepEqual(plain(app.getDayMapDestination({ href, title: '' })), {
            query: '琉球燒肉NAKAMA', placeId: ''
        });
    }
    assert.equal(verifiedPlaces.beef.name, '琉球燒肉NAKAMA');
    assert.equal(verifiedPlaces.beef.placeId, '');
    assert.doesNotMatch(html, /ChIJPwH7Wsoa5TQRHjRbpuM8Wsk|Ryukyu No Ushi/);
});

test('Day 4 restaurant uses the supplied address without the old business identity', () => {
    const links = [...html.matchAll(/<a\b[^>]*data-place-key="buchi"[^>]*>/g)];
    assert.equal(links.length, 2);
    for (const [tag] of links) {
        const href = tag.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&');
        const params = new URL(href).searchParams;
        assert.equal(params.get('query'), '沖縄県那覇市久茂地3-23-10');
        assert.equal(params.has('query_place_id'), false);
        assert.deepEqual(plain(app.getDayMapDestination({ href, title: '' })), {
            query: '沖縄県那覇市久茂地3-23-10', placeId: ''
        });
    }
    assert.equal(verifiedPlaces.buchi.address, '沖縄県那覇市久茂地3-23-10');
    assert.equal(verifiedPlaces.buchi.placeId, '');
    assert.doesNotMatch(html, /ChIJzcnA2ndp5TQRRkXi5c02uKk|久茂地３丁目１２−1/);
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
