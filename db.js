// Storage layer with two backends:
//
// 1) Upstash Redis - used automatically once UPSTASH_REDIS_REST_URL and
//    UPSTASH_REDIS_REST_TOKEN are set as environment variables. On Vercel,
//    installing the "Upstash" integration from the Vercel Marketplace
//    (Project -> Storage -> Browse Marketplace -> Upstash) injects these
//    two variables into your project automatically - no manual copy/paste.
//
// 2) Local JSON files - used automatically when those env vars are NOT set
//    (e.g. when you just run `npm start` on your own machine). This keeps
//    local development working exactly like before, no Upstash account
//    needed just to test on localhost.
//
// Why this is needed at all: Vercel serverless functions have a READ-ONLY
// filesystem in production (except /tmp, which is wiped between
// invocations and not shared across them). Writing to data/*.json there
// throws "Error: EROFS: read-only file system". Redis lives outside the
// function entirely, so writes always succeed there.

const fs = require("fs");

const USE_REDIS = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

let redis = null;
if (USE_REDIS) {
  const { Redis } = require("@upstash/redis");
  redis = Redis.fromEnv();
}

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

// key   - the Redis key to use (only relevant when USE_REDIS is true)
// file  - local file path fallback (only relevant when USE_REDIS is false)
// seed  - default data used the very first time nothing has been saved yet
async function readList(key, file, seed) {
  if (USE_REDIS) {
    const data = await redis.get(key);
    if (data === null || data === undefined) {
      await redis.set(key, seed);
      return seed;
    }
    return data;
  }
  return readFileJSON(file);
}

async function writeList(key, file, data) {
  if (USE_REDIS) {
    await redis.set(key, data);
    return;
  }
  writeFileJSON(file, data);
}

module.exports = { readList, writeList, USE_REDIS };
