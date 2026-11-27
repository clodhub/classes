import { assert, load } from './runtime.mjs';
import { createBrowser } from './jar.mjs';

const m = await load('web/index.ts');
const categories = ['analytics', 'marketing'];
const name = 'class_consent';

// Settings: defaults, unrendered placeholders, rendered text, none, refusals.
const defaults = m.settingsFrom({});
assert.match(defaults.cookieName, /^[A-Za-z][A-Za-z0-9_]{0,63}$/);
assert.ok(Number.isInteger(defaults.maxAgeDays) && defaults.maxAgeDays >= 1 && defaults.maxAgeDays <= 400);
assert.ok(Array.isArray(defaults.categories));
assert.deepEqual(m.settingsFrom({ cookieName: '{{cookieName}}', maxAgeDays: '{{maxAgeDays}}', categories: '{{categories}}' }), defaults);
assert.deepEqual(m.settingsFrom({ cookieName: 'consent', maxAgeDays: '180', categories: 'analytics marketing personalisation' }),
  { cookieName: 'consent', maxAgeDays: 180, categories: ['analytics', 'marketing', 'personalisation'] });
assert.deepEqual(m.settingsFrom({ categories: 'none' }).categories, []);
for (const bad of [{ maxAgeDays: '0' }, { maxAgeDays: '401' }, { maxAgeDays: 'year' }, { cookieName: 'has space' }, { categories: 'analytics analytics' },
  { categories: 'essential analytics' }, { categories: 'Analytics' }]) {
  assert.throws(() => m.settingsFrom(bad), RangeError, JSON.stringify(bad));
}
const installed = m.installedSettings();
assert.deepEqual(m.settingsFrom(installed), installed);

// The consent model.
assert.deepEqual(m.acceptAll(categories), { essential: true, analytics: true, marketing: true });
assert.deepEqual(m.rejectAll(categories), { essential: true, analytics: false, marketing: false });
assert.deepEqual(m.acceptAll([]), { essential: true });
assert.throws(() => m.acceptAll(['essential']), RangeError);
assert.equal(m.allows(null, 'essential'), true);
assert.equal(m.allows(null, 'analytics'), false);
assert.equal(m.allows(m.acceptAll(categories), 'analytics'), true);
assert.equal(m.allows(m.rejectAll(categories), 'marketing'), false);
assert.equal(m.allows({ essential: true, analytics: true }, 'marketing'), false);

// The parent domain: one level up when there is one; never for localhost, IP addresses or hosts under a top-level domain.
assert.equal(m.parentDomain('shop.example.com'), 'example.com');
assert.equal(m.parentDomain('Book.Studio.Example.COM.'), 'studio.example.com');
for (const host of ['example.com', 'localhost', 'shop.localhost', '127.0.0.1', '192.168.1.20', '[::1]', '::1', 'intranet', '', null, 'bad_host.example.com']) {
  assert.equal(m.parentDomain(host), null, String(host));
}

// Cookie text: the parent-domain cookie first, then the host-only one; one cookie when there is no parent.
const both = m.consentCookies(m.acceptAll(categories), { name, maxAgeDays: 10, hostname: 'shop.example.com' });
assert.equal(both.length, 2);
assert.match(both[0], /;\s*Domain=\.?example\.com(;|$)/i);
assert.doesNotMatch(both[1], /Domain=/i);
for (const cookie of both) {
  assert.ok(cookie.startsWith(`${name}=`));
  assert.match(cookie, /;\s*Path=\/(;|$)/i);
  assert.match(cookie, /;\s*Max-Age=864000(;|$)/i);
  assert.match(cookie, /;\s*SameSite=Lax(;|$)/i);
}
assert.equal(m.consentCookies(m.rejectAll(categories), { name, maxAgeDays: 1, hostname: 'localhost' }).length, 1);
assert.equal(m.consentCookies(m.rejectAll(categories), { name, maxAgeDays: 1 }).length, 1);
assert.throws(() => m.consentCookies({ essential: true, analytics: 'yes' }, { name, maxAgeDays: 1 }), RangeError);

// Reading: the named cookie only, the first readable one wins, unreadable text is no consent.
const stored = both[0].split(';')[0];
assert.deepEqual(m.readConsent(`other=1; ${stored}`, name), m.acceptAll(categories));
assert.equal(m.readConsent('other=1', name), null);
assert.equal(m.readConsent(null, name), null);
assert.equal(m.readConsent(`${name}=not-json`, name), null);
assert.equal(m.readConsent(`${name}=${encodeURIComponent('[1,2]')}`, name), null);
assert.deepEqual(m.readConsent(`${name}=garbage; ${stored}`, name), m.acceptAll(categories));
assert.deepEqual(m.readConsent(`${name}=${encodeURIComponent('{"analytics":false}')}`, name), { essential: true, analytics: false });

// The store in a browser: no choice shows the banner; saving shares the choice with the sibling site; a withdrawal on
// one site wins on the other; a category left out is stored as refused and one not asked about is not stored; a new
// category asks again.
const browser = createBrowser();
const shop = browser.page('shop.example.com');
const store = m.createConsentStore({ document: shop, name, categories, maxAgeDays: 30, hostname: 'shop.example.com' });
assert.equal(store.current(), null);
let heard = 0;
const stop = store.subscribe(() => heard++);
assert.deepEqual(store.save(m.acceptAll(categories)), m.acceptAll(categories));
assert.equal(heard, 1);
const first = store.current();
assert.deepEqual(first, m.acceptAll(categories));
assert.equal(store.current(), first);
const www = browser.page('www.example.com');
const sibling = m.createConsentStore({ document: www, name, categories, maxAgeDays: 30, hostname: 'www.example.com' });
assert.deepEqual(sibling.current(), m.acceptAll(categories));
sibling.save(m.rejectAll(categories));
assert.deepEqual(store.current(), m.rejectAll(categories));
stop();
store.save({ essential: true, analytics: true, marketing: false });
assert.equal(heard, 1);
assert.deepEqual(store.save({ essential: true, analytics: true }), { essential: true, analytics: true, marketing: false });
assert.deepEqual(store.save({ essential: true, analytics: false, marketing: true, unasked: true }), { essential: true, analytics: false, marketing: true });
assert.throws(() => store.save({ essential: true, analytics: 'yes' }), RangeError);
assert.equal(m.createConsentStore({ document: shop, name, categories: [...categories, 'personalisation'], maxAgeDays: 30, hostname: 'shop.example.com' }).current(), null);
assert.deepEqual(m.createConsentStore({ document: browser.page('other.test'), name, categories: [], maxAgeDays: 30, hostname: 'other.test' }).current(), { essential: true });
browser.advance(30 * 86400 + 1);
assert.equal(store.current(), null);

// A host whose parent is a public suffix keeps the choice in its host-only cookie.
const hosted = createBrowser({ publicSuffixes: ['netlify.app'] }).page('example-studio.netlify.app');
const hostedStore = m.createConsentStore({ document: hosted, name, categories, maxAgeDays: 30, hostname: 'example-studio.netlify.app' });
hostedStore.save(m.rejectAll(categories));
assert.deepEqual(hostedStore.current(), m.rejectAll(categories));
console.log('cookie consent class: all checks passed');
