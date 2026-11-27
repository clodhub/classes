import { assert, load } from './runtime.mjs';

const m = await load('server/index.ts');
const site = 'https://studio.example.com';
const hours = ['Tu-Fr 09:30-13:30', 'Tu-Fr 16:00-19:30', 'Sa 09:00-14:00'];

// Settings: LocalBusiness by default; schema.org types below it are accepted, others refused.
assert.deepEqual(m.settingsFrom({}), { businessType: 'LocalBusiness' });
assert.deepEqual(m.settingsFrom({ businessType: '{{businessType}}' }), { businessType: 'LocalBusiness' });
for (const type of ['BeautySalon', 'HealthAndBeautyBusiness', 'DaySpa', 'Store', 'ClothingStore', 'Restaurant']) assert.deepEqual(m.settingsFrom({ businessType: type }), { businessType: type });
for (const bad of ['Organization', 'Thing', 'Product', 'beautysalon', 'Beauty Salon']) assert.throws(() => m.settingsFrom({ businessType: bad }), RangeError, bad);
const installed = m.installedSettings();
assert.deepEqual(m.settingsFrom(installed), installed);

// JSON-LD for a local business: the type, the facts given, nothing invented.
const data = m.localBusiness({ name: 'Example Studio', url: site, email: 'hello@example.com', telephone: '+34600000000', address: { city: 'Madrid', country: 'ES' },
  geo: { lat: 40.4168, lng: -3.7038 }, priceRange: '\u20ac\u20ac', openingHours: hours }, 'BeautySalon');
assert.equal(data['@context'], 'https://schema.org');
assert.equal(data['@type'], 'BeautySalon');
assert.equal(data.name, 'Example Studio');
assert.equal(data.url, site);
assert.equal(data.email, 'hello@example.com');
assert.equal(data.telephone, '+34600000000');
assert.deepEqual(data.address, { '@type': 'PostalAddress', addressLocality: 'Madrid', addressCountry: 'ES' });
assert.deepEqual(data.geo, { '@type': 'GeoCoordinates', latitude: 40.4168, longitude: -3.7038 });
assert.equal(data.priceRange, '\u20ac\u20ac');
assert.deepEqual(data.openingHours, hours);
const plain = m.localBusiness({ name: 'Example Studio', url: site, openingHours: [] }, 'Store');
assert.deepEqual(Object.keys(plain).sort(), ['@context', '@type', 'name', 'url']);
assert.equal(m.localBusiness({ name: 'Example Studio', url: site, openingHours: hours })['@type'], installed.businessType);
assert.throws(() => m.localBusiness({ name: 'Example Studio', url: site, openingHours: hours }, 'Organization'), RangeError);
assert.throws(() => m.localBusiness({ name: 'Example Studio', url: 'ftp://studio.example.com', openingHours: hours }), RangeError);
assert.throws(() => m.localBusiness({ name: 'Example Studio', url: site, openingHours: ['every day'] }), RangeError);

// Language prefixes as needed: the default language at the bare path.
assert.equal(m.localisedPath('/', 'es', 'es'), '/');
assert.equal(m.localisedPath('/', 'en', 'es'), '/en');
assert.equal(m.localisedPath('/services', 'es', 'es'), '/services');
assert.equal(m.localisedPath('/services', 'en', 'es'), '/en/services');
assert.throws(() => m.localisedPath('services', 'en', 'es'), RangeError);

// Page metadata: canonical address, every language, x-default, Open Graph and Twitter.
const page = { title: 'Services', description: 'What we offer.', siteName: 'Example Studio', siteAddress: site, path: '/services', languages: ['es', 'en'], defaultLanguage: 'es' };
const english = m.pageMetadata({ ...page, language: 'en' });
assert.equal(english.title, 'Services');
assert.equal(english.description, 'What we offer.');
assert.deepEqual(english.alternates, { canonical: `${site}/en/services`, languages: { es: `${site}/services`, en: `${site}/en/services`, 'x-default': `${site}/services` } });
assert.equal(english.openGraph.type, 'website');
assert.equal(english.openGraph.url, `${site}/en/services`);
assert.equal(english.openGraph.siteName, 'Example Studio');
assert.match(english.openGraph.locale, /^en_[A-Z]{2}$/);
assert.equal(m.pageMetadata({ ...page, language: 'en', locales: { en: 'en_GB' } }).openGraph.locale, 'en_GB');
assert.equal(english.twitter.title, 'Services');
const home = m.pageMetadata({ ...page, path: '/', language: 'es' });
assert.equal(home.alternates.canonical, site);
assert.equal(home.alternates.languages.en, `${site}/en`);
assert.throws(() => m.pageMetadata({ ...page, language: 'fr' }), RangeError);

// Sitemap and robots.txt.
const xml = m.sitemapXml(site, [{ path: '/', languages: ['es', 'en'], changed: new Date('2026-03-01T12:00:00Z') }, { path: '/services', languages: ['es', 'en'] }], 'es');
assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9"/);
assert.equal((xml.match(/<url>/g) ?? []).length, 4);
for (const loc of [site, `${site}/en`, `${site}/services`, `${site}/en/services`]) assert.ok(xml.includes(`<loc>${loc}</loc>`), loc);
assert.ok(xml.includes('<lastmod>2026-03-01</lastmod>'));
assert.ok(xml.includes(`hreflang="x-default" href="${site}/services"`));
assert.ok(xml.includes(`hreflang="en" href="${site}/en"`));
const robots = m.robotsTxt(site, ['/admin', '/api/']);
assert.match(robots, /^User-agent: \*$/m);
assert.match(robots, /^Disallow: \/admin$/m);
assert.match(robots, /^Disallow: \/api\/$/m);
assert.match(robots, /^Sitemap: https:\/\/studio\.example\.com\/sitemap\.xml$/m);

// Embedding JSON-LD: nothing in a value can end the script element.
const hostile = { name: '</script><script>alert(1)</script><!--', note: '\u2028\u2029&' };
const script = m.jsonLdScript(hostile);
assert.equal(/[<>&\u2028\u2029]/.test(script), false);
assert.deepEqual(JSON.parse(script), hostile);
console.log('site metadata class: all checks passed');
