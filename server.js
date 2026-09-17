const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const QA_FILE = path.join(__dirname, "data", "qa.json");
const EXAMPLES_FILE = path.join(__dirname, "data", "examples.json");

// ---------- small file-based "database" helpers ----------
function readJSON(file) {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

function nextId(list) {
  const max = list.reduce((m, item) => Math.max(m, parseInt(item.id, 10) || 0), 0);
  return String(max + 1);
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

// GET all question+answer rows (for the table) -> reads only qa.json
app.get("/api/questions", (req, res) => {
  const list = readJSON(QA_FILE);
  res.json(list);
});

// GET one question's example (for the modal) -> reads only examples.json
app.get("/api/questions/:id/example", (req, res) => {
  const list = readJSON(EXAMPLES_FILE);
  const item = list.find((q) => q.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

const CATEGORIES = ["JavaScript", "React JS", "Node JS", "Next JS", "AI", "HTML/CSS"];

// GET the fixed list of tech categories (used to build the filter tabs / form dropdown)
app.get("/api/categories", (req, res) => {
  res.json(CATEGORIES);
});

// GET one question's full details (question + answer + example) -> used to pre-fill the edit form
app.get("/api/questions/:id", (req, res) => {
  const { id } = req.params;
  const qaList = readJSON(QA_FILE);
  const examplesList = readJSON(EXAMPLES_FILE);

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
});

// POST a new question -> writes the SAME id into both documents
app.post("/api/questions", (req, res) => {
  const { question, answer, examples, category } = req.body || {};

  if (!question || !question.trim() || !answer || !answer.trim()) {
    return res.status(400).json({ error: "question and answer are required" });
  }

  const qaList = readJSON(QA_FILE);
  const examplesList = readJSON(EXAMPLES_FILE);

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

  writeJSON(QA_FILE, qaList);
  writeJSON(EXAMPLES_FILE, examplesList);

  res.status(201).json({ qa: qaEntry, example: exampleEntry });
});

// PUT (update) an existing question -> updates the SAME id in both documents
app.put("/api/questions/:id", (req, res) => {
  const { id } = req.params;
  const { question, answer, examples, category } = req.body || {};

  if (!question || !question.trim() || !answer || !answer.trim()) {
    return res.status(400).json({ error: "question and answer are required" });
  }

  const qaList = readJSON(QA_FILE);
  const examplesList = readJSON(EXAMPLES_FILE);

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

  writeJSON(QA_FILE, qaList);
  writeJSON(EXAMPLES_FILE, examplesList);

  res.json({ qa: updatedQa, example: updatedExample });
});

// DELETE a question -> removes matching id from both documents
app.delete("/api/questions/:id", (req, res) => {
  const { id } = req.params;

  let qaList = readJSON(QA_FILE);
  let examplesList = readJSON(EXAMPLES_FILE);

  const existed = qaList.some((q) => q.id === id);
  qaList = qaList.filter((q) => q.id !== id);
  examplesList = examplesList.filter((q) => q.id !== id);

  writeJSON(QA_FILE, qaList);
  writeJSON(EXAMPLES_FILE, examplesList);

  if (!existed) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Q&A app running at http://localhost:${PORT}`);
});
