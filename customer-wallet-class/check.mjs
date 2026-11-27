import { assert, load } from './runtime.mjs';

const m = await load('web/index.ts');
for (const name of ['merge', 'prune', 'createWallet', 'exportAll', 'importAll']) assert.equal(typeof m[name], 'function', name);
assert.deepEqual(m.WALLET_KINDS, ['booking', 'giftCard', 'giftCardPurchase', 'member']);

const at = (text) => (text === null ? null : new Date(text));
const item = (kind, id, secret, snapshot = null, refreshedAt = null, expiresAt = null) => ({ kind, id, secret, snapshot, refreshedAt: at(refreshedAt), expiresAt: at(expiresAt) });
const plain = (list) => list.map((x) => [x.kind, x.id, x.secret, x.snapshot, x.refreshedAt?.toISOString() ?? null, x.expiresAt?.toISOString() ?? null]);

// Merge: one item per kind and id, kind order then id order; the later refresh wins; a secret never becomes empty.
const booking = item('booking', '6a1f00000000000000000003', 'token', '{"status":"confirmed"}', '2027-02-20T10:00:00.000Z', '2027-03-01T09:00:00.000Z');
const newer = item('booking', '6a1f00000000000000000003', '', '{"status":"cancelled"}', '2027-02-22T10:00:00.000Z', '2027-03-01T09:00:00.000Z');
const imported = item('booking', '6a1f00000000000000000003', 'token-2');
const card = item('giftCard', 'G4HR', 'G4HR');
const member = item('member', 'M-1', 'M-1');
assert.deepEqual(plain(m.merge([member, booking], [card])), plain([booking, card, member]));
assert.deepEqual(plain(m.merge([booking], [newer])), [['booking', booking.id, 'token', '{"status":"cancelled"}', '2027-02-22T10:00:00.000Z', '2027-03-01T09:00:00.000Z']]);
assert.deepEqual(plain(m.merge([newer], [booking])), plain(m.merge([booking], [newer])));
assert.deepEqual(plain(m.merge([booking], [imported])), plain([booking]));
assert.deepEqual(plain(m.merge([{ ...booking, secret: '' }], [imported])), [['booking', booking.id, 'token-2', '{"status":"confirmed"}', '2027-02-20T10:00:00.000Z', '2027-03-01T09:00:00.000Z']]);
assert.deepEqual(plain(m.merge([item('member', 'b', 's'), item('member', 'B', 's'), item('member', '1', 's')], [])).map((x) => x[1]), ['1', 'B', 'b']);
assert.throws(() => m.merge([{ ...card, kind: 'voucher' }], []), RangeError);

// Prune: kept while expired at most keepDays ago.
const now = new Date('2027-03-31T09:00:00.000Z');
assert.deepEqual(plain(m.prune([booking, card], now, 30)), plain([booking, card]));
assert.deepEqual(plain(m.prune([booking, card], new Date(now.getTime() + 1), 30)), plain([card]));
assert.throws(() => m.prune([card], now, -1), RangeError);

// The wallet in a storage.
const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
const wallet = m.createWallet(storage, { now: () => now });
const heard = [];
wallet.subscribe((list) => heard.push(list.length));
wallet.put([card, booking]);
assert.deepEqual(plain(m.createWallet(storage).items()), plain([booking, card]));
assert.equal(wallet.remove('giftCard', 'G4HR'), true);
assert.equal(wallet.remove('giftCard', 'G4HR'), false);
const text = m.exportAll(storage);
wallet.clear();
assert.deepEqual(wallet.items(), []);
assert.deepEqual(m.importAll(storage, text + 'junk\n'), { imported: 1, rejected: ['junk'] });
assert.deepEqual(plain(wallet.items()), plain([booking]));
assert.deepEqual(heard, [2, 1, 0]);
