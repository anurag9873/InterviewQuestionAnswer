// Logic for add.html - the standalone "add a new question" page (no table here).

const qaForm = document.getElementById("qaForm");
const categorySelect = document.getElementById("category");
const successMsg = document.getElementById("successMsg");

async function loadCategories() {
  const res = await fetch("/api/categories");
  const categories = await res.json();
  categorySelect.innerHTML = categories
    .map((c) => `<option value="${c}">${c}</option>`)
    .join("");
}

qaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  successMsg.classList.add("hidden");

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
    await loadCategories();
    successMsg.classList.remove("hidden");
    successMsg.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    const err = await res.json();
    alert(err.error || "Something went wrong");
  }
});

loadCategories();
