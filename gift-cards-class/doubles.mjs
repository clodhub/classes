// Doubles of the interfaces a gift cards component requires, so the class check needs no other component:
// the records store is the class's byte copy of the records engine, the voucher codes a seeded generator of XXXX-XXXX-XXXX
// codes, and the payments client keeps checkouts and sheet payments like a simulated payments component
// (classes/payments-class/payments.json).
import { createStore } from './records.ts';

export const openRecords = (now) => createStore({ now });

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createCodes({ seed = 1, sequence = [] } = {}) {
  let x = seed | 0 || 1;
  const queue = [...sequence];
  const int = (bound) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % bound; };
  const generate = () => queue.shift() ?? Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[int(32)]).join('')).join('-');
  const normalise = (text) => {
    if (typeof text !== 'string') return null;
    const compact = text.toUpperCase().replace(/[\s-]+/g, '');
    if (compact.length !== 12 || [...compact].some((c) => !ALPHABET.includes(c))) return null;
    return compact.match(/.{4}/g).join('-');
  };
  return {
    settings: { groups: 3, groupLength: 4, alphabet: ALPHABET },
    generate,
    generateShort: (length) => Array.from({ length }, () => ALPHABET[int(32)]).join(''),
    normalise,
    isCode: (text) => normalise(text) !== null,
    async withRetry(attempt, isCollision, attempts = 3) {
      for (let tried = 1; ; tried++) {
        try { return await attempt(generate()); } catch (error) { if (tried >= attempts || !isCollision(error)) throw error; }
      }
    },
  };
}

export function createPayments({ currency = 'EUR', fail = null } = {}) {
  const checkouts = new Map();
  const requests = [];
  const sheetRequests = [];
  let next = 0;
  const keep = (id, request) => {
    const amountTotal = request.lineItems.reduce((sum, item) => sum + item.amount * (item.quantity ?? 1), 0);
    checkouts.set(id, { id, paid: false, amountTotal, currency, metadata: { ...request.metadata }, paymentReference: null, customerEmail: request.customerEmail ?? null });
  };
  return {
    mode: 'simulated',
    currency,
    requests,
    sheetRequests,
    async createCheckout(request) {
      requests.push(structuredClone(request));
      if (fail) return { ok: false, code: fail, message: 'payments double refused the checkout' };
      const id = `cs_test_${++next}`;
      keep(id, request);
      return { ok: true, id, url: `/simulated-checkout?id=${id}` };
    },
    // A sheet payment is named by its payment's id, which is also what a refund names.
    async createSheetPayment(request) {
      sheetRequests.push(structuredClone(request));
      if (fail) return { ok: false, code: fail, message: 'payments double refused the sheet payment' };
      const id = `pi_test_${++next}`;
      keep(id, request);
      return { ok: true, id, clientSecret: `${id}_secret`, customer: `cus_test_${next}`, ephemeralKey: `ek_test_${next}` };
    },
    async checkout(id) { return checkouts.has(id) ? structuredClone(checkouts.get(id)) : null; },
    async refund() { return { ok: true, id: null, already: false }; },
    simulated: {
      // Returns the summary itself, not a promise, as a payments client's simulated.complete does.
      complete(id) {
        const found = checkouts.get(id);
        if (!found) return null;
        found.paid = true;
        found.paymentReference = id.startsWith('pi_') ? id : `pi_test_${id.slice('cs_test_'.length)}`;
        return structuredClone(found);
      },
    },
  };
}
