import { randomUUID } from "crypto";
import { ImapFlow } from "imapflow";
import {
  google,
  isGmailImapReady,
  isGoogleOAuthReady,
  smtp,
} from "./config.js";
import { deleteSetting, getSetting, importMail, setSetting } from "./db.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function addresses(list) {
  if (!list?.length) return "";
  return list.map((a) => a.address || a.email).filter(Boolean).join(", ");
}

function headerMap(payload) {
  const map = {};
  for (const h of payload?.headers || []) map[h.name.toLowerCase()] = h.value;
  return map;
}

export function gmailStatus() {
  const tokens = getSetting("gmail_tokens");
  return {
    oauthConfigured: isGoogleOAuthReady(),
    oauthConnected: Boolean(tokens),
    imapReady: isGmailImapReady(),
    email: getSetting("gmail_email") || (isGmailImapReady() ? smtp.user : null),
    lastSyncAt: getSetting("gmail_synced_at"),
    lastImported: Number(getSetting("gmail_last_imported") || 0),
  };
}

export function authUrl(state) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", google.clientId);
  url.searchParams.set("redirect_uri", google.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export function beginOAuth() {
  const state = randomUUID();
  setSetting("gmail_oauth_state", state);
  return authUrl(state);
}

async function tokenRequest(body) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Google token alınamadı");
  return data;
}

function persistTokens(data, previous = {}) {
  const merged = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || previous.refresh_token,
    expiry: Date.now() + Number(data.expires_in || 3500) * 1000,
  };
  setSetting("gmail_tokens", JSON.stringify(merged));
  return merged;
}

export async function finishOAuth(code, state) {
  if (!state || state !== getSetting("gmail_oauth_state")) {
    throw new Error("OAuth state uyuşmadı");
  }
  deleteSetting("gmail_oauth_state");
  const data = await tokenRequest({
    code,
    client_id: google.clientId,
    client_secret: google.clientSecret,
    redirect_uri: google.redirectUri,
    grant_type: "authorization_code",
  });
  persistTokens(data);
  const me = await googleGet("https://www.googleapis.com/oauth2/v2/userinfo");
  if (me.email) setSetting("gmail_email", me.email);
  return me.email;
}

async function accessToken() {
  const raw = getSetting("gmail_tokens");
  if (!raw) throw new Error("Gmail bağlı değil");
  const tokens = JSON.parse(raw);
  if (tokens.expiry && Date.now() < tokens.expiry - 30_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("Gmail oturumu düşmüş, yeniden bağlayın");
  const data = await tokenRequest({
    refresh_token: tokens.refresh_token,
    client_id: google.clientId,
    client_secret: google.clientSecret,
    grant_type: "refresh_token",
  });
  return persistTokens(data, tokens).access_token;
}

async function googleGet(url, token) {
  const access = token || (await accessToken());
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gmail API hatası");
  return data;
}

function saveImported({ gmailId, toEmail, subject, fromEmail, createdAt, source }) {
  return importMail({
    id: `g_${gmailId}`.slice(0, 80),
    gmailId,
    toEmail,
    subject,
    fromEmail,
    createdAt,
    source,
  });
}

export async function syncGmailApi({ query = "in:sent", source = "gmail", limit = 120 } = {}) {
  const token = await accessToken();
  const list = await googleGet(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
    token
  );
  const ids = (list.messages || []).map((m) => m.id);
  let imported = 0;

  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8);
    const messages = await Promise.all(
      chunk.map((id) =>
        googleGet(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          token
        )
      )
    );
    for (const msg of messages) {
      const h = headerMap(msg.payload);
      const to = (h.to || "").replace(/.*<([^>]+)>.*/, "$1").trim() || h.to || "(alıcı yok)";
      const from = (h.from || "").replace(/.*<([^>]+)>.*/, "$1").trim();
      const createdAt = h.date ? new Date(h.date).toISOString() : new Date().toISOString();
      const result = saveImported({
        gmailId: msg.id,
        toEmail: to,
        subject: h.subject || "",
        fromEmail: from,
        createdAt,
        source,
      });
      if (result.created) imported += 1;
    }
  }

  setSetting("gmail_synced_at", new Date().toISOString());
  setSetting("gmail_last_imported", String(imported));
  return { imported, scanned: ids.length };
}

export async function syncGmailImap({ limit = 150 } = {}) {
  if (!isGmailImapReady()) {
    throw new Error("IMAP için .env içinde Gmail SMTP_USER / SMTP_PASS gerekli");
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: smtp.user, pass: smtp.pass.replace(/\s+/g, "") },
    logger: false,
  });

  await client.connect();
  try {
    const boxes = await client.list();
    const sent =
      boxes.find((b) => b.specialUse === "\\Sent") ||
      boxes.find((b) => /sent|gönder/i.test(b.path || b.name || ""));
    if (!sent) throw new Error("Gönderilmiş kutusu bulunamadı (Gmail IMAP açık mı?)");

    const lock = await client.getMailboxLock(sent.path);
    try {
      const exists = client.mailbox.exists || 0;
      if (!exists) {
        setSetting("gmail_email", smtp.user);
        setSetting("gmail_synced_at", new Date().toISOString());
        setSetting("gmail_last_imported", "0");
        return { imported: 0, scanned: 0 };
      }
      const start = Math.max(1, exists - limit + 1);
      let imported = 0;
      let scanned = 0;
      for await (const msg of client.fetch(`${start}:*`, { envelope: true, uid: true })) {
        scanned += 1;
        const env = msg.envelope || {};
        const gmailId = env.messageId || `imap-${msg.uid}`;
        const result = saveImported({
          gmailId,
          toEmail: addresses(env.to) || "(alıcı yok)",
          subject: env.subject || "",
          fromEmail: addresses(env.from),
          createdAt: env.date ? new Date(env.date).toISOString() : new Date().toISOString(),
          source: "gmail",
        });
        if (result.created) imported += 1;
      }
      setSetting("gmail_email", smtp.user);
      setSetting("gmail_synced_at", new Date().toISOString());
      setSetting("gmail_last_imported", String(imported));
      return { imported, scanned };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

export function disconnectGmail() {
  deleteSetting("gmail_tokens");
  deleteSetting("gmail_email");
  deleteSetting("gmail_oauth_state");
}
