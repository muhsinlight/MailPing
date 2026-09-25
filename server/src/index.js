import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { classifyMail } from "./classify.js";
import {
  ALLOWED_IPS,
  BIND_HOST,
  PORT,
  PUBLIC_BASE_URL,
  TRUST_PROXY,
  cvUrl,
  isGoogleOAuthReady,
  pixelUrl,
} from "./config.js";
import {
  getTrack,
  listSignalsSince,
  listTrackEvents,
  listTracks,
  queryTracks,
  recordCvDownload,
  recordOpen,
  trackStats,
} from "./db.js";
import {
  beginOAuth,
  disconnectGmail,
  finishOAuth,
  gmailStatus,
  syncGmailApi,
  syncGmailImap,
} from "./gmail.js";
import { createTrackWithPixel, sendTrackedEmail, sendReadNotification } from "./email.js";
import { TRANSPARENT_PNG } from "./pixel.js";
import {
  contentDisposition,
  getCvMeta,
  isPdfBuffer,
  readCv,
  removeCv,
  renderCvLanding,
  saveCv,
} from "./cv.js";
import {
  authGate,
  clearSessionCookie,
  createSessionCookie,
  credentialsInfo,
  verifyPassword,
} from "./auth.js";
import { clientIp, ipGate, rateLimit, securityHeaders } from "./security.js";

const app = express();
app.disable("x-powered-by");
if (TRUST_PROXY) app.set("trust proxy", 1);

app.use(securityHeaders);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(ipGate({ allowedIps: ALLOWED_IPS, trustProxy: TRUST_PROXY }));
app.use(authGate);

function toPublicTrack(track, extra = {}) {
  const kind = classifyMail(track);
  return {
    ...track,
    read: Boolean(track.first_open_at),
    cvDownloaded: Boolean(track.cv_first_download_at),
    tracked: track.has_pixel !== 0,
    topic: kind.topic,
    topicLabel: kind.label,
    application: kind.application,
    pixelUrl: pixelUrl(track.id),
    cvUrl: cvUrl(track.id),
    ...extra,
  };
}

function requireToEmail(req, res) {
  const toEmail = req.body?.toEmail;
  if (!toEmail || typeof toEmail !== "string") {
    res.status(400).json({ error: "toEmail gerekli" });
    return null;
  }
  return req.body;
}

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyFn: (req) => clientIp(req, TRUST_PROXY),
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/login", loginLimit, (req, res) => {
  if (!verifyPassword(req.body?.password)) {
    return res.status(401).json({ error: "Şifre yanlış" });
  }
  res.setHeader("Set-Cookie", createSessionCookie());
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

app.get("/api/auth", (_req, res) => {
  const info = credentialsInfo();
  res.json({ ok: true, apiToken: info.apiToken });
});

app.get("/api/cv", (_req, res) => {
  res.json({ cv: getCvMeta() });
});

app.get("/api/cv/file", (_req, res) => {
  const file = readCv();
  if (!file) return res.status(404).json({ error: "CV yüklenmemiş" });
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDisposition(file.filename),
    "Cache-Control": "no-store",
  });
  res.send(file.buffer);
});

app.put(
  "/api/cv",
  express.raw({
    type: (req) => {
      const t = req.headers["content-type"] || "";
      return t.includes("pdf") || t.includes("octet-stream");
    },
    limit: "12mb",
  }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: "Dosya boş" });
    }
    if (!isPdfBuffer(req.body)) {
      return res.status(400).json({ error: "Sadece PDF kabul edilir" });
    }
    const filename = req.headers["x-filename"] || "cv.pdf";
    res.json({ cv: saveCv(req.body, filename) });
  }
);

app.delete("/api/cv", (_req, res) => {
  removeCv();
  res.json({ cv: null });
});

app.post("/api/tracks", (req, res) => {
  const body = requireToEmail(req, res);
  if (!body) return;
  const { track, pixelHtml, cvHtml, cvUrl: downloadUrl } = createTrackWithPixel({
    toEmail: body.toEmail,
    subject: body.subject,
    fromEmail: body.fromEmail,
    source: body.source ?? "api",
  });
  res.status(201).json(toPublicTrack(track, { pixelHtml, cvHtml, cvUrl: downloadUrl }));
});

app.post("/api/send", async (req, res) => {
  try {
    const body = requireToEmail(req, res);
    if (!body) return;
    const { track } = await sendTrackedEmail({
      toEmail: body.toEmail,
      subject: body.subject,
      text: body.text,
      html: body.html,
      fromEmail: body.fromEmail,
      source: body.source ?? "smtp",
    });
    res.status(201).json(toPublicTrack(track, { sent: true }));
  } catch (err) {
    res.status(500).json({ error: err.message || "Gönderilemedi" });
  }
});

app.get("/api/gmail/status", (_req, res) => {
  res.json(gmailStatus());
});

app.get("/api/gmail/connect", (_req, res) => {
  if (!isGoogleOAuthReady()) {
    return res.status(400).send("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET .env içinde yok.");
  }
  res.redirect(beginOAuth());
});

app.get("/api/gmail/callback", async (req, res) => {
  try {
    await finishOAuth(String(req.query.code || ""), String(req.query.state || ""));
    const result = await syncGmailApi();
    res.redirect(`/?gmail=ok&n=${result.imported}`);
  } catch (err) {
    res.redirect(`/?gmail=error&m=${encodeURIComponent(err.message)}`);
  }
});

app.post("/api/gmail/sync", async (_req, res) => {
  try {
    const status = gmailStatus();
    const result = status.oauthConnected ? await syncGmailApi() : await syncGmailImap();
    res.json({ ...result, ...gmailStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message || "Gmail çekilemedi" });
  }
});

app.post("/api/gmail/disconnect", (_req, res) => {
  disconnectGmail();
  res.json(gmailStatus());
});

app.get("/api/signals", (req, res) => {
  const after = String(req.query.after || "");
  res.json({ now: new Date().toISOString(), signals: listSignalsSince(after) });
});

app.get("/api/tracks", (req, res) => {
  if (req.query.paged === "1" || req.query.offset !== undefined) {
    const page = queryTracks({
      limit: req.query.limit,
      offset: req.query.offset,
      filter: req.query.kind || req.query.filter,
      status: req.query.status,
      query: req.query.q,
    });
    return res.json({
      items: page.items.map((t) => toPublicTrack(t)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      stats: trackStats(),
    });
  }
  res.json(listTracks().map((t) => toPublicTrack(t)));
});

app.get("/api/tracks/:id", (req, res) => {
  const track = getTrack(req.params.id);
  if (!track) return res.status(404).json({ error: "Bulunamadı" });
  res.json(toPublicTrack(track, { events: listTrackEvents(track.id) }));
});

app.get("/t/:id.png", (req, res) => {
  const id = req.params.id.replace(/\.png$/, "");
  const track = getTrack(id);
  if (track) {
    const result = recordOpen(id, {
      ip: clientIp(req, TRUST_PROXY),
      userAgent: req.headers["user-agent"],
    });
    if (result?.isFirstOpen) {
      sendReadNotification(result.track).catch((err) => {
        console.error("[MailTracker] Okundu bildirimi gönderilemedi:", err.message);
      });
    }
  }
  res.set({
    "Content-Type": "image/png",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
  });
  res.send(TRANSPARENT_PNG);
});

app.get("/c/:id", (req, res) => {
  const track = getTrack(req.params.id);
  if (!track) return res.status(404).send("Bağlantı geçersiz.");
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.send(renderCvLanding({ track, cv: getCvMeta() }));
});

app.post("/c/:id/file", (req, res) => {
  const track = getTrack(req.params.id);
  const file = readCv();
  if (!track) return res.status(404).send("Bağlantı geçersiz.");
  if (!file) return res.status(404).send("CV henüz yüklenmemiş.");

  recordCvDownload(track.id, {
    ip: clientIp(req, TRUST_PROXY),
    userAgent: req.headers["user-agent"],
  });

  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDisposition(file.filename),
    "Cache-Control": "no-store",
  });
  res.send(file.buffer);
});

app.use(
  express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public"), {
    etag: false,
    setHeaders(res) {
      res.set("Cache-Control", "no-store");
    },
  })
);

app.listen(PORT, BIND_HOST, () => {
  const info = credentialsInfo();
  console.log(`MailPing sunucu: http://localhost:${PORT}`);
  console.log(`Pixel base URL (PUBLIC_BASE_URL): ${PUBLIC_BASE_URL}`);
  console.log("Kilit: panel şifresi + eklenti API token (piksel/CV linki açık)");
  if (ALLOWED_IPS.length) console.log(`IP kapısı: ${ALLOWED_IPS.join(", ")}`);
  else console.log("IP kapısı: kapalı (ALLOWED_IPS boş — herkes login sayfasını görür)");
  if (info.generated.length) {
    console.log(`İlk kurulum kimliği yazıldı: ${info.secretsPath}`);
    console.log("Panel şifresi ve eklenti token'ı bu dosyada. VPS'te .env'e taşımanız daha iyi.");
  }
  if (PUBLIC_BASE_URL.includes("localhost")) {
    console.warn(
      "UYARI: Okundu takibi için PUBLIC_BASE_URL internetten erişilebilir olmalı (VPS, ngrok, Cloudflare Tunnel)."
    );
  }
});
