import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const members = ['阿均', '國恒', '媽咪', '阿猿', '培芝'];

function app(rates = { TWD: 30, JPY: 150, USD: 1 }) {
    const context = vm.createContext({ document: { addEventListener() {} }, URLSearchParams });
    vm.runInContext(script, context);
    context.__rates = rates;
    vm.runInContext('expenseRates = __rates ? { rates: __rates } : null;', context);
    return context;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function record(overrides = {}) {
    return {
        date: '2026-11-27', name: '午餐', amount: 1500, currency: 'JPY', payer: '阿均',
        category: '餐飲', participants: [...members], ...overrides
    };
}

test('the rate saved with each expense settles it even after live rates change or disappear', () => {
    const context = app();
    const item = { amount: 1000, currency: 'JPY', rateToTwd: 0.25, payer: '阿均' };
    assert.equal(context.toTwd(item), 250);
    vm.runInContext('expenseRates = { rates: { TWD: 30, JPY: 100, USD: 1 } };', context);
    assert.equal(context.toTwd(item), 250);
    vm.runInContext('expenseRates = null;', context);
    assert.equal(context.toTwd(item), 250);
    assert.equal(context.toTwd({ amount: 80, currency: 'TWD' }), 80);
    assert.equal(context.toTwd({ amount: 1000, currency: 'JPY' }), null);
    const result = plain(context.calculateExpenseSplit([item, { amount: 1000, currency: 'JPY', payer: '國恒' }]));
    assert.equal(result.total, 250);
    assert.equal(result.skippedCurrency, 1);
});

test('new records capture the current rate, and edits keep the original rate unless the currency changes', () => {
    const context = app();
    assert.equal(context.currentRateToTwd('JPY'), 0.2);
    assert.equal(context.currentRateToTwd('TWD'), 1);
    assert.equal(context.currentRateToTwd('XYZ'), null);
    const created = plain(context.buildExpenseRecord(record({ amount: '1,500 ' })));
    assert.equal(created.amount, 1500);
    assert.equal(created.rateToTwd, 0.2);
    assert.deepEqual(created.participants, []);

    const previous = { id: 'a', currency: 'JPY', rateToTwd: 0.21 };
    assert.equal(context.buildExpenseRecord(record({ amount: 2000 }), previous).rateToTwd, 0.21);
    assert.equal(context.buildExpenseRecord(record({ currency: 'USD' }), previous).rateToTwd, 30);
    assert.equal(context.buildExpenseRecord(record({ currency: 'TWD' }), previous).rateToTwd, 1);
    vm.runInContext('expenseRates = null;', context);
    assert.equal(context.buildExpenseRecord(record()).rateToTwd, null);
});

test('selecting everyone stores the all-member default while partial selections keep their names', () => {
    const context = app();
    assert.deepEqual(plain(context.participantsForStorage([...members].reverse())), []);
    assert.deepEqual(plain(context.participantsForStorage(['阿均', '國恒', '阿均'])), ['阿均', '國恒']);
    assert.deepEqual(plain(context.participantsForStorage([...members, '旅伴'])), [...members, '旅伴']);
});

test('client validation mirrors the Firestore rules', () => {
    const context = app();
    const valid = context.buildExpenseRecord(record());
    assert.equal(context.validateExpenseRecord(valid), '');
    const cases = [
        [{ date: '' }, '日期'], [{ date: '2026/11/27' }, '日期'], [{ name: '  ' }, '項目'],
        [{ name: 'x'.repeat(81) }, '80'], [{ amount: '' }, '金額'], [{ amount: 'abc' }, '金額'],
        [{ amount: 0 }, '金額'], [{ amount: 1e8 }, '太大'], [{ currency: '' }, '幣別'], [{ payer: '' }, '誰付'],
        [{ category: 'x'.repeat(21) }, '分類']
    ];
    for (const [overrides, message] of cases) {
        assert.match(context.validateExpenseRecord(context.buildExpenseRecord(record(overrides))), new RegExp(message), JSON.stringify(overrides));
    }
    assert.equal(context.validateExpenseRecord(context.buildExpenseRecord(record({ amount: -300 }))), '');
    for (const field of ['date', 'name', 'amount', 'currency', 'rateToTwd', 'payer', 'category', 'participants']) {
        assert.ok(rules.includes(`'${field}'`), `${field} is allowed by the rules`);
    }
});

test('Firestore documents become display items with safe defaults and pending flags', () => {
    const context = app();
    const item = plain(context.expenseFromDoc('doc1', {
        date: '2026-11-28', name: '晚餐', amount: 9000, currency: 'JPY', rateToTwd: 0.2, payer: '媽咪',
        participants: ['媽咪', '培芝'], createdAt: { toMillis: () => 1234 }
    }, true));
    assert.deepEqual(item, {
        id: 'doc1', date: '2026-11-28', name: '晚餐', amount: 9000, currency: 'JPY', rateToTwd: 0.2, payer: '媽咪',
        category: '', participants: ['媽咪', '培芝'], createdAt: 1234, pending: true
    });
    const sparse = plain(context.expenseFromDoc('doc2', { amount: 'oops', rateToTwd: null, createdAt: null }));
    assert.equal(sparse.name, '(未命名)');
    assert.equal(sparse.amount, 0);
    assert.equal(sparse.rateToTwd, null);
    assert.equal(sparse.createdAt, 0);
    assert.equal(sparse.pending, false);
});

test('expenses sort newest day first and chronologically within a day', () => {
    const context = app();
    const sorted = context.sortExpenses([
        { id: 'b', date: '2026-11-26', createdAt: 2 },
        { id: 'c', date: '2026-11-27', createdAt: 5 },
        { id: 'a', date: '2026-11-26', createdAt: 1 },
        { id: 'd', date: '2026-11-27', createdAt: 3 }
    ]);
    assert.deepEqual(plain(sorted.map(item => item.id)), ['d', 'c', 'a', 'b']);
});

test('CSV export quotes text, guards spreadsheet formulas and includes the TWD amount', () => {
    const context = app();
    const csv = context.expensesToCsv([
        { date: '2026-11-27', name: '=SUM(A1)', amount: 1000, currency: 'JPY', rateToTwd: 0.21, payer: '阿均', category: '', participants: [], createdAt: 2 },
        { date: '2026-11-26', name: '早餐, "飯糰"', amount: 120, currency: 'TWD', rateToTwd: 1, payer: '媽咪', category: '餐飲', participants: ['媽咪', '培芝'], createdAt: 1 }
    ]);
    const lines = csv.split('\r\n');
    assert.equal(lines[0], '日期,項目,金額,幣別,付款人,分類,分帳對象,匯率（1 單位兌台幣）,台幣金額');
    assert.equal(lines[1], '2026-11-26,"早餐, ""飯糰""",120,TWD,媽咪,餐飲,媽咪、培芝,1,120');
    assert.equal(lines[2], "2026-11-27,'=SUM(A1),1000,JPY,阿均,,全部 5 人,0.21,210");
});

test('sync status explains offline, pending uploads and failures', () => {
    const context = app();
    assert.equal(context.describeExpenseSync({ fromCache: false, online: true, syncedAt: '21:05', pending: 0 }), '已同步 21:05');
    assert.equal(context.describeExpenseSync({ fromCache: true, online: true, syncedAt: '', pending: 0 }), '同步中…');
    assert.equal(context.describeExpenseSync({ fromCache: true, online: false, syncedAt: '', pending: 2, notice: '有一筆沒有存成功' }),
        '離線中，顯示手機裡的資料・2 筆等待上傳・有一筆沒有存成功');
});

test('join errors are explained in plain language', () => {
    const context = app();
    assert.match(context.describeJoinError({ code: 'permission-denied' }), /通關碼不正確/);
    assert.match(context.describeJoinError({ code: 'timeout' }), /逾時/);
    assert.match(context.describeJoinError({ code: 'auth/admin-restricted-operation' }), /匿名登入/);
    assert.match(context.describeJoinError(new TypeError('Failed to fetch dynamically imported module')), /網路/);
});

test('Firebase loads lazily from a pinned SDK version and only allows emulators on localhost', () => {
    assert.match(script, /const FIREBASE_SDK_URL = 'https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+';/);
    assert.match(script, /projectId: 'trip-schedule-website'/);
    assert.doesNotMatch(html, /docs\.google\.com/);
    const context = app();
    context.window = { location: { hostname: 'vannweng.github.io', search: '?firebaseEmulator=127.0.0.1' } };
    assert.equal(context.getFirebaseEmulatorHost(), '');
    context.window = { location: { hostname: 'localhost', search: '?firebaseEmulator=127.0.0.1' } };
    assert.equal(context.getFirebaseEmulatorHost(), '127.0.0.1');
});

test('the passcode lives only in Firestore rules data, never in the page', () => {
    assert.match(rules, /match \/tripAccess\/\{tripId\} \{\s*allow read, write: if false;/);
    assert.match(rules, /request\.resource\.data\.code == tripCode\(tripId\)/);
    assert.match(script, /const EXPENSE_TRIP_ID = 'okinawa-2026';/);
    assert.doesNotMatch(script, /['"`]tripAccess/);
});
