import { assert, load } from './runtime.mjs';
import { createDriver } from './driver.mjs';

const m = await load('server/index.ts');
let clock = Date.parse('2026-03-02T10:00:00.000Z');
const now = () => new Date(clock);
let opened = 0;
const open = () => m.openRecords({ env: {}, driver: createDriver({ now }), directory: null, now, settings: { database: `class-check-${++opened}` } });
const code = async (promise, expected) => {
  await assert.rejects(promise, (error) => { assert.equal(error.code, expected, String(error)); return true; });
};
// listIndexes gives the indexes in no fixed order.
const byKey = (indexes) => [...indexes].sort((a, b) => (JSON.stringify(a.key) < JSON.stringify(b.key) ? -1 : 1));

// Ids, names and the error shape.
assert.match(m.newId(now), /^[0-9a-f]{24}$/);
assert.equal(m.newId(now).slice(0, 8), Math.floor(clock / 1000).toString(16).padStart(8, '0'));
assert.notEqual(m.newId(now), m.newId(now));
assert.equal(m.validName('giftCards'), true);
assert.equal(m.validName('1bad'), false);
assert.equal(m.validName('a.b'), false);
assert.equal(m.isDuplicateKey(new m.RecordsError('duplicate-key', 'x')), true);
assert.equal(m.isDuplicateKey(new m.RecordsError('invalid-filter', 'x')), false);
assert.equal(m.isDuplicateKey(new Error('x')), false);

const records = await open();
assert.equal(typeof records.kind, 'string');
assert.ok(records.kind.length > 0);
assert.throws(() => records.collection('no spaces'), (error) => error.code === 'invalid-name');

// Copies in and out; dates survive; undefined fields are not stored; ids are generated or kept.
const items = records.collection('items');
const when = new Date('2026-03-01T09:30:00.000Z');
const input = { name: 'Massage', tags: ['body'], nested: { minutes: 60 }, at: when, gone: undefined };
const { insertedId } = await items.insertOne(input);
assert.match(insertedId, /^[0-9a-f]{24}$/);
assert.equal(input._id, undefined);
input.nested.minutes = 1;
const stored = await items.findOne({ _id: insertedId });
assert.deepEqual(stored, { _id: insertedId, name: 'Massage', tags: ['body'], nested: { minutes: 60 }, at: when });
assert.ok(stored.at instanceof Date);
assert.equal(Object.hasOwn(stored, 'gone'), false);
stored.nested.minutes = 2;
assert.equal((await items.findOne({ _id: insertedId })).nested.minutes, 60);
await items.insertOne({ _id: 'facial', name: 'Facial', tags: ['face', 'skin'], nested: { minutes: 45 }, price: 8000, at: new Date('2026-03-05T12:00:00Z') });
await code(items.insertOne({ _id: 'facial', name: 'Again' }), 'duplicate-key');
await code(items.insertOne({ _id: 'x', $bad: 1 }), 'invalid-document');
await code(items.insertOne(JSON.parse('{"_id":"x","__proto__":{"admin":true}}')), 'invalid-document');
await code(items.insertOne({ _id: 'x', 'nul\u0000name': 1 }), 'invalid-document');
await items.insertOne({ _id: 'wrap', name: 'Wrap', tags: [], price: 5000, status: null, lines: [{ slug: 'a', minutes: 30 }, { slug: 'b', minutes: 15 }] });

// Filters. Without a sort the order of the matches is not fixed, so unsorted results are compared sorted.
const ids = async (filter, options) => {
  const found = (await items.find(filter, options)).map((doc) => doc._id);
  return options?.sort ? found : found.sort();
};
assert.deepEqual(await ids({ name: 'Facial' }), ['facial']);
assert.deepEqual(await ids({ tags: 'skin' }), ['facial']);
assert.deepEqual(await ids({ 'nested.minutes': { $gte: 50 } }), [insertedId]);
assert.deepEqual(await ids({ 'lines.slug': 'b' }), ['wrap']);
assert.deepEqual(await ids({ price: { $ne: 8000 } }), [insertedId, 'wrap']);
assert.deepEqual(await ids({ status: null }), [insertedId, 'facial', 'wrap']);
assert.deepEqual(await ids({ status: { $ne: null } }), []);
assert.deepEqual(await ids({ price: { $exists: true } }), ['facial', 'wrap']);
assert.deepEqual(await ids({ price: { $exists: false } }), [insertedId]);
assert.deepEqual(await ids({ _id: { $in: ['wrap', 'facial', 'none'] } }), ['facial', 'wrap']);
assert.deepEqual(await ids({ _id: { $nin: ['wrap'] } }), [insertedId, 'facial']);
assert.deepEqual(await ids({ price: { $gt: 5000, $lte: 8000 } }), ['facial']);
assert.deepEqual(await ids({ at: { $lt: new Date('2026-03-02T00:00:00Z') } }), [insertedId]);
assert.deepEqual(await ids({ name: { $gte: 'M' } }), [insertedId, 'wrap']);
assert.deepEqual(await ids({ $or: [{ name: 'Wrap' }, { price: 8000 }] }), ['facial', 'wrap']);
assert.deepEqual(await ids({ $and: [{ tags: 'face' }, { price: { $gt: 1 } }] }), ['facial']);
// Equality with an object needs the same fields in the same order; comparisons with other values match nothing.
assert.deepEqual(await ids({ nested: { minutes: 60 } }), [insertedId]);
assert.deepEqual(await ids({ lines: { slug: 'a', minutes: 30 } }), ['wrap']);
assert.deepEqual(await ids({ lines: { minutes: 30, slug: 'a' } }), []);
assert.deepEqual(await ids({ lines: { $in: [{ slug: 'b', minutes: 15 }] } }), ['wrap']);
assert.deepEqual(await ids({ status: { $gte: null } }), []);
assert.deepEqual(await ids({ nested: { $gt: {} } }), []);
await code(items.find({ price: { $regex: 'x' } }), 'invalid-filter');
await code(items.find({ price: undefined }), 'invalid-filter');
await code(items.find({ name: /Fac/ }), 'invalid-filter');
await code(items.find({ name: { $in: [/Fac/] } }), 'invalid-filter');
await code(items.find({ '__proto__.admin': true }), 'invalid-filter');
// The whole filter is checked before any document is read: on an empty collection, and past a part that decides.
const none = records.collection('none');
await code(none.find({ price: { $regex: 'x' } }), 'invalid-filter');
await code(none.countDocuments({ $or: [{ a: 1 }, { b: { $where: 'x' } }] }), 'invalid-filter');
await code(none.find({}, { projection: { a: 2 } }), 'invalid-filter');
await code(items.find({ name: 'Facial', $or: [{ price: 8000 }, { price: { $regex: 'x' } }] }), 'invalid-filter');
await code(items.find({ name: 'none', price: { $regex: 'x' } }), 'invalid-filter');
assert.equal(await items.countDocuments({}), 3);
assert.equal(await items.countDocuments({ price: { $gt: 0 } }), 2);

// Sort, skip, limit and projection.
assert.deepEqual(await ids({}, { sort: { price: -1 } }), ['facial', 'wrap', insertedId]);
assert.deepEqual(await ids({}, { sort: { price: 1 } }), [insertedId, 'wrap', 'facial']);
assert.deepEqual(await ids({}, { sort: { price: -1 }, skip: 1, limit: 1 }), ['wrap']);
assert.deepEqual(await items.findOne({ _id: 'facial' }, { projection: { name: 1 } }), { _id: 'facial', name: 'Facial' });
assert.deepEqual(await items.findOne({ _id: 'facial' }, { projection: { name: 1, _id: 0 } }), { name: 'Facial' });
assert.deepEqual(await items.findOne({ _id: 'facial' }, { projection: { _id: 1 } }), { _id: 'facial' });
assert.deepEqual(Object.keys(await items.findOne({ _id: 'wrap' }, { projection: { lines: 0, tags: 0 } })).sort(), ['_id', 'name', 'price', 'status']);
assert.equal(await items.findOne({ name: 'none' }), null);
// Across types: null and missing first, then numbers, texts (by code point), objects, booleans and dates.
const mixed = records.collection('mixed');
for (const [id, v] of [['null', null], ['two', 2], ['half', 1.5], ['upper', 'B'], ['text', 'a'], ['bmp', '\uFFFD'], ['astral', '\u{1F600}'],
  ['object', { a: 1 }], ['false', false], ['true', true], ['date', new Date('2026-01-01T00:00:00Z')]]) await mixed.insertOne({ _id: id, v });
const ascending = ['null', 'half', 'two', 'upper', 'text', 'bmp', 'astral', 'object', 'false', 'true', 'date'];
assert.deepEqual((await mixed.find({}, { sort: { v: 1 } })).map((doc) => doc._id), ascending);
assert.deepEqual((await mixed.find({}, { sort: { v: -1 } })).map((doc) => doc._id), [...ascending].reverse());
assert.deepEqual((await mixed.find({ v: { $gt: '\uFFFD' } })).map((doc) => doc._id), ['astral']);

// Updates.
assert.deepEqual(await items.updateOne({ _id: 'facial' }, { $set: { 'nested.minutes': 50, offer: { percent: 10 } }, $inc: { price: -500, sold: 1 } }),
  { matchedCount: 1, modifiedCount: 1, upsertedId: null });
const facial = await items.findOne({ _id: 'facial' });
assert.equal(facial.nested.minutes, 50);
assert.equal(facial.price, 7500);
assert.equal(facial.sold, 1);
assert.deepEqual(facial.offer, { percent: 10 });
assert.deepEqual(await items.updateOne({ _id: 'facial' }, { $set: { price: 7500 } }), { matchedCount: 1, modifiedCount: 0, upsertedId: null });
await items.updateOne({ _id: 'facial' }, { $unset: { offer: '' } });
assert.equal(Object.hasOwn(await items.findOne({ _id: 'facial' }), 'offer'), false);
await items.updateOne({ _id: 'facial' }, { $set: { note: 'x' } });
await items.updateOne({ _id: 'facial' }, { $set: { note: undefined } });
assert.equal(Object.hasOwn(await items.findOne({ _id: 'facial' }), 'note'), false);
assert.deepEqual(await items.updateOne({ _id: 'none' }, { $set: { a: 1 } }), { matchedCount: 0, modifiedCount: 0, upsertedId: null });
await code(items.updateOne({ _id: 'facial' }, { $push: { tags: 'x' } }), 'invalid-update');
await code(items.updateOne({ _id: 'facial' }, { $set: { _id: 'other' } }), 'invalid-update');
await code(items.updateOne({ _id: 'facial' }, { $inc: { name: 1 } }), 'invalid-update');
await code(items.updateOne({ _id: 'facial' }, { $set: { offer: {}, 'offer.percent': 5 } }), 'invalid-update');
await code(items.updateOne({ _id: 'wrap' }, { $set: { 'status.note': 'x' } }), 'invalid-update');
const upserted = await items.updateOne({ _id: 'settings-1', kind: 'setting' }, { $set: { value: 'peak' } }, { upsert: true });
assert.equal(upserted.upsertedId, 'settings-1');
assert.deepEqual(await items.findOne({ _id: 'settings-1' }), { _id: 'settings-1', kind: 'setting', value: 'peak' });
assert.deepEqual(await items.updateMany({ price: { $gt: 0 } }, { $set: { listed: true } }), { matchedCount: 2, modifiedCount: 2 });
assert.deepEqual(await ids({ listed: true }), ['facial', 'wrap']);
// A position past the end of an array fills the gap with null.
const notes = records.collection('notes');
await notes.insertOne({ _id: 'gap', tags: ['a'] });
await notes.updateOne({ _id: 'gap' }, { $set: { 'tags.3': 'd' } });
assert.deepEqual((await notes.findOne({ _id: 'gap' })).tags, ['a', null, null, 'd']);

// Upserts take the filter's equality fields: values, $eq and a one-value $in, also inside $and and a one-clause $or. A
// filter that fixes no _id gets a generated one.
const seeded = await notes.updateOne(
  { kind: { $in: ['hours'] }, $or: [{ size: 'm' }], 'shape.form': { $eq: 'round' }, $and: [{ tone: 'warm' }, { $or: [{ a: 1 }, { a: 2 }] }],
    price: { $gt: 1 }, tags: { $in: ['x', 'y'] } },
  { $set: { value: 'peak' } }, { upsert: true });
assert.match(seeded.upsertedId, /^[0-9a-f]{24}$/);
assert.deepEqual(await notes.findOne({ _id: seeded.upsertedId }), { _id: seeded.upsertedId, kind: 'hours', size: 'm', shape: { form: 'round' }, tone: 'warm', value: 'peak' });
assert.equal((await notes.updateOne({ _id: { $in: ['in-1'] } }, { $set: { v: 1 } }, { upsert: true })).upsertedId, 'in-1');
assert.equal((await notes.updateOne({ $or: [{ _id: 'or-1' }] }, { $set: { v: 1 } }, { upsert: true })).upsertedId, 'or-1');
assert.equal((await notes.updateOne({ kind: 'named' }, { $set: { _id: 'named-1' } }, { upsert: true })).upsertedId, 'named-1');
await code(notes.updateOne({ $and: [{ kind: 'a' }, { kind: 'b' }] }, { $set: { v: 1 } }, { upsert: true }), 'invalid-filter');
await code(notes.updateOne({ _id: 'fixed' }, { $set: { _id: 'other' } }, { upsert: true }), 'invalid-update');
assert.equal(await notes.countDocuments({ _id: { $in: ['fixed', 'other'] } }), 0);
const claim = await notes.findOneAndUpdate({ kind: 'claim' }, { $inc: { count: 1 } }, { upsert: true, returnDocument: 'after' });
assert.match(claim._id, /^[0-9a-f]{24}$/);
assert.deepEqual(claim, { _id: claim._id, kind: 'claim', count: 1 });
assert.deepEqual(await notes.findOneAndUpdate({ kind: 'claim' }, { $inc: { count: 1 } }, { upsert: true, returnDocument: 'after' }), { _id: claim._id, kind: 'claim', count: 2 });
assert.equal(await notes.findOneAndUpdate({ kind: 'fresh' }, { $set: { a: 1 } }, { upsert: true }), null);
assert.equal(await notes.countDocuments({ kind: 'fresh' }), 1);

// findOneAndUpdate: before by default, after on request, upsert, and one winner when two callers race for a document.
const before = await items.findOneAndUpdate({ _id: 'wrap' }, { $set: { status: 'held' } });
assert.equal(before.status, null);
const after = await items.findOneAndUpdate({ _id: 'wrap' }, { $set: { status: 'paid' } }, { returnDocument: 'after' });
assert.equal(after.status, 'paid');
assert.equal(await items.findOneAndUpdate({ _id: 'none' }, { $set: { a: 1 } }), null);
const created = await items.findOneAndUpdate({ _id: 'made' }, { $set: { a: 1 } }, { upsert: true, returnDocument: 'after' });
assert.deepEqual(created, { _id: 'made', a: 1 });
const claims = await Promise.all([1, 2, 3].map(() => items.findOneAndUpdate({ _id: 'wrap', status: 'paid' }, { $set: { status: 'cancelled' } })));
assert.equal(claims.filter(Boolean).length, 1);
const sortedClaim = await items.findOneAndUpdate({ listed: true }, { $set: { first: true } }, { sort: { price: 1 }, returnDocument: 'after' });
assert.equal(sortedClaim._id, 'wrap');

// Deletes.
assert.deepEqual(await items.deleteOne({ _id: 'made' }), { deletedCount: 1 });
assert.deepEqual(await items.deleteOne({ _id: 'made' }), { deletedCount: 0 });
assert.deepEqual(await items.deleteMany({ kind: 'setting' }), { deletedCount: 1 });

// Indexes: unique, sparse, replaced and expiring.
const codes = records.collection('codes');
await codes.createIndexes([{ key: { code: 1 }, unique: true }, { key: { session: 1 }, unique: true, sparse: true }]);
await codes.insertOne({ code: 'AAAA', session: 's1' });
await code(codes.insertOne({ code: 'AAAA' }), 'duplicate-key');
await codes.insertOne({ code: 'BBBB' });
await codes.insertOne({ code: 'CCCC' });
await code(codes.insertOne({ code: 'DDDD', session: 's1' }), 'duplicate-key');
await code(codes.updateOne({ code: 'BBBB' }, { $set: { code: 'AAAA' } }), 'duplicate-key');
const plain = records.collection('plain');
await plain.createIndexes([{ key: { email: 1 }, unique: true }]);
await plain.insertOne({ name: 'no email' });
await code(plain.insertOne({ name: 'also none' }), 'duplicate-key');
assert.deepEqual(byKey(await codes.listIndexes()), [{ key: { code: 1 }, unique: true }, { key: { session: 1 }, unique: true, sparse: true }]);
// The same key with other options replaces an index; the same index again changes nothing.
await codes.createIndexes([{ key: { code: 1 }, unique: true }, { key: { session: 1 }, sparse: true }]);
await codes.insertOne({ code: 'DDDD', session: 's1' });
assert.deepEqual(byKey(await codes.listIndexes()), [{ key: { code: 1 }, unique: true }, { key: { session: 1 }, sparse: true }]);
// A unique index the documents break is refused, and the index it would replace stays.
const duplicates = records.collection('duplicates');
await duplicates.createIndexes([{ key: { tag: 1 } }]);
await duplicates.insertOne({ tag: 'x' });
await duplicates.insertOne({ tag: 'x' });
await code(duplicates.createIndexes([{ key: { tag: 1 }, unique: true }]), 'duplicate-key');
assert.deepEqual(await duplicates.listIndexes(), [{ key: { tag: 1 } }]);
// A sparse index leaves out only a document with none of its fields; key fields in another order make another index.
const pairs = records.collection('pairs');
await pairs.createIndexes([{ key: { room: 1, slot: 1 }, unique: true, sparse: true }]);
await pairs.insertOne({ room: 'a' });
await code(pairs.insertOne({ room: 'a' }), 'duplicate-key');
await pairs.insertOne({ other: 1 });
await pairs.insertOne({ other: 2 });
await pairs.createIndexes([{ key: { slot: 1, room: 1 } }]);
assert.equal((await pairs.listIndexes()).length, 2);
await code(pairs.createIndexes([{ key: { room: 2 } }]), 'invalid-filter');
await code(pairs.createIndexes([{ key: { at: 1 }, expireAfterSeconds: 0.5 }]), 'invalid-filter');
await code(pairs.createIndexes([{ key: { at: 1, room: 1 }, expireAfterSeconds: 60 }]), 'invalid-filter');
const sessions = records.collection('sessions');
await sessions.createIndexes([{ key: { createdAt: 1 }, expireAfterSeconds: 60 }]);
await sessions.insertOne({ _id: 'old', createdAt: now() });
clock += 30 * 1000;
await sessions.insertOne({ _id: 'new', createdAt: now() });
assert.equal(await sessions.countDocuments({}), 2);
clock += 31 * 1000;
assert.deepEqual((await sessions.find({})).map((doc) => doc._id), ['new']);

// Export and import: every line follows the records line schema; another store takes the data, its indexes and its dates.
const exported = await records.exportAll();
const lines = exported.trim().split('\n').map((line) => JSON.parse(line));
assert.ok(lines.every((line) => typeof line.collection === 'string' && ('index' in line) !== ('document' in line)));
const names = ['codes', 'duplicates', 'items', 'mixed', 'notes', 'pairs', 'plain', 'sessions'];
assert.deepEqual([...new Set(lines.map((line) => line.collection))], names);
assert.ok(lines.some((line) => line.document && line.document.at && line.document.at.$date === when.toISOString()));
const copy = await open();
assert.deepEqual(await copy.importAll(exported), { collections: names.length, records: lines.filter((line) => line.document).length });
const moved = await copy.collection('items').findOne({ _id: insertedId });
assert.ok(moved.at instanceof Date);
assert.equal(moved.at.getTime(), when.getTime());
assert.deepEqual(byKey(await copy.collection('codes').listIndexes()), [{ key: { code: 1 }, unique: true }, { key: { session: 1 }, sparse: true }]);
await code(copy.collection('codes').insertOne({ code: 'AAAA' }), 'duplicate-key');
await code(copy.importAll(exported), 'duplicate-key');
assert.equal(await copy.collection('items').countDocuments({}), 3);
await assert.rejects(copy.importAll('{"collection":"items"}\n'), (error) => error.code === 'invalid-document');
await assert.rejects(copy.importAll('{"collection":"items","index":{"key":{"a":2}}}\n'), (error) => error.code === 'invalid-document');

// A closed handle refuses further use.
await copy.close();
assert.throws(() => copy.collection('items'), (error) => error.code === 'unavailable');
await records.close();
console.log('records class: all checks passed');
