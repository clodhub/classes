import { assert, load } from './runtime.mjs';

const m = await load('server/index.ts');
let requests = 0;
const noNetwork = async () => {
  requests++;
  throw new Error('the mail class checks make no requests');
};
const env = { SHOP_MAIL_FROM: 'bookings@example.com', SHOP_MAIL_OWNER: 'hello@example.com' };
const settings = { senderName: 'Example Studio', fromVariable: 'SHOP_MAIL_FROM', businessVariable: 'SHOP_MAIL_OWNER' };
const create = (options = {}) => m.createMail({ simulate: true, env, settings, fetch: noNetwork, ...options });

// The sender and the shop's address come from the variables the settings name.
const mail = create();
assert.equal(mail.mode, 'simulated');
assert.equal(mail.from, 'Example Studio <bookings@example.com>');
assert.equal(mail.business, 'hello@example.com');
const unset = create({ env: {} });
assert.deepEqual([unset.from, unset.business], ['', '']);
assert.equal(create({ env: { ...env, SHOP_MAIL_FROM: 'bookings' } }).from, '');
assert.equal(create({ senderName: 'Salón Ejemplo' }).from, '"Salón Ejemplo" <bookings@example.com>');
assert.equal(create({ senderName: 'Studio "Uno", Madrid' }).from, '"Studio \\"Uno\\", Madrid" <bookings@example.com>');
assert.throws(() => create({ settings: { ...settings, senderName: 'Salón' } }), RangeError);
assert.throws(() => create({ settings: { ...settings, fromVariable: 'shop_mail_from' } }), RangeError);
assert.throws(() => create({ senderName: 'Example\nStudio' }), RangeError);
assert.throws(() => create({ senderName: '' }), RangeError);

// Sends land in the outbox in order, as copies of what was given.
const first = { to: 'ana@example.com', replyTo: 'hello@example.com', subject: 'Your booking is confirmed', html: '<p>See you on 5 June at 10:00.</p>' };
const second = {
  to: ['hello@example.com', 'owner@example.com'], subject: 'New booking: Relaxing Massage', text: 'Ana booked 5 June at 10:00.',
  html: '<p>Ana booked 5 June at 10:00.</p><img src="cid:qrcode">',
  attachments: [{ filename: 'qrcode.png', content: 'iVBORw0KGgo=', contentType: 'image/png', contentId: 'qrcode' }],
};
const sentFirst = await mail.send(first);
const sentSecond = await mail.send(second);
assert.deepEqual([sentFirst.ok, sentSecond.ok], [true, true]);
assert.ok(typeof sentFirst.id === 'string' && sentFirst.id.length > 0);
assert.notEqual(sentFirst.id, sentSecond.id);
assert.deepEqual(mail.outbox(), [first, second]);
second.to.push('late@example.com');
second.attachments[0].filename = 'changed.png';
const listed = mail.outbox();
try {
  listed[0].subject = 'changed';
} catch {
  // A frozen copy refuses the change, which is as good.
}
assert.deepEqual(mail.outbox().map((message) => message.subject), ['Your booking is confirmed', 'New booking: Relaxing Massage']);
assert.deepEqual(mail.outbox()[1].to, ['hello@example.com', 'owner@example.com']);
assert.equal(mail.outbox()[1].attachments[0].filename, 'qrcode.png');
assert.deepEqual(create().outbox(), []);
assert.equal((await unset.send(first)).ok, true);
assert.equal(unset.outbox().length, 1);

// Messages outside MailMessage are refused and nothing is kept.
const valid = () => ({ to: 'ana@example.com', subject: 'Your gift card', html: '<p>Hello Ana</p>' });
const image = { filename: 'qrcode.png', content: 'iVBORw0KGgo=', contentType: 'image/png' };
const refused = [
  ['no recipient', (x) => { delete x.to; }],
  ['an empty recipient list', (x) => { x.to = []; }],
  ['an empty recipient', (x) => { x.to = ''; }],
  ['a recipient that is not an address', (x) => { x.to = 'ana'; }],
  ['a recipient with a name', (x) => { x.to = 'Ana <ana@example.com>'; }],
  ['one bad address in a list', (x) => { x.to = ['ana@example.com', 'ana@example']; }],
  ['51 recipients', (x) => { x.to = Array.from({ length: 51 }, (_, index) => `guest${index}@example.com`); }],
  ['no subject', (x) => { delete x.subject; }],
  ['an empty subject', (x) => { x.subject = ''; }],
  ['a subject of spaces', (x) => { x.subject = '   '; }],
  ['a subject with a line break', (x) => { x.subject = 'Hello\nBcc: someone@example.com'; }],
  ['no HTML', (x) => { delete x.html; }],
  ['empty HTML', (x) => { x.html = ''; }],
  ['text that is not text', (x) => { x.text = 42; }],
  ['a reply address that is not one', (x) => { x.replyTo = 'hello'; }],
  ['attachments that are not a list', (x) => { x.attachments = { ...image }; }],
  ['an attachment without content', (x) => { x.attachments = [{ filename: 'qrcode.png', contentType: 'image/png' }]; }],
  ['an attachment that is not base64', (x) => { x.attachments = [{ ...image, content: 'not base64!' }]; }],
  ['an attachment without a media type', (x) => { x.attachments = [{ ...image, contentType: 'png' }]; }],
  ['a content id over 127 characters', (x) => { x.attachments = [{ ...image, contentId: 'c'.repeat(128) }]; }],
  ['attachments over 40,000,000 characters', (x) => {
    x.attachments = [{ ...image, content: 'AAAA'.repeat(5_000_000) }, { ...image, filename: 'b.png', content: 'AAAA'.repeat(5_000_001) }];
  }],
  ['an unknown field', (x) => { x.cc = 'hello@example.com'; }],
];
const kept = mail.outbox().length;
for (const [what, change] of refused) {
  const message = valid();
  change(message);
  const result = await mail.send(message);
  assert.deepEqual([result.ok, result.code, typeof result.message], [false, 'INVALID_MESSAGE', 'string'], what);
}
assert.equal((await mail.send(null)).code, 'INVALID_MESSAGE');
assert.equal(mail.outbox().length, kept);
assert.equal((await mail.send({ ...valid(), to: Array.from({ length: 50 }, (_, index) => `guest${index}@example.com`) })).ok, true);

// Escaping and addresses.
assert.equal(m.escapeHtml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
assert.equal(m.escapeHtml('&amp;'), '&amp;amp;');
assert.equal(m.escapeHtml('Masaje relajante, 60 € (María)'), 'Masaje relajante, 60 € (María)');
assert.deepEqual([m.escapeHtml(null), m.escapeHtml(undefined), m.escapeHtml(42)], ['', '', '42']);
for (const address of ['ana@example.com', 'ana.ruiz+gifts@mail.example.es', "o'brien@example.ie", 'a@b.co', 'ana@xn--bcher-kva.example']) {
  assert.equal(m.isEmailAddress(address), true, address);
}
for (const value of ['ana', 'ana@', '@example.com', 'ana@example', 'ana @example.com', ' ana@example.com', 'ana@example.com ',
  'Ana <ana@example.com>', 'ana@@example.com', 'ana@exa mple.com', 'ana..ruiz@example.com', 'ana@-example.com', `${'a'.repeat(65)}@example.com`,
  42, null, undefined, {}]) {
  assert.equal(m.isEmailAddress(value), false, String(value));
}

// A live client without its API key refuses without a request, checks the message first and keeps no outbox.
const live = m.createMail({ env, settings, fetch: noNetwork });
assert.deepEqual([live.mode, live.from, live.business], ['live', mail.from, 'hello@example.com']);
const notConfigured = await live.send(valid());
assert.deepEqual([notConfigured.ok, notConfigured.code, typeof notConfigured.message], [false, 'NOT_CONFIGURED', 'string']);
assert.equal((await live.send({ ...valid(), subject: '' })).code, 'INVALID_MESSAGE');
assert.deepEqual(live.outbox(), []);
assert.equal(requests, 0);
console.log('mail class: all checks passed');
