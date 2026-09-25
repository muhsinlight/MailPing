import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PUBLIC_BASE_URL, smtp } from "../src/config.js";

const to = process.env.MAIL_TO;
if (!smtp.user || !smtp.pass || !to) {
  console.error("SMTP_USER, SMTP_PASS ve MAIL_TO (.env) gerekli.");
  process.exit(1);
}

function apiToken() {
  if (process.env.API_TOKEN) return process.env.API_TOKEN;
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "secrets.json");
    return JSON.parse(fs.readFileSync(file, "utf8")).apiToken || "";
  } catch {
    return "";
  }
}

const token = apiToken();
if (!token) {
  console.error("API_TOKEN yok. Sunucuyu bir kez başlatın veya .env'e ekleyin.");
  process.exit(1);
}

const res = await fetch(`${PUBLIC_BASE_URL}/api/send`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    toEmail: to,
    subject: "deneme",
    html: "<p>MailTracker deneme maili.</p><p>HTML açıp görselleri yükleyin.</p>",
    text: "MailTracker deneme",
    source: "smtp",
  }),
});

if (!res.ok) {
  console.error("Gönderilemedi:", await res.text());
  console.error("Sunucu çalışıyor mu? npm start");
  process.exit(1);
}

const data = await res.json();
console.log("Track:", data.id);
console.log(`Mail gönderildi → ${to}`);
console.log(`Panel: ${PUBLIC_BASE_URL}/`);
