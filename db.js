// Storage layer with two backends:
//
// 1) MongoDB (cloud) - used automatically once MONGODB_URI is set as an
//    environment variable. This is what runs on Vercel: create a free
//    cluster on MongoDB Atlas, get its connection string, and set it as
//    MONGODB_URI in your Vercel project settings.
//
// 2) Local JSON files - used automatically when MONGODB_URI is NOT set
//    (e.g. when you just run `npm start` on your own machine). This keeps
//    local development working exactly like before, with no MongoDB
//    account needed just to test on localhost.
//
// Why this is needed at all: Vercel serverless functions have a READ-ONLY
// filesystem in production (except /tmp, which is wiped between
// invocations and not shared across them). Writing to data/*.json there
// throws "Error: EROFS: read-only file system". MongoDB lives outside the
// function entirely, so writes always succeed there.
//
// Each "list" (qa_list / examples_list) maps to one MongoDB collection of
// the same name. To keep the rest of the app (server.js) completely
// unchanged, writeList() replaces the WHOLE collection's contents with the
// array it's given, mirroring how the local-JSON-file version always
// rewrote the whole file. That's simple and correct for a small Q&A app
// like this one (a handful to a few hundred questions).

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

// Strip MongoDB's own _id before handing documents back to the app - the
// app only ever deals with its own "id" field (a plain string like "1",
// "2", ...), so this keeps the API responses identical to before.
function stripMongoId(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

// collectionName - Mongo collection to use (only relevant when USE_MONGO)
// file            - local file path fallback (only relevant when !USE_MONGO)
// seed            - default data used the very first time nothing has
//                    been saved yet (fresh collection, or a fresh clone
//                    with no local writes)
async function readList(collectionName, file, seed) {
  if (USE_MONGO) {
    const db = await getDb();
    const collection = db.collection(collectionName);

    const count = await collection.countDocuments();
    if (count === 0 && seed.length) {
      await collection.insertMany(seed.map((item) => ({ ...item })));
    }

    const docs = await collection.find({}).toArray();
    return docs
      .map(stripMongoId)
      .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
  }
  return readFileJSON(file);
}

async function writeList(collectionName, file, data) {
  if (USE_MONGO) {
    const db = await getDb();
    const collection = db.collection(collectionName);

    await collection.deleteMany({});
    if (data.length) {
      await collection.insertMany(data.map((item) => ({ ...item })));
    }
    return;
  }
  writeFileJSON(file, data);
}

module.exports = { readList, writeList, USE_MONGO };
