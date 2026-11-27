import { assert, load } from './runtime.mjs';

const m = await load('web/index.ts');
for (const name of ['entryLocation', 'icsText', 'icsDataUrl']) assert.equal(typeof m[name], 'function', name);

// A booking's calendar file, with the application's own product id.
const booking = {
  uid: '6a1f00000000000000000003@www.example.com', title: 'Relaxing Massage - Example Studio', start: new Date('2027-03-01T08:00:00.000Z'),
  end: new Date('2027-03-01T09:00:00.000Z'), place: 'Example Studio', address: 'Calle Ejemplo 1, 28001 Madrid', notes: 'Relaxing Massage (60 min)',
  status: 'confirmed', sequence: 0,
};
assert.equal(m.entryLocation(booking), 'Example Studio, Calle Ejemplo 1, 28001 Madrid');
assert.equal(m.entryLocation({ place: ' ', address: 'Calle Ejemplo 1' }), 'Calle Ejemplo 1');
assert.equal(m.icsText(booking, { stamp: new Date('2026-11-26T10:00:00.000Z'), productId: '-//Example Studio//Bookings//EN' }),
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example Studio//Bookings//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\n' +
  'UID:6a1f00000000000000000003@www.example.com\r\nDTSTAMP:20261126T100000Z\r\nDTSTART:20270301T080000Z\r\nDTEND:20270301T090000Z\r\n' +
  'SUMMARY:Relaxing Massage - Example Studio\r\nLOCATION:Example Studio\\, Calle Ejemplo 1\\, 28001 Madrid\r\nDESCRIPTION:Relaxing Massage (60 min)\r\n' +
  'STATUS:CONFIRMED\r\nSEQUENCE:0\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');

// Defaults, escaping, dropped lines and folding at 75 octets without splitting a character.
const stamp = new Date('2027-01-01T00:00:00.900Z');
const plain = m.icsText({ uid: 'x@example.com', title: 'A; B, C \\ D', start: booking.start, end: booking.end, place: '', address: '', notes: 'one\r\ntwo\u0007' }, { stamp });
assert.match(plain, /^BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-\/\/clodhub\/\/device-calendar\/\/EN\r\n/);
assert.match(plain, /\r\nDTSTAMP:20270101T000000Z\r\n/);
assert.match(plain, /\r\nSUMMARY:A\\; B\\, C \\\\ D\r\nDESCRIPTION:one\\ntwo\r\nSTATUS:CONFIRMED\r\nSEQUENCE:0\r\n/);
assert.ok(!plain.includes('LOCATION:'));
const long = m.icsText({ ...booking, title: 'é'.repeat(60), status: 'cancelled', sequence: 2, url: 'https://www.example.com/en' }, { stamp });
const lines = long.split('\r\n');
assert.ok(lines.every((line) => new TextEncoder().encode(line).length <= 75));
assert.equal(lines.find((line) => line.startsWith('SUMMARY:')), 'SUMMARY:' + 'é'.repeat(33));
assert.equal(lines[lines.findIndex((line) => line.startsWith('SUMMARY:')) + 1], ' ' + 'é'.repeat(27));
assert.ok(lines.includes('URL:https://www.example.com/en') && lines.includes('STATUS:CANCELLED') && lines.includes('SEQUENCE:2'));
assert.throws(() => m.icsText({ ...booking, end: new Date('2027-03-01T07:00:00.000Z') }, { stamp }), RangeError);
assert.equal(decodeURIComponent(m.icsDataUrl(plain).replace('data:text/calendar;charset=utf-8,', '')), plain);
