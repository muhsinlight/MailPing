import fs from "fs";
import path from "path";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { fileURLToPath } from "url";
import { PUBLIC_BASE_URL } from "./config.js";
import { isLoginPublic, isTrackingPublic } from "./security.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const secretsPath = path.join(dataDir, "secrets.json");
const COOKIE = "mp";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function readSecretsFile() {
  try {
    return JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  } catch {
    return {};
  }
}

function writeSecretsFile(data) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(secretsPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export function loadCredentials() {
  const file = readSecretsFile();
  const generated = [];
  const next = { ...file };

  if (!(process.env.AUTH_SECRET || next.authSecret)) {
    next.authSecret = randomBytes(32).toString("hex");
    generated.push("authSecret");
  }
  if (!(process.env.PANEL_PASSWORD || next.panelPassword)) {
    next.panelPassword = randomBytes(12).toString("base64url");
    generated.push("panelPassword");
  }
  if (!(process.env.API_TOKEN || next.apiToken)) {
    next.apiToken = randomBytes(32).toString("hex");
    generated.push("apiToken");
  }

  if (generated.length) writeSecretsFile(next);
  else if (!fs.existsSync(secretsPath) && !process.env.AUTH_SECRET) {
    writeSecretsFile({ authSecret: next.authSecret });
  }

  return {
    authSecret: process.env.AUTH_SECRET || next.authSecret,
    panelPassword: process.env.PANEL_PASSWORD || next.panelPassword,
    apiToken: process.env.API_TOKEN || next.apiToken,
    generated,
    secretsPath,
  };
}

const creds = loadCredentials();

function hmac(value) {
  return createHmac("sha256", creds.authSecret).update(String(value)).digest();
}

function secretEquals(left, right) {
  return timingSafeEqual(hmac(left || ""), hmac(right || ""));
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function readBearer(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  return String(req.headers["x-api-token"] || "").trim();
}

function verifySession(raw) {
  const [payload, sig] = String(raw || "").split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", creds.authSecret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: PUBLIC_BASE_URL.startsWith("https://"),
    path: "/",
    maxAge: SESSION_MS,
  };
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path}`);
  parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function createSessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString("base64url");
  const sig = createHmac("sha256", creds.authSecret).update(payload).digest("base64url");
  return serializeCookie(COOKIE, `${payload}.${sig}`, cookieOptions());
}

export function clearSessionCookie() {
  return serializeCookie(COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

export function isAuthenticated(req) {
  const bearer = readBearer(req);
  if (bearer && secretEquals(bearer, creds.apiToken)) return "token";
  if (verifySession(parseCookies(req)[COOKIE])) return "session";
  return null;
}

export function verifyPassword(password) {
  return secretEquals(String(password || ""), creds.panelPassword);
}

export function authGate(req, res, next) {
  if (isTrackingPublic(req) || isLoginPublic(req)) return next();
  const via = isAuthenticated(req);
  if (via) {
    req.authVia = via;
    return next();
  }
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Giriş gerekli" });
  }
  if (req.method === "GET") return res.redirect("/login.html");
  return res.status(401).json({ error: "Giriş gerekli" });
}

export function credentialsInfo() {
  return {
    apiToken: creds.apiToken,
    secretsPath: creds.secretsPath,
    generated: creds.generated,
    fromEnv: {
      password: Boolean(process.env.PANEL_PASSWORD),
      token: Boolean(process.env.API_TOKEN),
    },
  };
}
