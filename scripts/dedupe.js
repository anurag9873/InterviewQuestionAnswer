// One-off cleanup script: removes duplicate-id records that the old
// (buggy) storage code could create in MongoDB, so the app's new unique
// index on "id" can be created successfully.
//
// Run it once, locally, with MONGODB_URI set (either export it in your
// shell, or keep it in your .env file - this script loads .env too):
//
//   node scripts/dedupe.js
//
// For each collection (qa_list, examples_list), it groups documents by
// their "id" field and, for any id that appears more than once, keeps
// only the OLDEST document (the first one ever inserted, by Mongo's own
// _id, which is roughly insertion-ordered) and deletes the rest.

require("dotenv").config();
const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "qa_app";

if (!uri) {
  console.error("MONGODB_URI is not set (check your .env file or shell environment).");
  process.exit(1);
}

const COLLECTIONS = ["qa_list", "examples_list"];

async function dedupeCollection(db, name) {
  const collection = db.collection(name);
  const docs = await collection.find({}).sort({ _id: 1 }).toArray();

  const seenIds = new Set();
  const idsToDelete = [];

  for (const doc of docs) {
    if (seenIds.has(doc.id)) {
      idsToDelete.push(doc._id);
    } else {
      seenIds.add(doc.id);
    }
  }

  if (idsToDelete.length === 0) {
    console.log(`[${name}] No duplicates found (${docs.length} documents).`);
    return;
  }

  const result = await collection.deleteMany({ _id: { $in: idsToDelete } });
  console.log(
    `[${name}] Removed ${result.deletedCount} duplicate document(s), kept ${seenIds.size} unique id(s).`
  );
}

(async () => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    for (const name of COLLECTIONS) {
      await dedupeCollection(db, name);
    }

    console.log("Done. You can now restart the app - the unique index will be created automatically.");
  } catch (err) {
    console.error("Cleanup failed:", err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
})();
