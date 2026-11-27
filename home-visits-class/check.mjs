import { assert, load } from './runtime.mjs';

const web = await load('web/index.ts');
const m = await load('server/index.ts');
const AGENT = 'Class check (https://example.com)';
const base = { lat: 40.4168, lng: -3.7038 };
const address = { street: 'Calle Mayor 1', city: 'Madrid', postalCode: '28013' };

for (const name of ['eligibility', 'distanceKm', 'quote', 'parseAddress', 'geocodeQuery', 'geocode', 'settingsFrom', 'installedSettings']) {
  assert.equal(typeof web[name], 'function', name);
  assert.equal(typeof m[name], 'function', name);
}

// Settings.
const defaults = { radiusKm: 25, calloutFee: 5000, travelMinutes: 30, minimumMinutes: 60, gapMinutes: 5 };
assert.deepEqual(m.settingsFrom({}), defaults);
assert.deepEqual(m.settingsFrom(Object.fromEntries(Object.keys(defaults).map((key) => [key, `{{${key}}}`]))), defaults);
assert.deepEqual(m.settingsFrom({ radiusKm: '10', calloutFee: '0' }), { ...defaults, radiusKm: 10, calloutFee: 0 });
assert.throws(() => m.settingsFrom({ radiusKm: '0' }), RangeError);
assert.throws(() => m.settingsFrom({ calloutFee: '-1' }), RangeError);
assert.equal(typeof m.installedSettings().radiusKm, 'number');

// Eligibility.
const atHome = ['relaxing-massage', 'deep-tissue-massage'];
const options = { minimumMinutes: 60, gapMinutes: 5 };
assert.deepEqual(m.eligibility([], atHome, options), { status: 'ineligible' });
assert.deepEqual(m.eligibility([{ itemSlug: 'deep-facial', minutes: 60 }], atHome, options), { status: 'ineligible' });
assert.deepEqual(m.eligibility([{ itemSlug: 'relaxing-massage', minutes: 60 }], atHome, options), { status: 'eligible' });
assert.deepEqual(m.eligibility([{ itemSlug: 'relaxing-massage', minutes: 30 }, { itemSlug: 'deep-tissue-massage', minutes: 20 }], atHome, options),
  { status: 'duration_shortfall', totalMinutes: 55 });
assert.deepEqual(m.eligibility([{ itemSlug: 'relaxing-massage', minutes: 30 }, { itemSlug: 'deep-tissue-massage', minutes: 25 }], atHome, options), { status: 'eligible' });

// Distances (the source's haversine) and quotes.
assert.equal(m.distanceKm(base, base), 0);
assert.ok(Math.abs(m.distanceKm(base, { lat: 41.387, lng: 2.1701 }) - 505.2107205347604) < 1e-9);
assert.ok(Math.abs(m.distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111.19492664455873) < 1e-9);
assert.throws(() => m.distanceKm(base, { lat: 91, lng: 0 }), RangeError);
const near = { lat: 40.6371, lng: -3.7038 };
const far = { lat: 40.6461, lng: -3.7038 };
const terms = { radiusKm: 25, calloutFee: 5000, travelMinutes: 30 };
const inside = m.quote(base, near, terms);
assert.equal(inside.ok, true);
assert.equal(inside.calloutFee, 5000);
assert.equal(inside.travelMinutes, 30);
assert.ok(Math.abs(inside.distanceKm - 24.49624233979569) < 1e-9);
const outside = m.quote(base, far, terms);
assert.equal(outside.ok, false);
assert.equal(outside.code, 'OUTSIDE_AREA');
assert.ok(outside.distanceKm > 25);
assert.equal(m.quote(base, near, { ...terms, radiusKm: m.distanceKm(base, near) }).ok, true);

// Addresses.
assert.deepEqual(m.parseAddress({ street: ' Calle Mayor 1 ', city: 'Madrid', postalCode: '28013', lat: 40.4153, lng: -3.7089 }),
  { street: 'Calle Mayor 1', city: 'Madrid', postalCode: '28013', notes: '', lat: 40.4153, lng: -3.7089 });
assert.equal(m.parseAddress({ street: 'Calle Mayor 1', city: 'Madrid', postalCode: '28013', lat: '40.4', lng: -3.7 }), null);
assert.equal(m.parseAddress({ street: '', city: 'Madrid', postalCode: '28013', lat: 40.4, lng: -3.7 }), null);
assert.equal(m.parseAddress(null), null);
assert.equal(m.geocodeQuery(address), 'Calle Mayor 1, Madrid, 28013');

// Geocoding through a fetch double: the query, the headers, the first result, failures as null, and the spacing.
let clock = Date.parse('2026-03-02T10:00:00Z');
const calls = [];
const waits = [];
const answers = [[{ lat: '40.4153949', lon: '-3.7069974' }], [], { status: 503 }];
const fetch = async (url, init) => {
  calls.push({ url, headers: init.headers, at: clock });
  const answer = answers.length > 1 ? answers.shift() : answers[0];
  return answer && answer.status ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => answer };
};
const geocoding = { endpoint: 'https://class-check-geocoder.example/search', userAgent: AGENT, fetch, now: () => new Date(clock), wait: async (ms) => { waits.push(ms); clock += ms; } };
assert.deepEqual(await m.geocode(address, geocoding), { lat: 40.4153949, lng: -3.7069974 });
const sent = new URL(calls[0].url);
assert.equal(sent.origin + sent.pathname, 'https://class-check-geocoder.example/search');
assert.equal(sent.searchParams.get('format'), 'json');
assert.equal(sent.searchParams.get('limit'), '1');
assert.equal(sent.searchParams.get('q'), 'Calle Mayor 1, Madrid, 28013');
assert.equal(calls[0].headers['User-Agent'], AGENT);
assert.equal(await m.geocode({ ...address, street: 'Calle Dos 2' }, geocoding), null);
assert.equal(await m.geocode({ ...address, street: 'Calle Tres 3' }, geocoding), null);
assert.equal(calls.length, 3);
for (let index = 1; index < calls.length; index++) assert.ok(calls[index].at - calls[index - 1].at >= 1000, 'requests start a second apart');
assert.equal(await m.geocode({ street: '', city: '', postalCode: '' }, geocoding), null);
assert.equal(calls.length, 3);
await assert.rejects(m.geocode(address, { ...geocoding, userAgent: '' }), RangeError);
await assert.rejects(m.geocode(address, { ...geocoding, endpoint: 'not an address' }), RangeError);
await assert.rejects(m.geocode(address, { userAgent: AGENT, fetch }), RangeError);
console.log('home-visits class: all checks passed');
