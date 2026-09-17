// Logic for edit.html - standalone "edit an existing question" page (no table here).
// The id comes from the URL, e.g. /edit/3

const qaForm = document.getElementById("qaForm");
const categorySelect = document.getElementById("category");
const errorMsg = document.getElementById("errorMsg");

const questionInput = document.getElementById("question");
const answerInput = document.getElementById("answer");
const examplesInput = document.getElementById("examples");

const id = window.location.pathname.split("/").filter(Boolean).pop();

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.remove("hidden");
}

async function init() {
  try {
    const [categoriesRes, questionRes] = await Promise.all([
      fetch("/api/categories"),
      fetch(`/api/questions/${id}`),
    ]);

    if (!questionRes.ok) {
      showError("This question could not be found. It may have been deleted.");
      return;
    }

    const categories = await categoriesRes.json();
    const data = await questionRes.json();

    categorySelect.innerHTML = categories
      .map((c) => `<option value="${c}">${c}</option>`)
      .join("");
    categorySelect.value = data.category;

    questionInput.value = data.question;
    answerInput.value = data.answer;
    examplesInput.value = data.examples || "";

    qaForm.classList.remove("hidden");
  } catch (err) {
    showError("Something went wrong loading this question.");
  }
}

qaForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const res = await fetch(`/api/questions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: categorySelect.value,
      question: questionInput.value,
      answer: answerInput.value,
      examples: examplesInput.value,
    }),
  });

  if (res.ok) {
    window.location.href = "/";
  } else {
    const err = await res.json();
    alert(err.error || "Something went wrong");
  }
});

init();
