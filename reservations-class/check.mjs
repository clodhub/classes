import { assert, load } from './runtime.mjs';
// Doubles of every collaborator, written from their class documents (doubles.ts, with byte copies of the records engine
// and of opening-hours' zone functions).
import { createDoubles, request, SHEET, URLS } from './doubles.ts';

const m = await load('server/index.ts');
assert.equal(typeof m.createReservations, 'function');

async function quiet(action) {
  const saved = console.error;
  const logged = [];
  console.error = (...parts) => logged.push(parts.map(String).join(' '));
  try {
    return { value: await action(), logged };
  } finally {
    console.error = saved;
  }
}

function shop(options) {
  const doubles = createDoubles(options);
  return { ...doubles, reservations: m.createReservations(doubles.deps) };
}
const documents = (doubles) => doubles.store.collection('reservations').find({});

// Collaborators are checked when the service is made.
{
  const doubles = createDoubles();
  assert.throws(() => m.createReservations({ ...doubles.deps, calendar: undefined }), RangeError);
  assert.throws(() => m.createReservations({ ...doubles.deps, money: { ...doubles.deps.money, currency: 'GBP' } }), RangeError);
  assert.throws(() => m.createReservations({ ...doubles.deps, calendars: { bookings: 'bookings', busy: [] } }), RangeError);
  const { createSheetPayment, ...checkoutOnly } = doubles.deps.payments;
  assert.equal(typeof createSheetPayment, 'function');
  assert.throws(() => m.createReservations({ ...doubles.deps, payments: { ...checkoutOnly, createCheckout: doubles.deps.payments.createCheckout, refund: doubles.deps.payments.refund } }), RangeError);
}

// The collection's indexes: both cancellation secrets unique.
{
  const doubles = shop();
  await doubles.reservations.ensureIndexes();
  const indexes = await doubles.store.collection('reservations').listIndexes();
  for (const key of ['cancelToken', 'ownerCancelToken']) assert.ok(indexes.some((index) => index.key[key] === 1 && index.unique === true), key);
  assert.ok(indexes.some((index) => index.key.checkoutId === 1));
}

// A filled honeypot answers with the home path and stores nothing.
{
  const doubles = shop();
  assert.deepEqual(await doubles.reservations.reserve(request({ honeypot: 'bot' }), URLS), { ok: true, kind: 'ignored', path: '/en/' });
  assert.deepEqual(await doubles.reservations.reserve(request({ honeypot: 'bot', language: 'es' }), URLS), { ok: true, kind: 'ignored', path: '/' });
  assert.equal((await documents(doubles)).length, 0);
}

// Requests refused before anything is stored.
{
  const doubles = shop();
  const refused = async (fields, code, status = 400) =>
    assert.deepEqual(await doubles.reservations.reserve(request(fields), URLS), { ok: false, status, code }, code);
  await refused({ name: '' }, 'MISSING_FIELDS');
  await refused({ items: 'relaxing-massage' }, 'MISSING_FIELDS');
  await refused({ date: '6 May' }, 'INVALID_FORMAT');
  await refused({ date: '2026-05-04', time: '18:00' }, 'TOO_SOON');
  await refused({ date: '2026-05-10' }, 'CLOSED_DAY');
  await refused({ time: '15:00' }, 'OUTSIDE_HOURS');
  await refused({ items: [] }, 'MISSING_FIELDS');
  await refused({ items: [{ itemSlug: 'unknown-item', minutes: 60 }] }, 'UNKNOWN_ITEM');
  await refused({ items: [{ itemSlug: 'relaxing-massage', minutes: 50 }] }, 'UNKNOWN_ITEM');
  await refused({ memberCode: 'NOPE-NOPE-NOPE' }, 'MEMBER_CODE_INVALID');
  await refused({ giftCardCode: 'NOPE-NOPE-NOPE' }, 'GIFT_CARD_INVALID');
  assert.equal((await documents(doubles)).length, 0);
}

// A deposit is paid through a checkout; the paid checkout confirms the booking, makes its event and sends the notice.
{
  const doubles = shop();
  await assert.rejects(doubles.reservations.reserve(request(), { successUrl: URLS.successUrl, cancelUrl: URLS.cancelUrl }), RangeError);
  await assert.rejects(doubles.reservations.reserve(request(), { kind: 'sheet' }), RangeError);
  const result = await doubles.reservations.reserve(request({ email: ' Sam@Example.COM ' }), URLS);
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'checkout');
  const [checkout] = doubles.payments.requests;
  const [stored] = await documents(doubles);
  assert.deepEqual([result.id, result.token], [stored._id, stored.cancelToken]);
  assert.deepEqual(result.checkout, { id: stored.checkoutId, url: `https://payments.example.com/pay/${stored.checkoutId}` });
  assert.equal(stored.clientEmail, 'sam@example.com');
  assert.equal(stored.status, 'awaiting_payment');
  assert.deepEqual(checkout.metadata, { kind: 'reservation', reservationId: stored._id });
  assert.equal(checkout.lineItems[0].amount, 3500);
  assert.equal(checkout.successUrl, URLS.successUrl);
  assert.deepEqual(checkout.expiresAt, doubles.policy.checkoutExpiry(doubles.now(), doubles.policy.settings.checkoutMinutes));
  assert.deepEqual(await doubles.reservations.status(stored.checkoutId), { status: 'awaiting_payment' });
  const summary = doubles.payments.simulated.complete(stored.checkoutId);
  assert.deepEqual(await doubles.reservations.confirmPayment(summary), { outcome: 'confirmed' });
  assert.equal((await doubles.reservations.confirmPayment(summary)).outcome, 'ignored');
  assert.deepEqual(await doubles.reservations.status(stored.checkoutId), { status: 'confirmed' });
  const events = [...doubles.calendar.events.values()];
  assert.equal(events.length, 1);
  assert.equal(events[0].calendar, 'bookings');
  assert.deepEqual([events[0].start.toISOString(), events[0].end.toISOString()], ['2026-05-06T08:00:00.000Z', '2026-05-06T09:00:00.000Z']);
  const notice = doubles.notices.find((item) => item.type === 'confirmed');
  assert.equal(notice.deposit, 3500);
  assert.equal(notice.balance, 3500);
  assert.equal(notice.language, 'en');
  assert.ok(notice.cancelUrl.includes(encodeURIComponent(notice.reservation.cancelToken)));
  assert.ok(notice.ownerCancelUrl.includes(encodeURIComponent(notice.reservation.ownerCancelToken)));
  assert.deepEqual(notice.freeCancellationDeadline, new Date('2026-05-05T08:00:00.000Z'));
  assert.equal((await doubles.reservations.preview('no-such-token')), null);
  const preview = await doubles.reservations.preview(notice.reservation.cancelToken);
  assert.equal(preview.by, 'customer');
  assert.equal(preview.refundEligible, true);
  assert.equal((await doubles.reservations.preview(notice.reservation.ownerCancelToken)).by, 'owner');

  // A customer cancelling inside the free period gets nothing back; the event goes.
  doubles.setTime('2026-05-05T09:00:00.000Z');
  assert.deepEqual(await doubles.reservations.cancel(notice.reservation.cancelToken), { ok: true, refund: 'not_eligible', by: 'customer', cardConsumed: false });
  assert.equal(doubles.calendar.events.size, 0);
  assert.equal(doubles.payments.refunds.length, 0);
  assert.deepEqual(await doubles.reservations.cancel(notice.reservation.cancelToken), { ok: false, status: 400, code: 'ALREADY_CANCELLED' });
  assert.deepEqual(await doubles.reservations.cancel('no-such-token'), { ok: false, status: 404, code: 'NOT_FOUND' });
  assert.deepEqual(await doubles.reservations.cancel(''), { ok: false, status: 400, code: 'MISSING_TOKEN' });
  assert.ok(doubles.notices.some((item) => item.type === 'cancelled' && item.by === 'customer' && item.refund === 'not_eligible'));
}

// The owner always refunds the whole deposit, once, under the key refund:<id>.
{
  const doubles = shop();
  await doubles.reservations.reserve(request(), URLS);
  const [stored] = await documents(doubles);
  await doubles.reservations.confirmPayment(doubles.payments.simulated.complete(stored.checkoutId));
  doubles.setTime('2026-05-06T07:00:00.000Z');
  assert.deepEqual(await doubles.reservations.cancel(stored.ownerCancelToken), { ok: true, refund: 'refunded', by: 'owner', cardConsumed: false });
  assert.equal(doubles.payments.refunds[0].idempotencyKey, `refund:${stored._id}`);
  assert.equal(doubles.payments.refundedOf(doubles.payments.refunds[0].paymentReference), 3500);
  const [cancelled] = await documents(doubles);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelReason, 'business');
}

// No deposit due (a gift card covers it): confirmed at once.
{
  const doubles = shop();
  doubles.giftCards.add({ code: 'GIFT-CARD-AAAA', kind: 'amount', amount: 5000, expiresAt: new Date('2027-01-01T00:00:00Z') });
  const confirmed = await doubles.reservations.reserve(request({ giftCardCode: 'gift-card-aaaa' }), URLS);
  const [stored] = await documents(doubles);
  assert.deepEqual(confirmed, { ok: true, kind: 'confirmed', id: stored._id, token: stored.cancelToken });
  assert.equal(stored.status, 'confirmed');
  assert.equal(stored.deposit, 0);
  assert.equal(stored.balance, 2000);
  assert.equal(doubles.payments.requests.length, 0);
  assert.equal(doubles.calendar.events.size, 1);
  assert.ok(doubles.notices.some((item) => item.type === 'confirmed' && item.deposit === 0));
  // The card is held by that booking: it has one session.
  assert.deepEqual(await doubles.reservations.reserve(request({ giftCardCode: 'GIFT-CARD-AAAA', time: '17:00' }), URLS),
    { ok: false, status: 400, code: 'GIFT_CARD_IN_USE' });
}

// A time taken in the calendar is refused with nothing stored; a calendar that cannot be reached lets the booking through.
{
  const doubles = shop();
  doubles.calendar.block('travel', new Date('2026-05-06T08:30:00Z'), new Date('2026-05-06T09:30:00Z'));
  assert.deepEqual(await doubles.reservations.reserve(request(), URLS), { ok: false, status: 409, code: 'SLOT_TAKEN' });
  assert.equal((await documents(doubles)).length, 0);
  doubles.calendar.unavailable = true;
  const open = await quiet(() => doubles.reservations.reserve(request(), URLS));
  assert.equal(open.value.kind, 'checkout');
  assert.ok(open.logged.length > 0);
}

// A paid checkout whose time was lost meanwhile is cancelled and refunded; so is one the new schedule no longer opens.
{
  const doubles = shop();
  await doubles.reservations.reserve(request(), URLS);
  const [lost] = await documents(doubles);
  doubles.calendar.block('bookings', new Date('2026-05-06T08:00:00Z'), new Date('2026-05-06T09:00:00Z'));
  const outcome = await doubles.reservations.confirmPayment(doubles.payments.simulated.complete(lost.checkoutId));
  assert.deepEqual(outcome, { outcome: 'cancelled', reason: 'slot_lost', refund: 'refunded' });
  assert.equal(doubles.payments.refunds[0].idempotencyKey, `refund:${lost._id}`);
  assert.deepEqual(await doubles.reservations.status(lost.checkoutId), { status: 'cancelled', cancelReason: 'slot_lost' });
  assert.ok(doubles.notices.some((item) => item.type === 'payment-cancelled' && item.reason === 'slot_lost'));

  await doubles.reservations.reserve(request({ time: '17:00' }), URLS);
  const late = (await documents(doubles)).find((item) => item.time === '17:00');
  doubles.useSchedule('quiet');
  assert.deepEqual(await doubles.reservations.confirmPayment(doubles.payments.simulated.complete(late.checkoutId)),
    { outcome: 'cancelled', reason: 'too_late', refund: 'refunded' });
}

// A checkout that does not pay the deposit changes nothing.
{
  const doubles = shop();
  await doubles.reservations.reserve(request(), URLS);
  const [stored] = await documents(doubles);
  const summary = await doubles.payments.checkout(stored.checkoutId);
  assert.deepEqual((await quiet(() => doubles.reservations.confirmPayment(summary))).value, { outcome: 'ignored', reason: 'payment_mismatch' });
  assert.deepEqual(await doubles.reservations.confirmPayment({ ...summary, metadata: { kind: 'gift' } }), { outcome: 'ignored', reason: 'not_reservation' });
  assert.equal((await documents(doubles))[0].status, 'awaiting_payment');
}

// Availability: starts on the step after busy times and the buffer, none when the calendars cannot be reached.
{
  const doubles = shop();
  doubles.calendar.block('bookings', new Date('2026-05-06T09:00:00Z'), new Date('2026-05-06T10:00:00Z'));
  const day = await doubles.reservations.availability({ date: '2026-05-06', minutes: '60' });
  assert.equal(day.ok, true);
  assert.deepEqual(day.slots.slice(0, 3).map((slot) => slot.start), ['12:10', '12:40', '16:00']);
  assert.deepEqual(await doubles.reservations.availability({ date: '2026-05-06', minutes: '5' }), { ok: false, status: 400, code: 'INVALID_DURATION' });
  assert.deepEqual(await doubles.reservations.availability({ date: '2026-05-04', minutes: 60 }), { ok: false, status: 400, code: 'TOO_SOON' });
  assert.deepEqual(await doubles.reservations.availability({ date: 'May 6', minutes: 60 }), { ok: false, status: 400, code: 'INVALID_DATE' });
  doubles.calendar.unavailable = true;
  assert.deepEqual((await quiet(() => doubles.reservations.availability({ date: '2026-05-06', minutes: 60 }))).value.slots, []);
  const info = await doubles.reservations.scheduleInfo();
  assert.equal(info.id, 'regular');
  assert.deepEqual(info.closedDays, [0]);
}

// An app's payment sheet: a sheet payment for the deposit in the SDK's API version; its completion confirms the booking.
{
  const doubles = shop();
  const result = await doubles.reservations.reserve(request(), SHEET);
  const [stored] = await documents(doubles);
  assert.equal(result.kind, 'sheet');
  assert.deepEqual([result.id, result.token, result.sheet.id], [stored._id, stored.cancelToken, stored.checkoutId]);
  assert.deepEqual(Object.keys(result.sheet).sort(), ['clientSecret', 'customer', 'ephemeralKey', 'id']);
  assert.equal(doubles.payments.requests.length, 0);
  const [sheetRequest] = doubles.payments.sheetRequests;
  assert.deepEqual([sheetRequest.lineItems[0].amount, sheetRequest.ephemeralKeyVersion, sheetRequest.customerEmail], [3500, '2020-08-27', 'sam@example.com']);
  assert.deepEqual(sheetRequest.metadata, { kind: 'reservation', reservationId: stored._id });
  assert.deepEqual(await doubles.reservations.confirmPayment(doubles.payments.simulated.complete(stored.checkoutId)), { outcome: 'confirmed' });
  assert.equal((await documents(doubles))[0].paymentReference, stored.checkoutId);
  // A sheet payment that cannot start cancels the booking, as a checkout does.
  doubles.payments.fail.push('createSheetPayment');
  assert.deepEqual((await quiet(() => doubles.reservations.reserve(request({ time: '17:00' }), SHEET))).value, { ok: false, status: 500, code: 'CHECKOUT_FAILED' });
  assert.equal((await documents(doubles)).find((item) => item.time === '17:00').cancelReason, 'checkout_failed');
}

// A booking is read by its id and the customer's token, with the policy's answers for now; one awaiting payment past its
// payment's end is expired, and a payment that still arrives confirms it while the time is free.
{
  const doubles = shop();
  const made = await doubles.reservations.reserve(request(), SHEET);
  const [stored] = await documents(doubles);
  const view = await doubles.reservations.find(made.id, made.token);
  assert.deepEqual([view.status, view.depositPaid, view.refundOnCancel, view.deposit, view.balance, view.currency], ['awaiting_payment', false, false, 3500, 3500, 'EUR']);
  assert.deepEqual([view.startsAt, view.endsAt], [new Date('2026-05-06T08:00:00.000Z'), new Date('2026-05-06T09:00:00.000Z')]);
  assert.deepEqual(view.paymentExpiresAt, doubles.policy.checkoutExpiry(stored.createdAt, doubles.policy.settings.checkoutMinutes));
  assert.deepEqual(view.freeCancellationDeadline, new Date('2026-05-05T08:00:00.000Z'));
  assert.deepEqual(view.items.map((item) => [item.itemSlug, item.minutes, item.price]), [['relaxing-massage', 60, 7000]]);
  assert.equal(await doubles.reservations.find(made.id, stored.ownerCancelToken), null);
  assert.equal(await doubles.reservations.find('missing', made.token), null);
  assert.equal(await doubles.reservations.find(made.id, ''), null);
  doubles.advance(doubles.policy.settings.checkoutMinutes + 1);
  assert.equal((await doubles.reservations.find(made.id, made.token)).status, 'expired');
  assert.deepEqual(await doubles.reservations.confirmPayment(doubles.payments.simulated.complete(stored.checkoutId)), { outcome: 'confirmed' });
  const paid = await doubles.reservations.find(made.id, made.token);
  assert.deepEqual([paid.status, paid.depositPaid, paid.refundOnCancel, paid.paymentExpiresAt], ['confirmed', true, true, null]);
}

// The bookings of an address, for the customer's wallet: soonest first, those ending after a moment when asked.
{
  const doubles = shop();
  const later = await doubles.reservations.reserve(request({ date: '2026-05-07', email: 'SAM@example.com' }), URLS);
  const sooner = await doubles.reservations.reserve(request(), URLS);
  await doubles.reservations.reserve(request({ time: '17:00', email: 'alex@example.com' }), URLS);
  assert.deepEqual((await doubles.reservations.bookingsByEmail(' sam@EXAMPLE.com ')).map((item) => [item.id, item.token]),
    [[sooner.id, sooner.token], [later.id, later.token]]);
  assert.deepEqual((await doubles.reservations.bookingsByEmail('sam@example.com', { endsAfter: new Date('2026-05-06T09:00:00.000Z') })).map((item) => item.id), [later.id]);
  assert.deepEqual(await doubles.reservations.bookingsByEmail('nobody@example.com'), []);
  assert.deepEqual(await doubles.reservations.bookingsByEmail('not an address'), []);
  await assert.rejects(doubles.reservations.bookingsByEmail('sam@example.com', { endsAfter: 'tomorrow' }), RangeError);
}

// The quote prices a booking as reserve prices it, without the holds and the calendars.
{
  const doubles = shop();
  doubles.memberPricing.add({ code: 'MEMB-ERCO-DEAA', rule: { mode: 'discount', discountPercent: 20, itemSlugs: [], categorySlugs: [], allItems: true }, expiresAt: new Date('2027-01-01T00:00:00Z') });
  doubles.giftCards.add({ code: 'GIFT-CARD-BBBB', kind: 'amount', amount: 2000, expiresAt: new Date('2027-01-01T00:00:00Z') });
  const priced = await doubles.reservations.quote({ items: [{ itemSlug: 'relaxing-massage', minutes: 60 }], date: '2026-05-06', time: '10:00', language: 'en' });
  assert.deepEqual([priced.ok, priced.total, priced.deposit, priced.balance, priced.member, priced.giftCard, priced.homeVisit],
    [true, 7000, 3500, 3500, 'none', { status: 'none', value: 0 }, { status: 'none', distanceKm: null }]);
  assert.deepEqual(priced.lines, [{ itemSlug: 'relaxing-massage', itemName: 'Relaxing Massage', minutes: 60, price: 7000, listPrice: 7000, available: true }]);
  assert.deepEqual(priced.freeCancellationDeadline, new Date('2026-05-05T08:00:00.000Z'));
  const member = await doubles.reservations.quote({ items: [{ itemSlug: 'relaxing-massage', minutes: 60 }], memberCode: 'memb-erco-deaa', giftCardCode: 'GIFT-CARD-BBBB' });
  assert.deepEqual([member.member, member.lines[0].price, member.lines[0].listPrice, member.giftCard, member.total, member.freeCancellationDeadline],
    ['applied', 5600, 7000, { status: 'applied', value: 2000 }, 5600, null]);
  const refused = await doubles.reservations.quote({ items: [{ itemSlug: 'unknown-item', minutes: 60 }], memberCode: 'NOPE-NOPE-NOPE', giftCardCode: 'NOPE-NOPE-NOPE' });
  assert.deepEqual([refused.lines[0].available, refused.member, refused.giftCard.status, refused.total], [false, 'invalid', 'invalid', 0]);
  assert.deepEqual(await doubles.reservations.quote({ items: 'relaxing-massage' }), { ok: false, status: 400, code: 'MISSING_FIELDS' });
  assert.equal((await documents(doubles)).length, 0);
}

console.log('reservations class: all checks passed');
