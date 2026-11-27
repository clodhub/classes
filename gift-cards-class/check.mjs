import { assert, load } from './runtime.mjs';
import { createCodes, createPayments, openRecords } from './doubles.mjs';

const web = await load('web/index.ts');
const m = await load('server/index.ts');
const DAY = 24 * 3600 * 1000;
let clock = Date.parse('2026-03-02T10:00:00.000Z');
const now = () => new Date(clock);
const lines = [
  { itemSlug: 'relaxing-massage', itemName: 'Relaxing Massage', price: 7500 },
  { itemSlug: 'deep-facial', itemName: 'Deep Facial', price: 8000 },
];
const buyer = { recipientName: 'Ana', recipientEmail: 'ana@example.com', senderName: 'Luis', senderEmail: 'luis@example.com', message: 'Enjoy', language: 'es' };
const sheet = { kind: 'sheet', ephemeralKeyVersion: '2020-08-27' };

// The web entry carries the shared rules; the server entry the same functions.
for (const name of ['matchesItem', 'cardValue', 'usability', 'publicView', 'adminView', 'validatePurchase', 'bookingPath', 'settingsFrom', 'installedSettings']) {
  assert.equal(typeof web[name], 'function', name);
  assert.equal(m[name], web[name], name);
}
assert.deepEqual(web.DEFAULT_SETTINGS, { minimumAmount: 3000, maximumAmount: 50000, validityDays: 365 });
assert.deepEqual(web.settingsFrom({ minimumAmount: '{{minimumAmount}}', maximumAmount: '{{maximumAmount}}', validityDays: '{{validityDays}}' }), web.DEFAULT_SETTINGS);
assert.deepEqual(web.settingsFrom({ minimumAmount: '1000', maximumAmount: '20000', validityDays: '180' }), { minimumAmount: 1000, maximumAmount: 20000, validityDays: 180 });
for (const bad of [{ minimumAmount: '0' }, { validityDays: 'year' }, { minimumAmount: 9000, maximumAmount: 8000 }, { validityDays: 1.5 }]) {
  assert.throws(() => web.settingsFrom(bad), RangeError, JSON.stringify(bad));
}
assert.deepEqual(web.settingsFrom(web.installedSettings()), web.installedSettings());

// Purchases: required fields, addresses, amount bounds (for amount and item cards), items, and packs.
const settings = web.DEFAULT_SETTINGS;
const amountCard = web.validatePurchase({ ...buyer, kind: 'amount', amount: 5000 }, settings);
assert.equal(amountCard.ok, true);
assert.deepEqual(amountCard.purchase, { kind: 'amount', amount: 5000, itemName: '', itemSlug: null, minutes: null, ...buyer, promotionId: null, discountPercent: null, sessionsTotal: 1 });
assert.equal(web.validatePurchase({ ...buyer, senderEmail: ' ' , amount: 5000 }, settings).code, 'MISSING_FIELDS');
assert.equal(web.validatePurchase(null, settings).code, 'MISSING_FIELDS');
assert.equal(web.validatePurchase({ ...buyer, recipientEmail: 'ana@', amount: 5000 }, settings).code, 'INVALID_EMAIL');
assert.equal(web.validatePurchase({ ...buyer, amount: 2999 }, settings).code, 'INVALID_AMOUNT');
assert.equal(web.validatePurchase({ ...buyer, amount: 50001 }, settings).code, 'INVALID_AMOUNT');
assert.equal(web.validatePurchase({ ...buyer, amount: 'lots' }, settings).code, 'INVALID_AMOUNT');
assert.equal(web.validatePurchase({ ...buyer, kind: 'item', amount: 7500 }, settings).code, 'MISSING_ITEM');
assert.equal(web.validatePurchase({ ...buyer, kind: 'item', itemName: 'Relaxing Massage', amount: 60000 }, settings).code, 'INVALID_AMOUNT');
assert.equal(web.validatePurchase({ ...buyer, message: 'x'.repeat(501), amount: 5000 }, settings).code, 'TOO_LONG');
const itemCard = web.validatePurchase({ ...buyer, kind: 'item', itemName: ' Relaxing Massage ', itemSlug: 'relaxing-massage', minutes: 60, amount: 7000 }, settings);
assert.equal(itemCard.ok, true);
assert.equal(itemCard.purchase.itemName, 'Relaxing Massage');
assert.equal(itemCard.purchase.minutes, 60);
const pack = { promotionId: 'spring-pack', packSize: 5, discountPercent: 20, price: 30000 };
const packPurchase = web.validatePurchase({ senderName: 'Luis', senderEmail: 'luis@example.com', kind: 'item', itemName: 'Deep Facial', itemSlug: 'deep-facial', minutes: 60, amount: 1 }, settings, pack);
assert.equal(packPurchase.ok, true);
assert.equal(packPurchase.purchase.amount, 30000);
assert.equal(packPurchase.purchase.sessionsTotal, 5);
assert.equal(packPurchase.purchase.promotionId, 'spring-pack');
assert.equal(packPurchase.purchase.recipientEmail, 'luis@example.com');
assert.equal(web.validatePurchase({ ...buyer, itemName: 'Deep Facial' }, settings, pack).code, 'MISSING_ITEM');
assert.throws(() => web.validatePurchase({ ...buyer }, settings, { ...pack, packSize: 0 }), RangeError);
assert.equal(web.validatePurchase({ ...buyer, amount: 5000, language: 'Klingon!' }, settings).purchase.language, 'en');
const shouted = web.validatePurchase({ ...buyer, senderEmail: ' Luis@Example.COM ', recipientEmail: 'ANA@example.com', amount: 5000 }, settings).purchase;
assert.deepEqual([shouted.senderEmail, shouted.recipientEmail], ['luis@example.com', 'ana@example.com']);

// Values against a basket, usability and views of stored cards.
const card = (fields) => ({
  _id: 'c1', code: 'ABCD-EFGH-JKMN', kind: 'amount', amount: 5000, currency: 'EUR', itemName: '', itemSlug: null, minutes: null, ...buyer,
  status: 'issued', checkoutId: 'cs_1', paymentReference: 'pi_1', issuedBy: 'payment', issuedAt: now(), redeemedAt: null,
  expiresAt: new Date(clock + 365 * DAY), promotionId: null, discountPercent: null, sessionsTotal: 1, sessionsUsed: 0,
  balance: fields.kind === 'item' ? null : 5000, ...fields,
});
assert.equal(web.cardValue(card({}), lines), 5000);
assert.equal(web.cardValue(card({}), []), 5000);
assert.equal(web.cardValue(card({ balance: 1200 }), lines), 1200);
assert.equal(web.cardValue(card({ kind: 'item', amount: 6000, itemName: 'Deep Facial', itemSlug: 'deep-facial' }), lines), 8000);
assert.equal(web.cardValue(card({ kind: 'item', itemName: 'deep facial ' }), lines), 8000);
assert.equal(web.cardValue(card({ kind: 'item', itemName: 'Hot Stones', itemSlug: 'hot-stones' }), lines), 0);
assert.equal(web.matchesItem(card({ kind: 'item', itemName: 'Deep Facial', itemSlug: 'deep-facial' }), { itemSlug: 'deep-facial', itemName: 'Other' }), true);
assert.equal(web.matchesItem(card({ kind: 'item', itemName: 'Deep Facial', itemSlug: 'deep-facial' }), { itemSlug: 'relaxing-massage', itemName: 'Deep Facial' }), false);
assert.equal(web.matchesItem(card({}), lines[0]), false);
assert.deepEqual(web.usability(null, now()), { ok: false, reason: 'not_found' });
assert.deepEqual(web.usability(card({}), now()), { ok: true, sessionsLeft: 1 });
assert.deepEqual(web.usability(card({ expiresAt: new Date(clock - 1) }), now()), { ok: false, reason: 'expired' });
assert.deepEqual(web.usability(card({ status: 'redeemed', sessionsUsed: 1 }), now()), { ok: false, reason: 'redeemed' });
assert.deepEqual(web.usability(card({ sessionsTotal: 5, sessionsUsed: 3 }), now()), { ok: true, sessionsLeft: 2 });
const shown = web.publicView(card({ kind: 'item', itemName: 'Deep Facial', itemSlug: 'deep-facial', sessionsTotal: 5, sessionsUsed: 3, promotionId: 'spring-pack' }));
assert.equal(shown.pack, true);
assert.equal(shown.sessionsLeft, 2);
for (const secret of ['recipientName', 'recipientEmail', 'senderName', 'senderEmail', 'message', '_id', 'checkoutId', 'paymentReference']) assert.equal(secret in shown, false, secret);
assert.equal(shown.balance, null);
assert.equal(web.publicView(card({ balance: 1200 })).balance, 1200);
assert.equal(web.adminView(card({ balance: 1200 }), now()).balance, 1200);
assert.equal(web.adminView(card({}), now()).status, 'issued');
assert.equal(web.adminView(card({ expiresAt: new Date(clock - 1) }), now()).status, 'expired');
assert.equal(web.adminView(card({ status: 'redeemed', expiresAt: new Date(clock - 1) }), now()).status, 'redeemed');
assert.equal(web.adminView(card({}), now()).recipientName, 'Ana');
assert.equal('recipientEmail' in web.adminView(card({}), now()), false);
assert.equal(web.bookingPath(card({}), '/en'), '/en/reserve?gift=ABCD-EFGH-JKMN');
assert.equal(web.bookingPath(card({ itemSlug: 'deep-facial', minutes: 60 }), ''), '/reserve?item=deep-facial&minutes=60&locked=true&gift=ABCD-EFGH-JKMN');
assert.equal(web.bookingPath(card({ itemSlug: 'deep-facial' }), ''), '/reserve?item=deep-facial&locked=true&gift=ABCD-EFGH-JKMN');

// The service needs a store, codes and a payments client in the same currency.
const records = openRecords(now);
const payments = createPayments();
// The first codes repeat, so later cards meet a taken code.
const codes = createCodes({ seed: 11, sequence: ['AAAA-BBBB-CCCC', 'AAAA-BBBB-CCCC', 'AAAA-BBBB-CCCC'] });
assert.throws(() => m.createGiftCards({ codes, payments }), TypeError);
assert.throws(() => m.createGiftCards({ records, payments }), TypeError);
assert.throws(() => m.createGiftCards({ records, codes }), TypeError);
assert.throws(() => m.createGiftCards({ records, codes, payments: { currency: 'EUR', createCheckout: payments.createCheckout } }), TypeError);
assert.throws(() => m.createGiftCards({ records, codes, payments, currency: 'GBP' }), RangeError);
const cards = m.createGiftCards({ records, codes, payments, now });
assert.equal(cards.currency, 'EUR');
assert.deepEqual(cards.settings, web.installedSettings());
await cards.ensureIndexes();
assert.equal(m.GIFT_CARDS_COLLECTION, 'giftCards');
const indexes = await records.collection('giftCards').listIndexes();
for (const field of ['code', 'checkoutId']) assert.ok(indexes.some((index) => index.key[field] === 1 && index.unique), field);
for (const field of ['senderEmail', 'recipientEmail']) assert.ok(indexes.some((index) => index.key[field] === 1), field);
assert.equal(m.PURCHASES_COLLECTION, 'giftCardPurchases');
assert.ok((await records.collection('giftCardPurchases').listIndexes()).some((index) => index.key.senderEmail === 1));

// Checkout: the purchase is kept under an id and a token, then paid through one line item at the purchase amount, the sender
// as customer, and metadata naming the purchase.
const urls = { kind: 'checkout', successUrl: 'https://shop.example.com/es/gift-cards/success?checkout={CHECKOUT_ID}', cancelUrl: 'https://shop.example.com/es/gift-cards' };
assert.equal((await cards.checkout({ ...buyer, amount: 100 }, urls)).code, 'INVALID_AMOUNT');
assert.equal(payments.requests.length, 0);
assert.equal(await records.collection('giftCardPurchases').countDocuments({}), 0);
await assert.rejects(cards.checkout({ ...buyer, amount: 5000 }, { successUrl: urls.successUrl, cancelUrl: urls.cancelUrl }), TypeError);
const started = await cards.checkout({ ...buyer, kind: 'item', itemName: 'Relaxing Massage', itemSlug: 'relaxing-massage', minutes: 60, amount: 7000 }, urls);
assert.equal(started.ok, true);
assert.equal(started.kind, 'checkout');
assert.equal(typeof started.checkout.url, 'string');
assert.ok(typeof started.id === 'string' && typeof started.token === 'string' && started.token !== '');
const request = payments.requests[0];
assert.equal(request.lineItems.length, 1);
assert.equal(request.lineItems[0].amount, 7000);
assert.equal(request.customerEmail, 'luis@example.com');
assert.equal(request.language, 'es');
assert.equal(request.successUrl, urls.successUrl);
assert.equal(request.cancelUrl, urls.cancelUrl);
assert.deepEqual(request.metadata, { kind: 'gift', purchaseId: started.id });
const pending = await cards.purchase(started.id, started.token);
assert.deepEqual([pending.purchase.status, pending.purchase.payment, pending.purchase.checkoutId, pending.cards], ['pending', 'checkout', started.checkout.id, []]);
assert.deepEqual(pending.purchase.expiresAt, new Date(clock + DAY));
assert.equal(pending.purchase.recipientName, 'Ana');
assert.equal(await cards.purchase(started.id, 'not-the-token'), null);
assert.equal(await cards.purchase('missing', started.token), null);
const failing = m.createGiftCards({ records, codes, payments: createPayments({ fail: 'PROVIDER_ERROR' }), now });
const refused = await failing.checkout({ ...buyer, amount: 5000 }, urls);
assert.equal(refused.code, 'CHECKOUT_FAILED');
assert.equal(refused.reason, 'PROVIDER_ERROR');
assert.equal((await failing.checkout({ ...buyer, amount: 5000 }, sheet)).code, 'CHECKOUT_FAILED');
assert.equal(await records.collection('giftCardPurchases').countDocuments({}), 1);

// Fulfilment: only paid gift payments of the purchase's amount; once per payment, however often or however concurrently it is delivered.
assert.deepEqual(await cards.fulfil({ id: 'cs_x', paid: true, amountTotal: 1, currency: 'EUR', metadata: { kind: 'reservation' }, paymentReference: null, customerEmail: null }), { ok: false, code: 'NOT_GIFT' });
assert.deepEqual(await cards.fulfil(await payments.checkout(started.checkout.id)), { ok: false, code: 'NOT_PAID' });
const paid = await payments.simulated.complete(started.checkout.id);
assert.deepEqual(await cards.fulfil({ ...paid, amountTotal: 6999 }), { ok: false, code: 'PAYMENT_MISMATCH' });
const [first, second] = await Promise.all([cards.fulfil(paid), cards.fulfil(paid)]);
assert.equal(first.ok && second.ok, true);
assert.deepEqual([first.created, second.created].sort(), [false, true]);
assert.equal(first.card.code, second.card.code);
assert.equal(first.card.code, 'AAAA-BBBB-CCCC');
const again = await cards.fulfil(paid);
assert.equal(again.created, false);
assert.equal(again.card.code, first.card.code);
assert.equal(await records.collection('giftCards').countDocuments({}), 1);
const issued = first.card;
assert.equal(issued.kind, 'item');
assert.equal(issued.amount, 7000);
assert.equal(issued.currency, 'EUR');
assert.equal(issued.itemSlug, 'relaxing-massage');
assert.equal(issued.minutes, 60);
assert.equal(issued.recipientEmail, 'ana@example.com');
assert.equal(issued.message, 'Enjoy');
assert.equal(issued.language, 'es');
assert.equal(issued.status, 'issued');
assert.equal(issued.issuedBy, 'payment');
assert.equal(issued.paymentReference, paid.paymentReference);
assert.equal(issued.expiresAt.getTime(), clock + 365 * DAY);
assert.equal(issued.sessionsTotal, 1);
assert.equal(issued.sessionsUsed, 0);
assert.equal(issued.promotionId, null);
assert.equal(issued.balance, null);
assert.deepEqual(await cards.fulfil({ ...paid, id: 'cs_other', metadata: { kind: 'gift', cardKind: 'item' } }), { ok: false, code: 'INVALID_METADATA' });
assert.deepEqual(await cards.fulfil({ ...paid, id: 'cs_other', metadata: { kind: 'gift', purchaseId: 'missing' } }), { ok: false, code: 'INVALID_METADATA' });
const bought = await cards.purchase(started.id, started.token);
assert.deepEqual([bought.purchase.status, bought.cards.map((item) => item.code)], ['paid', [issued.code]]);

// A free card from the shop; its first code is taken, so it gets another.
const freeCard = await cards.issueFree({ ...buyer, amount: 4000 });
assert.equal(freeCard.ok, true);
assert.notEqual(freeCard.card.code, issued.code);
assert.equal(freeCard.card.issuedBy, 'admin');
assert.equal(freeCard.card.checkoutId, `admin-${freeCard.card.code}`);
assert.equal(freeCard.card.paymentReference, null);
assert.equal(freeCard.card.balance, 4000);
assert.equal((await cards.issueFree({ ...buyer, amount: 1 })).code, 'INVALID_AMOUNT');

// A pack bought under a promotion through an app's payment sheet: N sessions at the pack price; the sheet payment does not expire.
const packCheckout = await cards.checkout({ senderName: 'Luis', senderEmail: 'luis@example.com', kind: 'item', itemName: 'Deep Facial', itemSlug: 'deep-facial', minutes: 60, language: 'en' }, sheet, { pack });
assert.equal(packCheckout.ok, true);
assert.equal(packCheckout.kind, 'sheet');
assert.deepEqual(Object.keys(packCheckout.sheet).sort(), ['clientSecret', 'customer', 'ephemeralKey', 'id']);
const sheetRequest = payments.sheetRequests.at(-1);
assert.equal(sheetRequest.lineItems[0].amount, 30000);
assert.equal(sheetRequest.ephemeralKeyVersion, '2020-08-27');
assert.deepEqual(sheetRequest.metadata, { kind: 'gift', purchaseId: packCheckout.id });
assert.equal((await cards.purchase(packCheckout.id, packCheckout.token)).purchase.expiresAt, null);
const packCard = (await cards.fulfil(await payments.simulated.complete(packCheckout.sheet.id))).card;
assert.equal(packCard.promotionId, 'spring-pack');
assert.equal(packCard.sessionsTotal, 5);
assert.equal(packCard.discountPercent, 20);
assert.equal(packCard.amount, 30000);
assert.equal(packCard.recipientEmail, 'luis@example.com');
assert.equal(cards.cardValue(packCard, lines), 8000);

// The purchases and cards of an address, for the customer's wallet: as bought or received, newest first.
clock += 1000;
const later = await cards.issueFree({ ...buyer, recipientEmail: 'Luis@example.com', senderEmail: 'shop@example.com', amount: 3000 });
const luis = await cards.purchasesByEmail(' LUIS@example.com ');
assert.deepEqual(luis.map((record) => record.purchase._id).sort(), [packCheckout.id, started.id].sort());
assert.ok(luis.every((record) => record.purchase.status === 'paid' && record.cards.length === 1));
assert.deepEqual(new Set((await cards.cardsByEmail('luis@example.com')).map((item) => item.code)), new Set([later.card.code, packCard.code, issued.code, freeCard.card.code]));
assert.equal((await cards.cardsByEmail('luis@example.com'))[0].code, later.card.code);
assert.deepEqual((await cards.cardsByEmail('ana@example.com')).map((item) => item.code).sort(), [issued.code, freeCard.card.code].sort());
assert.deepEqual(await cards.purchasesByEmail('ana@example.com'), []);
assert.deepEqual(await cards.cardsByEmail('not an address'), []);

// Lookup, validation and usability read what people type.
assert.equal((await cards.lookup(` ${issued.code.toLowerCase().replaceAll('-', ' ')} `))._id, issued._id);
assert.equal(await cards.lookup('no such code'), null);
assert.equal(await cards.lookup(42), null);
const valid = await cards.validate(issued.code.toLowerCase());
assert.equal(valid.valid, true);
assert.equal(valid.code, issued.code);
assert.equal('recipientEmail' in valid, false);
assert.deepEqual(await cards.validate('ZZZZ-ZZZZ-ZZZZ'), { valid: false, reason: 'not_found' });
const usable = await cards.usable(packCard.code);
assert.equal(usable.ok, true);
assert.equal(usable.sessionsLeft, 5);

// Redemption: sessions one at a time, never more than the card has, then 409; expired cards give 410; unknown 404.
assert.deepEqual(await cards.redeem(issued.code, { amount: 500 }), { ok: false, status: 400, code: 'INVALID_AMOUNT' });
assert.deepEqual(await cards.redeem(issued.code), { ok: true, sessionsUsed: 1, sessionsTotal: 1, fullyRedeemed: true, taken: null, balance: null });
const done = await cards.redeem(issued.code);
assert.equal(done.status, 409);
assert.equal(done.code, 'REDEEMED');
assert.ok(done.redeemedAt instanceof Date);
assert.deepEqual(await cards.validate(issued.code), { valid: false, reason: 'redeemed' });
assert.deepEqual(await cards.redeem('ZZZZ-ZZZZ-ZZZZ'), { ok: false, status: 404, code: 'NOT_FOUND' });
const together = await Promise.all(Array.from({ length: 7 }, () => cards.redeem(packCard.code)));
assert.equal(together.filter((result) => result.ok).length, 5);
assert.equal(together.filter((result) => result.ok && result.fullyRedeemed).length, 1);
assert.ok(together.filter((result) => !result.ok).every((result) => result.status === 409));
assert.deepEqual((await cards.lookup(packCard.code)).sessionsUsed, 5);

// An amount card keeps a balance: staff take part of it, never more than is left; without an amount, all that is left.
assert.deepEqual(await cards.redeem(freeCard.card.code, { amount: 0 }), { ok: false, status: 400, code: 'INVALID_AMOUNT' });
assert.deepEqual(await cards.redeem(freeCard.card.code, { amount: 1500 }), { ok: true, sessionsUsed: 0, sessionsTotal: 1, fullyRedeemed: false, taken: 1500, balance: 2500 });
assert.deepEqual(await cards.redeem(freeCard.card.code, { amount: 2501 }), { ok: false, status: 409, code: 'INSUFFICIENT_BALANCE', balance: 2500 });
assert.equal(cards.cardValue(await cards.lookup(freeCard.card.code), lines), 2500);
assert.equal((await cards.validate(freeCard.card.code)).balance, 2500);
const takes = await Promise.all([1000, 1000, 1000].map((amount) => cards.redeem(freeCard.card.code, { amount })));
assert.equal(takes.filter((result) => result.ok).length, 2);
assert.equal(takes.find((result) => !result.ok).code, 'INSUFFICIENT_BALANCE');
assert.equal((await cards.lookup(freeCard.card.code)).balance, 500);
assert.deepEqual(await cards.redeem(later.card.code), { ok: true, sessionsUsed: 1, sessionsTotal: 1, fullyRedeemed: true, taken: 3000, balance: 0 });
assert.equal((await cards.lookup(later.card.code)).status, 'redeemed');
clock += 366 * DAY;
const expired = await cards.redeem(freeCard.card.code);
assert.equal(expired.status, 410);
assert.equal(expired.code, 'EXPIRED');
assert.deepEqual(await cards.usable(freeCard.card.code), { ok: false, reason: 'expired' });

// A late cancellation consumes a session, or what is left of an amount card, even after expiry; nothing is left after the last.
assert.equal(await cards.consume(freeCard.card.code), true);
assert.equal(await cards.consume(freeCard.card.code), false);
assert.deepEqual([(await cards.lookup(freeCard.card.code)).status, (await cards.lookup(freeCard.card.code)).balance], ['redeemed', 0]);
assert.equal(await cards.consume('ZZZZ-ZZZZ-ZZZZ'), false);
console.log('gift cards class: all checks passed');
