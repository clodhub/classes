// Wall-clock dates and times in any IANA time zone, computed with Intl.DateTimeFormat only.
// No imports: appointment-slots carries a byte copy of this file for its tests and class check.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;
const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

// Throws RangeError for a name that is not an IANA time zone.
function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wall(instant: number, timeZone: string): Wall {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function dateText(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

// How far the zone's wall clock is ahead of UTC at an instant, in milliseconds.
function offsetAt(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  const w = wall(whole, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole;
}

function parseDate(date: unknown): [number, number, number] {
  const match = typeof date === "string" ? DATE.exec(date) : null;
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) return [year, month, day];
  }
  throw new RangeError(`not a date in the form YYYY-MM-DD: ${String(date)}`);
}

// "24:00" is the end of the day, as a closing time.
function parseTime(time: unknown): [number, number] {
  const match = typeof time === "string" ? TIME.exec(time) : null;
  if (match) {
    const [hour, minute] = [Number(match[1]), Number(match[2])];
    if ((hour < 24 && minute < 60) || (hour === 24 && minute === 0)) return [hour, minute];
  }
  throw new RangeError(`not a time in the form HH:MM: ${String(time)}`);
}

/** Whether the text is a calendar date in the form YYYY-MM-DD. */
export function isDate(text: unknown): text is string {
  try {
    parseDate(text);
    return true;
  } catch {
    return false;
  }
}

/** Whether the text is a time of day from 00:00 to 23:59. */
export function isTime(text: unknown): text is string {
  try {
    return parseTime(text)[0] < 24;
  } catch {
    return false;
  }
}

/** The day of the week of a calendar date, 0 for Sunday to 6 for Saturday. The same in every time zone. */
export function dayOfWeek(date: string): number {
  const [year, month, day] = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The date a number of days after (or before, when negative) a date. */
export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`days is a whole number: ${String(days)}`);
  const [year, month, day] = parseDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return dateText(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Today's date on the zone's wall clock. */
export function today(timeZone: string, now: () => Date = () => new Date()): string {
  const w = wall(now().getTime(), timeZone);
  return dateText(w.year, w.month, w.day);
}

/** The time (HH:MM) an instant shows on the zone's wall clock. */
export function wallTime(instant: Date, timeZone: string): string {
  const w = wall(instant.getTime(), timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * The instant a wall-clock date and time names in a zone, as RFC 5545 reads local times: a time skipped when the clocks
 * go forward is read with the offset before the change (02:30 becomes 03:30), and a time that happens twice when they
 * go back is its first occurrence.
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = parseDate(date);
  const [hour, minute] = parseTime(time);
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const before = offsetAt(local - DAY, timeZone);
  const after = offsetAt(local + DAY, timeZone);
  const early = local - before;
  if (before === after) return new Date(early);
  const late = local - after;
  const earlyHolds = offsetAt(early, timeZone) === before;
  const lateHolds = offsetAt(late, timeZone) === after;
  if (earlyHolds && lateHolds) return new Date(Math.min(early, late));
  if (lateHolds) return new Date(late);
  return new Date(early);
}

/** The zone's UTC offset ("+02:00", "-03:00", "+05:30") at a wall-clock time of a date, noon by default. */
export function offsetOf(date: string, timeZone: string, time = "12:00"): string {
  const offset = Math.round(offsetAt(zonedInstant(date, time, timeZone).getTime(), timeZone) / MINUTE);
  const size = Math.abs(offset);
  return `${offset < 0 ? "-" : "+"}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}
