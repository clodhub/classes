import { assert, load } from './runtime.mjs';

const m = await load('server/index.ts');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULTS = { groups: 3, groupLength: 4, alphabet: ALPHABET };

// Doubles of the random source. `cycling` returns 0, 1, 2 ... in turn and records each bound it is asked for; `seeded` is
// a small xorshift generator with rejection sampling, so every value in [0, bound) is equally likely.
function cycling() {
  let next = 0;
  const bounds = [];
  return { bounds, int(bound) { bounds.push(bound); return next++ % bound; } };
}
function seeded(seed) {
  let x = seed | 0 || 1;
  const word = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
  return { int(bound) { const limit = Math.floor(0x100000000 / bound) * bound; let value; do value = word(); while (value >= limit); return value % bound; } };
}

// Settings: defaults, rendered text, unrendered placeholders, and refusals (including codes under 40 random bits).
assert.deepEqual(m.DEFAULT_SETTINGS, DEFAULTS);
assert.deepEqual(m.settingsFrom({}), DEFAULTS);
assert.deepEqual(m.settingsFrom({ groups: '{{groups}}', groupLength: '{{groupLength}}', alphabet: '{{alphabet}}' }), DEFAULTS);
assert.deepEqual(m.settingsFrom({ groups: '4', groupLength: '3', alphabet: 'ACDEFGHJKLMNPQRTUVWXY34679' }),
  { groups: 4, groupLength: 3, alphabet: 'ACDEFGHJKLMNPQRTUVWXY34679' });
assert.deepEqual(m.settingsFrom({ groups: 2, groupLength: 6 }), { groups: 2, groupLength: 6, alphabet: ALPHABET });
for (const bad of [{ groups: '0' }, { groups: 'three' }, { groups: 2.5 }, { groups: '9' }, { groupLength: '1' }, { groupLength: '17' },
  { alphabet: 'abcdefghjkmnpqrs' }, { alphabet: 'AABCDEFGHJKMNPQR' }, { alphabet: 'ABC_DEFGHJKMNPQR' }, { alphabet: 7 },
  { groups: '1', groupLength: '4' }, { alphabet: 'AB' }]) {
  assert.throws(() => m.settingsFrom(bad), RangeError, JSON.stringify(bad));
}
const installed = m.installedSettings();
assert.deepEqual(m.settingsFrom(installed), installed);

// Every character is one int(alphabet length) draw, left to right, mapped to the alphabet in order: no modulo of a wider range.
const counter = cycling();
const codes = m.createVoucherCodes({ source: counter, ...DEFAULTS });
assert.deepEqual(codes.settings, DEFAULTS);
assert.equal(codes.generate(), 'ABCD-EFGH-JKLM');
assert.equal(codes.generate(), 'NPQR-STUV-WXYZ');
assert.equal(codes.generate(), '2345-6789-ABCD');
assert.equal(codes.generateShort(6), 'EFGHJK');
assert.equal(counter.bounds.length, 42);
assert.ok(counter.bounds.every((bound) => bound === 32));
// Short codes are not held to the 40-bit floor of the settings: email verification uses 6 characters.
assert.equal(codes.generateShort(1), 'L');

// With a uniform source every character of the alphabet turns up about equally often.
const random = m.createVoucherCodes({ source: seeded(20261126), ...DEFAULTS });
const counts = new Map();
const seen = new Set();
for (let i = 0; i < 400; i++) {
  const code = random.generate();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  seen.add(code);
  for (const char of code.replaceAll('-', '')) counts.set(char, (counts.get(char) ?? 0) + 1);
}
assert.equal(seen.size, 400);
assert.equal(counts.size, 32);
assert.ok([...counts.values()].every((count) => count > 90 && count < 210), JSON.stringify([...counts]));
assert.match(random.generateShort(6), /^[A-HJ-NP-Z2-9]{6}$/);

// A missing source, a value outside [0, bound) and bad lengths are refused.
assert.throws(() => m.createVoucherCodes({}), TypeError);
assert.throws(() => m.createVoucherCodes({ source: {} }), TypeError);
for (const value of [32, -1, 1.5, Number.NaN, '3']) {
  assert.throws(() => m.createVoucherCodes({ source: { int: () => value }, ...DEFAULTS }).generate(), RangeError, String(value));
}
assert.throws(() => m.createVoucherCodes({ source: counter, groups: 1, groupLength: 4 }), RangeError);
for (const length of [0, 65, 2.5, '6']) assert.throws(() => codes.generateShort(length), RangeError, String(length));

// Reading typed codes: case, surrounding space, spaces and hyphens, and the compact form; anything else is null.
assert.equal(codes.normalise(' abcd efgh jkmn '), 'ABCD-EFGH-JKMN');
assert.equal(codes.normalise('abcdefghjkmn'), 'ABCD-EFGH-JKMN');
assert.equal(codes.normalise('ABCD-EFGH-JKMN'), 'ABCD-EFGH-JKMN');
assert.equal(codes.normalise('abcd - efgh - jkmn'), 'ABCD-EFGH-JKMN');
for (const text of ['ABCD-EFGH-JKM', 'ABCD-EFGH-JKMNP', 'ABCD-EFGH-JKM0', 'ABCD_EFGH_JKMN', '', '   ']) assert.equal(codes.normalise(text), null, text);
for (const value of [null, undefined, 42, {}, ['ABCD-EFGH-JKMN']]) assert.equal(codes.normalise(value), null);
assert.equal(codes.isCode('abcd efgh jkmn'), true);
assert.equal(codes.isCode('ABCD-EFGH'), false);
assert.equal(codes.isCode(7), false);
const custom = m.createVoucherCodes({ source: seeded(7), groups: 4, groupLength: 3, alphabet: 'ACDEFGHJKLMNPQRTUVWXY34679' });
assert.match(custom.generate(), /^[ACDEFGHJKLMNPQRTUVWXY34679]{3}(-[ACDEFGHJKLMNPQRTUVWXY34679]{3}){3}$/);
assert.equal(custom.normalise('acd efg hjk lmn'), 'ACD-EFG-HJK-LMN');
assert.equal(custom.normalise('ABCD-EFGH-JKMN'), null);

// Collisions: a taken code is replaced by a new one; after `attempts` collisions the last error is thrown; other errors at once.
const collision = new Error('duplicate key');
const isCollision = (error) => error === collision;
const retrying = m.createVoucherCodes({ source: cycling(), ...DEFAULTS });
const tried = [];
const stored = await retrying.withRetry(async (code) => {
  tried.push(code);
  if (code === 'ABCD-EFGH-JKLM') throw collision;
  return { code };
}, isCollision);
assert.deepEqual(tried, ['ABCD-EFGH-JKLM', 'NPQR-STUV-WXYZ']);
assert.deepEqual(stored, { code: 'NPQR-STUV-WXYZ' });
let calls = 0;
await assert.rejects(retrying.withRetry(async () => { calls++; throw collision; }, isCollision, 4), (error) => error === collision);
assert.equal(calls, 4);
calls = 0;
await assert.rejects(retrying.withRetry(async () => { calls++; throw collision; }, isCollision), (error) => error === collision);
assert.ok(calls >= 2, 'the default retries at least once');
calls = 0;
const unavailable = new Error('store unavailable');
await assert.rejects(retrying.withRetry(async () => { calls++; throw unavailable; }, isCollision), (error) => error === unavailable);
assert.equal(calls, 1);
for (const attempts of [0, 1.5]) await assert.rejects(async () => retrying.withRetry(async (code) => code, isCollision, attempts), RangeError);
console.log('voucher codes class: all checks passed');
