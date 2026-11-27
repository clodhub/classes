import { assert, load } from './runtime.mjs';
import { createStore } from './records.ts';

const web = await load('web/index.ts');
const m = await load('server/index.ts');
const at = (iso) => () => new Date(iso);
const iso = (date, time, zone) => m.zonedInstant(date, time, zone).toISOString();
const MADRID = 'Europe/Madrid';
const SYDNEY = 'Australia/Sydney';

// The web entry offers every shared function; the server entry adds the active schedule.
for (const name of ['isDate', 'isTime', 'dayOfWeek', 'addDays', 'today', 'wallTime', 'zonedInstant', 'offsetOf', 'validateCalendar', 'scheduleFor',
  'closedDays', 'windowsOn', 'earliestBookableDate', 'firstBookableDate', 'checkBooking', 'openingHoursSpecification', 'describeHours',
  'settingsFrom', 'installedSettings']) {
  assert.equal(typeof web[name], 'function', name);
  assert.equal(typeof m[name], 'function', name);
}
assert.equal(typeof m.createActiveSchedule, 'function');

// Two weeks as data: two windows from Tuesday to Friday, and windows that alternate by day with Monday by appointment.
const span = (open, close) => [{ open, close }];
const split = [{ open: '09:30', close: '13:30' }, { open: '16:00', close: '19:30' }];
const twoWindows = { '0': [], '1': [], '2': split, '3': split, '4': split, '5': split, '6': span('09:00', '14:00') };
const alternating = { '0': [], '1': [], '2': span('11:00', '19:00'), '3': span('08:30', '16:30'), '4': span('11:00', '19:00'),
  '5': span('08:30', '16:30'), '6': span('09:00', '13:00') };
const calendar = { timeZone: MADRID, defaultSchedule: 'standard',
  schedules: [{ id: 'standard', hours: twoWindows }, { id: 'quiet', name: { en: 'Quiet season' }, hours: alternating, byAppointmentDays: [1] }] };

// Settings.
assert.deepEqual(m.settingsFrom({}), { leadDays: 1 });
assert.deepEqual(m.settingsFrom({ leadDays: '{{leadDays}}' }), { leadDays: 1 });
assert.deepEqual(m.settingsFrom({ leadDays: '0' }), { leadDays: 0 });
assert.deepEqual(m.settingsFrom({ leadDays: 30 }), { leadDays: 30 });
assert.throws(() => m.settingsFrom({ leadDays: '-1' }), RangeError);
assert.throws(() => m.settingsFrom({ leadDays: 'soon' }), RangeError);
assert.equal(Number.isInteger(m.installedSettings().leadDays), true);

// Calendars.
assert.deepEqual(m.validateCalendar(calendar), []);
assert.ok(m.validateCalendar({ ...calendar, timeZone: 'Mars/Olympus' }).length > 0);
assert.ok(m.validateCalendar({ ...calendar, defaultSchedule: 'missing' }).length > 0);
assert.ok(m.validateCalendar({ ...calendar, schedules: [{ id: 'standard', hours: { '1': [{ open: '15:00', close: '10:00' }] } }] }).length > 0);
assert.ok(m.validateCalendar({ ...calendar, schedules: [{ id: 'standard', hours: { '1': [{ open: '10:00', close: '15:00' }, { open: '14:00', close: '16:00' }] } }] }).length > 0);
assert.ok(m.validateCalendar({ ...calendar, schedules: [{ id: 'standard', hours: { '8': [] } }] }).length > 0);
assert.ok(m.validateCalendar({ ...calendar, schedules: [{ id: 'standard', hours: twoWindows, byAppointmentDays: [2] }] }).length > 0);
assert.ok(m.validateCalendar({ ...calendar, schedules: [{ id: 'standard', hours: twoWindows }, { id: 'standard', hours: alternating }] }).length > 0);
assert.ok(m.validateCalendar('calendar').length > 0);
assert.equal(m.scheduleFor(calendar, 'quiet').id, 'quiet');
assert.equal(m.scheduleFor(calendar, 'unknown').id, 'standard');
assert.equal(m.scheduleFor(calendar, null).id, 'standard');
assert.deepEqual(m.closedDays(twoWindows), [0, 1]);
assert.deepEqual(m.closedDays({ '3': span('09:00', '12:00') }), [0, 1, 2, 4, 5, 6]);
assert.deepEqual(m.windowsOn(twoWindows, '2026-03-03'), split);
assert.deepEqual(m.windowsOn(twoWindows, '2026-03-02'), []);
assert.deepEqual(m.windowsOn(twoWindows, '2026-03-01'), []);

// Calendar dates: weekdays do not depend on the zone; lead days count from the zone's today.
assert.equal(m.isDate('2028-02-29'), true);
assert.equal(m.isDate('2026-02-29'), false);
assert.equal(m.isTime('23:59'), true);
assert.equal(m.isTime('24:00'), false);
assert.equal(m.dayOfWeek('2026-03-01'), 0);
assert.equal(m.dayOfWeek('2026-01-05'), 1);
assert.throws(() => m.dayOfWeek('2026-13-01'), RangeError);
assert.equal(m.addDays('2026-12-31', 1), '2027-01-01');
assert.equal(m.addDays('2028-03-01', -1), '2028-02-29');
assert.equal(m.today(MADRID, at('2026-03-02T22:59:00Z')), '2026-03-02');
assert.equal(m.today(MADRID, at('2026-03-02T23:00:00Z')), '2026-03-03');
assert.equal(m.today('Pacific/Auckland', at('2026-01-04T12:30:00Z')), '2026-01-05');
assert.equal(m.today('America/Los_Angeles', at('2026-01-05T07:30:00Z')), '2026-01-04');
assert.equal(m.earliestBookableDate(MADRID, 1, at('2026-03-02T23:00:00Z')), '2026-03-04');
assert.equal(m.earliestBookableDate(MADRID, 0, at('2026-03-02T10:00:00Z')), '2026-03-02');
assert.equal(m.firstBookableDate(twoWindows, MADRID, 1, at('2026-03-07T10:00:00Z')), '2026-03-10');
assert.equal(m.firstBookableDate({}, MADRID, 1, at('2026-03-07T10:00:00Z')), '2026-03-08');

// Bookings: the codes in their order.
const options = { timeZone: MADRID, leadDays: 1, now: at('2026-03-02T10:00:00Z') };
assert.deepEqual(m.checkBooking('2026-03-03', '09:30', twoWindows, options), { ok: true });
assert.deepEqual(m.checkBooking('2026-03-03', '19:29', twoWindows, options), { ok: true });
assert.deepEqual(m.checkBooking('2026-03-3', '10:00', twoWindows, options), { ok: false, code: 'INVALID_FORMAT' });
assert.deepEqual(m.checkBooking('2026-02-30', '10:00', twoWindows, options), { ok: false, code: 'INVALID_FORMAT' });
assert.deepEqual(m.checkBooking('2026-03-03', '25:00', twoWindows, options), { ok: false, code: 'INVALID_FORMAT' });
assert.deepEqual(m.checkBooking('2026-03-02', '18:00', twoWindows, options), { ok: false, code: 'TOO_SOON' });
assert.deepEqual(m.checkBooking('2026-03-08', '12:00', twoWindows, options), { ok: false, code: 'CLOSED_DAY' });
assert.deepEqual(m.checkBooking('2026-03-09', '12:00', twoWindows, options), { ok: false, code: 'CLOSED_DAY' });
assert.deepEqual(m.checkBooking('2026-03-03', '15:00', twoWindows, options), { ok: false, code: 'OUTSIDE_HOURS' });
assert.deepEqual(m.checkBooking('2026-03-03', '19:30', twoWindows, options), { ok: false, code: 'OUTSIDE_HOURS' });
const sameDay = { timeZone: MADRID, leadDays: 0, now: at('2026-03-03T10:00:00Z') };
assert.deepEqual(m.checkBooking('2026-03-03', '10:30', twoWindows, sameDay), { ok: false, code: 'TOO_SOON' });
assert.deepEqual(m.checkBooking('2026-03-03', '11:30', twoWindows, sameDay), { ok: true });

// Wall-clock instants across both daylight saving changes, in Madrid and in Sydney.
assert.equal(iso('2026-01-15', '10:00', MADRID), '2026-01-15T09:00:00.000Z');
assert.equal(iso('2026-07-15', '10:00', MADRID), '2026-07-15T08:00:00.000Z');
assert.equal(iso('2026-03-29', '01:59', MADRID), '2026-03-29T00:59:00.000Z');
assert.equal(iso('2026-03-29', '02:30', MADRID), '2026-03-29T01:30:00.000Z');
assert.equal(iso('2026-03-29', '10:00', MADRID), '2026-03-29T08:00:00.000Z');
assert.equal(iso('2026-10-25', '02:30', MADRID), '2026-10-25T00:30:00.000Z');
assert.equal(iso('2026-10-25', '03:00', MADRID), '2026-10-25T02:00:00.000Z');
assert.equal(iso('2026-10-25', '10:00', MADRID), '2026-10-25T09:00:00.000Z');
assert.equal(iso('2026-03-02', '24:00', MADRID), '2026-03-02T23:00:00.000Z');
assert.equal(iso('2026-10-04', '02:30', SYDNEY), '2026-10-03T16:30:00.000Z');
assert.equal(iso('2026-10-04', '10:00', SYDNEY), '2026-10-03T23:00:00.000Z');
assert.equal(iso('2026-04-05', '02:30', SYDNEY), '2026-04-04T15:30:00.000Z');
assert.equal(iso('2026-04-05', '10:00', SYDNEY), '2026-04-05T00:00:00.000Z');
assert.equal(iso('2026-09-06', '00:00', 'America/Santiago'), '2026-09-06T04:00:00.000Z');
assert.throws(() => m.zonedInstant('2026-03-02', '10:00', 'Mars/Olympus'), RangeError);
assert.throws(() => m.zonedInstant('2026-03-02', '7:00', MADRID), RangeError);
assert.equal(m.wallTime(new Date('2026-03-29T01:00:00Z'), MADRID), '03:00');
assert.equal(m.wallTime(new Date('2026-10-25T01:30:00Z'), MADRID), '02:30');
assert.equal(m.wallTime(new Date('2026-10-03T16:00:00Z'), SYDNEY), '03:00');
assert.equal(m.offsetOf('2026-01-15', MADRID), '+01:00');
assert.equal(m.offsetOf('2026-03-29', MADRID), '+02:00');
assert.equal(m.offsetOf('2026-03-29', MADRID, '01:00'), '+01:00');
assert.equal(m.offsetOf('2026-04-05', SYDNEY), '+10:00');
assert.equal(m.offsetOf('2026-01-15', 'Asia/Kolkata'), '+05:30');
assert.equal(m.offsetOf('2026-01-15', 'America/Sao_Paulo'), '-03:00');
assert.equal(m.offsetOf('2026-01-15', 'UTC'), '+00:00');

// schema.org texts and words.
assert.deepEqual(m.openingHoursSpecification(twoWindows), ['Tu-Fr 09:30-13:30', 'Tu-Fr 16:00-19:30', 'Sa 09:00-14:00']);
assert.deepEqual(m.openingHoursSpecification(alternating), ['Tu 11:00-19:00', 'We 08:30-16:30', 'Th 11:00-19:00', 'Fr 08:30-16:30', 'Sa 09:00-13:00']);
assert.deepEqual(m.openingHoursSpecification({ '6': span('09:00', '13:00'), '0': span('09:00', '13:00') }), ['Sa-Su 09:00-13:00']);
assert.equal(m.describeHours(calendar.schedules[0], { language: 'en' }), 'Tue\u2013Fri: 09:30\u201313:30, 16:00\u201319:30 | Sat: 09:00\u201314:00');
assert.equal(m.describeHours(calendar.schedules[1], { language: 'en', byAppointment: 'by appointment' }),
  'Mon: by appointment | Tue, Thu: 11:00\u201319:00 | Wed, Fri: 08:30\u201316:30 | Sat: 09:00\u201313:00');
assert.equal(m.describeHours(calendar.schedules[0], { language: 'es', closed: 'cerrado' }),
  'Lun, Dom: cerrado | Mar\u2013Vie: 09:30\u201313:30, 16:00\u201319:30 | S\u00e1b: 09:00\u201314:00');
assert.equal(m.describeHours(calendar.schedules[0], { language: 'fr' }), 'Mar.\u2013Ven.\u00a0: 09:30\u201313:30, 16:00\u201319:30 | Sam.\u00a0: 09:00\u201314:00');

// The schedule in force: kept in the settings collection of a records store, or by the object without one.
let clock = Date.parse('2026-05-04T08:00:00Z');
const now = () => new Date(clock);
const store = createStore({ now });
const active = m.createActiveSchedule({ records: store, calendar, now });
assert.deepEqual(await active.get(), { schedule: calendar.schedules[0], updatedAt: null });
assert.deepEqual(await active.set('winter'), { ok: false, code: 'UNKNOWN_SCHEDULE' });
clock += 1000;
assert.deepEqual(await active.set('quiet'), { ok: true, id: 'quiet', updatedAt: new Date('2026-05-04T08:00:01Z') });
assert.equal(m.SETTINGS_COLLECTION, 'settings');
assert.equal(m.ACTIVE_SCHEDULE_ID, 'activeSchedule');
assert.deepEqual(await store.collection('settings').findOne({ _id: 'activeSchedule' }), { _id: 'activeSchedule', value: 'quiet', updatedAt: new Date('2026-05-04T08:00:01Z') });
const shared = await m.createActiveSchedule({ records: store, calendar, now }).get();
assert.equal(shared.schedule.id, 'quiet');
assert.deepEqual(shared.updatedAt, new Date('2026-05-04T08:00:01Z'));
await store.collection('settings').updateOne({ _id: 'activeSchedule' }, { $set: { value: 'retired' } });
assert.equal((await active.get()).schedule.id, 'standard');
const broken = { collection: () => ({ findOne: async () => { throw new Error('down'); }, updateOne: async () => { throw new Error('down'); } }) };
let reported = 0;
assert.equal((await m.createActiveSchedule({ records: broken, calendar, onError: () => reported++ }).get()).schedule.id, 'standard');
assert.equal(reported, 1);
const local = m.createActiveSchedule({ calendar, now });
assert.deepEqual(await local.set('quiet'), { ok: true, id: 'quiet', updatedAt: now() });
assert.equal((await local.get()).schedule.id, 'quiet');
assert.throws(() => m.createActiveSchedule({ calendar: { ...calendar, defaultSchedule: 'none' } }), RangeError);
console.log('opening-hours class: all checks passed');
