import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const members = ['阿均', '國恒', '媽咪', '阿猿', '培芝'];

function app() {
    const context = vm.createContext({ document: { addEventListener() {} } });
    vm.runInContext(script, context);
    vm.runInContext('expenseRates = { rates: { TWD: 30, JPY: 150, USD: 1 } };', context);
    return context;
}

function expense(overrides = {}) {
    return { amount: 500, currency: '台幣', payer: '阿均', ...overrides };
}

function split(context, items) {
    return JSON.parse(JSON.stringify(context.calculateExpenseSplit(items)));
}

function assertSettles(context, result) {
    const pending = new Map(result.balances.map(person => [person.name, Math.round(person.balance * 100)]));
    const paid = result.balances.reduce((sum, person) => sum + Math.round(person.paid * 100), 0);
    const owed = result.balances.reduce((sum, person) => sum + Math.round(person.owed * 100), 0);
    assert.equal(paid, Math.round(result.total * 100));
    assert.equal(owed, paid);
    for (const transfer of context.buildTransfers(result.balances)) {
        const cents = Math.round(transfer.amount * 100);
        assert.ok(cents > 0);
        pending.set(transfer.from, pending.get(transfer.from) + cents);
        pending.set(transfer.to, pending.get(transfer.to) - cents);
    }
    assert.ok([...pending.values()].every(value => value === 0));
}

test('blank selection and legacy records split among all five members', () => {
    const context = app();
    for (const participants of [undefined, '', '  ', []]) {
        const result = split(context, [expense({ participants })]);
        assert.deepEqual(result.balances.map(person => person.name), members);
        assert.ok(result.balances.every(person => person.owed === 100));
        assertSettles(context, result);
    }
});

test('Google Forms CSV parses quoted checkbox names and descriptive column titles', () => {
    const context = app();
    const csv = '時間戳記,日期,項目,金額 (輸入數字就好）,幣別,付款人,分類,分帳對象(未勾選=全部分帳）\r\n'
        + '2026/11/26 12:00:00,2026/11/26,午餐,120,台幣,培芝,餐飲,"阿均, 國恒"';
    const records = context.sheetRowsToExpenses(context.parseCsv(csv));
    assert.equal(records.length, 1);
    assert.deepEqual([...records[0].participants], ['阿均', '國恒']);
    const result = split(context, records);
    assert.equal(result.balances.find(person => person.name === '阿均').owed, 60);
    assert.equal(result.balances.find(person => person.name === '培芝').balance, 120);
    assertSettles(context, result);
});

test('missing participant column retains the all-member default', () => {
    const context = app();
    const records = context.sheetRowsToExpenses(context.parseCsv('日期,項目,金額,幣別,付款人\n2026/11/26,午餐,500,台幣,阿均'));
    assert.equal(context.describeExpenseParticipants(records[0]), '全部 5 人');
    assert.ok(split(context, records).balances.every(person => person.owed === 100));
});

for (const count of [1, 2, 3, 4]) {
    test(`${count} selected members bear the cost while a nonparticipant payer receives repayment`, () => {
        const context = app();
        const selected = members.slice(0, count);
        const result = split(context, [expense({ amount: count * 100, payer: '培芝', participants: selected })]);
        for (const person of result.balances) {
            assert.equal(person.owed, selected.includes(person.name) ? 100 : 0);
        }
        assert.equal(result.balances.find(person => person.name === '培芝').balance, count * 100);
        assert.equal(context.buildTransfers(result.balances).length, count);
        assertSettles(context, result);
    });
}

test('payer included in the selection only recovers the other members’ shares', () => {
    const context = app();
    const result = split(context, [expense({ amount: 300, participants: ['阿均', '國恒', '媽咪'] })]);
    assert.equal(result.balances[0].balance, 200);
    assertSettles(context, result);
});

test('mixed all-member, couple and personal expenses accumulate individual obligations', () => {
    const context = app();
    const result = split(context, [
        expense(),
        expense({ amount: 200, payer: '國恒', participants: ['阿猿', '培芝'] }),
        expense({ amount: 50, payer: '培芝', participants: ['媽咪'] })
    ]);
    assert.deepEqual(result.balances.map(person => person.owed), [100, 100, 150, 200, 200]);
    assert.deepEqual(result.balances.map(person => person.balance), [400, 100, -150, -200, -150]);
    assertSettles(context, result);
});

test('a payer outside the five-person group is still credited for advances', () => {
    const context = app();
    const result = split(context, [expense({ payer: '旅伴' })]);
    assert.equal(result.balances.find(person => person.name === '旅伴').balance, 500);
    assert.equal(result.balances.find(person => person.name === '旅伴').owed, 0);
    assertSettles(context, result);
});

test('JPY converts before per-expense shares are accumulated with TWD expenses', () => {
    const context = app();
    const result = split(context, [
        expense({ currency: '日圓', participants: ['阿均', '國恒'] }),
        expense({ amount: 100, payer: '媽咪' })
    ]);
    assert.equal(result.total, 200);
    assert.deepEqual(result.balances.map(person => person.owed), [70, 70, 20, 20, 20]);
    assertSettles(context, result);
});

test('duplicate names and checkbox separators do not count anyone twice', () => {
    const context = app();
    const result = split(context, [expense({ amount: 200, participants: ' 阿均，國恒、阿均; ' })]);
    assert.deepEqual(result.balances.map(person => person.owed), [100, 100, 0, 0, 0]);
    assertSettles(context, result);
});

test('converted totals use the same per-entry cent rounding as settlement', () => {
    const context = app();
    vm.runInContext('expenseRates = { rates: { TWD: 31.905, JPY: 150 } };', context);
    const items = [expense({ amount: 1, currency: '日圓' }), expense({ amount: 1, currency: '日圓' })];
    const result = split(context, items);
    assert.equal(result.total, 0.42);
    assert.equal(items.reduce((sum, item) => sum + context.toTwdCents(item), 0) / 100, result.total);
    assertSettles(context, result);
});

test('cent remainders and sub-dollar transfers conserve the full amount', () => {
    const context = app();
    const result = split(context, [expense({ amount: 0.1, participants: members.slice(1, 4) })]);
    assert.deepEqual(result.balances.map(person => person.owed), [0, 0.04, 0.03, 0.03, 0]);
    assert.equal(context.formatTwd(0.04), 'NT$0.04');
    assertSettles(context, result);
});

test('refunds reverse the selected members’ obligations without losing cents', () => {
    const context = app();
    const result = split(context, [expense({ amount: -100, participants: members.slice(1, 4) })]);
    assert.deepEqual(result.balances.map(person => person.owed), [0, -33.34, -33.33, -33.33, 0]);
    assertSettles(context, result);
});

test('unsupported currencies and missing payers are counted but excluded from settlement', () => {
    const context = app();
    const result = split(context, [expense(), expense({ currency: '未知幣別' }), expense({ payer: '' })]);
    assert.equal(result.total, 500);
    assert.equal(result.skippedCurrency, 1);
    assert.equal(result.skippedPayer, 1);
    assertSettles(context, result);
});

test('self-paid personal costs and an empty ledger require no transfers', () => {
    const context = app();
    for (const items of [[], [expense({ participants: ['阿均'] })]]) {
        const result = split(context, items);
        assert.equal(context.buildTransfers(result.balances).length, 0);
        assertSettles(context, result);
    }
});
