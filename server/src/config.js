import "dotenv/config";

export const PORT = Number(process.env.PORT) || 3847;
export const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(
  /\/$/,
  ""
);
export const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");
export const ALLOWED_IPS = (process.env.ALLOWED_IPS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const smtp = {
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || process.env.SMTP_USER,
  fromName: process.env.MAIL_FROM_NAME || "",
};

const watchRaw = process.env.NOTIFY_WATCH_RECIPIENTS;
export const notify = {
  enabled: process.env.NOTIFY_ON_READ !== "false",
  to: process.env.NOTIFY_TO,
  fromName: process.env.NOTIFY_FROM_NAME || "MailPing",
  /** null = tüm alıcılar */
  watch:
    !watchRaw || watchRaw.trim() === "*" || watchRaw.trim().toLowerCase() === "all"
      ? null
      : watchRaw
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
};

export function pixelUrl(id) {
  return `${PUBLIC_BASE_URL}/t/${id}.png`;
}

export function cvUrl(id) {
  return `${PUBLIC_BASE_URL}/c/${id}`;
}

export const google = {
  clientId: process.env.GOOGLE_CLIENT_ID || "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  redirectUri: (process.env.GOOGLE_REDIRECT_URI || `${PUBLIC_BASE_URL}/api/gmail/callback`).replace(
    /\/$/,
    ""
  ),
};

export function isGmailImapReady() {
  return Boolean(smtp.user && smtp.pass && /gmail\.com$/i.test(smtp.user));
}

export function isGoogleOAuthReady() {
  return Boolean(google.clientId && google.clientSecret);
}
