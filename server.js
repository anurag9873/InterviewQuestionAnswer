// Load variables from a local .env file (e.g. MONGODB_URI) into
// process.env. Node does NOT do this automatically - without this line,
// creating a .env file has no effect and the app silently falls back to
// local JSON files even if you filled in MONGODB_URI. On Vercel this line
// is harmless (there's no .env file there; env vars come from the
// dashboard instead).
require("dotenv").config();

const express = require("express");
const path = require("path");
const { readList, writeList, USE_MONGO } = require("./db");

// Clear startup feedback - so a bad MONGODB_URI (wrong password, IP not
// whitelisted, etc.) shows up immediately in the terminal instead of only
// failing silently on the first request.
if (USE_MONGO) {
  const { getDb } = require("./lib/mongo");
  getDb()
    .then(() => console.log("MongoDB: connected successfully."))
    .catch((err) => {
      console.error("MongoDB: FAILED to connect -", err.message);
      console.error(
        "Check: connection string is correct (password URL-encoded, no < > left in it), " +
          "the database user exists, and Network Access in Atlas allows your current IP (or 0.0.0.0/0)."
      );
    });
} else {
  console.log("MONGODB_URI not set - using local JSON files in ./data instead.");
}

const app = express();
const PORT = process.env.PORT || 3000;

const QA_FILE = path.join(__dirname, "data", "qa.json");
const EXAMPLES_FILE = path.join(__dirname, "data", "examples.json");

// Used only the very first time there's nothing saved yet (fresh Redis
// database, or a fresh clone with no local writes). After that, whatever
// the user adds/edits/deletes through the app is what's returned.
const SEED_QA = require("./data/qa.json");
const SEED_EXAMPLES = require("./data/examples.json");

const QA_KEY = "qa_list";
const EXAMPLES_KEY = "examples_list";

function nextId(list) {
  const max = list.reduce((m, item) => Math.max(m, parseInt(item.id, 10) || 0), 0);
  return String(max + 1);
}

// Express 4 does NOT catch errors thrown/rejected inside an `async`
// route handler - an unhandled one (e.g. MongoDB connection failing)
// crashes the whole Node process instead of just failing that one
// request. Wrapping every async handler with this sends the error to
// Express's error-handling middleware below instead.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------- middleware ----------
app.use(express.json());

// ---------- page routes (separate routes, not query params) ----------

// Home page: the Q&A table with category filter tabs
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Separate route for the "add a question" form (no table shown here)
app.get("/add", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "add.html"));
});

// Separate route for editing an existing question (no table shown here)
app.get("/edit/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "edit.html"));
});

// static assets (css/js) - after the page routes above
app.use(express.static(path.join(__dirname, "public")));

// ---------- API routes ----------

// GET all question+answer rows (for the table)
app.get("/api/questions", asyncHandler(async (req, res) => {
  const list = await readList(QA_KEY, QA_FILE, SEED_QA);
  res.json(list);
}));

// GET one question's example (for the modal)
app.get("/api/questions/:id/example", asyncHandler(async (req, res) => {
  const list = await readList(EXAMPLES_KEY, EXAMPLES_FILE, SEED_EXAMPLES);
  const item = list.find((q) => q.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
}));

const CATEGORIES = ["JavaScript", "React JS", "Node JS", "Next JS", "AI", "HTML/CSS"];

// GET the fixed list of tech categories (used to build the filter tabs / form dropdown)
app.get("/api/categories", (req, res) => {
  res.json(CATEGORIES);
});

// GET one question's full details (question + answer + example) -> used to pre-fill the edit form
app.get("/api/questions/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const qaList = await readList(QA_KEY, QA_FILE, SEED_QA);
  const examplesList = await readList(EXAMPLES_KEY, EXAMPLES_FILE, SEED_EXAMPLES);

  const qaEntry = qaList.find((q) => q.id === id);
  if (!qaEntry) return res.status(404).json({ error: "Not found" });

  const exampleEntry = examplesList.find((q) => q.id === id);

  res.json({
    id: qaEntry.id,
    category: qaEntry.category || "General",
    question: qaEntry.question,
    answer: qaEntry.answer,
    examples: exampleEntry ? exampleEntry.examples : "",
  });
}));

// POST a new question -> writes the SAME id into both documents
app.post("/api/questions", asyncHandler(async (req, res) => {
  const { question, answer, examples, category } = req.body || {};

  if (!question || !question.trim() || !answer || !answer.trim()) {
    return res.status(400).json({ error: "question and answer are required" });
  }

  const qaList = await readList(QA_KEY, QA_FILE, SEED_QA);
  const examplesList = await readList(EXAMPLES_KEY, EXAMPLES_FILE, SEED_EXAMPLES);

  const id = nextId(qaList.length >= examplesList.length ? qaList : examplesList);
  const finalCategory = CATEGORIES.includes(category) ? category : "General";

  const qaEntry = {
    id,
    category: finalCategory,
    question: question.trim(),
    answer: answer.trim(),
  };
  const exampleEntry = {
    id,
    category: finalCategory,
    question: question.trim(),
    examples: (examples || "").trim(),
  };

  qaList.push(qaEntry);
  examplesList.push(exampleEntry);

  await writeList(QA_KEY, QA_FILE, qaList);
  await writeList(EXAMPLES_KEY, EXAMPLES_FILE, examplesList);

  res.status(201).json({ qa: qaEntry, example: exampleEntry });
}));

// PUT (update) an existing question -> updates the SAME id in both documents
app.put("/api/questions/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { question, answer, examples, category } = req.body || {};

  if (!question || !question.trim() || !answer || !answer.trim()) {
    return res.status(400).json({ error: "question and answer are required" });
  }

  const qaList = await readList(QA_KEY, QA_FILE, SEED_QA);
  const examplesList = await readList(EXAMPLES_KEY, EXAMPLES_FILE, SEED_EXAMPLES);

  const qaIndex = qaList.findIndex((q) => q.id === id);
  if (qaIndex === -1) return res.status(404).json({ error: "Not found" });

  const finalCategory = CATEGORIES.includes(category)
    ? category
    : qaList[qaIndex].category || "General";

  const updatedQa = {
    id,
    category: finalCategory,
    question: question.trim(),
    answer: answer.trim(),
  };
  const updatedExample = {
    id,
    category: finalCategory,
    question: question.trim(),
    examples: (examples || "").trim(),
  };

  qaList[qaIndex] = updatedQa;

  const exIndex = examplesList.findIndex((q) => q.id === id);
  if (exIndex === -1) {
    examplesList.push(updatedExample);
  } else {
    examplesList[exIndex] = updatedExample;
  }

  await writeList(QA_KEY, QA_FILE, qaList);
  await writeList(EXAMPLES_KEY, EXAMPLES_FILE, examplesList);

  res.json({ qa: updatedQa, example: updatedExample });
}));

// DELETE a question -> removes matching id from both documents
app.delete("/api/questions/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;

  let qaList = await readList(QA_KEY, QA_FILE, SEED_QA);
  let examplesList = await readList(EXAMPLES_KEY, EXAMPLES_FILE, SEED_EXAMPLES);

  const existed = qaList.some((q) => q.id === id);
  qaList = qaList.filter((q) => q.id !== id);
  examplesList = examplesList.filter((q) => q.id !== id);

  await writeList(QA_KEY, QA_FILE, qaList);
  await writeList(EXAMPLES_KEY, EXAMPLES_FILE, examplesList);

  if (!existed) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
}));

// Catch-all error handler - runs for anything passed to next(err), e.g. a
// MongoDB connection/query failure from any route above. Keeps the server
// alive and returns a normal JSON error instead of crashing the process.
app.use((err, req, res, next) => {
  console.error("Request failed:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({
    error:
      "Something went wrong talking to the database. Check the server logs for details.",
  });
});

app.listen(PORT, () => {
  console.log(`Q&A app running at http://localhost:${PORT}`);
});

module.exports = app;
