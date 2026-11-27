import { assert, load } from './runtime.mjs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const web = await load('web/index.ts');
const m = await load('server/index.ts');
for (const name of ['createCatalogueQuery', 'minutesOf', 'validateCatalogue', 'slugify', 'settingsFrom', 'installedSettings', 'DEFAULT_SETTINGS']) {
  assert.equal(typeof web[name], typeof m[name], `web and server both export ${name}`);
}

// A stand-in for money's parseMoney: a number beside the currency's sign, with two optional decimals after "," or ".".
const calls = [];
const SIGNS = { EUR: '€', GBP: '£' };
const parsePrice = (text, currency) => {
  calls.push(currency);
  const sign = SIGNS[currency];
  const match = new RegExp(`(\\d+)(?:[.,](\\d{2}))?\\s*${sign}|${sign}\\s*(\\d+)(?:[.,](\\d{2}))?`).exec(text);
  return match ? Number(match[1] ?? match[3]) * 100 + Number(match[2] ?? match[4] ?? 0) : null;
};

// Settings.
assert.deepEqual(m.DEFAULT_SETTINGS, { fileLanguage: 'en' });
assert.deepEqual(m.settingsFrom({ fileLanguage: '{{fileLanguage}}' }), { fileLanguage: 'en' });
assert.deepEqual(m.settingsFrom({ fileLanguage: 'es' }), { fileLanguage: 'es' });
assert.throws(() => m.settingsFrom({ fileLanguage: 'English' }), RangeError);
assert.deepEqual(m.settingsFrom(m.installedSettings()), m.installedSettings());

// Labels, slugs.
const lengths = { '45 minutes': 45, '60 minutos (Medio)': 60, '30 minutes - 1 area': 30, 'Small area': null, '1 h 30': 90, '1,5 horas': 90, "90'": 90, '45': 45,
  '2 areas - 45 minutes': 45, 'Pack of 5 sessions': null };
for (const [label, minutes] of Object.entries(lengths)) assert.equal(m.minutesOf(label), minutes, label);
assert.equal(m.slugify('Hands & Feet Care'), 'hands-feet-care');
assert.equal(m.slugify('Masaje Relajante Ñandú'), 'masaje-relajante-nandu');

// One item file in English and one in Spanish.
const english = `# Relaxing Massage

A slow, *full-body* massage with warm oil.

## Treatment details

| Duration | Price |
|---|---|
| 45 minutes | 60 € |
| 60 minutes | €75.50 |
| **Packs** | |

## Benefits

- Relieves **muscle** tension
- Improves sleep

## What to expect

Long, gentle strokes.

## Recommended for

- Stress

## Aftercare recommendations

- Drink water
`;
const spanish = `# Masaje relajante

Un masaje lento con aceite templado.

## Detalles del tratamiento

| Zona | Precio | Duración |
|:--|:-:|--:|
| Espalda | 60 € | 45 minutos |
| Cuerpo entero | 75,50 € | 60 minutos |

## Beneficios

- Alivia la tensión

## Qué esperar

Movimientos largos.

## Recomendado para

- Estrés

## Recomendaciones post-tratamiento

- Beber agua
`;
const parsedEnglish = m.parseItemMarkdown(english, m.defaultHeadings, parsePrice, 'EUR');
assert.equal(parsedEnglish.title, 'Relaxing Massage');
assert.equal(parsedEnglish.description, 'A slow, full-body massage with warm oil.');
assert.deepEqual(parsedEnglish.options, [{ label: '45 minutes', minutes: 45, price: 6000, priceText: '60 €' },
  { label: '60 minutes', minutes: 60, price: 7550, priceText: '€75.50' }]);
assert.deepEqual(parsedEnglish.benefits, ['Relieves muscle tension', 'Improves sleep']);
assert.equal(parsedEnglish.whatToExpect, 'Long, gentle strokes.');
assert.deepEqual([parsedEnglish.recommendedFor, parsedEnglish.aftercare], [['Stress'], ['Drink water']]);
assert.equal(parsedEnglish.warnings.length, 1);
const parsedSpanish = m.parseItemMarkdown(spanish, m.defaultHeadings, parsePrice, 'EUR');
assert.equal(parsedSpanish.title, 'Masaje relajante');
assert.deepEqual(parsedSpanish.options.map((option) => [option.label, option.minutes, option.price, option.priceText]),
  [['Espalda - 45 minutos', 45, 6000, '60 €'], ['Cuerpo entero - 60 minutos', 60, 7550, '75,50 €']]);
assert.deepEqual([parsedSpanish.benefits, parsedSpanish.whatToExpect, parsedSpanish.aftercare], [['Alivia la tensión'], 'Movimientos largos.', ['Beber agua']]);
assert.ok(calls.length > 0 && calls.every((currency) => currency === 'EUR'));
for (const [language, headings] of Object.entries({ fr: ['Prix', 'Bienfaits', 'À quoi s\'attendre', 'Recommandé pour', 'Conseils après le soin'],
  de: ['Details der Behandlung', 'Vorteile', 'Was Sie erwartet', 'Empfohlen für', 'Pflegehinweise'], en: ['PRICES', 'Benefits', 'What to expect', 'Recommended for', 'Aftercare recommendations'],
  es: ['Precios', 'Beneficios', 'Qué esperar', 'Recomendado para', 'Recomendaciones post tratamiento'] })) {
  const parsed = m.parseItemMarkdown(`# T\n\n## ${headings[0]}\n\n| a | b |\n|---|---|\n| 30 min | 35 € |\n\n## ${headings[1]}\n\n- b\n\n## ${headings[2]}\n\nE.\n\n## ${headings[3]}\n\n- r\n\n## ${headings[4]}\n\n- a\n`,
    m.defaultHeadings, parsePrice, 'EUR');
  assert.deepEqual([parsed.options.length, parsed.benefits, parsed.whatToExpect, parsed.recommendedFor, parsed.aftercare], [1, ['b'], 'E.', ['r'], ['a']], language);
}
assert.deepEqual(m.parseItemMarkdown('# T\n\n## Prices\n\n| a | b |\n|---|---|\n| 30 min | £35 |\n| 45 min | 40 € |\n', m.defaultHeadings, parsePrice, 'GBP').options.map((o) => o.price), [3500]);

// A content folder with two categories: one in the flat layout, one with a folder per item and translated file names.
const root = mkdtempSync(join(tmpdir(), 'shop-catalogue-class-'));
const put = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
try {
  put('content/categories.json', JSON.stringify({ Massage: { es: 'Masajes' }, 'Facial Care': { en: 'Facials', es: 'Faciales' } }));
  put('content/Massage/Relaxing Massage.md', english);
  put('content/Massage/Relaxing Massage.es.md', spanish);
  put('content/Facial Care/Deep Facial/Deep Facial.md', '# Deep Facial\n\nClears the pores.\n\n## Prices\n\n| Duration | Price |\n|---|---|\n| 60 minutes | 95 € |\n');
  put('content/Facial Care/Deep Facial/Limpieza profunda.es.md', '# Limpieza facial profunda\n\nDespeja los poros.\n\n## Precios\n\n| Duración | Precio |\n|---|---|\n| 60 minutos | 95 € |\n');
  put('content/_drafts/Draft.md', english);
  put('public/icons/relaxing-massage.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  put('public/categories/massage.png', 'image');
  calls.length = 0;
  const assets = { iconDir: join(root, 'public/icons'), iconUrl: '/icons', categoryImageDir: join(root, 'public/categories'), categoryImageUrl: '/categories' };
  const { catalogues, warnings, errors } = await m.buildCatalogues({ root: join(root, 'content'), languages: ['en', 'es'], fileLanguage: 'en', currency: 'EUR', parsePrice, assets });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => warning.includes('no icon deep-facial')));
  assert.ok(calls.every((currency) => currency === 'EUR'));
  assert.deepEqual(Object.keys(catalogues), ['en', 'es']);
  for (const language of ['en', 'es']) {
    assert.deepEqual(m.validateCatalogue(catalogues[language]), []);
    assert.equal(catalogues[language].language, language);
    assert.equal(catalogues[language].currency, 'EUR');
  }
  const shape = (catalogue) => catalogue.categories.map((category) => [category.slug, category.name, category.image, category.items.map((item) => [item.slug, item.title, item.icon])]);
  assert.deepEqual(shape(catalogues.en), [['facial-care', 'Facials', null, [['deep-facial', 'Deep Facial', null]]],
    ['massage', 'Massage', '/categories/massage.png', [['relaxing-massage', 'Relaxing Massage', '/icons/relaxing-massage.svg']]]]);
  assert.deepEqual(shape(catalogues.es), [['facial-care', 'Faciales', null, [['deep-facial', 'Limpieza facial profunda', null]]],
    ['massage', 'Masajes', '/categories/massage.png', [['relaxing-massage', 'Masaje relajante', '/icons/relaxing-massage.svg']]]]);

  // The queries the pages ask, a language without a catalogue, search.
  const query = m.createCatalogueQuery(catalogues, { fallbackLanguage: 'en' });
  assert.deepEqual(query.languages(), ['en', 'es']);
  assert.deepEqual(query.categories('es'), [{ slug: 'facial-care', name: 'Faciales', image: null, itemCount: 1, minPrice: 9500 },
    { slug: 'massage', name: 'Masajes', image: '/categories/massage.png', itemCount: 1, minPrice: 6000 }]);
  assert.equal(query.category('massage', 'en').items.length, 1);
  assert.equal(query.category('nails', 'en'), null);
  assert.equal(query.item('relaxing-massage', 'es').title, 'Masaje relajante');
  assert.equal(query.item('relaxing-massage', 'fr').title, 'Relaxing Massage');
  assert.equal(query.item('relaxing-massage', 'es-MX').title, 'Masaje relajante');
  assert.equal(query.item('missing', 'en'), null);
  assert.deepEqual(query.items('en').map((item) => item.slug), ['deep-facial', 'relaxing-massage']);
  assert.deepEqual(query.option('relaxing-massage', 60, 'es'), { label: 'Cuerpo entero - 60 minutos', minutes: 60, price: 7550, priceText: '75,50 €' });
  assert.equal(query.option('relaxing-massage', 30, 'es'), null);
  assert.deepEqual(query.index(), [{ slug: 'deep-facial', categorySlug: 'facial-care' }, { slug: 'relaxing-massage', categorySlug: 'massage' }]);
  assert.deepEqual(query.search('MASAJE', 'es'), [{ kind: 'category', slug: 'massage', categorySlug: 'massage', name: 'Masajes' },
    { kind: 'item', slug: 'relaxing-massage', categorySlug: 'massage', name: 'Masaje relajante' }]);
  assert.deepEqual(query.search('profunda limpieza', 'es').map((result) => result.slug), ['deep-facial']);
  assert.deepEqual(query.search('masaje', 'es', 1).map((result) => result.kind), ['category']);
  assert.deepEqual(query.search('  ', 'es'), []);
  assert.throws(() => m.createCatalogueQuery({}), RangeError);
  assert.throws(() => m.createCatalogueQuery(catalogues, { fallbackLanguage: 'de' }), RangeError);
  assert.throws(() => m.createCatalogueQuery({ en: catalogues.es }), RangeError);
  assert.ok(m.validateCatalogue({ ...catalogues.en, format: 2 }).length > 0);
  assert.ok(m.validateCatalogue({ format: 1, language: 'en', currency: 'EUR', categories: [{ slug: 'x', name: 'X', image: null, items: 'none' }] }).length > 0);

  // Writing the catalogues for the pages.
  const written = await m.writeCatalogues(join(root, 'generated'), catalogues);
  assert.deepEqual(written.map((path) => path.split(/[\\/]/).at(-1)), ['catalogue-en.json', 'catalogue-es.json']);
  assert.deepEqual(JSON.parse(readFileSync(written[0], 'utf8')), catalogues.en);
  await assert.rejects(m.writeCatalogues(join(root, 'generated'), { en: { ...catalogues.en, format: 2 } }), RangeError);

  // File languages: a suffix names its language whatever fileLanguage is; a file without one is in fileLanguage; two are an error.
  put('second/Massage/Stones.md', '# Piedras\n\n## Precios\n\n| a | b |\n|---|---|\n| 30 minutos | 55 € |\n');
  put('second/Massage/Stones.en.md', '# Stones\n\n## Prices\n\n| a | b |\n|---|---|\n| 30 minutes | 55 € |\n');
  const second = await m.buildCatalogues({ root: join(root, 'second'), languages: ['en', 'es'], fileLanguage: 'es', currency: 'EUR', parsePrice });
  assert.deepEqual(second.errors, []);
  assert.deepEqual([second.catalogues.en.categories[0].items[0].title, second.catalogues.es.categories[0].items[0].title], ['Stones', 'Piedras']);
  put('third/Massage/Stones.md', '# Stones\n');
  put('third/Massage/Stones.en.md', '# Stones\n');
  put('third/Massage/Stones.es.md', '# Piedras\n');
  const third = await m.buildCatalogues({ root: join(root, 'third'), languages: ['en', 'es'], fileLanguage: 'en', currency: 'EUR', parsePrice });
  assert.equal(third.errors.length, 1);
  assert.ok(third.errors[0].includes('Stones.md') && third.errors[0].includes('Stones.en.md'));
  assert.deepEqual(third.catalogues.en.categories, []);
  // A language without its own file shows the fileLanguage text; an item without a fileLanguage file is left out.
  const wider = await m.buildCatalogues({ root: join(root, 'content'), languages: ['en', 'es', 'fr'], fileLanguage: 'en', currency: 'EUR', parsePrice });
  assert.deepEqual(wider.errors, []);
  assert.equal(wider.catalogues.fr.categories.find((category) => category.slug === 'massage').items[0].title, 'Relaxing Massage');
  assert.equal(wider.catalogues.es.categories.find((category) => category.slug === 'massage').items[0].title, 'Masaje relajante');
  assert.ok(wider.warnings.some((warning) => warning.includes('Relaxing Massage') && warning.includes('fr')));
  put('fourth/Massage/Piedras.es.md', '# Piedras\n');
  assert.deepEqual((await m.buildCatalogues({ root: join(root, 'fourth'), languages: ['en', 'es'], currency: 'EUR', parsePrice })).catalogues.es.categories, []);
  await assert.rejects(m.buildCatalogues({ root: join(root, 'content'), languages: ['en', 'es'], fileLanguage: 'fr', currency: 'EUR', parsePrice }), RangeError);
  await assert.rejects(m.buildCatalogues({ root: join(root, 'content'), languages: ['en', 'es'], currency: 'EUR', parsePrice, assets: { iconDir: 'x' } }), RangeError);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('shop catalogue class: all checks passed');
