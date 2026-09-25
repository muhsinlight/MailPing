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

const button = form.querySelector("button[type=submit]");
const forgot = document.getElementById("forgot");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  button.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password: document.getElementById("password").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
      error.textContent = "Bu IP'den panele izin yok.";
      error.hidden = false;
      return;
    }
    if (res.status === 429) {
      const minutes = Math.max(1, Math.ceil(Number(data.retryAfter || 0) / 60));
      error.textContent = data.retryAfter
        ? `Çok fazla deneme. ${minutes} dakika sonra tekrar deneyin.`
        : "Çok fazla deneme. Biraz bekleyin.";
      error.hidden = false;
      return;
    }
    if (!res.ok) {
      error.textContent = "Şifre yanlış.";
      error.hidden = false;
      return;
    }
    location.replace("/");
  } finally {
    button.disabled = false;
  }
});

forgot.addEventListener("click", async () => {
  error.hidden = true;
  forgot.disabled = true;
  try {
    const res = await fetch("/api/recover", { method: "POST", credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const minutes = Math.max(1, Math.ceil(Number(data.retryAfter || 0) / 60));
      error.textContent = `Yeni şifre az önce gitti. ${minutes} dakika sonra tekrar iste.`;
      error.hidden = false;
      return;
    }
    if (!res.ok) {
      error.textContent = data.error || "Şifre gönderilemedi.";
      error.hidden = false;
      return;
    }
    error.textContent = `Yeni şifre ${data.sentTo} adresine gitti. Eski şifre kapandı.`;
    error.hidden = false;
  } finally {
    forgot.disabled = false;
  }
});
