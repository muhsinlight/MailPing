const TRACKING_PATH = /^\/(t\/[^/]+\.png|c\/[^/]+(\/file)?)$/;
const LOGIN_ASSETS = new Set(["/login.html", "/login.js", "/login.css", "/panel.css"]);

export function normalizeIp(ip) {
  let value = String(ip || "").trim();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  if (value === "::1") return "127.0.0.1";
  return value;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return normalizeIp(String(forwarded).split(",")[0]);
  }
  return normalizeIp(req.socket.remoteAddress);
}

export function isTrackingPublic(req) {
  const path = req.path || "";
  if (path === "/health") return true;
  if (path === "/api/gmail/callback") return true;
  if (TRACKING_PATH.test(path)) {
    if (path.endsWith("/file")) return req.method === "POST";
    return req.method === "GET";
  }
  return false;
}

export function isLoginPublic(req) {
  const path = req.path || "";
  if (LOGIN_ASSETS.has(path) && req.method === "GET") return true;
  if (path === "/api/login" && req.method === "POST") return true;
  return false;
}

export function securityHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-DNS-Prefetch-Control": "off",
  });
  if (!isTrackingPublic(req)) {
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"
    );
  }
  next();
}

export function ipGate({ allowedIps, trustProxy }) {
  const allow = new Set(allowedIps.map(normalizeIp).filter(Boolean));
  return (req, res, next) => {
    if (isTrackingPublic(req)) return next();
    if (!allow.size) return next();

    const ip = clientIp(req, trustProxy);
    if (allow.has(ip)) return next();

    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ error: "Bu IP'den panele izin yok" });
    }
    res
      .status(403)
      .type("html")
      .send(
        `<!DOCTYPE html><meta charset="utf-8"><title>Kapalı</title><p>Bu IP'den panele izin yok (${ip}).</p>`
      );
  };
}

export function rateLimit({ windowMs, max, keyFn }) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, n: 0 };
      buckets.set(key, bucket);
    }
    bucket.n += 1;
    if (bucket.n > max) {
      return res.status(429).json({ error: "Çok fazla deneme, biraz bekleyin" });
    }
    if (buckets.size > 2000) {
      for (const [id, item] of buckets) {
        if (now - item.start > windowMs) buckets.delete(id);
      }
    }
    next();
  };
}
