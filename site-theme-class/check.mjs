import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assert, load, source } from './runtime.mjs';

const m = await load('web/index.ts');
const COLOURS = ['background', 'surface', 'raised', 'accent', 'accent-light', 'accent-dark', 'on-accent', 'text', 'text-soft', 'muted', 'border', 'border-accent',
  'success', 'error', 'warning', 'info'];
const camel = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const channels = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map((value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// The themes: the recipe's looks are there, each valid, readable and returned as a copy.
const file = m.themes;
const original = JSON.stringify(file);
assert.equal(file.format, 1);
const names = m.themeNames(file);
assert.deepEqual(names, file.themes.map((theme) => theme.name));
assert.equal(new Set(names).size, names.length);
assert.ok(names.includes(file.default));
for (const look of ['noir', 'ivory', 'sage']) assert.ok(names.includes(look), `the ${look} look`);
for (const theme of file.themes) {
  assert.deepEqual(m.validateTheme(theme), [], theme.name);
  assert.deepEqual(m.resolveTheme(file, { themeName: theme.name }), theme);
  const c = theme.colour;
  for (const [fore, back, minimum] of [['text', 'background', 4.5], ['textSoft', 'background', 4.5], ['muted', 'background', 4.5], ['onAccent', 'accent', 4.5], ['accent', 'background', 3]]) {
    assert.ok(contrast(c[fore], c[back]) >= minimum, `${theme.name}: ${fore} on ${back}`);
  }
}
assert.equal(m.resolveTheme(file, { themeName: 'noir' }).scheme, 'dark');
assert.equal(m.resolveTheme(file, { themeName: 'ivory' }).scheme, 'light');
const base = m.resolveTheme(file);
assert.equal(base.name, file.default);
base.colour.accent = '#000000';
assert.equal(JSON.stringify(file), original);
assert.throws(() => m.resolveTheme(file, { themeName: 'no-such-theme' }), RangeError);

// Settings and colours.
assert.deepEqual(m.settingsFrom({}), { themeName: 'noir', accentColour: null });
assert.deepEqual(m.settingsFrom({ themeName: '{{themeName}}', accentColour: '{{accentColour}}' }), { themeName: 'noir', accentColour: null });
assert.deepEqual(m.settingsFrom({ themeName: 'sage', accentColour: 'none' }), { themeName: 'sage', accentColour: null });
assert.deepEqual(m.settingsFrom({ themeName: 'ivory', accentColour: 'hex D4A843' }), { themeName: 'ivory', accentColour: '#d4a843' });
for (const bad of [{ themeName: 'Noir' }, { accentColour: 'gold' }, { accentColour: 'hex 12' }]) assert.throws(() => m.settingsFrom(bad), RangeError, JSON.stringify(bad));
const installed = m.installedSettings();
assert.deepEqual(m.settingsFrom(installed), installed);
assert.equal(m.parseColour('hex C9A84C'), '#c9a84c');
assert.equal(m.parseColour('#C9A84C'), '#c9a84c');
assert.throws(() => m.parseColour('#c9a'), RangeError);

// An accent colour: the accent, its border and companions follow it, text on it reads, an unreadable accent is refused.
for (const [look, accent] of [['noir', 'hex D4A843'], ['noir', 'hex 9AD1F5'], ['ivory', 'hex 1D4ED8'], ['sage', 'hex 2F7F86']]) {
  const theme = m.resolveTheme(file, { themeName: look, accentColour: accent });
  const hex = m.parseColour(accent);
  assert.equal(theme.colour.accent, hex);
  assert.equal(theme.colour.borderAccent, hex);
  assert.ok(luminance(theme.colour.accentLight) > luminance(hex), `${look} ${accent} light`);
  assert.ok(luminance(theme.colour.accentDark) < luminance(hex), `${look} ${accent} dark`);
  assert.ok(contrast(theme.colour.onAccent, hex) >= 4.5, `${look} ${accent} text on the accent`);
  assert.deepEqual(m.validateTheme(theme), []);
}
assert.throws(() => m.resolveTheme(file, { themeName: 'noir', accentColour: 'hex 1D2B53' }), RangeError);
assert.throws(() => m.resolveTheme(file, { themeName: 'ivory', accentColour: 'hex F5E6C8' }), RangeError);

// The variables the storefront reads, the stylesheet and the Tailwind preset that reads them.
const theme = m.resolveTheme(file, { themeName: 'noir' });
const variables = m.cssVariables(theme);
assert.equal(variables['--colour-scheme'], 'dark');
for (const name of COLOURS) {
  assert.equal(variables[`--colour-${name}`], theme.colour[camel(name)].toLowerCase(), name);
  assert.equal(variables[`--colour-${name}-rgb`], channels(theme.colour[camel(name)]).join(' '), `${name}-rgb`);
}
assert.match(variables['--font-heading'], /^var\(--font-heading-loaded, .+\)$/);
assert.match(variables['--font-body'], /^var\(--font-body-loaded, .+\)$/);
for (const name of ['sm', 'md', 'lg', 'full']) assert.equal(variables[`--radius-${name}`], theme.radius[name]);
for (const name of ['sm', 'md', 'lg']) assert.equal(variables[`--shadow-${name}`], theme.shadow[name]);
const css = m.renderCss(theme);
assert.match(css, /^:root \{\n/);
assert.match(css, /^\s*color-scheme: dark;$/m);
for (const [name, value] of Object.entries(variables)) assert.ok(css.includes(`${name}: ${value};`), name);
const preset = m.tailwindPreset();
const shop = preset.theme.extend.colors.shop;
assert.deepEqual(Object.keys(shop).sort(), [...COLOURS].sort());
for (const name of COLOURS) assert.ok(shop[name].includes(`var(--colour-${name}`), name);
assert.deepEqual(preset.theme.extend.fontFamily.heading.map(String), ['var(--font-heading)']);
assert.deepEqual(preset.theme.extend.fontFamily.body.map(String), ['var(--font-body)']);
for (const name of ['sm', 'md', 'lg', 'full']) assert.equal(preset.theme.extend.borderRadius[name], `var(--radius-${name})`);
for (const name of ['sm', 'md', 'lg']) assert.equal(preset.theme.extend.boxShadow[name], `var(--shadow-${name})`);

// Problems are reported, and a theme with a problem is not rendered.
assert.ok(m.validateTheme({ ...theme, colour: { ...theme.colour, accent: 'gold' } }).length > 0);
assert.ok(m.validateTheme({ ...theme, colour: { ...theme.colour, text: theme.colour.background } }).length > 0);
assert.ok(m.validateTheme({ ...theme, font: { heading: ['"x"; } body {'], body: ['serif'] } }).length > 0);
assert.throws(() => m.renderCss({ ...theme, radius: { ...theme.radius, md: 'large' } }), RangeError);
// The looks' fonts are bundled: each built-in theme's first heading and body font has its files and licence installed under web/,
// with the digests the component declares.
const typeTags = [[0, 1, 0, 0], [0x4f, 0x54, 0x54, 0x4f], [0x77, 0x4f, 0x46, 0x32]];
for (const theme of file.themes) {
  const fonts = m.themeFonts(theme);
  for (const role of ['heading', 'body']) {
    const family = fonts[role];
    assert.ok(family, `${theme.name}: its ${role} font ${theme.font[role][0]} is bundled`);
    assert.equal(family.family, theme.font[role][0]);
    assert.ok(family.files.length > 0);
    for (const font of family.files) {
      assert.match(font.path, /^fonts\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.(ttf|otf|woff2)$/);
      const bytes = readFileSync(source(`web/${font.path}`));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), font.digest, font.path);
      assert.ok(typeTags.some((tag) => tag.every((value, index) => bytes[index] === value)), `${font.path} is a TrueType, OpenType or WOFF2 font`);
    }
    assert.ok(readFileSync(source(`web/${family.licence}`), 'utf8').trim().length > 0, family.licence);
  }
}
assert.deepEqual(m.themeFonts({ ...file.themes[0], font: { heading: ['No Such Font', 'serif'], body: ['sans-serif'] } }), { heading: null, body: null });
assert.equal(typeof m.FONT_SOURCE.repository, 'string');
assert.ok(Object.keys(m.fontFamilies).length >= 1);
console.log('site theme class: all checks passed');
