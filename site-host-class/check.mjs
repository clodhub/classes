import { assert, load } from './runtime.mjs';

const m = await load('server/index.ts');
const site = 'https://studio.example.com';
const header = (headers, key) => headers.find((item) => item.key.toLowerCase() === key.toLowerCase())?.value;

// Providers and settings: the provider setting takes one of providers(); the address has no trailing slash.
const providers = m.providers();
assert.ok(Array.isArray(providers) && providers.length > 0);
for (const provider of providers) assert.match(provider, /^[a-z][a-z0-9-]{0,63}$/);
const defaults = m.settingsFrom({});
assert.ok(providers.includes(defaults.provider));
assert.match(defaults.siteAddress, /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9_/-]*)?$/);
assert.deepEqual(m.settingsFrom({ provider: '{{provider}}', siteAddress: '{{siteAddress}}', accountReference: '{{accountReference}}' }), defaults);
for (const provider of providers) assert.equal(m.settingsFrom({ provider }).provider, provider);
const chosen = m.settingsFrom({ provider: providers[0], siteAddress: `${site}/`, accountReference: 'example-team' });
assert.equal(chosen.siteAddress, site);
assert.equal(chosen.accountReference, 'example-team');
assert.equal(m.settingsFrom({ accountReference: 'none' }).accountReference, null);
for (const bad of [{ provider: 'no-such-provider' }, { siteAddress: 'studio.example.com' }, { accountReference: 'Example Team' }]) {
  assert.throws(() => m.settingsFrom(bad), RangeError, JSON.stringify(bad));
}
const installed = m.installedSettings();
assert.deepEqual(m.settingsFrom(installed), installed);

// Security headers: HSTS only over https; the others always.
const secure = m.securityHeaders(site);
assert.match(header(secure, 'Strict-Transport-Security'), /^max-age=([0-9]+)/);
assert.ok(Number(/max-age=([0-9]+)/.exec(header(secure, 'Strict-Transport-Security'))[1]) >= 31536000);
const plain = m.securityHeaders('http://localhost:3000');
assert.equal(header(plain, 'Strict-Transport-Security'), undefined);
for (const headers of [secure, plain]) {
  assert.equal(header(headers, 'X-Content-Type-Options'), 'nosniff');
  assert.equal(header(headers, 'X-Frame-Options'), 'DENY');
  assert.ok(header(headers, 'Referrer-Policy'));
}

// next.config: the application's own settings kept, the security headers on every path before the application's own rules
// (which then override a header of the same name on their paths), no X-Powered-By.
const config = m.nextConfig({ reactStrictMode: true, async headers() { return [{ source: '/api/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] }]; } }, { siteAddress: site });
assert.equal(config.reactStrictMode, true);
assert.equal(config.poweredByHeader, false);
const rules = await config.headers();
const every = rules.findIndex((rule) => rule.source === '/(.*)');
assert.ok(every >= 0 && every < rules.findIndex((rule) => rule.source === '/api/(.*)'));
assert.deepEqual(rules[every].headers, secure);

// The environment check names the required variables that are unset or blank.
const declarations = [
  { name: 'ADMIN_PIN', secret: true, required: true, description: 'admin PIN' },
  { name: 'STAFF_PIN', secret: true, required: false, description: 'staff PIN' },
  { name: 'MONGODB_URI', secret: true, required: true, description: 'database' },
];
assert.deepEqual(m.checkEnvironment(declarations, { ADMIN_PIN: '1234', MONGODB_URI: '' }), { ok: false, missing: ['MONGODB_URI'] });
assert.deepEqual(m.checkEnvironment(declarations, { ADMIN_PIN: '1234', MONGODB_URI: 'mongodb://x' }), { ok: true, missing: [] });

// Every provider has notes and steps that end in a health check of the site, with no secret value in any command even when
// the variables are set in the environment.
const secretValue = 'class-check-secret-value-4821';
process.env.ADMIN_PIN = secretValue;
process.env.MONGODB_URI = secretValue;
for (const provider of providers) {
  assert.ok(m.providerNotes(provider).trim().length > 0, provider);
  const steps = m.deploySteps(provider, { siteAddress: site, accountReference: 'example-team', variables: ['ADMIN_PIN', 'MONGODB_URI'] });
  assert.ok(steps.length > 0, provider);
  for (const step of steps) {
    assert.ok(typeof step.description === 'string' && step.description.length > 0, provider);
    assert.ok(Array.isArray(step.command) && step.command.every((part) => typeof part === 'string'), provider);
    assert.ok(!step.command.join(' ').includes(secretValue));
  }
  assert.ok(steps.some((step) => step.command.some((part) => part.includes(`${site}/api/health`))), `${provider} checks the site`);
}
assert.throws(() => m.deploySteps('no-such-provider'), RangeError);
assert.throws(() => m.providerNotes('no-such-provider'), RangeError);

// The health route's answer.
const response = m.health();
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.deepEqual(await response.json(), { ok: true });
console.log('site host class: all checks passed');
