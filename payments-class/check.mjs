import { assert, load } from './runtime.mjs';

const m = await load('server/index.ts');
let clock = Date.parse('2026-05-04T10:00:00.000Z');
const now = () => new Date(clock);
const minutes = (count) => count * 60 * 1000;
let requests = 0;
const noNetwork = async () => {
  requests++;
  throw new Error('the payments class checks make no requests');
};
const create = (options = {}) => m.createPayments({ simulate: true, env: {}, fetch: noNetwork, now, settings: { currency: 'eur' }, ...options });
// A live client refuses simulated calls: by throwing, or by a promise that rejects.
async function refuses(call) {
  let outcome;
  try {
    outcome = call();
  } catch {
    return;
  }
  await assert.rejects(Promise.resolve(outcome));
}

// The client, its currency and its webhook header.
const payments = create();
assert.equal(payments.mode, 'simulated');
assert.equal(payments.currency, 'EUR');
assert.match(payments.signatureHeader, /^[a-z][a-z0-9-]*$/);
assert.equal(payments.publishableKey, null);
assert.equal(create({ settings: { currency: 'gbp' } }).currency, 'GBP');
assert.throws(() => create({ settings: { currency: 'euro' } }), RangeError);

// A checkout keeps every request field; the request is not changed and later changes to it are not kept.
const request = {
  lineItems: [{ name: 'Relaxing Massage', description: '60 minutes', amount: 7500 }, { name: 'Deep Facial', amount: 4000, quantity: 2 }],
  customerEmail: 'ana@example.com',
  language: 'es',
  metadata: { kind: 'reservation', reservationId: 'r-1001', note: '' },
  successUrl: 'https://studio.example.com/es/reserve/success?checkout={CHECKOUT_ID}',
  cancelUrl: 'https://studio.example.com/es/reserve/cancelled',
  expiresAt: new Date(clock + minutes(35)),
};
const sent = structuredClone(request);
const started = await payments.createCheckout(request);
assert.equal(started.ok, true, started.message);
assert.ok(typeof started.id === 'string' && started.id.length > 0);
assert.equal(started.url, `/simulated-checkout?id=${encodeURIComponent(started.id)}`);
assert.deepEqual(request, sent);
const unpaid = {
  id: started.id, paid: false, amountTotal: 15500, currency: 'EUR', metadata: { kind: 'reservation', reservationId: 'r-1001' },
  paymentReference: null, customerEmail: 'ana@example.com',
};
const details = await payments.simulated.details(started.id);
assert.deepEqual(details, {
  kind: 'checkout',
  summary: unpaid,
  lineItems: [{ name: 'Relaxing Massage', description: '60 minutes', amount: 7500, quantity: 1 }, { name: 'Deep Facial', amount: 4000, quantity: 2 }],
  successUrl: `https://studio.example.com/es/reserve/success?checkout=${started.id}`,
  cancelUrl: 'https://studio.example.com/es/reserve/cancelled',
  expiresAt: sent.expiresAt,
  language: 'es',
});
assert.deepEqual(await payments.checkout(started.id), unpaid);
request.metadata.kind = 'changed';
request.lineItems[0].name = 'Changed';
request.expiresAt.setTime(0);
details.lineItems[0].amount = 1;
details.summary.metadata.kind = 'changed';
details.expiresAt.setTime(0);
const kept = await payments.simulated.details(started.id);
assert.deepEqual([kept.summary.metadata.kind, kept.lineItems[0].name, kept.lineItems[0].amount], ['reservation', 'Relaxing Massage', 7500]);
assert.equal(kept.expiresAt.getTime(), sent.expiresAt.getTime());
// Every simulated client in the process sees the checkout; an unknown id is nothing.
assert.deepEqual(await create().checkout(started.id), unpaid);
assert.equal(await payments.checkout('cs_unknown'), null);
assert.equal(await payments.simulated.details('cs_unknown'), null);
assert.equal(payments.simulated.complete('cs_unknown'), null);
const pages = create({ simulatedCheckoutUrl: (id) => `https://studio.example.com/pay/${id}` });
const elsewhere = await pages.createCheckout({ ...sent, expiresAt: new Date(clock + minutes(40)) });
assert.equal(elsewhere.url, `https://studio.example.com/pay/${elsewhere.id}`);

// Requests outside CheckoutRequest are refused, and its limits are kept.
const valid = () => ({
  lineItems: [{ name: 'Deep Facial', amount: 8000 }], metadata: { kind: 'gift' },
  successUrl: 'https://studio.example.com/gift-cards/success', cancelUrl: 'https://studio.example.com/gift-cards',
});
const refused = [
  ['no line items', (r) => { r.lineItems = []; }],
  ['21 line items', (r) => { r.lineItems = Array.from({ length: 21 }, () => ({ name: 'Deep Facial', amount: 100 })); }],
  ['a zero amount', (r) => { r.lineItems[0].amount = 0; }],
  ['a fractional amount', (r) => { r.lineItems[0].amount = 80.5; }],
  ['an empty name', (r) => { r.lineItems[0].name = ' '; }],
  ['a zero quantity', (r) => { r.lineItems[0].quantity = 0; }],
  ['no metadata', (r) => { delete r.metadata; }],
  ['a metadata value that is not text', (r) => { r.metadata.amount = 80; }],
  ['a metadata key with square brackets', (r) => { r.metadata['line[0]'] = 'x'; }],
  ['a metadata key over 40 characters', (r) => { r.metadata['k'.repeat(41)] = 'x'; }],
  ['a metadata value over 500 characters', (r) => { r.metadata.message = 'x'.repeat(501); }],
  ['51 metadata keys', (r) => { for (let index = 0; index < 51; index++) r.metadata[`k${index}`] = 'v'; }],
  ['a relative success address', (r) => { r.successUrl = '/gift-cards/success'; }],
  ['a cancel address that is not http', (r) => { r.cancelUrl = 'javascript:history.back()'; }],
  ['an expiry under 30 minutes ahead', (r) => { r.expiresAt = new Date(clock + minutes(29)); }],
  ['an expiry over 24 hours ahead', (r) => { r.expiresAt = new Date(clock + minutes(24 * 60 + 1)); }],
  ['a customer email that is not one', (r) => { r.customerEmail = 'ana'; }],
  ['an unknown field', (r) => { r.mode = 'payment'; }],
];
for (const [what, change] of refused) {
  const candidate = valid();
  change(candidate);
  const result = await payments.createCheckout(candidate);
  assert.deepEqual([result.ok, result.code, typeof result.message], [false, 'INVALID_REQUEST', 'string'], what);
}
assert.equal((await payments.createCheckout(null)).code, 'INVALID_REQUEST');
for (const ahead of [minutes(30), minutes(24 * 60)]) {
  assert.equal((await payments.createCheckout({ ...valid(), expiresAt: new Date(clock + ahead) })).ok, true);
}
const blank = await payments.createCheckout({ ...valid(), customerEmail: '', language: '' });
const blankDetails = await payments.simulated.details(blank.id);
assert.deepEqual([blankDetails.summary.customerEmail, blankDetails.language, blankDetails.expiresAt], [null, null, null]);

// Paying: a new payment reference, the same summary once paid.
const paid = payments.simulated.complete(started.id);
assert.ok(typeof paid.paymentReference === 'string' && paid.paymentReference.length > 0);
assert.deepEqual(paid, { ...unpaid, paid: true, paymentReference: paid.paymentReference });
assert.deepEqual(payments.simulated.complete(started.id), paid);
assert.deepEqual(await payments.checkout(started.id), paid);
assert.deepEqual((await payments.simulated.details(started.id)).summary, paid);

// A checkout past its expiry is not completed: its unpaid summary comes back. Without expiresAt it lasts 24 hours.
const soon = await payments.createCheckout({ ...valid(), expiresAt: new Date(clock + minutes(31)) });
const late = await payments.createCheckout({ ...valid(), expiresAt: new Date(clock + minutes(31)) });
const open = await payments.createCheckout(valid());
const lasting = await payments.createCheckout(valid());
clock += minutes(30);
assert.equal(payments.simulated.complete(soon.id).paid, true);
clock += minutes(1);
const expired = payments.simulated.complete(late.id);
assert.deepEqual([expired.paid, expired.paymentReference], [false, null]);
assert.equal((await payments.checkout(late.id)).paid, false);
clock += minutes(24 * 60 - 32);
assert.equal(payments.simulated.complete(lasting.id).paid, true);
clock += minutes(1);
assert.equal(payments.simulated.complete(open.id).paid, false);

// The signed event, read from the request header the client names, as a webhook route does.
const { body, signature } = await payments.simulated.signedEvent(paid);
assert.equal(typeof body, 'string');
const headers = new Headers({ 'content-type': 'application/json', [payments.signatureHeader]: signature });
const verified = await payments.verifyEvent(body, headers.get(payments.signatureHeader));
assert.equal(verified.ok, true);
assert.equal(typeof verified.event.type, 'string');
assert.deepEqual(payments.completedCheckout(verified.event), paid);
assert.equal((await create().verifyEvent(body, signature)).ok, true);
assert.equal(payments.completedCheckout({ type: 'something.else', data: {} }), null);
assert.deepEqual(await payments.verifyEvent(body, null), { ok: false, code: 'MISSING_SIGNATURE' });
assert.deepEqual(await payments.verifyEvent(body, ''), { ok: false, code: 'MISSING_SIGNATURE' });
const tampered = body.replace(`${paid.amountTotal}`, `${paid.amountTotal + 1}`);
assert.notEqual(tampered, body);
assert.deepEqual(await payments.verifyEvent(tampered, signature), { ok: false, code: 'INVALID_SIGNATURE' });
const otherBody = await payments.simulated.signedEvent({ ...paid, amountTotal: 1 });
assert.deepEqual(await payments.verifyEvent(body, otherBody.signature), { ok: false, code: 'INVALID_SIGNATURE' });
assert.deepEqual(await payments.verifyEvent(body, 'not a signature'), { ok: false, code: 'INVALID_SIGNATURE' });
// Within 300 seconds of the signing either way, never outside.
clock += 300 * 1000;
assert.equal((await payments.verifyEvent(body, signature)).ok, true);
clock += 1000;
assert.deepEqual(await payments.verifyEvent(body, signature), { ok: false, code: 'INVALID_SIGNATURE' });
const ahead = await payments.simulated.signedEvent(paid);
clock -= 301 * 1000;
assert.deepEqual(await payments.verifyEvent(ahead.body, ahead.signature), { ok: false, code: 'INVALID_SIGNATURE' });
clock += 301 * 1000;

// Refunds by idempotency key: a repeat reports the first, a key reused with other values is refused, nothing left is already.
const reference = paid.paymentReference;
const first = await payments.refund({ paymentReference: reference, idempotencyKey: `refund:${started.id}` });
assert.deepEqual([first.ok, typeof first.id, first.already], [true, 'string', false]);
assert.deepEqual(await payments.refund({ paymentReference: reference, idempotencyKey: `refund:${started.id}` }), { ok: true, id: first.id, already: true });
assert.equal((await payments.refund({ paymentReference: reference, idempotencyKey: `refund:${started.id}`, amount: 100 })).code, 'PROVIDER_ERROR');
assert.deepEqual(await payments.refund({ paymentReference: reference, idempotencyKey: `again:${started.id}` }), { ok: true, id: null, already: true });
const partly = payments.simulated.complete((await payments.createCheckout(valid())).id);
const part = await payments.refund({ paymentReference: partly.paymentReference, idempotencyKey: `part:${partly.id}`, amount: 3000 });
assert.deepEqual([part.ok, part.already], [true, false]);
assert.equal((await payments.refund({ paymentReference: partly.paymentReference, idempotencyKey: `more:${partly.id}`, amount: 5001 })).code, 'PROVIDER_ERROR');
const rest = await payments.refund({ paymentReference: partly.paymentReference, idempotencyKey: `rest:${partly.id}` });
assert.deepEqual([rest.ok, typeof rest.id, rest.already], [true, 'string', false]);
assert.notEqual(rest.id, part.id);
assert.deepEqual(await payments.refund({ paymentReference: partly.paymentReference, idempotencyKey: `late:${partly.id}` }), { ok: true, id: null, already: true });
for (const wrong of [
  { paymentReference: 'pi_unknown', idempotencyKey: 'refund:unknown' },
  { paymentReference: '', idempotencyKey: 'refund:empty' },
  { paymentReference: reference, idempotencyKey: '' },
  { paymentReference: reference, idempotencyKey: 'k'.repeat(256) },
  { paymentReference: reference, idempotencyKey: 'refund:zero', amount: 0 },
  null,
]) {
  const result = await payments.refund(wrong);
  assert.deepEqual([result.ok, result.code, typeof result.message], [false, 'PROVIDER_ERROR', 'string'], JSON.stringify(wrong));
}

// Sheet payments for an app's payment sheet: a payment the simulated route pays as it pays a checkout, read by the same
// completion path, refunded by its own payment reference, never expiring as a checkout does.
const sheetRequest = () => ({
  lineItems: [{ name: 'Deep Facial', amount: 4000, quantity: 2 }], customerEmail: 'ana@example.com', metadata: { kind: 'gift', note: '' },
  ephemeralKeyVersion: '2020-08-27',
});
const sheet = await payments.createSheetPayment(sheetRequest());
assert.equal(sheet.ok, true, sheet.message);
for (const key of ['id', 'clientSecret', 'customer', 'ephemeralKey']) assert.ok(typeof sheet[key] === 'string' && sheet[key].length > 0, key);
assert.notEqual((await payments.createSheetPayment(sheetRequest())).id, sheet.id);
const sheetDetails = await payments.simulated.details(sheet.id);
assert.deepEqual([sheetDetails.kind, sheetDetails.successUrl, sheetDetails.cancelUrl, sheetDetails.expiresAt, sheetDetails.language], ['sheet', null, null, null, null]);
assert.deepEqual(sheetDetails.lineItems, [{ name: 'Deep Facial', amount: 4000, quantity: 2 }]);
const sheetUnpaid = await payments.checkout(sheet.id);
assert.deepEqual([sheetUnpaid.id, sheetUnpaid.paid, sheetUnpaid.amountTotal, sheetUnpaid.currency, sheetUnpaid.metadata, sheetUnpaid.paymentReference],
  [sheet.id, false, 8000, 'EUR', { kind: 'gift' }, null]);
assert.deepEqual(await create().checkout(sheet.id), sheetUnpaid);
clock += minutes(3 * 24 * 60);
const sheetPaid = payments.simulated.complete(sheet.id);
assert.deepEqual({ ...sheetPaid, paymentReference: null }, { ...sheetUnpaid, paid: true });
assert.ok(typeof sheetPaid.paymentReference === 'string' && sheetPaid.paymentReference.length > 0);
assert.deepEqual(payments.simulated.complete(sheet.id), sheetPaid);
const sheetEvent = await payments.simulated.signedEvent(sheetPaid);
const sheetVerified = await payments.verifyEvent(sheetEvent.body, sheetEvent.signature);
assert.equal(sheetVerified.ok, true);
assert.notEqual(sheetVerified.event.type, verified.event.type);
assert.deepEqual(payments.completedCheckout(sheetVerified.event), sheetPaid);
const sheetRefund = await payments.refund({ paymentReference: sheetPaid.paymentReference, idempotencyKey: `refund:${sheet.id}`, amount: 3000 });
assert.deepEqual([sheetRefund.ok, sheetRefund.already], [true, false]);
assert.equal((await payments.refund({ paymentReference: sheetPaid.paymentReference, idempotencyKey: `more:${sheet.id}`, amount: 5001 })).code, 'PROVIDER_ERROR');
for (const [what, change] of [
  ['no ephemeral key version', (r) => { delete r.ephemeralKeyVersion; }],
  ['an ephemeral key version that is not an API version', (r) => { r.ephemeralKeyVersion = '24.1.0'; }],
  ['no line items', (r) => { r.lineItems = []; }],
  ['a customer email that is not one', (r) => { r.customerEmail = 'ana'; }],
  ['a metadata value that is not text', (r) => { r.metadata.amount = 80; }],
  ['a checkout field', (r) => { r.successUrl = 'https://studio.example.com/'; }],
]) {
  const candidate = sheetRequest();
  change(candidate);
  const result = await payments.createSheetPayment(candidate);
  assert.deepEqual([result.ok, result.code, typeof result.message], [false, 'INVALID_REQUEST', 'string'], what);
}
assert.equal((await payments.createSheetPayment(null)).code, 'INVALID_REQUEST');

// A live client without its secrets refuses, without a request, and names the same header.
const live = m.createPayments({ env: {}, fetch: noNetwork, now, settings: { currency: 'eur' } });
assert.equal(live.mode, 'live');
assert.equal(live.currency, 'EUR');
assert.equal(live.signatureHeader, payments.signatureHeader);
assert.equal(live.publishableKey, null);
assert.equal((await live.createCheckout(valid())).code, 'NOT_CONFIGURED');
assert.equal((await live.createSheetPayment(sheetRequest())).code, 'NOT_CONFIGURED');
assert.equal((await live.refund({ paymentReference: reference, idempotencyKey: 'refund:live' })).code, 'NOT_CONFIGURED');
assert.equal(await live.checkout(started.id), null);
assert.deepEqual(await live.verifyEvent(body, signature), { ok: false, code: 'NOT_CONFIGURED' });
assert.deepEqual(await live.verifyEvent(body, null), { ok: false, code: 'MISSING_SIGNATURE' });
await refuses(() => live.simulated.complete(started.id));
await refuses(() => live.simulated.details(started.id));
await refuses(() => live.simulated.signedEvent(paid));
assert.equal(requests, 0);
console.log('payments class: all checks passed');
