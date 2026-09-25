import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { deleteSetting, getSetting, setSetting } from "./db.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const cvDir = path.join(dataDir, "cv");
const cvFilePath = path.join(cvDir, "current.pdf");

const PDF_MAGIC = Buffer.from("%PDF");

function safeFilename(name) {
  const raw = decodeURIComponent(String(name || "cv.pdf"));
  const base = path.basename(raw).replace(/[^\w.\- ()ğıüşöçİĞÜŞÖÇ]+/gi, "_") || "cv.pdf";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

export function isPdfBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 4 && buf.subarray(0, 4).equals(PDF_MAGIC);
}

export function getCvMeta() {
  if (!fs.existsSync(cvFilePath)) return null;
  const stat = fs.statSync(cvFilePath);
  return {
    filename: getSetting("cv_filename") || "cv.pdf",
    size: stat.size,
    uploadedAt: getSetting("cv_uploaded_at"),
  };
}

export function saveCv(buffer, originalName) {
  fs.mkdirSync(cvDir, { recursive: true });
  fs.writeFileSync(cvFilePath, buffer);
  setSetting("cv_filename", safeFilename(originalName));
  setSetting("cv_uploaded_at", new Date().toISOString());
  return getCvMeta();
}

export function readCv() {
  const meta = getCvMeta();
  if (!meta) return null;
  return { ...meta, buffer: fs.readFileSync(cvFilePath) };
}

export function removeCv() {
  if (fs.existsSync(cvFilePath)) fs.unlinkSync(cvFilePath);
  deleteSetting("cv_filename");
  deleteSetting("cv_uploaded_at");
}

export function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_") || "cv.pdf";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function renderCvLanding({ track, cv }) {
  const hasFile = Boolean(cv);
  const title = hasFile ? cv.filename : "CV";
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: ui-sans-serif, "Segoe UI", sans-serif;
      background: #ebe6dc; color: #1c1a17;
    }
    .card {
      width: min(400px, calc(100vw - 28px));
      background: #fffdf8;
      border: 1px solid #ddd6c8;
      border-radius: 22px;
      padding: 28px;
    }
    .kicker { margin: 0 0 8px; color: #6f6a62; font-size: 0.75rem; }
    h1 { font-size: 1.35rem; margin: 0 0 8px; font-weight: 650; }
    p { margin: 0 0 20px; color: #6f6a62; line-height: 1.45; }
    button, .gone {
      appearance: none; border: 1px solid #1c1a17; border-radius: 12px;
      padding: 11px 16px; font: inherit; cursor: pointer; width: 100%;
    }
    button { background: #1c1a17; color: #fffdf8; }
    .gone { background: #f0ebe3; color: #6f6a62; border-color: #ddd6c8; cursor: default; }
    .hint { margin: 14px 0 0; font-size: 0.78rem; }
  </style>
</head>
<body>
  <div class="card">
    <p class="kicker">MailPing</p>
    <h1>${escapeHtml(hasFile ? cv.filename : "CV henüz yok")}</h1>
    <p>${
      hasFile
        ? "Dosyayı indirmek için düğmeye basın. Bu indirme gönderene düşer."
        : "Bağlantı geçerli ama CV henüz yüklenmemiş."
    }</p>
    ${
      hasFile
        ? `<form method="POST" action="/c/${encodeURIComponent(track.id)}/file">
            <button type="submit">PDF indir</button>
          </form>`
        : `<div class="gone">İndirilemez</div>`
    }
    <p class="hint">Önizleme taraması sayılmaz; yalnız bu düğme sayılır.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
