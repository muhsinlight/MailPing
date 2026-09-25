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
  return `<p style="margin:16px 0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5"><a href="${url}" style="color:#0b6e4f">${label}</a></p>`;
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

export function isSmtpConfigured() {
  return Boolean(smtp.user && smtp.pass);
}

export function ownerMailbox() {
  return String(smtp.from || smtp.user || notifyCfg.to || "").trim();
}

export async function sendPanelPassword(to, password) {
  const transport = getSmtpTransporter();
  if (!transport || !to) throw new Error("SMTP yapılandırılmamış (SMTP_USER / SMTP_PASS)");
  await transport.sendMail({
    from: fromHeader(),
    to,
    subject: "MailPing panel şifresi",
    text: [
      "Yeni panel şifren:",
      password,
      "",
      "Eski şifre artık geçmez. Bu mesajı senden başkası istediyse şifreyi yine senin kutuna gönderdik.",
    ].join("\n"),
  });
}

function fromHeader() {
  const email = smtp.from;
  const name = notifyCfg.fromName.replace(/"/g, "");
  return email ? `"${name}" <${email}>` : name;
}

export function createTrackWithPixel({ toEmail, subject, fromEmail, source, includeCv = false }) {
  const id = randomUUID();
  const track = createTrack({
    id,
    toEmail: toEmail.trim(),
    subject: subject?.trim() ?? "",
    fromEmail: fromEmail?.trim() ?? "",
    source: source ?? "api",
  });
  const url = pixelUrl(id);
  const file = includeCv ? getCvMeta() : null;
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
  includeCv = false,
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
    includeCv: Boolean(includeCv),
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

  const recipient = track.to_email || "alıcı";
  const originalSubject = track.subject?.trim() || "(konu yok)";
  const who = String(track.company || recipient).trim();
  const safeWho = escapeHtml(who);
  const safeRecipient = escapeHtml(recipient);
  const safeSubject = escapeHtml(originalSubject);

  await transport.sendMail({
    from: fromHeader(),
    to: notifyTo,
    subject: `${who} maili açtı`,
    text: [
      `${who} maili açtı.`,
      "",
      `Kime: ${recipient}`,
      `Konu: ${originalSubject}`,
    ].join("\n"),
    html: `
      <p><strong>${safeWho}</strong> maili açtı.</p>
      <p style="color:#555;font-size:14px;margin:0">Kime: ${safeRecipient}<br/>Konu: ${safeSubject}</p>
    `.trim(),
  });
}
