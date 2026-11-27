import { assert, load } from './runtime.mjs';

// The calendar contract in simulated mode: no store, account or network.
const m = await load('server/index.ts');
const now = () => new Date('2026-05-04T08:00:00.000Z');
const calendar = m.createCalendar({ simulate: true, env: {}, now });
assert.equal(typeof calendar.kind, 'string');
assert.ok(calendar.kind.length > 0);

// Calendar names of this run only, so events kept in the process by anything else do not count.
const run = crypto.randomUUID().slice(0, 8);
const bookings = `bookings-${run}`;
const travel = `travel-${run}`;
const at = (time, day = '05') => new Date(`2026-05-${day}T${time}:00.000Z`);
const block = (start, end) => ({ start: at(start).toISOString(), end: at(end).toISOString() });
const day = { from: at('00:00'), to: at('00:00', '06') };
const event = (fields) => ({ calendar: bookings, start: at('09:00'), end: at('10:00'), summary: 'Relaxing Massage - Sam P.',
  description: 'Client: Sam P.\nPhone: +44 20 7946 0000', timeZone: 'Europe/London', ...fields });

async function quiet(action) {
  const saved = { warn: console.warn, error: console.error };
  const logged = [];
  console.warn = console.error = (...parts) => logged.push(parts.map(String).join(' '));
  try {
    return { value: await action(), logged };
  } finally {
    Object.assign(console, saved);
  }
}

// Nothing asked for, nothing busy.
assert.deepEqual(await calendar.busy({ calendars: [], ...day }), []);
assert.deepEqual(await calendar.busy({ calendars: [bookings], ...day }), []);

// An event is busy on its own calendar and on no other.
const massage = await calendar.createEvent(event({}));
assert.equal(typeof massage.id, 'string');
assert.ok(massage.id.length > 0);
assert.equal(massage.calendar, bookings);
assert.ok(massage.link === null || typeof massage.link === 'string');
assert.deepEqual(await calendar.busy({ calendars: [bookings], ...day }), [block('09:00', '10:00')]);
assert.deepEqual(await calendar.busy({ calendars: [travel], ...day }), []);

// Several calendars: the blocks of each, in time order.
const visit = await calendar.createEvent(event({ calendar: travel, start: at('07:30'), end: at('08:30'), summary: 'Travel' }));
assert.equal(visit.calendar, travel);
assert.notEqual(visit.id, massage.id);
assert.deepEqual(await calendar.busy({ calendars: [bookings, travel], ...day }), [block('07:30', '08:30'), block('09:00', '10:00')]);

// Only within the range: an event that touches the range is not busy in it, and a block is cut to the range.
assert.deepEqual(await calendar.busy({ calendars: [bookings], from: at('10:00'), to: at('18:00') }), []);
assert.deepEqual(await calendar.busy({ calendars: [bookings], from: at('06:00'), to: at('09:00') }), []);
assert.deepEqual(await calendar.busy({ calendars: [bookings], from: at('09:30'), to: at('18:00') }), [block('09:30', '10:00')]);
assert.deepEqual(await calendar.busy({ calendars: [bookings], from: at('09:15'), to: at('09:45') }), [block('09:15', '09:45')]);
assert.deepEqual(await calendar.busy({ calendars: [bookings], from: at('00:00', '06'), to: at('00:00', '07') }), []);

// Every simulated calendar with the same settings in the process shares the events; another collection keeps its own.
const other = m.createCalendar({ simulate: true, env: {}, now });
assert.equal(other.kind, calendar.kind);
assert.deepEqual(await other.busy({ calendars: [bookings], ...day }), [block('09:00', '10:00')]);
const separate = m.createCalendar({ simulate: true, env: {}, now, settings: { collection: `separate_${run}` } });
assert.deepEqual(await separate.busy({ calendars: [bookings], ...day }), []);
assert.throws(() => m.createCalendar({ simulate: true, env: {}, settings: { collection: 'no spaces' } }), RangeError);

// Names that are empty are left out with a warning; with none left nothing is configured. Failures are logged, not thrown.
const mixed = await quiet(() => calendar.busy({ calendars: ['', bookings], ...day }));
assert.deepEqual(mixed.value, [block('09:00', '10:00')]);
assert.ok(mixed.logged.length > 0);
const unnamed = await quiet(() => calendar.busy({ calendars: [''], ...day }));
assert.equal(unnamed.value, null);
assert.ok(unnamed.logged.length > 0);
const nowhere = await quiet(() => calendar.createEvent(event({ calendar: '' })));
assert.equal(nowhere.value, null);
assert.ok(nowhere.logged.length > 0);
const unnamedDelete = await quiet(() => calendar.deleteEvent({ calendar: '', id: massage.id }));
assert.equal(unnamedDelete.value, false);

// Arguments outside their documented shape are programmer errors; nothing is kept from them.
await assert.rejects(calendar.busy({ calendars: [bookings], from: day.to, to: day.from }), RangeError);
await assert.rejects(calendar.busy({ calendars: [bookings], from: day.from, to: day.from }), RangeError);
await assert.rejects(calendar.busy({ calendars: bookings, ...day }), RangeError);
await assert.rejects(calendar.busy({ calendars: [bookings], from: new Date('not a date'), to: day.to }), RangeError);
await assert.rejects(calendar.createEvent(event({ end: at('09:00') })), RangeError);
await assert.rejects(calendar.createEvent(event({ start: '2026-05-05T09:00:00Z' })), RangeError);
await assert.rejects(calendar.createEvent(event({ timeZone: 'Not/A_Zone' })), RangeError);
await assert.rejects(calendar.createEvent(event({ summary: 5 })), RangeError);
await assert.rejects(calendar.deleteEvent(null), RangeError);
assert.deepEqual(await calendar.busy({ calendars: [bookings], ...day }), [block('09:00', '10:00')]);

// Deleting: another calendar's event or an unknown id is false; a deleted event is no longer busy and cannot be deleted again.
assert.equal(await calendar.deleteEvent({ calendar: travel, id: massage.id }), false);
assert.equal(await calendar.deleteEvent({ calendar: bookings, id: 'no-such-event' }), false);
assert.equal(await calendar.deleteEvent({ calendar: bookings, id: massage.id }), true);
assert.deepEqual(await calendar.busy({ calendars: [bookings, travel], ...day }), [block('07:30', '08:30')]);
assert.equal(await calendar.deleteEvent({ calendar: bookings, id: massage.id }), false);
assert.equal(await other.deleteEvent({ calendar: travel, id: visit.id }), true);
assert.deepEqual(await calendar.busy({ calendars: [bookings, travel], ...day }), []);

// The iCalendar feed, on implementations that have one.
if (calendar.ics !== undefined) {
  assert.equal(typeof calendar.ics, 'function');
  const facial = await calendar.createEvent(event({ start: at('15:00'), end: at('16:00'), summary: 'Deep Facial; Jo, K.', description: 'Room 2\nBring nothing' }));
  await calendar.createEvent(event({ start: at('11:00', '06'), end: at('12:00', '06') }));
  const text = await calendar.ics(bookings, day.from, day.to);
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.equal(text.replace(/\r\n/g, '').includes('\n'), false);
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const lines = text.replace(/\r\n[ \t]/g, '').split('\r\n');
  assert.equal(lines.filter((line) => line === 'BEGIN:VEVENT').length, 1);
  for (const expected of ['VERSION:2.0', `UID:${facial.id}`, 'DTSTART:20260505T150000Z', 'DTEND:20260505T160000Z',
    'SUMMARY:Deep Facial\\; Jo\\, K.', 'DESCRIPTION:Room 2\\nBring nothing', 'END:VEVENT']) {
    assert.ok(lines.includes(expected), expected);
  }
  assert.ok(lines.some((line) => line.startsWith('PRODID:')));
  assert.ok(lines.some((line) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(line)));
  const none = await calendar.ics(travel, day.from, day.to);
  assert.equal(none.replace(/\r\n[ \t]/g, '').split('\r\n').includes('BEGIN:VEVENT'), false);
  await assert.rejects(calendar.ics(bookings, day.to, day.from), RangeError);
  assert.equal((await quiet(() => calendar.ics('', day.from, day.to))).value, null);
}

console.log('calendar class: all checks passed');
