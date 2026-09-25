const TRACKING_PATH = /^\/(t\/[^/]+\.png|c\/[^/]+(\/file)?)$/;
const LOGIN_ASSETS = new Set([
  "/login.html",
  "/login.js",
  "/login.css",
  "/panel.css",
  "/logo.svg",
  "/logo.png",
]);

export function normalizeIp(ip) {
  let value = String(ip || "").trim();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  if (value === "::1") return "127.0.0.1";
  return value;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const cf = req.headers["cf-connecting-ip"];
    if (cf) return normalizeIp(String(cf).split(",")[0]);
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
  if (path === "/api/recover" && req.method === "POST") return true;
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
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'"
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

export function createAttemptGuard({
  maxFailures = 5,
  lockMs = 15 * 60 * 1000,
  delays = [1000, 2000, 4000, 8000],
} = {}) {
  const buckets = new Map();
  const tails = new Map();

  function state(key, now) {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { failures: 0, lockedUntil: 0 };
      buckets.set(key, bucket);
    }
    if (bucket.lockedUntil && now >= bucket.lockedUntil) {
      bucket.failures = 0;
      bucket.lockedUntil = 0;
    }
    return bucket;
  }

  function status(key, now = Date.now()) {
    const bucket = state(key, now);
    if (bucket.lockedUntil > now) {
      return { locked: true, retryAfter: Math.ceil((bucket.lockedUntil - now) / 1000) };
    }
    return { locked: false, retryAfter: 0 };
  }

  function fail(key, now = Date.now()) {
    const bucket = state(key, now);
    if (bucket.lockedUntil > now) {
      return {
        locked: true,
        retryAfter: Math.ceil((bucket.lockedUntil - now) / 1000),
        delayMs: 0,
      };
    }
    const delayMs = delays[Math.min(bucket.failures, delays.length - 1)] ?? 1000;
    bucket.failures += 1;
    if (bucket.failures >= maxFailures) {
      bucket.lockedUntil = now + lockMs;
      return { locked: true, retryAfter: Math.ceil(lockMs / 1000), delayMs };
    }
    return { locked: false, retryAfter: 0, delayMs };
  }

  function ok(key) {
    buckets.delete(key);
  }

  function run(key, fn) {
    const prev = tails.get(key) || Promise.resolve();
    const runP = prev.then(() => fn());
    const tracked = runP.then(
      () => {},
      () => {}
    );
    tails.set(key, tracked);
    tracked.finally(() => {
      if (tails.get(key) === tracked) tails.delete(key);
    });
    return runP;
  }

  return { status, fail, ok, run };
}
