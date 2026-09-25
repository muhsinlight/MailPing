const form = document.getElementById("form");
const error = document.getElementById("error");

(async () => {
  try {
    const res = await fetch("/api/auth", { credentials: "same-origin" });
    if (res.ok) location.replace("/");
  } catch {
    /* kapalı */
  }
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ password: document.getElementById("password").value }),
  });
  if (res.status === 403) {
    error.textContent = "Bu IP'den panele izin yok.";
    error.hidden = false;
    return;
  }
  if (res.status === 429) {
    error.textContent = "Çok fazla deneme. Biraz bekleyin.";
    error.hidden = false;
    return;
  }
  if (!res.ok) {
    error.textContent = "Şifre yanlış.";
    error.hidden = false;
    return;
  }
  location.replace("/");
});
