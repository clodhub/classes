import { assert, load } from './runtime.mjs';

const web = await load('web/index.ts');
const server = await load('server/index.ts');
const NAMES = ['DEFAULT_SETTINGS', 'createBasket', 'installedSettings', 'parseRequestedLines', 'restoreBasket', 'settingsFrom', 'totalMinutes', 'totalPrice'];
for (const name of NAMES) assert.equal(typeof server[name], typeof web[name], `web and server both export ${name}`);

const massage = { itemSlug: 'relaxing-massage', itemName: 'Relaxing Massage', categorySlug: 'massage', minutes: 60, price: 7000 };
const facial = { itemSlug: 'deep-facial', itemName: 'Deep Facial', categorySlug: 'facial-care', minutes: 60, price: 9500 };
const short = { ...massage, minutes: 45, price: 6000 };
const counter = () => {
  let n = 0;
  return () => `line-${++n}`;
};

for (const m of [web, server]) {
  // Settings.
  assert.deepEqual(m.settingsFrom({ gapMinutes: '{{gapMinutes}}', maximumLines: '{{maximumLines}}' }), m.DEFAULT_SETTINGS);
  assert.deepEqual(m.settingsFrom({ gapMinutes: '10', maximumLines: '3' }), { gapMinutes: 10, maximumLines: 3 });
  for (const bad of [{ gapMinutes: '-1' }, { gapMinutes: 'five' }, { maximumLines: '0' }, { maximumLines: 2.5 }]) assert.throws(() => m.settingsFrom(bad), RangeError);
  assert.deepEqual(m.settingsFrom(m.installedSettings()), m.installedSettings());

  // Totals: the lengths with a gap between each two lines, and the prices.
  assert.equal(m.totalMinutes([], 5), 0);
  assert.equal(m.totalMinutes([{ minutes: 60 }], 5), 60);
  assert.equal(m.totalMinutes([{ minutes: 60 }, { minutes: 45 }, { minutes: 30 }], 5), 145);
  assert.equal(m.totalMinutes([{ minutes: 60 }, { minutes: 45 }], 0), 105);
  assert.equal(m.totalPrice([{ price: 7000 }, { price: 9500 }]), 16500);
  assert.throws(() => m.totalPrice([{ price: 1.5 }]), RangeError);

  // A basket: ids, add, remove, clear, limits and refusals.
  const basket = m.createBasket({ gapMinutes: 5, maximumLines: 3, newId: counter() });
  assert.deepEqual(basket.add(massage), { ok: true, id: 'line-1' });
  assert.deepEqual(basket.add(facial), { ok: true, id: 'line-2' });
  assert.deepEqual(basket.lines(), [{ id: 'line-1', ...massage }, { id: 'line-2', ...facial }]);
  assert.deepEqual(basket.totals(), { count: 2, minutes: 125, price: 16500 });
  for (const bad of [{ ...massage, minutes: 0 }, { ...massage, price: -1 }, { ...massage, price: 75.5 }, { ...massage, itemSlug: '' }, { ...massage, itemName: '' }, null]) {
    assert.deepEqual(basket.add(bad), { ok: false, code: 'INVALID_LINE' });
  }
  assert.deepEqual(basket.add(short), { ok: true, id: 'line-3' });
  assert.deepEqual(basket.add(short), { ok: false, code: 'BASKET_FULL' });
  assert.equal(basket.remove('line-2'), true);
  assert.equal(basket.remove('line-2'), false);
  assert.deepEqual(basket.totals(), { count: 2, minutes: 110, price: 13000 });
  const random = m.createBasket().add(massage);
  assert.ok(random.ok && random.id.length >= 16);

  // Subscribe and a snapshot that stays the same object until a change.
  const watched = m.createBasket({ newId: counter() });
  const empty = watched.snapshot();
  assert.deepEqual(empty, { lines: [], totals: { count: 0, minutes: 0, price: 0 } });
  assert.equal(watched.snapshot(), empty);
  let calls = 0;
  const stop = watched.subscribe(() => calls++);
  watched.add(massage);
  assert.equal(calls, 1);
  const one = watched.snapshot();
  assert.notEqual(one, empty);
  assert.equal(watched.snapshot(), one);
  assert.deepEqual(one.totals, { count: 1, minutes: 60, price: 7000 });
  watched.remove('none');
  assert.equal(watched.snapshot(), one);
  stop();
  watched.clear();
  assert.equal(calls, 1);
  assert.deepEqual(watched.lines(), []);
  assert.throws(() => { one.lines.push({}); });

  // Saved text and restore; anything else gives an empty basket.
  const kept = m.createBasket({ newId: counter() });
  kept.add(massage);
  kept.add(facial);
  const restored = m.restoreBasket(kept.serialise(), { newId: () => 'line-9' });
  assert.deepEqual(restored.lines(), kept.lines());
  assert.deepEqual(restored.totals(), { count: 2, minutes: 125, price: 16500 });
  assert.deepEqual(restored.add(short), { ok: true, id: 'line-9' });
  for (const text of [null, '', 'not json', '[]', '{}', '{"lines":"x"}']) assert.deepEqual(m.restoreBasket(text).lines(), []);
  assert.equal(m.createBasket({ lines: [{ id: 'a', ...massage }] }).totals().price, 7000);
  assert.throws(() => m.createBasket({ lines: [massage] }), RangeError);

  // The lines a request posts, as the server reads them.
  assert.deepEqual(m.parseRequestedLines([{ id: 'line-1', ...massage, price: 1 }, { itemSlug: 'deep-facial', minutes: 60 }]), { ok: true, lines: [
    { itemSlug: 'relaxing-massage', minutes: 60, categorySlug: 'massage' }, { itemSlug: 'deep-facial', minutes: 60, categorySlug: '' }] });
  for (const raw of [null, {}, [], [{ minutes: 60 }], [{ itemSlug: 'deep-facial' }], [{ itemSlug: 'deep-facial', minutes: -1 }], [{ itemSlug: 'deep-facial', minutes: 1.5 }]]) {
    assert.deepEqual(m.parseRequestedLines(raw), { ok: false, code: 'INVALID_LINES' });
  }
  assert.deepEqual(m.parseRequestedLines([massage, massage, massage], { maximumLines: 2 }), { ok: false, code: 'INVALID_LINES' });
  assert.equal(m.parseRequestedLines([massage, massage], { maximumLines: 2 }).ok, true);
}
console.log('basket class: all checks passed');
