import { assert, load } from './runtime.mjs';
// A byte copy of opening-hours' zone functions stands in for the opening-hours module the application passes.
import * as zone from './zone.ts';
// The source's own results for the same inputs, computed by a copy of its code outside the package.
import { intervalCases, overlapBusy, overlapCases, slotCases } from './source-slots.ts';

const web = await load('web/index.ts');
const m = await load('server/index.ts');
const MADRID = 'Europe/Madrid';
const times = (slots) => slots.map((slot) => `${slot.start}-${slot.end}`);

for (const name of ['availableSlots', 'eventInterval', 'overlaps', 'busyWindow', 'settingsFrom', 'installedSettings']) {
  assert.equal(typeof web[name], 'function', name);
  assert.equal(typeof m[name], 'function', name);
}

// Settings.
assert.deepEqual(m.settingsFrom({}), { stepMinutes: 30, bufferMinutes: 10 });
assert.deepEqual(m.settingsFrom({ stepMinutes: '{{stepMinutes}}', bufferMinutes: '{{bufferMinutes}}' }), { stepMinutes: 30, bufferMinutes: 10 });
assert.deepEqual(m.settingsFrom({ stepMinutes: '15', bufferMinutes: '0' }), { stepMinutes: 15, bufferMinutes: 0 });
assert.throws(() => m.settingsFrom({ stepMinutes: '0' }), RangeError);
assert.throws(() => m.settingsFrom({ bufferMinutes: '-1' }), RangeError);
const installed = m.installedSettings();
assert.ok(Number.isInteger(installed.stepMinutes) && Number.isInteger(installed.bufferMinutes));

// The slot algorithm: every case the source computed, with the step and buffer given.
for (const item of slotCases) {
  const slots = m.availableSlots(zone, { date: item.date, windows: item.windows, timeZone: MADRID, durationMinutes: item.durationMinutes,
    bufferMinutes: item.bufferMinutes, stepMinutes: 30, busy: item.busy });
  assert.deepEqual(slots, item.slots, item.name);
  const range = m.busyWindow(zone, item.date, item.windows, MADRID);
  assert.deepEqual(range, item.range === null ? null : { from: new Date(item.range.timeMin), to: new Date(item.range.timeMax) }, item.name);
}
for (const item of intervalCases) {
  const travelMinutes = item.isHomeVisit && (item.bufferMinutes ?? 10) === 30 ? 30 : 0;
  assert.deepEqual(m.eventInterval(zone, { date: item.date, time: item.startTime, timeZone: MADRID, durationMinutes: item.durationMinutes, travelMinutes }),
    { start: new Date(item.start), end: new Date(item.end) }, item.name);
}
for (const item of overlapCases) assert.equal(m.overlaps(new Date(item.start), new Date(item.end), overlapBusy), item.overlaps);

// The step and buffer as arguments, unreadable blocks, other zones, and arguments out of range.
const windows = [{ open: '09:00', close: '11:00' }];
const busy = [{ start: '2026-03-02T09:00:00Z', end: '2026-03-02T09:20:00Z' }];
assert.deepEqual(times(m.availableSlots(zone, { date: '2026-03-02', windows, timeZone: MADRID, durationMinutes: 30, stepMinutes: 15, bufferMinutes: 0, busy })),
  ['09:00-09:30', '09:15-09:45', '09:30-10:00', '10:20-10:50']);
assert.deepEqual(m.availableSlots(zone, { date: '2026-03-02', windows, timeZone: MADRID, durationMinutes: 60, stepMinutes: 30, bufferMinutes: 10, busy: [{ start: 'soon', end: 'later' }] }),
  m.availableSlots(zone, { date: '2026-03-02', windows, timeZone: MADRID, durationMinutes: 60, stepMinutes: 30, bufferMinutes: 10, busy: [] }));
assert.deepEqual(m.availableSlots(zone, { date: '2026-03-02', windows: [], timeZone: MADRID, durationMinutes: 30, busy }), []);
assert.equal(m.busyWindow(zone, '2026-03-02', [], MADRID), null);
assert.deepEqual(times(m.availableSlots(zone, { date: '2026-10-04', windows: [{ open: '01:00', close: '05:00' }], timeZone: 'Australia/Sydney', durationMinutes: 60, stepMinutes: 30, bufferMinutes: 10, busy: [] })),
  ['01:00-03:00', '01:30-03:30', '03:00-04:00', '03:30-04:30', '04:00-05:00']);
assert.deepEqual(m.eventInterval(zone, { date: '2026-04-05', time: '10:00', timeZone: 'Australia/Sydney', durationMinutes: 60, travelMinutes: 15 }),
  { start: new Date('2026-04-04T23:45:00Z'), end: new Date('2026-04-05T01:15:00Z') });
assert.deepEqual(m.eventInterval(zone, { date: '2026-03-02', time: '10:00', timeZone: MADRID, durationMinutes: 60 }),
  { start: new Date('2026-03-02T09:00:00Z'), end: new Date('2026-03-02T10:00:00Z') });
assert.equal(m.overlaps(new Date('2026-03-02T10:00:00Z'), new Date('2026-03-02T11:00:00Z'), [{ start: '2026-03-02T11:00:00Z', end: '2026-03-02T12:00:00Z' }]), false);
assert.equal(m.overlaps(new Date('2026-03-02T10:00:00Z'), new Date('2026-03-02T11:00:01Z'), [{ start: '2026-03-02T11:00:00Z', end: '2026-03-02T12:00:00Z' }]), true);
assert.throws(() => m.availableSlots(zone, { date: '2026-03-02', windows, timeZone: MADRID, durationMinutes: 0, busy }), RangeError);
assert.throws(() => m.availableSlots(zone, { date: '2026-03-02', windows, timeZone: MADRID, durationMinutes: 30, stepMinutes: 0, busy }), RangeError);
assert.throws(() => m.eventInterval(zone, { date: '2026-03-02', time: '10:00', timeZone: MADRID, durationMinutes: 30, travelMinutes: -1 }), RangeError);
console.log('appointment-slots class: all checks passed');
