// Cached MongoDB connection.
//
// Serverless platforms (like Vercel) can run many concurrent function
// invocations, and each one importing this file fresh would normally open
// its own new connection to MongoDB, quickly exhausting the connection
// limit. To avoid that, we cache the connection promise on `global` so
// every invocation that shares the same warm serverless instance reuses
// the same connection instead of opening a new one.

const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "qa_app";

function isConfigured() {
  return Boolean(uri);
}

function getClientPromise() {
  if (!uri) return null;

  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  return global._mongoClientPromise;
}

async function getDb() {
  const clientPromise = getClientPromise();
  if (!clientPromise) {
    throw new Error("MONGODB_URI is not set");
  }
  const client = await clientPromise;
  return client.db(dbName);
}

module.exports = { getDb, isConfigured };
