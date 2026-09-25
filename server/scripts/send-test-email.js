import "dotenv/config";
import { PUBLIC_BASE_URL, smtp } from "../src/config.js";

const to = process.env.MAIL_TO;
const password = String(process.env.PANEL_PASSWORD || "").trim();
if (!smtp.user || !smtp.pass || !to) {
  console.error("SMTP_USER, SMTP_PASS ve MAIL_TO (.env) gerekli.");
  process.exit(1);
}
if (!password) {
  console.error("PANEL_PASSWORD .env içinde gerekli.");
  process.exit(1);
}

const base = PUBLIC_BASE_URL.replace(/\/$/, "");
const loginRes = await fetch(`${base}/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
if (!loginRes.ok) {
  console.error("Panele giriş yapılamadı:", await loginRes.text());
  process.exit(1);
}

const cookies = loginRes.headers.getSetCookie?.() || [];
const cookie = cookies.map((part) => part.split(";")[0]).join("; ");
if (!cookie) {
  console.error("Oturum çerezi alınamadı.");
  process.exit(1);
}

const res = await fetch(`${base}/api/send`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookie,
  },
  body: JSON.stringify({
    toEmail: to,
    subject: "deneme",
    html: "<p>MailPing deneme maili.</p>",
    text: "MailPing deneme",
    source: "panel",
  }),
});

if (!res.ok) {
  console.error("Gönderilemedi:", await res.text());
  process.exit(1);
}

const data = await res.json();
console.log("Track:", data.id);
console.log(`Mail gönderildi → ${to}`);
console.log(`Panel: ${base}/`);
