import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import { createTrack } from "./db.js";
import { cvUrl, pixelUrl, smtp, notify as notifyCfg } from "./config.js";
import { getCvMeta } from "./cv.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPixelHtml(url) {
  return `<img src="${url}" width="1" height="1" alt="" style="display:none!important;opacity:0!important;border:0!important;" />`;
}

function appendHtml(html, snippet) {
  if (!snippet) return html || "";
  const trimmed = (html || "").trim();
  if (!trimmed) return snippet;
  if (/<\/body>/i.test(trimmed)) {
    return trimmed.replace(/<\/body>/i, `${snippet}</body>`);
  }
  return `${trimmed}${snippet}`;
}

function buildCvHtml(url, fileName) {
  const label = escapeHtml(fileName || "PDF");
  return `<p style="margin:16px 0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">
  <strong>CV:</strong>
  <a href="${url}" style="color:#0b6e4f">${label} görüntüle / indir</a>
</p>`;
}

let transporter;

function getSmtpTransporter() {
  if (transporter) return transporter;
  if (!smtp.user || !smtp.pass) return null;
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: false,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  return transporter;
}

function isSmtpConfigured() {
  return Boolean(smtp.user && smtp.pass);
}

function fromHeader() {
  const email = smtp.from;
  const name = notifyCfg.fromName.replace(/"/g, "");
  return email ? `"${name}" <${email}>` : name;
}

export function createTrackWithPixel({ toEmail, subject, fromEmail, source }) {
  const id = randomUUID();
  const track = createTrack({
    id,
    toEmail: toEmail.trim(),
    subject: subject?.trim() ?? "",
    fromEmail: fromEmail?.trim() ?? "",
    source: source ?? "api",
  });
  const url = pixelUrl(id);
  const file = getCvMeta();
  const downloadUrl = cvUrl(id);
  return {
    track,
    pixelUrl: url,
    pixelHtml: buildPixelHtml(url),
    cvUrl: downloadUrl,
    cvHtml: file ? buildCvHtml(downloadUrl, file.filename) : null,
  };
}

export async function sendTrackedEmail({
  toEmail,
  subject,
  text,
  html,
  fromEmail,
  source,
}) {
  if (!isSmtpConfigured()) {
    throw new Error("SMTP yapılandırılmamış (SMTP_USER / SMTP_PASS)");
  }

  const from = String(fromEmail || smtp.from || "").replace(/[\r\n]+/g, " ").trim();
  const { track, pixelHtml, pixelUrl: url, cvHtml } = createTrackWithPixel({
    toEmail,
    subject,
    fromEmail: from,
    source: source ?? "smtp",
  });

  const body = appendHtml(appendHtml(html || `<p>${escapeHtml(text || "")}</p>`, cvHtml), pixelHtml);

  await getSmtpTransporter().sendMail({
    from,
    to: toEmail,
    subject: subject || "(no subject)",
    text: text || " ",
    html: body,
  });

  return { track, pixelUrl: url };
}

function shouldNotify(track) {
  if (!notifyCfg.enabled || !track || !getSmtpTransporter()) return false;
  const to = (track.to_email || "").trim().toLowerCase();
  if (notifyCfg.watch === null) return true;
  return notifyCfg.watch.includes(to);
}

export async function sendReadNotification(track) {
  if (!shouldNotify(track)) return;

  const transport = getSmtpTransporter();
  const notifyTo = notifyCfg.to || smtp.from || smtp.user;
  if (!transport || !notifyTo) return;

  const recipient = track.to_email || "unknown";
  const originalSubject = track.subject?.trim() || "(no subject)";
  const safeRecipient = escapeHtml(recipient);
  const safeSubject = escapeHtml(originalSubject);

  await transport.sendMail({
    from: fromHeader(),
    to: notifyTo,
    subject: `${recipient} has just read ${originalSubject} - Your email was opened for the first time!`,
    text: [
      `${recipient} has just read ${originalSubject}`,
      "",
      "Your email was opened for the first time!",
      "",
      `To: ${recipient}`,
      `Subject: ${originalSubject}`,
    ].join("\n"),
    html: `
      <p><strong>${safeRecipient}</strong> has just read <strong>${safeSubject}</strong></p>
      <p>Your email was opened for the first time!</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
      <p style="color:#555;font-size:14px;margin:0">To: ${safeRecipient}<br/>Subject: ${safeSubject}</p>
    `.trim(),
  });
}
