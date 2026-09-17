const qaBody = document.getElementById("qaBody");
const qaForm = document.getElementById("qaForm");
const filterTabsEl = document.getElementById("filterTabs");
const categorySelect = document.getElementById("category");

const modalOverlay = document.getElementById("modalOverlay");
const modalQuestion = document.getElementById("modalQuestion");
const modalExample = document.getElementById("modalExample");
const modalClose = document.getElementById("modalClose");

let ALL_QUESTIONS = [];
let CATEGORIES = [];
let activeFilter = "All";

async function loadCategories() {
  const res = await fetch("/api/categories");
  CATEGORIES = await res.json();

  // Populate the "Technology" dropdown in the form
  categorySelect.innerHTML = CATEGORIES.map(
    (c) => `<option value="${c}">${c}</option>`
  ).join("");

  // Build filter tabs: "All" + one per category
  renderFilterTabs();
}

function renderFilterTabs() {
  ///const tabs = ["All", ...CATEGORIES];
   const tabs = ["All", ...CATEGORIES];
  filterTabsEl.innerHTML = "";
  tabs.forEach((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = tab;
    btn.className = "filter-tab" + (tab === activeFilter ? " active" : "");
    btn.addEventListener("click", () => {
      activeFilter = tab;
      renderFilterTabs();
      renderTable();
    });
    filterTabsEl.appendChild(btn);
  });
}

async function loadQuestions() {
  const res = await fetch("/api/questions");
  ALL_QUESTIONS = await res.json();
  renderTable();
}

function categorySlug(category) {
  return (category || "general").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function renderTable() {
  const list =
    activeFilter === "All"
      ? ALL_QUESTIONS
      : ALL_QUESTIONS.filter((item) => item.category === activeFilter);

  qaBody.innerHTML = "";

  if (list.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "empty-row";
    td.textContent = "No questions in this category yet.";
    tr.appendChild(td);
    qaBody.appendChild(tr);
    return;
  }

  list.forEach((item) => {
    const tr = document.createElement("tr");

    const catCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge badge-${categorySlug(item.category)}`;
    badge.textContent = item.category || "General";
    catCell.appendChild(badge);

    const qCell = document.createElement("td");
    qCell.className = "question-cell";
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = item.question;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openModal(item.id, item.question);
    });
    qCell.appendChild(link);

    const aCell = document.createElement("td");
    aCell.textContent = item.answer;

    const delCell = document.createElement("td");
    delCell.className = "delete-cell";
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteQuestion(item.id));
    delCell.appendChild(delBtn);

    tr.appendChild(catCell);
    tr.appendChild(qCell);
    tr.appendChild(aCell);
    tr.appendChild(delCell);
    qaBody.appendChild(tr);
  });
}

async function openModal(id, question) {
  modalQuestion.textContent = question;
  modalExample.textContent = "Loading...";
  modalOverlay.classList.remove("hidden");

  try {
    const res = await fetch(`/api/questions/${id}/example`);
    if (!res.ok) throw new Error("not found");
    const data = await res.json();
    modalExample.textContent = data.examples || "No example added yet.";
  } catch (err) {
    modalExample.textContent = "Could not load example.";
  }
}

function closeModal() {
  modalOverlay.classList.add("hidden");
}

modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

qaForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const category = categorySelect.value;
  const question = document.getElementById("question").value;
  const answer = document.getElementById("answer").value;
  const examples = document.getElementById("examples").value;

  const res = await fetch("/api/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, question, answer, examples }),
  });

  if (res.ok) {
    qaForm.reset();
    loadQuestions();
  } else {
    const err = await res.json();
    alert(err.error || "Something went wrong");
  }
});

async function deleteQuestion(id) {
  if (!confirm("Delete this question?")) return;
  await fetch(`/api/questions/${id}`, { method: "DELETE" });
  loadQuestions();
}

(async function init() {
  await loadCategories();
  await loadQuestions();
})();
