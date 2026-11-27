import { assert, load } from './runtime.mjs';

const m = await load('web/index.ts');
for (const name of ['monthGrid', 'shiftMonth', 'bookingMonths', 'monthDays', 'spokenDate', 'monthTitle', 'dayLabel', 'createBookingCalendarViews']) {
  assert.equal(typeof m[name], 'function', name);
}

// The grid: weekdays 0 (Sunday) to 6, blanks outside the month, four to six weeks.
const march = m.monthGrid('2027-03', 1);
assert.deepEqual(march.weekdays, [1, 2, 3, 4, 5, 6, 0]);
assert.deepEqual(march.weeks[0], ['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06', '2027-03-07']);
assert.deepEqual(march.weeks.at(-1), ['2027-03-29', '2027-03-30', '2027-03-31', null, null, null, null]);
assert.deepEqual(m.monthGrid('2027-03', 0).weeks[0], [null, '2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06']);
assert.equal(m.monthGrid('2026-02', 0).weeks.length, 4);
assert.equal(m.monthGrid('2027-05', 1).weeks.length, 6);
assert.equal(m.monthGrid('2028-02', 1).weeks.flat().filter(Boolean).length, 29);
assert.equal(m.monthGrid('2100-02', 1).weeks.flat().filter(Boolean).length, 28);
assert.throws(() => m.monthGrid('2027-13', 1), RangeError);
assert.throws(() => m.monthGrid('2027-03', 7), RangeError);

// Months: shifts across years, the months a booking may reach.
assert.equal(m.shiftMonth('2027-12', 1), '2028-01');
assert.equal(m.shiftMonth('2027-01', -1), '2026-12');
assert.deepEqual(m.bookingMonths('2026-11-27', 3), ['2026-11', '2026-12', '2027-01']);
assert.throws(() => m.bookingMonths('2027-02-29', 3), RangeError);
assert.throws(() => m.bookingMonths('2027-03-01', 0), RangeError);

// Day states: bookable or booked days may be chosen.
const days = m.monthDays(march, { '2027-03-01': 'bookable', '2027-03-07': 'closed' }, ['2027-03-07'], '2027-03-01').flat().filter(Boolean);
assert.deepEqual(days[0], { date: '2027-03-01', day: 1, status: 'bookable', booked: false, selected: true, selectable: true });
assert.deepEqual(days[6], { date: '2027-03-07', day: 7, status: 'closed', booked: true, selected: false, selectable: true });
assert.deepEqual(days[1], { date: '2027-03-02', day: 2, status: null, booked: false, selected: false, selectable: false });

// The React views through a stand-in createElement: every day a button with its spoken date, chosen days only.
const h = (type, props, ...children) => (typeof type === 'function' ? type({ ...props, children }) : { type, props: props ?? {}, children: children.flat() });
const nodes = (node, found = []) => { if (node && typeof node === 'object' && 'type' in node) { found.push(node); node.children.forEach((child) => nodes(child, found)); } return found; };
const { MonthView, TimesView } = m.createBookingCalendarViews(h);
const style = { colors: { text: '#222', muted: '#999', accent: '#753', onAccent: '#fff', border: '#ccc', surface: '#fff', booked: '#edc' }, corner: 8 };
const labels = { bookable: 'available', closed: 'closed', byAppointment: 'by appointment', tooSoon: 'too soon', tooShort: 'too short', booked: 'booked',
  previousMonth: 'Previous month', nextMonth: 'Next month' };
const picked = [];
const view = MonthView({ grid: march, language: 'en', statuses: { '2027-03-01': 'bookable' }, selected: null, style, labels, onSelect: (date) => picked.push(date) });
const buttons = nodes(view).filter((node) => node.type === 'button');
assert.equal(buttons.length, 31);
assert.ok(buttons[0].props['aria-label'].includes('2027') && buttons[0].props['aria-label'].endsWith(', available'));
assert.equal(buttons[0].props.disabled, false);
assert.equal(buttons[1].props.disabled, true);
buttons[0].props.onClick();
assert.deepEqual(picked, ['2027-03-01']);
const times = nodes(TimesView({ times: ['09:00', '09:30'], selected: '09:30', label: 'Free times', style, onSelect: (time) => picked.push(time) }));
assert.deepEqual(times.filter((node) => node.type === 'button').map((node) => node.props['aria-pressed']), [false, true]);
