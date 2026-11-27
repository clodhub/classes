import { assert, load } from './runtime.mjs';

const web = await load('web/index.ts');
const server = await load('server/index.ts');
const NAMES = ['DEFAULT_SETTINGS', 'formatMoney', 'fromMajor', 'installedSettings', 'minorDigits', 'parseMoney', 'percentOf', 'settingsFrom', 'toMajor'];
for (const name of NAMES) assert.equal(typeof server[name], typeof web[name], `server and web both export ${name}`);

for (const m of [web, server]) {
  // Settings: the currency, upper-case ISO 4217 with a minor unit.
  assert.deepEqual(m.DEFAULT_SETTINGS, { currency: 'EUR' });
  assert.deepEqual(m.settingsFrom({}), { currency: 'EUR' });
  assert.deepEqual(m.settingsFrom({ currency: '{{currency}}' }), { currency: 'EUR' });
  assert.deepEqual(m.settingsFrom({ currency: 'GBP' }), { currency: 'GBP' });
  for (const bad of ['eur', 'EURO', 'XXX', 'XAU', 7]) assert.throws(() => m.settingsFrom({ currency: bad }), RangeError, String(bad));
  assert.deepEqual(m.settingsFrom(m.installedSettings()), m.installedSettings());

  // Minor digits and conversions.
  assert.deepEqual(['EUR', 'GBP', 'CHF', 'USD', 'JPY', 'KRW', 'KWD', 'BHD', 'CLF'].map((code) => m.minorDigits(code)), [2, 2, 2, 2, 0, 0, 3, 3, 4]);
  for (const bad of ['eur', 'XAU', 'XTS', 'ABC', '']) assert.throws(() => m.minorDigits(bad), RangeError, bad);
  assert.equal(m.fromMajor(37.5, 'EUR'), 3750);
  assert.equal(m.fromMajor(45, 'GBP'), 4500);
  assert.equal(m.fromMajor(1.005, 'EUR'), 101);
  assert.equal(m.fromMajor(0.1 + 0.2, 'EUR'), 30);
  assert.equal(m.fromMajor(1200, 'JPY'), 1200);
  assert.equal(m.fromMajor(1.2345, 'KWD'), 1235);
  assert.equal(m.toMajor(3750, 'EUR'), 37.5);
  assert.equal(m.toMajor(1200, 'JPY'), 1200);
  assert.equal(m.toMajor(1234, 'KWD'), 1.234);
  assert.throws(() => m.fromMajor(Infinity, 'EUR'), RangeError);
  assert.throws(() => m.fromMajor(1, 'eur'), RangeError);
  assert.throws(() => m.toMajor(37.5, 'EUR'), RangeError);

  // Percentages round half a minor unit up.
  assert.equal(m.percentOf(1005, 50), 503);
  assert.equal(m.percentOf(3750, 10), 375);
  assert.equal(m.percentOf(999, 33), 330);
  assert.equal(m.percentOf(1, 50), 1);
  assert.equal(m.percentOf(0, 50), 0);
  assert.equal(m.percentOf(10000, 12.5), 1250);
  assert.throws(() => m.percentOf(10.5, 10), RangeError);
  assert.throws(() => m.percentOf(1000, NaN), RangeError);

  // Formatting in English and Spanish, in euros and pounds, with and without minor digits.
  const f = (amount, currency, language, options) => m.formatMoney(amount, currency, language, options);
  assert.equal(f(4500, 'EUR', 'en'), '€45');
  assert.equal(f(3750, 'EUR', 'en'), '€37.50');
  assert.equal(f(123456, 'EUR', 'en'), '€1,234.56');
  assert.equal(f(0, 'EUR', 'en'), '€0');
  assert.equal(f(-3750, 'EUR', 'en'), '-€37.50');
  assert.equal(f(3750, 'EUR', 'en', { wholeUnits: 'always' }), '€38');
  assert.equal(f(-49, 'EUR', 'en', { wholeUnits: 'always' }), '€0');
  assert.equal(f(4500, 'EUR', 'en', { wholeUnits: 'never' }), '€45.00');
  assert.equal(f(4500, 'EUR', 'es'), '45\u00a0€');
  assert.equal(f(3750, 'EUR', 'es'), '37,50\u00a0€');
  assert.equal(f(4500, 'EUR', 'es', { wholeUnits: 'never' }), '45,00\u00a0€');
  assert.equal(f(1234567, 'EUR', 'es'), '12.345,67\u00a0€');
  assert.equal(f(4500, 'GBP', 'en'), '£45');
  assert.equal(f(3750, 'GBP', 'en'), '£37.50');
  assert.equal(f(4500, 'GBP', 'es'), '45\u00a0£');
  assert.equal(f(3750, 'GBP', 'es'), '37,50\u00a0£');
  assert.equal(f(120000, 'JPY', 'en'), '¥120,000');
  assert.equal(f(1234, 'KWD', 'en'), 'KWD\u00a01.234');
  assert.equal(f(6000, 'CHF', 'de-CH'), 'CHF\u00a060');
  assert.equal(f(123456, 'EUR', 'en', { grouping: false }), '€1234.56');
  assert.equal(f(3750, 'EUR', 'es', { symbolBefore: true }), '€37,50');
  assert.equal(f(6000, 'CHF', 'en', { symbolBefore: true }), 'CHF\u00a060');
  assert.throws(() => f(100, 'eur', 'en'), RangeError);
  assert.throws(() => f(1.5, 'EUR', 'en'), RangeError);
  assert.throws(() => f(100, 'EUR', 'en', { wholeUnits: 'sometimes' }), RangeError);
  assert.throws(() => f(100, 'EUR', 'en_GB'), RangeError);

  // The shop's two earlier formats: euros with no minor digits when whole and a comma outside English, and Intl in whole euros.
  const euros = (cents, language) => (cents % 100 === 0 ? `€${cents / 100}` : `€${language === 'en' ? (cents / 100).toFixed(2) : (cents / 100).toFixed(2).replace('.', ',')}`);
  for (const language of ['en', 'es', 'fr', 'de']) {
    for (const cents of [4500, 3750, 3705, 5, 123456, 0]) {
      assert.equal(f(cents, 'EUR', language, { wholeUnits: 'auto', symbolBefore: true, grouping: false }), euros(cents, language), `${language} ${cents}`);
    }
  }
  for (const language of ['en', 'es']) {
    for (const units of [45, 120, 1500]) {
      const whole = new Intl.NumberFormat(language, { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(units);
      assert.equal(f(units * 100, 'EUR', language, { wholeUnits: 'always' }), whole);
    }
  }

  // Reading written prices.
  const p = (text, currency) => m.parseMoney(text, currency);
  const euroTexts = { '85€': 8500, '85 €': 8500, '€85': 8500, '€ 85': 8500, '37,50 €': 3750, '1.200,00 €': 120000, '1.200 €': 120000,
    '60 €': 6000, '€60': 6000, '60,00 €': 6000, '60,- €': 6000, 'EUR 60': 6000, '60 eur': 6000, '130€ / session': 13000,
    '€1,234.56': 123456, '1\u00a0234,56\u00a0€': 123456, '1\u202f234,56\u00a0€': 123456, '-37,50 €': -3750, '€ -5': -500 };
  for (const [text, amount] of Object.entries(euroTexts)) assert.equal(p(text, 'EUR'), amount, text);
  assert.equal(p('£60', 'GBP'), 6000);
  assert.equal(p('£37.50', 'GBP'), 3750);
  assert.equal(p('CHF 60', 'CHF'), 6000);
  assert.equal(p('CHF60', 'CHF'), 6000);
  assert.equal(p('60 CHF', 'CHF'), 6000);
  assert.equal(p("CHF 1'234.50", 'CHF'), 123450);
  assert.equal(p('$1,200.00', 'USD'), 120000);
  assert.equal(p('¥1,200', 'JPY'), 1200);
  assert.equal(p('KWD 12.500', 'KWD'), 12500);
  for (const [text, currency] of [['50 minutes', 'EUR'], ['37,50', 'EUR'], ['£60', 'EUR'], ['€60', 'GBP'], ['$1,200.00', 'EUR'], ['x60 €', 'EUR'],
    ['', 'EUR'], ['€', 'EUR'], ['EURO 5', 'EUR'], ['€1,234.567', 'EUR'], ['¥1.5', 'JPY']]) {
    assert.equal(p(text, currency), null, `${text} in ${currency}`);
  }
  assert.equal(m.parseMoney('85 €'), m.parseMoney('85 €', m.installedSettings().currency));
  assert.throws(() => p('85 €', 'eur'), RangeError);

  // What formatMoney writes reads back as the same amount.
  for (const language of ['en', 'es', 'fr', 'de', 'nl', 'de-CH']) {
    for (const currency of ['EUR', 'GBP', 'CHF', 'JPY']) {
      for (const amount of [0, 5, 3750, 4500, 123456, 100000000, -3750]) {
        for (const options of [{}, { wholeUnits: 'never' }, { symbolBefore: true }, { grouping: false }]) {
          const text = f(amount, currency, language, options);
          assert.equal(p(text, currency), amount, `${language} ${currency} ${JSON.stringify(options)} ${text}`);
        }
      }
    }
  }
}
console.log('money class: all checks passed');
