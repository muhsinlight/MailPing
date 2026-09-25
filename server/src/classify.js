const TOPICS = {
  ik: {
    label: "İK / HR",
    email: [
      "ik@",
      "hr@",
      "humanresources",
      "human-resources",
      "human_resources",
      "isealim@",
      "ise-alim",
      "recruit",
      "talent@",
      "jobs@",
      "hiring@",
      "people@",
    ],
    subject: [
      "insan kaynak",
      "human resource",
      "recruiter",
      "işe alım",
      "ise alim",
      "işe alim",
    ],
  },
  staj: {
    label: "Staj",
    email: ["staj@", "intern@", "internship@"],
    subject: ["staj", "intern", "internship", "stajyer"],
  },
  kariyer: {
    label: "Kariyer",
    email: ["kariyer@", "career@", "careers@"],
    subject: ["kariyer", "career", "iş fırsat", "is firsat", "iş imkan", "job opportunit"],
  },
  basvuru: {
    label: "Başvuru",
    email: [],
    subject: [
      "başvuru",
      "basvuru",
      "application",
      "pozisyon",
      "ilanı",
      "ilan ",
      "junior",
      "developer",
      "backend",
      "frontend",
      "yazılım",
      "yazilim",
      "mülakat",
      "mulakat",
      "interview",
      "cv incele",
      "özgeçmiş",
      "ozgecmis",
      "iş başv",
      "is basv",
    ],
  },
};

const COMPANY_INBOX = [
  "info@",
  "iletisim@",
  "iletişim@",
  "contact@",
  "hello@",
  "office@",
  "destek@",
  "support@",
  "kurumsal@",
  "asistan@",
  "team@",
  "admin@",
  "merhaba@",
];

const CONSUMER_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "yandex.com",
  "yandex.ru",
];

const NOISE = {
  email: [
    "unsubscribe",
    "noreply",
    "no-reply",
    "mailer-daemon",
    "telegram.org",
    "emsgrid.com",
    "mlsend.com",
  ],
  subject: [
    "wave",
    "verify email",
    "unsubscribe",
    "new event created",
    "smtp test",
    "aramıza hoş",
    "aramiza hos",
    "ödeme onay",
    "odeme onay",
    "newsletter",
    "telegram",
    "fotokopi",
    "test message",
    "pixel-hide",
    "refactor-check",
  ],
};

function haystack(track) {
  return `${track.to_email || ""} ${track.subject || ""} ${track.from_email || ""}`.toLowerCase();
}

function hits(text, terms) {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function isConsumerInbox(email) {
  const e = String(email || "").toLowerCase();
  return CONSUMER_DOMAINS.some((d) => e.endsWith(`@${d}`) || e.includes(`@${d}`));
}

export function isCompanyTarget(email) {
  const e = String(email || "").toLowerCase();
  if (!e.includes("@")) return false;
  if (isConsumerInbox(e)) return false;
  return true;
}

function topicOf(track) {
  const text = haystack(track);
  const email = String(track.to_email || "").toLowerCase();
  for (const [id, bucket] of Object.entries(TOPICS)) {
    if (hits(email, bucket.email) || hits(text, bucket.subject)) return id;
  }
  if (hits(email, COMPANY_INBOX) || isCompanyTarget(email)) return "sirket";
  return "other";
}

function isNoise(track) {
  const text = haystack(track);
  const email = String(track.to_email || "").toLowerCase();
  return hits(email, NOISE.email) || hits(text, NOISE.subject);
}

export function classifyMail(track) {
  const topic = topicOf(track);
  if (topic !== "other") {
    const label = topic === "sirket" ? "Şirket" : TOPICS[topic].label;
    return { topic, label, application: true };
  }
  return { topic: "other", label: "Diğer", application: false };
}

function likeGroup(columns, terms) {
  const clauses = [];
  const params = [];
  for (const term of terms) {
    const like = `%${term.toLowerCase()}%`;
    clauses.push(`(${columns.map((c) => `lower(${c}) LIKE ?`).join(" OR ")})`);
    for (let i = 0; i < columns.length; i += 1) params.push(like);
  }
  return {
    sql: clauses.length ? `(${clauses.join(" OR ")})` : "0",
    params,
  };
}

function bucketSql(id) {
  const bucket = TOPICS[id];
  if (!bucket) return { sql: "0", params: [] };
  const email = likeGroup(["to_email"], bucket.email);
  const subject = likeGroup(["to_email", "subject"], bucket.subject);
  const parts = [];
  const params = [];
  if (bucket.email.length) {
    parts.push(email.sql);
    params.push(...email.params);
  }
  if (bucket.subject.length) {
    parts.push(subject.sql);
    params.push(...subject.params);
  }
  return { sql: parts.length ? `(${parts.join(" OR ")})` : "0", params };
}

function keywordSql() {
  const parts = [];
  const params = [];
  for (const id of Object.keys(TOPICS)) {
    const piece = bucketSql(id);
    parts.push(piece.sql);
    params.push(...piece.params);
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}

function companySql() {
  const inbox = likeGroup(["to_email"], COMPANY_INBOX);
  const consumer = CONSUMER_DOMAINS.map(() => `lower(to_email) NOT LIKE ?`);
  const domain = {
    sql: `(instr(to_email, '@') > 0 AND ${consumer.join(" AND ")})`,
    params: CONSUMER_DOMAINS.map((d) => `%@${d}%`),
  };
  return {
    sql: `(${inbox.sql} OR ${domain.sql})`,
    params: [...inbox.params, ...domain.params],
  };
}

function noiseSql() {
  return likeGroup(["to_email", "subject"], [...NOISE.email, ...NOISE.subject]);
}

function applicationSql() {
  const keys = keywordSql();
  const company = companySql();
  const noise = noiseSql();
  return {
    sql: `((${keys.sql} OR ${company.sql}) AND NOT ${noise.sql})`,
    params: [...keys.params, ...company.params, ...noise.params],
  };
}

export function topicFilter(kind) {
  if (kind === "apps") return applicationSql();
  if (kind === "sirket") {
    const company = companySql();
    const noise = noiseSql();
    return {
      sql: `(${company.sql} AND NOT ${noise.sql})`,
      params: [...company.params, ...noise.params],
    };
  }
  if (kind === "ik" || kind === "staj" || kind === "kariyer" || kind === "basvuru") {
    return bucketSql(kind);
  }
  if (kind === "other") {
    const apps = applicationSql();
    return { sql: `(NOT ${apps.sql})`, params: apps.params };
  }
  return null;
}

export function statusFilter(status) {
  if (status === "opened") return "first_open_at IS NOT NULL";
  if (status === "waiting") return "first_open_at IS NULL";
  if (status === "cv") return "cv_first_download_at IS NOT NULL";
  return null;
}
