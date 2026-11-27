// A stand-in for the MongoDB Node driver's client, over the class's own copy of the records engine, so a store that talks
// to MongoDB can be checked without a server. Where MongoDB 8.2 answers differently from the records engine and a store
// relies on it, the stand-in answers as MongoDB: errors in the driver's shape (duplicate key is code 11000), $setOnInsert
// in upserts, dropIndex, default index names (<field>_<direction>), and a refused index (code 86, or 85 when only
// expireAfterSeconds differs) when one with its name exists with other options. Operations on one database run one at
// a time.
import { createStore } from './records.ts';

const serverError = (code, message) => Object.assign(new Error(message), { name: 'MongoServerError', code });

function driverError(error) {
  if (error && error.code === 'duplicate-key') return serverError(11000, 'E11000 duplicate key error collection');
  if (error && typeof error.code === 'string') return serverError(2, error.message);
  return error;
}

const guard = (run) => async (...args) => {
  try {
    return await run(...args);
  } catch (error) {
    throw driverError(error);
  }
};

function serial() {
  let last = Promise.resolve();
  return (run) => {
    const next = last.then(run, run);
    last = next.catch(() => {});
    return next;
  };
}

const nameOf = (key) => Object.entries(key).map(([field, direction]) => `${field}_${direction}`).join('_');
const sameKey = (a, b) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));
const overlap = (a, b) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

// The _id MongoDB takes from a filter for the document an upsert inserts.
function filterId(filter) {
  for (const [key, value] of Object.entries(filter ?? {})) {
    if (key === '_id') {
      if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return { value };
      if (Object.hasOwn(value, '$eq')) return { value: value.$eq };
      if (Array.isArray(value.$in) && value.$in.length === 1) return { value: value.$in[0] };
    } else if (key === '$and' || (key === '$or' && Array.isArray(value) && value.length === 1)) {
      for (const part of value) {
        const found = filterId(part);
        if (found) return found;
      }
    }
  }
  return null;
}

// $setOnInsert applies only to the document an upsert inserts. A path it shares with another operator is refused at once.
function splitInsert(update = {}) {
  const { $setOnInsert: onInsert, ...change } = update;
  const changed = Object.values(change).flatMap((fields) => Object.keys(fields ?? {}));
  for (const path of Object.keys(onInsert ?? {})) {
    const other = changed.find((done) => overlap(done, path));
    if (other !== undefined) throw serverError(40, `Updating the path '${path}' would create a conflict at '${other}'`);
  }
  return { change, onInsert };
}

// The update for the document an upsert inserts: $setOnInsert's fields join $set; its _id may not differ from the filter's.
function insertOf(filter, change, onInsert) {
  if (onInsert === undefined) return change;
  const fixed = filterId(filter);
  if (Object.hasOwn(onInsert, '_id') && fixed && fixed.value !== onInsert._id) {
    throw serverError(66, "Performing an update on the path '_id' would modify the immutable field '_id'");
  }
  return { ...change, $set: { ...(change.$set ?? {}), ...onInsert } };
}

const nothing = (change) => Object.values(change).every((fields) => Object.keys(fields ?? {}).length === 0);

// The filter has been read by then, so the engine refusing it can only mean a field the new document gets twice.
const inserting = (run) => run().catch((error) => {
  if (error && error.code === 'invalid-filter') throw serverError(54, `cannot infer query fields to set: ${error.message}`);
  throw error;
});

function cursor(produce, initial = {}) {
  const options = { ...initial };
  const self = {
    sort(sort) { options.sort = sort; return self; },
    skip(skip) { options.skip = skip; return self; },
    limit(limit) { options.limit = limit; return self; },
    project(projection) { options.projection = projection; return self; },
    toArray: guard(() => produce(options)),
    async *[Symbol.asyncIterator]() { for (const item of await self.toArray()) yield item; },
  };
  return self;
}

function collectionOf(store, queue, name, calls) {
  const records = () => store.collection(name);
  const log = (operation, ...args) => calls.push({ collection: name, operation, args });
  const op = (run) => guard((...args) => queue(() => run(...args)));
  const listed = async () => [{ v: 2, key: { _id: 1 }, name: '_id_' },
    ...(await records().listIndexes()).map((spec) => ({ v: 2, ...spec, name: nameOf(spec.key) }))];
  return {
    collectionName: name,
    insertOne: op(async (doc) => { log('insertOne', doc); const { insertedId } = await records().insertOne(doc); return { acknowledged: true, insertedId }; }),
    insertMany: op(async (docs) => {
      log('insertMany', docs);
      const insertedIds = {};
      for (const [index, doc] of docs.entries()) insertedIds[index] = (await records().insertOne(doc)).insertedId;
      return { acknowledged: true, insertedCount: docs.length, insertedIds };
    }),
    findOne: op(async (filter, options) => { log('findOne', filter, options); return records().findOne(filter ?? {}, options ?? {}); }),
    find(filter, options) { log('find', filter, options); return cursor((current) => queue(() => records().find(filter ?? {}, current)), options ?? {}); },
    countDocuments: op(async (filter) => { log('countDocuments', filter); return records().countDocuments(filter ?? {}); }),
    updateOne: op(async (filter, update, options = {}) => {
      log('updateOne', filter, update, options);
      const { change, onInsert } = splitInsert(update);
      const matched = await records().findOne(filter ?? {});
      if (matched || !options.upsert) {
        if (onInsert !== undefined && nothing(change)) return { acknowledged: true, matchedCount: matched ? 1 : 0, modifiedCount: 0, upsertedId: null, upsertedCount: 0 };
        return { acknowledged: true, ...(await records().updateOne(filter, change, {})), upsertedCount: 0 };
      }
      const result = await inserting(() => records().updateOne(filter, insertOf(filter, change, onInsert), { upsert: true }));
      return { acknowledged: true, ...result, upsertedCount: result.upsertedId ? 1 : 0 };
    }),
    updateMany: op(async (filter, update) => {
      log('updateMany', filter, update);
      const { change, onInsert } = splitInsert(update);
      if (onInsert !== undefined && nothing(change)) {
        return { acknowledged: true, matchedCount: await records().countDocuments(filter ?? {}), modifiedCount: 0, upsertedCount: 0, upsertedId: null };
      }
      return { acknowledged: true, ...(await records().updateMany(filter, change)), upsertedCount: 0, upsertedId: null };
    }),
    findOneAndUpdate: op(async (filter, update, options = {}) => {
      log('findOneAndUpdate', filter, update, options);
      if (options.includeResultMetadata) throw new Error('includeResultMetadata is not supported here');
      const { change, onInsert } = splitInsert(update);
      const { upsert, ...rest } = options;
      const matched = await records().findOne(filter ?? {}, rest.sort ? { sort: rest.sort } : {});
      if (matched || !upsert) {
        if (onInsert !== undefined && nothing(change)) return matched;
        return records().findOneAndUpdate(filter, change, rest);
      }
      return inserting(() => records().findOneAndUpdate(filter, insertOf(filter, change, onInsert), { ...rest, upsert: true }));
    }),
    deleteOne: op(async (filter) => { log('deleteOne', filter); return { acknowledged: true, ...(await records().deleteOne(filter)) }; }),
    deleteMany: op(async (filter) => { log('deleteMany', filter); return { acknowledged: true, ...(await records().deleteMany(filter)) }; }),
    createIndexes: op(async (indexes) => {
      log('createIndexes', indexes);
      const existing = await listed();
      for (const index of indexes) {
        const name = index.name ?? nameOf(index.key);
        const found = existing.find((item) => item.name === name);
        if (!found) continue;
        if (!sameKey(found.key, index.key) || Boolean(found.unique) !== Boolean(index.unique) || Boolean(found.sparse) !== Boolean(index.sparse)) {
          throw serverError(86, `An existing index has the same name as the requested index: ${name}`);
        }
        if ((found.expireAfterSeconds ?? null) !== (index.expireAfterSeconds ?? null)) {
          throw serverError(85, `An equivalent index already exists with the same name but different options: ${name}`);
        }
      }
      await records().createIndexes(indexes.map(({ name, ...spec }) => spec));
      return indexes.map((index) => index.name ?? nameOf(index.key));
    }),
    dropIndex: op(async (indexName) => {
      log('dropIndex', indexName);
      if (indexName === '_id_') throw serverError(72, 'cannot drop _id index');
      const existing = await listed();
      const found = existing.find((item) => item.name === indexName);
      if (!found || !store.dropIndex(name, found.key)) throw serverError(27, `index not found with name [${indexName}]`);
      return { nIndexesWas: existing.length, ok: 1 };
    }),
    listIndexes() {
      return cursor(() => queue(listed));
    },
  };
}

export function createDriver({ now } = {}) {
  const stores = new Map();
  const calls = [];
  let closed = false;
  const storeOf = (name) => {
    if (!stores.has(name)) stores.set(name, { store: createStore({ now }), queue: serial() });
    return stores.get(name);
  };
  return {
    calls,
    get closed() { return closed; },
    db(name) {
      const { store, queue } = storeOf(name);
      return {
        databaseName: name,
        collection: (collection) => collectionOf(store, queue, collection, calls),
        listCollections() { return cursor(() => queue(async () => store.names().map((collection) => ({ name: collection, type: 'collection' })))); },
        async dropDatabase() { await queue(async () => store.clear()); return true; },
      };
    },
    async close() { closed = true; },
  };
}
