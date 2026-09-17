// Storage layer with two backends:
//
// 1) MongoDB (cloud) - used automatically once MONGODB_URI is set as an
//    environment variable.
// 2) Local JSON files - used automatically when MONGODB_URI is NOT set
//    (e.g. `npm start` on your own machine).
//
// IMPORTANT DESIGN NOTE (read this if you're touching this file):
// An earlier version of this file implemented every write as "delete the
// whole collection, then re-insert the whole array" (mirroring how the
// local-JSON-file version always rewrote the whole file). That looks
// simple, but it is NOT safe against concurrent requests: if a second
// request reads the collection in the moment between the delete and the
// re-insert, it sees an empty collection and thinks it needs to reseed it
// - inserting the original seed data (ids 1-6) a second time. That is
// exactly what caused "multiple records with the same id" in MongoDB.
//
// This version instead performs one atomic operation per document
// (insertOne / replaceOne / deleteOne), which MongoDB guarantees is safe
// under concurrent requests, plus:
//  - a unique index on the "id" field, so the database itself refuses a
//    duplicate id even if some future bug tries to create one
//  - an atomic counter (a tiny "counters" collection with $inc) for
//    generating new ids, so two requests creating a question at the same
//    time can never be handed the same "next id"
//  - idempotent per-item seeding (upsert with $setOnInsert), which is
//    safe to run more than once or from multiple cold-started serverless
//    instances at once, unlike the old "count everything, then insert the
//    whole seed array" check.

const fs = require("fs");
const { getDb, isConfigured } = require("./lib/mongo");

const USE_MONGO = isConfigured();

function readFileJSON(file) {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function writeFileJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

function stripMongoId(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

// Per-collection setup, done at most once per warm serverless instance
// (the `ensured` Set is just an optimization - every operation inside is
// itself safe to repeat, so a cold start redoing it once more is fine).
const ensured = new Set();

async function ensureCollection(db, collectionName, seed) {
  if (ensured.has(collectionName)) return;

  const collection = db.collection(collectionName);

  try {
    await collection.createIndex({ id: 1 }, { unique: true });
  } catch (err) {
    // If duplicate ids already exist (e.g. from before this fix), Mongo
    // refuses to build a unique index. Don't crash the app over it - log
    // it clearly so it's easy to notice, and run scripts/dedupe.js to
    // clean the collection up, then restart the app.
    console.error(
      `Could not create unique index on "${collectionName}.id" (likely duplicate ids already exist - run "node scripts/dedupe.js" to clean them up):`,
      err.message
    );
  }

  // Idempotent seeding: each upsert either inserts (id missing) or does
  // nothing (id already present). Safe to run concurrently/more than once.
  await Promise.all(
    seed.map((item) =>
      collection.updateOne(
        { id: item.id },
        { $setOnInsert: item },
        { upsert: true }
      )
    )
  );

  ensured.add(collectionName);
}

async function getCollection(collectionName, seed) {
  const db = await getDb();
  await ensureCollection(db, collectionName, seed);
  return db.collection(collectionName);
}

// Full list - read-only, used for the table/filters/edit-prefill/example
// modal. No concurrency risk since it doesn't write anything.
async function readList(collectionName, file, seed) {
  if (USE_MONGO) {
    const collection = await getCollection(collectionName, seed);
    const docs = await collection.find({}).toArray();
    return docs
      .map(stripMongoId)
      .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
  }
  return readFileJSON(file);
}

// Insert exactly one new document.
async function insertItem(collectionName, file, seed, item) {
  if (USE_MONGO) {
    const collection = await getCollection(collectionName, seed);
    await collection.insertOne({ ...item });
    return;
  }
  const list = readFileJSON(file);
  list.push(item);
  writeFileJSON(file, list);
}

// Replace exactly one existing document (matched by its "id" field).
async function replaceItem(collectionName, file, seed, id, item) {
  if (USE_MONGO) {
    const collection = await getCollection(collectionName, seed);
    await collection.replaceOne({ id }, { ...item }, { upsert: true });
    return;
  }
  const list = readFileJSON(file);
  const index = list.findIndex((d) => d.id === id);
  if (index === -1) list.push(item);
  else list[index] = item;
  writeFileJSON(file, list);
}

// Delete exactly one document (matched by its "id" field).
async function deleteItem(collectionName, file, seed, id) {
  if (USE_MONGO) {
    const collection = await getCollection(collectionName, seed);
    await collection.deleteOne({ id });
    return;
  }
  const list = readFileJSON(file).filter((d) => d.id !== id);
  writeFileJSON(file, list);
}

// Atomically generate the next id for a collection. Using MongoDB's own
// $inc (rather than "read everything, take the max, add one" in app code)
// guarantees two requests arriving at the same time can never be handed
// the same id.
async function nextId(collectionName, file, seed) {
  if (USE_MONGO) {
    const db = await getDb();
    await ensureCollection(db, collectionName, seed);

    // Make sure the counter starts at or above the current highest id in
    // the collection (covers the seed data, and self-heals if the
    // collection ever ends up ahead of the counter for any reason). $max
    // only ever raises the stored value, so this is safe to run every
    // time, even from multiple concurrent requests.
    const docs = await db
      .collection(collectionName)
      .find({}, { projection: { id: 1 } })
      .toArray();
    const currentMax = docs.reduce(
      (m, d) => Math.max(m, parseInt(d.id, 10) || 0),
      0
    );
    const counters = db.collection("counters");
    await counters.updateOne(
      { _id: collectionName },
      { $max: { seq: currentMax } },
      { upsert: true }
    );

    // The actual id-generating step: MongoDB guarantees this increment is
    // atomic, so concurrent calls always get distinct, increasing values.
    const result = await counters.findOneAndUpdate(
      { _id: collectionName },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );
    const updated = result && result.value ? result.value : result;
    return String(updated.seq);
  }

  const list = readFileJSON(file);
  const max = list.reduce((m, item) => Math.max(m, parseInt(item.id, 10) || 0), 0);
  return String(max + 1);
}

module.exports = {
  readList,
  insertItem,
  replaceItem,
  deleteItem,
  nextId,
  USE_MONGO,
};
