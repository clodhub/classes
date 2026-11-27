// Doubles of every interface a reservations component requires, written from their class documents, so the class check
// and the component's tests need no other component. The records store is the records engine (records.ts) and wall-clock
// time is opening-hours' zone functions (zone.ts), both byte copies; everything else is small and kept in memory.
// The shop is the invented Example Studio in Europe/Madrid, paid in EUR.
import { createStore } from "./records.ts";
import * as zone from "./zone.ts";

type Window = { open: string; close: string };
type WeekHours = Record<string, Window[]>;
type Busy = { start?: string | null; end?: string | null };
type Point = { lat: number; lng: number };

export const TIME_ZONE = "Europe/Madrid";
const MINUTE = 60_000;

// Opening hours: the module's functions over WeekHours.
const windowsOf = (hours: WeekHours, day: number): Window[] => [...(hours[String(day)] ?? [])];
export const hours = {
  ...zone,
  windowsOn: (hoursOfWeek: WeekHours, date: string) => windowsOf(hoursOfWeek, zone.dayOfWeek(date)),
  closedDays: (hoursOfWeek: WeekHours) => [0, 1, 2, 3, 4, 5, 6].filter((day) => windowsOf(hoursOfWeek, day).length === 0),
  earliestBookableDate: (timeZone: string, leadDays: number, now?: () => Date) => zone.addDays(zone.today(timeZone, now), leadDays),
  checkBooking(date: unknown, time: unknown, hoursOfWeek: WeekHours, options: { timeZone: string; leadDays: number; now?: () => Date }) {
    if (!zone.isDate(date) || !zone.isTime(time)) return { ok: false, code: "INVALID_FORMAT" } as const;
    const at = (options.now ?? (() => new Date()))();
    if (date < hours.earliestBookableDate(options.timeZone, options.leadDays, () => at) || zone.zonedInstant(date, time, options.timeZone) <= at) {
      return { ok: false, code: "TOO_SOON" } as const;
    }
    const windows = hours.windowsOn(hoursOfWeek, date);
    if (windows.length === 0) return { ok: false, code: "CLOSED_DAY" } as const;
    if (!windows.some((window) => window.open <= time && time < window.close)) return { ok: false, code: "OUTSIDE_HOURS" } as const;
    return { ok: true } as const;
  },
};

// The shop's schedules: open weekdays 10:00-14:00 and 16:00-20:00 and Saturday mornings; a quiet schedule closes Wednesdays.
export const bookingCalendar = {
  timeZone: TIME_ZONE, defaultSchedule: "regular",
  schedules: [
    { id: "regular", hours: { "1": [{ open: "10:00", close: "14:00" }, { open: "16:00", close: "20:00" }], "2": [{ open: "10:00", close: "14:00" }, { open: "16:00", close: "20:00" }],
      "3": [{ open: "10:00", close: "14:00" }, { open: "16:00", close: "20:00" }], "4": [{ open: "10:00", close: "14:00" }, { open: "16:00", close: "20:00" }],
      "5": [{ open: "10:00", close: "14:00" }, { open: "16:00", close: "20:00" }], "6": [{ open: "10:00", close: "14:00" }] } },
    { id: "quiet", hours: { "1": [{ open: "11:00", close: "18:00" }], "2": [{ open: "11:00", close: "18:00" }], "4": [{ open: "11:00", close: "18:00" }],
      "5": [{ open: "11:00", close: "18:00" }] }, byAppointmentDays: [3] },
  ],
};

// Appointment slots: the slot rules of its class document.
const instants = (busy: Busy[]) => busy
  .map((block) => ({ start: block.start ? new Date(block.start).getTime() : Number.NaN, end: block.end ? new Date(block.end).getTime() : Number.NaN }))
  .filter((block) => Number.isFinite(block.start) && Number.isFinite(block.end))
  .sort((a, b) => a.start - b.start);
export const slots = {
  availableSlots(module: typeof hours, request: { date: string; windows: Window[]; timeZone: string; durationMinutes: number; bufferMinutes?: number; stepMinutes?: number; busy: Busy[] }) {
    const duration = request.durationMinutes * MINUTE;
    const buffer = (request.bufferMinutes ?? 10) * MINUTE;
    const step = (request.stepMinutes ?? 30) * MINUTE;
    const blocks = instants(request.busy);
    const out: Array<{ start: string; end: string }> = [];
    const offer = (start: number) => out.push({ start: module.wallTime(new Date(start), request.timeZone), end: module.wallTime(new Date(start + duration), request.timeZone) });
    for (const window of request.windows) {
      let cursor = module.zonedInstant(request.date, window.open, request.timeZone).getTime();
      const close = module.zonedInstant(request.date, window.close, request.timeZone).getTime();
      for (const block of blocks) {
        if (block.end + buffer <= cursor) continue;
        if (block.start >= close) break;
        for (; cursor + duration + buffer <= block.start; cursor += step) if (cursor + duration <= close) offer(cursor);
        if (block.end + buffer > cursor) cursor = block.end + buffer;
      }
      for (; cursor + duration <= close; cursor += step) offer(cursor);
    }
    return out;
  },
  eventInterval(module: typeof hours, request: { date: string; time: string; timeZone: string; durationMinutes: number; travelMinutes?: number }) {
    const start = module.zonedInstant(request.date, request.time, request.timeZone).getTime();
    const travel = (request.travelMinutes ?? 0) * MINUTE;
    return { start: new Date(start - travel), end: new Date(start + request.durationMinutes * MINUTE + travel) };
  },
  overlaps: (start: Date, end: Date, busy: Busy[]) => instants(busy).some((block) => block.start < end.getTime() && block.end > start.getTime()),
  busyWindow(module: typeof hours, date: string, windows: Window[], timeZone: string) {
    if (windows.length === 0) return null;
    return { from: module.zonedInstant(date, windows[0].open, timeZone), to: module.zonedInstant(date, windows[windows.length - 1].close, timeZone) };
  },
};

// Booking policy: the policy functions and settings of its class document.
export function createPolicy(settings: Partial<Record<string, number>> = {}) {
  const terms = (input: { startsAt: Date; now: Date; by: string; freeCancellationHours: number }) =>
    input.by === "owner" || input.startsAt.getTime() - input.now.getTime() > input.freeCancellationHours * 3_600_000;
  return {
    settings: { depositPercent: 50, freeCancellationHours: 24, holdMinutes: 40, checkoutMinutes: 35, minimumMinutes: 15, maximumMinutes: 360, ...settings },
    depositAndBalance(total: number, cardValue: number, depositPercent: number) {
      const deposit = Math.max(0, Math.round((total * depositPercent) / 100) - cardValue);
      return { deposit, balance: Math.max(0, total - Math.min(cardValue, total) - deposit) };
    },
    freeCancellationDeadline: (startsAt: Date, hoursBefore: number) => new Date(startsAt.getTime() - hoursBefore * 3_600_000),
    freeCancellation: terms,
    refundEligible: (input: { startsAt: Date; now: Date; by: string; freeCancellationHours: number; hasDeposit: boolean }) => input.hasDeposit && terms(input),
    cardConsumedByCancellation: (input: { startsAt: Date; now: Date; by: string; freeCancellationHours: number; hasCard: boolean }) => input.hasCard && !terms(input),
    holdActive: (createdAt: Date, now: Date, holdMinutes: number) => now.getTime() - createdAt.getTime() < holdMinutes * MINUTE,
    checkoutExpiry(now: Date, checkoutMinutes: number) {
      if (!Number.isInteger(checkoutMinutes) || checkoutMinutes < 31 || checkoutMinutes > 1440) throw new RangeError("checkoutMinutes is from 31 to 1440");
      return new Date(Math.floor(now.getTime() / 1000) * 1000 + checkoutMinutes * MINUTE);
    },
    checkDuration: (minutes: unknown, limits: { minimumMinutes: number; maximumMinutes: number }) =>
      Number.isInteger(minutes) && (minutes as number) >= limits.minimumMinutes && (minutes as number) <= limits.maximumMinutes
        ? { ok: true } as const : { ok: false, code: "INVALID_DURATION" } as const,
  };
}

// Shop catalogue: a CatalogueQuery over the studio's catalogue in English and Spanish.
const ITEMS = [
  { slug: "relaxing-massage", categorySlug: "massage", title: { en: "Relaxing Massage", es: "Masaje relajante" }, options: [[45, 6000], [60, 7000]] },
  { slug: "aromatherapy-massage", categorySlug: "massage", title: { en: "Aromatherapy Massage", es: "Masaje de aromaterapia" }, options: [[90, 9500]] },
  { slug: "deep-facial", categorySlug: "facials", title: { en: "Deep Facial", es: "Limpieza facial profunda" }, options: [[60, 9500]] },
] as const;
export const catalogue = {
  languages: () => ["en", "es"],
  item(slug: string, language: string) {
    const found = ITEMS.find((item) => item.slug === slug);
    if (!found) return null;
    const title = language in found.title ? found.title[language as "en" | "es"] : found.title.en;
    return { slug: found.slug, categorySlug: found.categorySlug, title, options: found.options.map(([minutes, price]) => ({ label: `${minutes} min`, minutes, price, priceText: "" })) };
  },
  option(slug: string, minutes: number, language: string) {
    return catalogue.item(slug, language)?.options.find((option) => option.minutes === minutes) ?? null;
  },
};

// Basket: the request lines and their length with the gap between items.
export const basket = {
  gapMinutes: 5,
  maximumLines: 20,
  parseRequestedLines(raw: unknown, options: { maximumLines?: number } = {}) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > (options.maximumLines ?? 20)) return { ok: false, code: "INVALID_LINES" } as const;
    const slug = (value: unknown) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
    const lines = [];
    for (const line of raw) {
      if (typeof line !== "object" || line === null) return { ok: false, code: "INVALID_LINES" } as const;
      const { itemSlug, minutes, categorySlug } = line as Record<string, unknown>;
      if (!slug(itemSlug) || !Number.isInteger(minutes) || (minutes as number) < 1) return { ok: false, code: "INVALID_LINES" } as const;
      lines.push({ itemSlug: itemSlug as string, minutes: minutes as number, categorySlug: slug(categorySlug) ? (categorySlug as string) : "" });
    }
    return { ok: true, lines } as const;
  },
  totalMinutes: (lines: ReadonlyArray<{ minutes: number }>, gapMinutes: number) =>
    lines.length === 0 ? 0 : lines.reduce((sum, line) => sum + line.minutes, 0) + gapMinutes * (lines.length - 1),
};

// Money: formatting in the shop's currency.
export const money = {
  currency: "EUR",
  formatMoney: (amount: number, currency: string, language: string) =>
    new Intl.NumberFormat(language, { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: amount % 100 === 0 ? 0 : 2 }).format(amount / 100),
};

// Payments: a simulated client, as its class document describes simulated mode; a sheet payment does not expire and is
// refunded by its own id.
export function createPayments(options: { now: () => Date; currency?: string }) {
  const checkouts = new Map<string, { request: Record<string, any>; summary: Record<string, any>; expiresAt: Date | null }>();
  const refunds = new Map<string, { id: string; paymentReference: string; amount: number }>();
  const refunded = new Map<string, number>();
  const fail: string[] = [];
  let made = 0;
  const failure = (message: string) => ({ ok: false, code: "PROVIDER_ERROR", message }) as const;
  return {
    mode: "simulated", currency: options.currency ?? "EUR", signatureHeader: "stripe-signature",
    // Names of operations that fail once, in order: "createCheckout", "createSheetPayment", "refund".
    fail,
    requests: [] as Array<Record<string, any>>,
    sheetRequests: [] as Array<Record<string, any>>,
    refunds: [] as Array<Record<string, any>>,
    async createCheckout(request: Record<string, any>) {
      this.requests.push(request);
      if (fail[0] === "createCheckout") return failure(`simulated failure ${String(fail.shift())}`);
      const ahead = request.expiresAt instanceof Date ? request.expiresAt.getTime() - options.now().getTime() : 24 * 60 * MINUTE;
      const items = Array.isArray(request.lineItems) ? request.lineItems : [];
      if (items.length === 0 || !items.every((item: any) => typeof item?.name === "string" && item.name && Number.isInteger(item.amount) && item.amount >= 1)
        || typeof request.metadata !== "object" || !/^https?:\/\//.test(String(request.successUrl)) || !/^https?:\/\//.test(String(request.cancelUrl))
        || ahead < 30 * MINUTE || ahead > 24 * 60 * MINUTE) {
        return { ok: false, code: "INVALID_REQUEST", message: "the request is outside CheckoutRequest" } as const;
      }
      const id = `cs_test_${++made}`;
      const amountTotal = items.reduce((sum: number, item: any) => sum + item.amount * (item.quantity ?? 1), 0);
      checkouts.set(id, { request, expiresAt: new Date(options.now().getTime() + ahead), summary: {
        id, paid: false, amountTotal, currency: this.currency, metadata: { ...request.metadata }, paymentReference: null, customerEmail: request.customerEmail || null } });
      return { ok: true, id, url: `https://payments.example.com/pay/${id}` } as const;
    },
    async createSheetPayment(request: Record<string, any>) {
      this.sheetRequests.push(request);
      if (fail[0] === "createSheetPayment") return failure(`simulated failure ${String(fail.shift())}`);
      const items = Array.isArray(request.lineItems) ? request.lineItems : [];
      if (items.length === 0 || !items.every((item: any) => typeof item?.name === "string" && item.name && Number.isInteger(item.amount) && item.amount >= 1)
        || typeof request.metadata !== "object" || typeof request.ephemeralKeyVersion !== "string" || !request.ephemeralKeyVersion) {
        return { ok: false, code: "INVALID_REQUEST", message: "the request is outside SheetRequest" } as const;
      }
      const id = `pi_test_${++made}`;
      const amountTotal = items.reduce((sum: number, item: any) => sum + item.amount * (item.quantity ?? 1), 0);
      checkouts.set(id, { request, expiresAt: null, summary: {
        id, paid: false, amountTotal, currency: this.currency, metadata: { ...request.metadata }, paymentReference: null, customerEmail: request.customerEmail || null } });
      return { ok: true, id, clientSecret: `${id}_secret`, customer: `cus_test_${made}`, ephemeralKey: `ek_test_${made}` } as const;
    },
    async checkout(id: string) {
      const found = checkouts.get(id);
      return found ? structuredClone(found.summary) : null;
    },
    simulated: {
      complete(id: string) {
        const found = checkouts.get(id);
        if (!found) return null;
        if (!found.summary.paid && (found.expiresAt === null || options.now() <= found.expiresAt)) {
          Object.assign(found.summary, { paid: true, paymentReference: id.startsWith("pi_") ? id : `pi_test_${id.slice(8)}` });
        }
        return structuredClone(found.summary);
      },
    },
    async refund(request: { paymentReference: string; idempotencyKey: string; amount?: number }) {
      this.refunds.push(request);
      if (fail[0] === "refund") return failure(`simulated failure ${String(fail.shift())}`);
      const paid = [...checkouts.values()].find((item) => item.summary.paid && item.summary.paymentReference === request.paymentReference);
      if (!paid || !request.idempotencyKey) return failure("no such payment");
      const before = refunds.get(request.idempotencyKey);
      if (before) return before.paymentReference === request.paymentReference ? { ok: true, id: before.id, already: true } as const : failure("the key was used for another refund");
      const left = paid.summary.amountTotal - (refunded.get(request.paymentReference) ?? 0);
      if (left === 0) return { ok: true, id: null, already: true } as const;
      const amount = request.amount ?? left;
      if (!Number.isInteger(amount) || amount < 1 || amount > left) return failure("the amount is more than is left");
      const id = `re_test_${refunds.size + 1}`;
      refunds.set(request.idempotencyKey, { id, paymentReference: request.paymentReference, amount });
      refunded.set(request.paymentReference, (refunded.get(request.paymentReference) ?? 0) + amount);
      return { ok: true, id, already: false } as const;
    },
    refundedOf: (paymentReference: string) => refunded.get(paymentReference) ?? 0,
  };
}

// Calendar: events in memory, busy blocks cut to the range, and an outage switch.
export function createCalendar() {
  const events = new Map<string, { calendar: string; start: Date; end: Date; summary: string; description: string; timeZone: string }>();
  let made = 0;
  return {
    unavailable: false,
    events,
    busyQueries: [] as Array<{ calendars: string[]; from: Date; to: Date }>,
    // A time someone booked in the calendar directly.
    block(calendar: string, start: Date, end: Date) {
      events.set(`outside-${++made}`, { calendar, start, end, summary: "Busy", description: "", timeZone: TIME_ZONE });
    },
    async busy(query: { calendars: string[]; from: Date; to: Date }) {
      this.busyQueries.push(query);
      if (this.unavailable) return null;
      return [...events.values()]
        .filter((event) => query.calendars.includes(event.calendar) && event.start < query.to && event.end > query.from)
        .map((event) => [Math.max(event.start.getTime(), query.from.getTime()), Math.min(event.end.getTime(), query.to.getTime())])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        .map(([start, end]) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() }));
    },
    async createEvent(event: { calendar: string; start: Date; end: Date; summary: string; description: string; timeZone: string }) {
      if (this.unavailable || !event.calendar) return null;
      const id = `event-${++made}`;
      events.set(id, { ...event });
      return { id, link: null, calendar: event.calendar };
    },
    async deleteEvent(reference: { calendar: string; id: string }) {
      if (this.unavailable) return false;
      return events.get(reference.id)?.calendar === reference.calendar && events.delete(reference.id);
    },
  };
}

const normal = (code: unknown) => (typeof code === "string" ? code.trim().toUpperCase() : "");

// Gift cards: the service's usable, cardValue and consume over cards in memory; an amount card is worth its balance.
export function createGiftCards(options: { now: () => Date; currency?: string }) {
  const cards = new Map<string, Record<string, any>>();
  return {
    currency: options.currency ?? "EUR",
    cards,
    add(card: Record<string, any>) {
      const stored: Record<string, any> = { kind: "amount", amount: 0, itemName: "", itemSlug: null, minutes: null, status: "issued", sessionsTotal: 1, sessionsUsed: 0, ...card };
      stored.balance ??= stored.kind === "amount" ? stored.amount : null;
      cards.set(stored.code, stored);
      return stored;
    },
    async usable(code: string) {
      const card = cards.get(normal(code));
      if (!card) return { ok: false, reason: "not_found" } as const;
      if (options.now().getTime() > card.expiresAt.getTime()) return { ok: false, reason: "expired" } as const;
      const sessionsLeft = card.sessionsTotal - card.sessionsUsed;
      if (card.status === "redeemed" || sessionsLeft < 1) return { ok: false, reason: "redeemed" } as const;
      return { ok: true, card: structuredClone(card), sessionsLeft } as const;
    },
    cardValue(card: Record<string, any>, lines: Array<{ itemSlug: string; itemName: string; price: number }>) {
      if (card.kind === "amount") return card.balance ?? 0;
      const match = lines.find((line) => (card.itemSlug ? card.itemSlug === line.itemSlug : card.itemName.trim().toLowerCase() === line.itemName.trim().toLowerCase()));
      return match ? match.price : 0;
    },
    async consume(code: string) {
      const card = cards.get(normal(code));
      if (!card || card.sessionsUsed >= card.sessionsTotal) return false;
      card.sessionsUsed += 1;
      if (card.kind === "amount") card.balance = 0;
      if (card.sessionsUsed >= card.sessionsTotal) Object.assign(card, { status: "redeemed", redeemedAt: options.now() });
      return true;
    },
  };
}

// Member pricing: activeRule and resolveItemPrice over vouchers in memory.
export function createMemberPricing(options: { now: () => Date }) {
  const vouchers = new Map<string, Record<string, any>>();
  const eligible = (rule: Record<string, any>, slug: string, categorySlug: string) =>
    rule.mode !== "discount" ? slug in (rule.itemPricing ?? {}) : rule.allItems || rule.itemSlugs.includes(slug) || rule.categorySlugs.includes(categorySlug);
  const percentFor = (rule: Record<string, any>, slug: string, categorySlug: string) => {
    if (rule.mode === "mixed") return rule.itemPricing?.[slug]?.type === "discount" ? rule.itemPricing[slug].discountPercent ?? null : null;
    return rule.mode === "discount" && rule.discountPercent > 0 && eligible(rule, slug, categorySlug) ? rule.discountPercent : null;
  };
  return {
    vouchers,
    add(voucher: Record<string, any>) {
      vouchers.set(voucher.code, { status: "active", name: "Member", ...voucher });
    },
    async activeRule(code: string) {
      const voucher = vouchers.get(normal(code));
      if (!voucher || voucher.status !== "active" || voucher.expiresAt.getTime() < options.now().getTime()) return null;
      return { rule: structuredClone(voucher.rule), voucher: structuredClone(voucher) };
    },
    resolveItemPrice(rule: Record<string, any> | null, slug: string, categorySlug: string, priceOptions: ReadonlyArray<{ minutes: number | null; price: number }>, minutes: number) {
      const fixed = rule !== null && (rule.mode === "custom" || (rule.mode === "mixed" && rule.itemPricing?.[slug]?.type === "fixed"));
      if (fixed) {
        const entry = rule.itemPricing?.[slug];
        return entry && entry.minutes === minutes ? { price: entry.price, minutes } : null;
      }
      const option = priceOptions.find((item) => item.minutes === minutes);
      if (!option) return null;
      const percent = rule === null ? null : percentFor(rule, slug, categorySlug);
      return { price: percent ? Math.round((option.price * (100 - percent)) / 100) : option.price, minutes };
    },
  };
}

// Home visits: eligibility, the quote from the studio and the address of a request.
const radians = (degrees: number) => (degrees * Math.PI) / 180;
export function createHomeVisits(settings: Partial<Record<string, number>> = {}) {
  return {
    base: { lat: 40.4168, lng: -3.7038 } as Point,
    eligibleSlugs: ["relaxing-massage", "aromatherapy-massage"],
    settings: { radiusKm: 25, calloutFee: 5000, travelMinutes: 30, minimumMinutes: 60, gapMinutes: 5, ...settings },
    eligibility(lines: Array<{ itemSlug: string; minutes: number }>, eligibleSlugs: readonly string[], options: { minimumMinutes: number; gapMinutes: number }) {
      if (lines.length === 0 || !lines.every((line) => eligibleSlugs.includes(line.itemSlug))) return { status: "ineligible" } as const;
      const totalMinutes = lines.reduce((sum, line) => sum + line.minutes, 0) + options.gapMinutes * (lines.length - 1);
      return totalMinutes < options.minimumMinutes ? { status: "duration_shortfall", totalMinutes } as const : { status: "eligible" } as const;
    },
    quote(base: Point, point: Point, options: { radiusKm: number; calloutFee: number; travelMinutes: number }) {
      const h = Math.sin(radians(point.lat - base.lat) / 2) ** 2 + Math.cos(radians(base.lat)) * Math.cos(radians(point.lat)) * Math.sin(radians(point.lng - base.lng) / 2) ** 2;
      const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
      return distanceKm > options.radiusKm ? { ok: false, code: "OUTSIDE_AREA", distanceKm } as const
        : { ok: true, distanceKm, calloutFee: options.calloutFee, travelMinutes: options.travelMinutes } as const;
    },
    parseAddress(raw: unknown) {
      if (typeof raw !== "object" || raw === null) return null;
      const value = raw as Record<string, unknown>;
      const text = (item: unknown) => (typeof item === "string" ? item.trim() : "");
      const address = { street: text(value.street), city: text(value.city), postalCode: text(value.postalCode), notes: text(value.notes) };
      if (!address.street || !address.city || !address.postalCode) return null;
      if (typeof value.lat !== "number" || typeof value.lng !== "number" || Math.abs(value.lat) > 90 || Math.abs(value.lng) > 180) return null;
      return { ...address, lat: value.lat, lng: value.lng };
    },
  };
}

// Every collaborator wired as the application wires them, with a clock the caller moves and the notices it is sent.
export function createDoubles(options: { now?: string; policy?: Partial<Record<string, number>>; homeVisits?: boolean; giftCards?: boolean; memberPricing?: boolean } = {}) {
  let clock = Date.parse(options.now ?? "2026-05-04T08:00:00.000Z");
  const now = () => new Date(clock);
  const store = createStore({ now });
  const payments = createPayments({ now });
  const calendar = createCalendar();
  const policy = createPolicy(options.policy);
  const giftCards = createGiftCards({ now });
  const memberPricing = createMemberPricing({ now });
  const homeVisits = createHomeVisits();
  const notices: Array<Record<string, any>> = [];
  let schedule = { schedule: bookingCalendar.schedules[0], updatedAt: null as Date | null };
  let notifyFails = false;
  const deps = {
    records: store, payments, calendar, calendars: { bookings: "bookings", travel: "travel", busy: ["bookings", "travel"] },
    hours, slots, policy, catalogue, basket, money, bookingCalendar, activeSchedule: async () => schedule, leadDays: 1, bufferMinutes: 10, stepMinutes: 30,
    ...(options.giftCards === false ? {} : { giftCards }), ...(options.memberPricing === false ? {} : { memberPricing }),
    ...(options.homeVisits === false ? {} : { homeVisits }),
    notify: async (event: Record<string, any>) => {
      notices.push(event);
      if (notifyFails) throw new Error("the mail service is down");
    },
    siteAddress: "https://studio.example.com", pathPrefix: (language: string) => (language === "es" ? "" : `/${language}`), now,
  };
  return {
    deps, store, payments, calendar, policy, giftCards, memberPricing, homeVisits, notices, now,
    advance: (minutes: number) => { clock += minutes * MINUTE; },
    setTime: (instant: string) => { clock = Date.parse(instant); },
    useSchedule: (id: string) => { schedule = { schedule: bookingCalendar.schedules.find((item) => item.id === id)!, updatedAt: now() }; },
    failNotify: (fails: boolean) => { notifyFails = fails; },
  };
}

// A booking request of the booking form, for 2026-05-06 (a Wednesday) at 10:00 in Madrid unless fields say otherwise.
export function request(fields: Record<string, unknown> = {}) {
  return {
    date: "2026-05-06", time: "10:00", name: "Sam P.", phone: "+34 600 000 000", email: "sam@example.com", message: "", honeypot: "",
    items: [{ itemSlug: "relaxing-massage", minutes: 60 }], language: "en", ...fields,
  };
}

// The payment choices: the provider's checkout page, and an app's payment sheet.
export const URLS = {
  kind: "checkout" as const, successUrl: "https://studio.example.com/en/reserve/success?checkout={CHECKOUT_ID}", cancelUrl: "https://studio.example.com/en/reserve/cancelled",
};
export const SHEET = { kind: "sheet" as const, ephemeralKeyVersion: "2020-08-27" };
