import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { companyFromEmail, statusFilter, topicFilter } from "./classify.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "tracks.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    to_email TEXT NOT NULL,
    subject TEXT,
    from_email TEXT,
    created_at TEXT NOT NULL,
    first_open_at TEXT,
    open_count INTEGER NOT NULL DEFAULT 0,
    last_open_at TEXT,
    last_open_ip TEXT,
    last_open_ua TEXT,
    source TEXT NOT NULL DEFAULT 'api'
  );

  CREATE TABLE IF NOT EXISTS open_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    FOREIGN KEY (track_id) REFERENCES tracks(id)
  );

  CREATE TABLE IF NOT EXISTS cv_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL,
    downloaded_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    FOREIGN KEY (track_id) REFERENCES tracks(id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function ensureColumn(table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn("tracks", "source", "source TEXT NOT NULL DEFAULT 'api'");
ensureColumn("tracks", "cv_first_download_at", "cv_first_download_at TEXT");
ensureColumn("tracks", "cv_download_count", "cv_download_count INTEGER NOT NULL DEFAULT 0");
ensureColumn("tracks", "last_cv_download_at", "last_cv_download_at TEXT");
ensureColumn("tracks", "last_cv_download_ip", "last_cv_download_ip TEXT");
ensureColumn("tracks", "last_cv_download_ua", "last_cv_download_ua TEXT");
ensureColumn("tracks", "gmail_id", "gmail_id TEXT");
ensureColumn("tracks", "has_pixel", "has_pixel INTEGER NOT NULL DEFAULT 1");
ensureColumn("tracks", "company", "company TEXT");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS tracks_gmail_id ON tracks(gmail_id) WHERE gmail_id IS NOT NULL"
);

{
  const setCompany = db.prepare("UPDATE tracks SET company = ? WHERE id = ?");
  const fillCompany = db.transaction(() => {
    for (const row of db.prepare("SELECT id, to_email FROM tracks").all()) {
      setCompany.run(companyFromEmail(row.to_email), row.id);
    }
  });
  fillCompany();
}

const sql = {
  insert: db.prepare(`
    INSERT INTO tracks (id, to_email, subject, from_email, created_at, source, company)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  get: db.prepare("SELECT * FROM tracks WHERE id = ?"),
  list: db.prepare("SELECT * FROM tracks ORDER BY created_at DESC LIMIT ?"),
  insertEvent: db.prepare(
    "INSERT INTO open_events (track_id, opened_at, ip, user_agent) VALUES (?, ?, ?, ?)"
  ),
  updateOpen: db.prepare(`
    UPDATE tracks SET
      first_open_at = ?,
      open_count = open_count + 1,
      last_open_at = ?,
      last_open_ip = ?,
      last_open_ua = ?
    WHERE id = ?
  `),
  insertCvEvent: db.prepare(
    "INSERT INTO cv_events (track_id, downloaded_at, ip, user_agent) VALUES (?, ?, ?, ?)"
  ),
  updateCv: db.prepare(`
    UPDATE tracks SET
      cv_first_download_at = ?,
      cv_download_count = cv_download_count + 1,
      last_cv_download_at = ?,
      last_cv_download_ip = ?,
      last_cv_download_ua = ?
    WHERE id = ?
  `),
  listOpens: db.prepare(
    "SELECT opened_at AS at, ip, user_agent FROM open_events WHERE track_id = ? ORDER BY opened_at ASC"
  ),
  listCvs: db.prepare(
    "SELECT downloaded_at AS at, ip, user_agent FROM cv_events WHERE track_id = ? ORDER BY downloaded_at ASC"
  ),
  signalsOpen: db.prepare(`
    SELECT e.opened_at AS at, e.track_id AS trackId, t.to_email AS toEmail, t.subject
    FROM open_events e
    JOIN tracks t ON t.id = e.track_id
    WHERE e.opened_at > ?
    ORDER BY e.opened_at ASC
    LIMIT 30
  `),
  signalsCv: db.prepare(`
    SELECT e.downloaded_at AS at, e.track_id AS trackId, t.to_email AS toEmail, t.subject
    FROM cv_events e
    JOIN tracks t ON t.id = e.track_id
    WHERE e.downloaded_at > ?
    ORDER BY e.downloaded_at ASC
    LIMIT 30
  `),
  getSetting: db.prepare("SELECT value FROM app_settings WHERE key = ?"),
  setSetting: db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
  deleteSetting: db.prepare("DELETE FROM app_settings WHERE key = ?"),
  getByGmailId: db.prepare("SELECT * FROM tracks WHERE gmail_id = ?"),
  insertImported: db.prepare(`
    INSERT INTO tracks (id, to_email, subject, from_email, created_at, source, gmail_id, has_pixel, company)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `),
};

export function getSetting(key) {
  return sql.getSetting.get(key)?.value ?? null;
}

export function setSetting(key, value) {
  sql.setSetting.run(key, value);
}

export function deleteSetting(key) {
  sql.deleteSetting.run(key);
}

export function importMail({ id, toEmail, subject, fromEmail, createdAt, source, gmailId }) {
  if (gmailId) {
    const existing = sql.getByGmailId.get(gmailId);
    if (existing) return { track: existing, created: false };
  }
  const to = toEmail || "(alıcı yok)";
  sql.insertImported.run(
    id,
    to,
    subject ?? "",
    fromEmail ?? "",
    createdAt || new Date().toISOString(),
    source ?? "gmail",
    gmailId ?? null,
    companyFromEmail(to)
  );
  return { track: sql.get.get(id), created: true };
}

export function createTrack({ id, toEmail, subject, fromEmail, source }) {
  sql.insert.run(
    id,
    toEmail,
    subject ?? "",
    fromEmail ?? "",
    new Date().toISOString(),
    source ?? "api",
    companyFromEmail(toEmail)
  );
  return sql.get.get(id);
}

export function getTrack(id) {
  return sql.get.get(id);
}

export function listTracks(limit = 300) {
  return sql.list.all(limit);
}

function filterClause(kind, status, query) {
  const where = [];
  const params = [];
  const topic = topicFilter(kind);
  if (topic) {
    where.push(topic.sql);
    params.push(...topic.params);
  }
  const statusSql = statusFilter(status);
  if (statusSql) where.push(statusSql);
  const q = String(query || "").trim();
  if (q) {
    where.push("(to_email LIKE ? OR subject LIKE ? OR source LIKE ? OR company LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  return {
    where: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export function queryTracks({ limit = 24, offset = 0, filter = "all", status = "", query = "" } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 80);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const { where, params } = filterClause(filter, status, query);
  const items = db
    .prepare(`SELECT * FROM tracks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, safeLimit, safeOffset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM tracks ${where}`).get(...params).n;
  return {
    items,
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + items.length < total,
  };
}

export function trackStats() {
  const row = db
    .prepare(
      `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN first_open_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
      SUM(CASE WHEN cv_first_download_at IS NOT NULL THEN 1 ELSE 0 END) AS cv
    FROM tracks
  `
    )
    .get();
  const total = row.total || 0;
  const opened = row.opened || 0;
  return { total, opened, waiting: total - opened, cv: row.cv || 0 };
}

const recordOpenTx = db.transaction((trackId, ip, userAgent) => {
  const track = sql.get.get(trackId);
  if (!track) return null;

  const now = new Date().toISOString();
  const isFirstOpen = !track.first_open_at;

  sql.insertEvent.run(trackId, now, ip ?? null, userAgent ?? null);
  sql.updateOpen.run(track.first_open_at ?? now, now, ip ?? null, userAgent ?? null, trackId);

  return { track: sql.get.get(trackId), isFirstOpen };
});

export function recordOpen(trackId, { ip, userAgent } = {}) {
  return recordOpenTx(trackId, ip, userAgent);
}

const recordCvTx = db.transaction((trackId, ip, userAgent) => {
  const track = sql.get.get(trackId);
  if (!track) return null;

  const now = new Date().toISOString();
  const isFirstDownload = !track.cv_first_download_at;

  sql.insertCvEvent.run(trackId, now, ip ?? null, userAgent ?? null);
  sql.updateCv.run(track.cv_first_download_at ?? now, now, ip ?? null, userAgent ?? null, trackId);

  return { track: sql.get.get(trackId), isFirstDownload };
});

export function recordCvDownload(trackId, { ip, userAgent } = {}) {
  return recordCvTx(trackId, ip, userAgent);
}

export function listSignalsSince(afterIso) {
  const after = afterIso || "1970-01-01T00:00:00.000Z";
  const opens = sql.signalsOpen.all(after).map((row) => ({
    type: "open",
    at: row.at,
    trackId: row.trackId,
    toEmail: row.toEmail,
    subject: row.subject || "",
  }));
  const cvs = sql.signalsCv.all(after).map((row) => ({
    type: "cv",
    at: row.at,
    trackId: row.trackId,
    toEmail: row.toEmail,
    subject: row.subject || "",
  }));
  return [...opens, ...cvs].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function listTrackEvents(trackId) {
  const opens = sql.listOpens.all(trackId).map((row) => ({
    type: "open",
    at: row.at,
    ip: row.ip,
    userAgent: row.user_agent,
  }));
  const cvs = sql.listCvs.all(trackId).map((row) => ({
    type: "cv",
    at: row.at,
    ip: row.ip,
    userAgent: row.user_agent,
  }));
  return [...opens, ...cvs].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
