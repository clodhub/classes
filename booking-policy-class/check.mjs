import { assert, load } from './runtime.mjs';

const web = await load('web/index.ts');
const m = await load('server/index.ts');
const HOUR = 3_600_000;
const MINUTE = 60_000;
const start = new Date('2026-03-10T09:00:00Z');
const before = (ms) => new Date(start.getTime() - ms);

for (const name of ['depositAndBalance', 'freeCancellationDeadline', 'freeCancellation', 'refundEligible', 'cardConsumedByCancellation', 'holdActive',
  'checkoutExpiry', 'checkDuration', 'settingsFrom', 'installedSettings']) {
  assert.equal(typeof web[name], 'function', name);
  assert.equal(typeof m[name], 'function', name);
}

// Settings.
const defaults = { depositPercent: 50, freeCancellationHours: 24, holdMinutes: 40, checkoutMinutes: 35, minimumMinutes: 15, maximumMinutes: 360 };
assert.deepEqual(m.settingsFrom({}), defaults);
assert.deepEqual(m.settingsFrom(Object.fromEntries(Object.keys(defaults).map((key) => [key, `{{${key}}}`]))), defaults);
assert.deepEqual(m.settingsFrom({ depositPercent: '30', freeCancellationHours: '48' }), { ...defaults, depositPercent: 30, freeCancellationHours: 48 });
assert.throws(() => m.settingsFrom({ depositPercent: '120' }), RangeError);
assert.throws(() => m.settingsFrom({ checkoutMinutes: '30' }), RangeError);
assert.throws(() => m.settingsFrom({ holdMinutes: '20' }), RangeError);
assert.throws(() => m.settingsFrom({ minimumMinutes: '400' }), RangeError);
assert.equal(typeof m.installedSettings().depositPercent, 'number');

// Deposit and balance: the deposit share less the card, never below nothing; the card never counts for more than the total.
assert.deepEqual(m.depositAndBalance(6000, 0, 50), { deposit: 3000, balance: 3000 });
assert.deepEqual(m.depositAndBalance(7501, 0, 50), { deposit: 3751, balance: 3750 });
assert.deepEqual(m.depositAndBalance(6000, 2000, 50), { deposit: 1000, balance: 3000 });
assert.deepEqual(m.depositAndBalance(6000, 4000, 50), { deposit: 0, balance: 2000 });
assert.deepEqual(m.depositAndBalance(6000, 8000, 50), { deposit: 0, balance: 0 });
assert.deepEqual(m.depositAndBalance(13000, 6000, 50), { deposit: 500, balance: 6500 });
assert.deepEqual(m.depositAndBalance(15500, 0, 30), { deposit: 4650, balance: 10850 });
assert.deepEqual(m.depositAndBalance(15500, 0, 0), { deposit: 0, balance: 15500 });
assert.deepEqual(m.depositAndBalance(15500, 0, 100), { deposit: 15500, balance: 0 });
assert.throws(() => m.depositAndBalance(100.5, 0, 50), RangeError);
assert.throws(() => m.depositAndBalance(100, -1, 50), RangeError);
assert.throws(() => m.depositAndBalance(100, 0, 101), RangeError);

// Cancellation: free for the owner, or for the customer strictly before the deadline; refunds need a deposit; a late
// customer cancellation uses up a gift card whether or not there was a deposit.
assert.deepEqual(m.freeCancellationDeadline(start, 24), new Date('2026-03-09T09:00:00Z'));
const terms = (now, by) => ({ startsAt: start, now, by, freeCancellationHours: 24 });
assert.equal(m.freeCancellation(terms(before(24 * HOUR + 1), 'customer')), true);
assert.equal(m.freeCancellation(terms(before(24 * HOUR), 'customer')), false);
assert.equal(m.freeCancellation(terms(before(HOUR), 'owner')), true);
assert.equal(m.refundEligible({ ...terms(before(25 * HOUR), 'customer'), hasDeposit: true }), true);
assert.equal(m.refundEligible({ ...terms(before(25 * HOUR), 'customer'), hasDeposit: false }), false);
assert.equal(m.refundEligible({ ...terms(before(HOUR), 'customer'), hasDeposit: true }), false);
assert.equal(m.refundEligible({ ...terms(before(HOUR), 'owner'), hasDeposit: true }), true);
assert.equal(m.cardConsumedByCancellation({ ...terms(before(HOUR), 'customer'), hasCard: true }), true);
assert.equal(m.cardConsumedByCancellation({ ...terms(before(25 * HOUR), 'customer'), hasCard: true }), false);
assert.equal(m.cardConsumedByCancellation({ ...terms(before(HOUR), 'owner'), hasCard: true }), false);
assert.equal(m.cardConsumedByCancellation({ ...terms(before(HOUR), 'customer'), hasCard: false }), false);
assert.throws(() => m.freeCancellation({ ...terms(before(HOUR), 'customer'), startsAt: new Date('x') }), RangeError);

// Holds, checkout expiry and durations.
const now = new Date('2026-03-02T12:00:00.750Z');
assert.equal(m.holdActive(new Date(now.getTime() - 40 * MINUTE + 1), now, 40), true);
assert.equal(m.holdActive(new Date(now.getTime() - 40 * MINUTE), now, 40), false);
assert.deepEqual(m.checkoutExpiry(now, 35), new Date('2026-03-02T12:35:00.000Z'));
assert.deepEqual(m.checkoutExpiry(now, 31), new Date('2026-03-02T12:31:00.000Z'));
assert.throws(() => m.checkoutExpiry(now, 30), RangeError);
assert.throws(() => m.checkoutExpiry(now, 1441), RangeError);
assert.deepEqual(m.checkDuration(15, defaults), { ok: true });
assert.deepEqual(m.checkDuration(360, defaults), { ok: true });
assert.deepEqual(m.checkDuration(14, defaults), { ok: false, code: 'INVALID_DURATION' });
assert.deepEqual(m.checkDuration(361, defaults), { ok: false, code: 'INVALID_DURATION' });
assert.deepEqual(m.checkDuration(60.5, defaults), { ok: false, code: 'INVALID_DURATION' });
assert.deepEqual(m.checkDuration('60', defaults), { ok: false, code: 'INVALID_DURATION' });
console.log('booking-policy class: all checks passed');
