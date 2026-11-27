import { assert, load } from './runtime.mjs';

const m = await load('web/index.ts');
for (const name of ['reminderPlan', 'reminderId', 'settingsFrom', 'installedSettings', 'leadMinutes']) assert.equal(typeof m[name], 'function', name);
assert.equal(m.MAXIMUM_REMINDERS, 60);

// Settings: two lead times in minutes, 0 for none; text as rendered, or still {{name}} before installation.
const defaults = { firstLeadMinutes: 1440, secondLeadMinutes: 120 };
assert.deepEqual(m.settingsFrom({}), defaults);
assert.deepEqual(m.settingsFrom({ firstLeadMinutes: '{{firstLeadMinutes}}', secondLeadMinutes: '{{secondLeadMinutes}}' }), defaults);
assert.deepEqual(m.settingsFrom({ firstLeadMinutes: '2880', secondLeadMinutes: '0' }), { firstLeadMinutes: 2880, secondLeadMinutes: 0 });
assert.throws(() => m.settingsFrom({ firstLeadMinutes: '40321' }), RangeError);
assert.throws(() => m.settingsFrom({ secondLeadMinutes: '-1' }), RangeError);
assert.deepEqual(m.leadMinutes({ firstLeadMinutes: 2880, secondLeadMinutes: 0 }), [2880]);
assert.deepEqual(m.leadMinutes({ firstLeadMinutes: 60, secondLeadMinutes: 60 }), [60]);
assert.deepEqual(m.leadMinutes(m.installedSettings()).every((minutes) => Number.isInteger(minutes) && minutes > 0), true);

// The plan: confirmed bookings only, times after now only, time order then id order, a booking id once, the soonest 60.
const at = (text) => new Date(text);
const id = (n) => `6a1f${n.toString(16).padStart(20, '0')}`;
const plain = (plan) => plan.map((item) => [item.id, item.bookingId, item.minutes, item.at.toISOString()]);
const now = at('2027-02-28T09:00:00.000Z');
const bookings = [
  { id: id(3), status: 'confirmed', startsAt: at('2027-03-01T08:00:00.000Z') },
  { id: id(4), status: 'pending', startsAt: at('2027-03-01T08:00:00.000Z') },
  { id: id(5), status: 'cancelled', startsAt: at('2027-03-01T08:00:00.000Z') },
  { id: id(2), status: 'confirmed', startsAt: at('2027-03-01T08:00:00.000Z') },
  { id: id(3), status: 'confirmed', startsAt: at('2027-03-05T08:00:00.000Z') },
  { id: id(6), status: 'confirmed', startsAt: at('2027-02-28T09:30:00.000Z') },
];
assert.deepEqual(plain(m.reminderPlan(bookings, [1440, 120], now)), [
  [`booking-${id(2)}-120`, id(2), 120, '2027-03-01T06:00:00.000Z'],
  [`booking-${id(3)}-120`, id(3), 120, '2027-03-01T06:00:00.000Z'],
]);
assert.deepEqual(plain(m.reminderPlan(bookings, [1440, 120], at('2027-02-27T07:00:00.000Z'))), [
  [`booking-${id(6)}-1440`, id(6), 1440, '2027-02-27T09:30:00.000Z'],
  [`booking-${id(2)}-1440`, id(2), 1440, '2027-02-28T08:00:00.000Z'],
  [`booking-${id(3)}-1440`, id(3), 1440, '2027-02-28T08:00:00.000Z'],
  [`booking-${id(6)}-120`, id(6), 120, '2027-02-28T07:30:00.000Z'],
  [`booking-${id(2)}-120`, id(2), 120, '2027-03-01T06:00:00.000Z'],
  [`booking-${id(3)}-120`, id(3), 120, '2027-03-01T06:00:00.000Z'],
].sort((a, b) => (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : a[0] < b[0] ? -1 : 1)));
const month = Array.from({ length: 40 }, (_, day) => ({ id: id(100 + day), status: 'confirmed', startsAt: new Date(Date.UTC(2027, 2, 1 + day, 9)) }));
const plan = m.reminderPlan(month, [1440, 120], at('2027-02-20T00:00:00.000Z'));
assert.equal(plan.length, 60);
assert.equal(plan.at(-1).id, `booking-${id(129)}-120`);
assert.deepEqual(m.reminderPlan([], [1440], now), []);
assert.throws(() => m.reminderPlan(bookings, [0], now), RangeError);
assert.throws(() => m.reminderPlan(bookings, [120], new Date('later')), RangeError);
assert.equal(m.reminderId('6a1f', 1440), 'booking-6a1f-1440');
