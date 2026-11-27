import { assert, load } from './runtime.mjs';
import { createStore } from './records.ts';

const web = await load('web/index.ts');
const server = await load('server/index.ts');
let clock = Date.parse('2026-03-02T10:00:00.000Z');
const now = () => new Date(clock);
const minutes = (count) => { clock += count * 60_000; };
const base64 = (bytes) => Buffer.alloc(bytes, 1).toString('base64');
const index = [
  { slug: 'relaxing-massage', categorySlug: 'massage' },
  { slug: 'aromatherapy-massage', categorySlug: 'massage' },
  { slug: 'deep-facial', categorySlug: 'facials' },
];
const scope = (fields) => ({ itemSlugs: [], categorySlugs: [], allItems: false, ...fields });
const pack = { title: { en: 'Spring pack', es: 'Bono de primavera' }, itemSlugs: ['relaxing-massage'], packSize: 5, discountPercent: 10 };

// Both entry modules give the pure functions; settings default as the class declares.
for (const name of ['coversItem', 'coveredItems', 'packPrice', 'packOffer', 'linkTarget', 'validatePromotionInput', 'checkValues', 'dueChanges',
  'settingsFrom', 'installedSettings']) {
  assert.equal(typeof web[name], 'function', name);
  assert.equal(typeof server[name], 'function', name);
}
assert.equal(typeof server.createPromotions, 'function');
const defaults = { maximumPackSize: 100, maximumImageBytes: 524288, featuredCount: 2, imageTypes: ['jpeg', 'png', 'webp', 'gif'] };
assert.deepEqual(web.settingsFrom({}), defaults);
assert.deepEqual(web.settingsFrom({ maximumPackSize: '{{maximumPackSize}}', featuredCount: '4', imageTypes: 'png webp' }),
  { ...defaults, featuredCount: 4, imageTypes: ['png', 'webp'] });
assert.throws(() => web.settingsFrom({ featuredCount: '0' }), RangeError);
assert.throws(() => web.settingsFrom({ imageTypes: 'image/png' }), RangeError);

// Coverage: all items, named items, or the item's own category; covered items and links in catalogue order.
assert.equal(web.coversItem(scope({ categorySlugs: ['facials'] }), 'relaxing-massage', 'massage'), false);
assert.equal(web.coversItem(scope({ categorySlugs: ['massage'] }), 'aromatherapy-massage', 'massage'), true);
assert.equal(web.coversItem(scope({ itemSlugs: ['deep-facial'] }), 'deep-facial', 'facials'), true);
assert.equal(web.coversItem(scope({ allItems: true }), 'x', 'y'), true);
assert.deepEqual(web.coveredItems(scope({ itemSlugs: ['deep-facial', 'gone'], categorySlugs: ['massage'] }), index).map((item) => item.slug),
  ['deep-facial', 'relaxing-massage', 'aromatherapy-massage']);
assert.deepEqual(web.coveredItems(scope({ allItems: true }), index), index);
assert.deepEqual(web.linkTarget(scope({ itemSlugs: ['gone', 'deep-facial'] }), index, null), { itemSlug: 'deep-facial', categorySlug: 'facials' });
assert.deepEqual(web.linkTarget(scope({ categorySlugs: ['massage'] }), index, null), { itemSlug: 'relaxing-massage', categorySlug: 'massage' });
assert.deepEqual(web.linkTarget(scope({ allItems: true }), index, 'aromatherapy-massage'), { itemSlug: 'aromatherapy-massage', categorySlug: 'massage' });
assert.equal(web.linkTarget(scope({ allItems: true }), index, null), null);

// Pack prices in whole currency units, rounded half up; the offer is priced from the catalogue option.
assert.equal(web.packPrice(7500, 5, 10), 33800);
assert.equal(web.packPrice(4550, 1, 15), 3900);
assert.equal(web.packPrice(1250, 2, 10, 0), 2250);
assert.equal(web.packPrice(12345, 2, 10, 3), 22000);
assert.throws(() => web.packPrice(100, 0, 10), RangeError);
assert.throws(() => web.packPrice(100.5, 1, 10), RangeError);
const promo = { _id: 'p1', active: true, packSize: 5, discountPercent: 10, ...scope({ categorySlugs: ['massage'] }) };
const massage = { slug: 'relaxing-massage', categorySlug: 'massage', options: [{ minutes: 45, price: 6000 }, { minutes: 60, price: 7000 }] };
assert.deepEqual(web.packOffer(promo, massage, 60), { ok: true, pack: { promotionId: 'p1', packSize: 5, discountPercent: 10, price: 31500 }, itemPrice: 7000, minutes: 60 });
assert.deepEqual(web.packOffer({ ...promo, active: false }, massage, 60), { ok: false, code: 'INACTIVE' });
assert.deepEqual(web.packOffer(promo, { ...massage, categorySlug: 'facials', slug: 'deep-facial' }, 60), { ok: false, code: 'NOT_COVERED' });
assert.deepEqual(web.packOffer(promo, massage, 30), { ok: false, code: 'UNKNOWN_OPTION' });

// Input checks: required fields, bounds, image limits measured from the data, instants with zones.
const check = (input, settings, partial) => web.validatePromotionInput(input, settings ?? defaults, partial);
const checked = check({ ...pack, title: { en: ' Spring pack ', fr: 'Forfait' }, packSize: 500, discountPercent: 150 });
assert.ok(checked.ok);
assert.deepEqual(checked.value, { title: { en: 'Spring pack', fr: 'Forfait' }, conditions: {}, itemSlugs: ['relaxing-massage'], categorySlugs: [],
  allItems: false, packSize: 100, discountPercent: 99, image: null, activateAt: null, deactivateAt: null });
for (const input of [{ ...pack, title: {} }, { ...pack, packSize: 0 }, { ...pack, discountPercent: undefined }, { ...pack, itemSlugs: [] }, 'x']) {
  assert.deepEqual(check(input), { ok: false, code: 'MISSING_FIELDS' }, JSON.stringify(input));
}
const withImage = check({ ...pack, image: { data: base64(defaults.maximumImageBytes), mimeType: 'image/png', bytes: 1 } });
assert.ok(withImage.ok);
assert.equal(withImage.value.image.bytes, defaults.maximumImageBytes);
assert.deepEqual(check({ ...pack, image: { data: base64(defaults.maximumImageBytes + 1), mimeType: 'image/png' } }), { ok: false, code: 'IMAGE_TOO_LARGE' });
assert.deepEqual(check({ ...pack, image: { data: base64(8), mimeType: 'image/svg+xml' } }), { ok: false, code: 'IMAGE_TYPE' });
assert.deepEqual(check({ ...pack, image: { data: '%%%%', mimeType: 'image/png' } }), { ok: false, code: 'IMAGE_TYPE' });
assert.deepEqual(check({ ...pack, activateAt: '2026-04-01T10:00' }), { ok: false, code: 'INVALID_DATES' });
assert.deepEqual(check({ ...pack, activateAt: '2026-04-02T00:00:00Z', deactivateAt: '2026-04-01T00:00:00Z' }), { ok: false, code: 'INVALID_DATES' });
assert.deepEqual(check({ packSize: 3, image: null }, defaults, true), { ok: true, value: { packSize: 3, image: null } });
assert.equal(web.checkValues({ ...checked.value, itemSlugs: [] }), 'MISSING_FIELDS');
assert.equal(web.checkValues(checked.value), null);

// Due schedules: a passed start switches on, a passed end switches off, both passed stays off.
const at = new Date('2026-05-01T12:00:00Z');
assert.deepEqual(web.dueChanges([
  { _id: 'a', active: false, activateAt: '2026-05-01T11:00:00Z', deactivateAt: null },
  { _id: 'b', active: true, activateAt: null, deactivateAt: new Date('2026-05-01T12:00:00Z') },
  { _id: 'c', active: false, activateAt: '2026-05-01T09:00:00Z', deactivateAt: '2026-05-01T10:00:00Z' },
  { _id: 'd', active: false, activateAt: '2026-05-01T13:00:00Z', deactivateAt: null },
], at), { activate: ['a'], deactivate: ['b'] });

// The service over a records store: new promotions start off; get refuses inactive ones; schedules run by the injected clock.
const records = createStore({ now });
const promotions = server.createPromotions({ records, now });
await promotions.ensureIndexes();
const created = await promotions.create(pack);
assert.ok(created.ok);
const id = created.promotion._id;
assert.equal(created.promotion.active, false);
assert.deepEqual(created.promotion.createdAt, now());
assert.deepEqual(await promotions.get(id), { ok: false, code: 'INACTIVE' });
assert.deepEqual(await promotions.get('nothing'), { ok: false, code: 'NOT_FOUND' });
assert.deepEqual(await promotions.create({ ...pack, discountPercent: 0 }), { ok: false, code: 'MISSING_FIELDS' });
minutes(1);
const on = await promotions.setActive(id, true);
assert.ok(on.ok && on.promotion.active);
assert.equal((await promotions.get(id)).ok, true);

const scheduled = await promotions.create({ ...pack, title: { en: 'Scheduled' }, activateAt: new Date(clock + 60 * 60_000), deactivateAt: new Date(clock + 120 * 60_000).toISOString() });
assert.ok(scheduled.ok);
assert.deepEqual((await promotions.list({ activeOnly: true })).map((item) => item._id), [id]);
minutes(60);
assert.deepEqual((await promotions.featured()).map((item) => item.title.en), ['Scheduled', 'Spring pack']);
assert.deepEqual((await promotions.featured(1)).map((item) => item.title.en), ['Scheduled']);
minutes(60);
assert.deepEqual(await promotions.get(scheduled.promotion._id), { ok: false, code: 'INACTIVE' });
assert.deepEqual(await promotions.applySchedules(), { activated: 0, deactivated: 0 });

// A switch by hand is not undone by a schedule that has passed.
const started = await promotions.create({ ...pack, title: { en: 'Started' }, activateAt: now() });
assert.ok(started.ok);
assert.equal((await promotions.get(started.promotion._id)).ok, true);
await promotions.setActive(started.promotion._id, false);
assert.deepEqual(await promotions.applySchedules(), { activated: 0, deactivated: 0 });
assert.deepEqual(await promotions.get(started.promotion._id), { ok: false, code: 'INACTIVE' });
assert.deepEqual(await promotions.setActive(started.promotion._id, 'on'), { ok: false, code: 'MISSING_FIELDS' });

// Updates change the fields given and keep the promotion coherent; removal.
minutes(1);
const updated = await promotions.update(id, { packSize: 3, image: { data: base64(10), mimeType: 'image/webp' } });
assert.ok(updated.ok);
assert.deepEqual([updated.promotion.packSize, updated.promotion.discountPercent, updated.promotion.image.bytes], [3, 10, 10]);
assert.deepEqual(updated.promotion.updatedAt, now());
assert.deepEqual(await promotions.update(id, { itemSlugs: [] }), { ok: false, code: 'MISSING_FIELDS' });
assert.deepEqual(await promotions.update('nothing', { packSize: 2 }), { ok: false, code: 'NOT_FOUND' });
assert.deepEqual(await promotions.remove(id), { ok: true });
assert.deepEqual(await promotions.remove(id), { ok: false, code: 'NOT_FOUND' });
assert.deepEqual(await promotions.get(id), { ok: false, code: 'NOT_FOUND' });

// Stored documents follow promotion.schema.json: every field present, dates as dates.
const [stored] = await records.collection('promotions').find({ _id: started.promotion._id });
assert.deepEqual(Object.keys(stored).sort(), ['_id', 'activateAt', 'active', 'allItems', 'categorySlugs', 'conditions', 'createdAt', 'deactivateAt',
  'discountPercent', 'image', 'itemSlugs', 'packSize', 'title', 'updatedAt']);
assert.ok(stored.createdAt instanceof Date);
console.log('promotions class: all checks passed');
