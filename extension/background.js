const DEFAULT_SERVER = "http://localhost:3847";

async function getSettings() {
  const { serverUrl, apiToken } = await chrome.storage.sync.get({
    serverUrl: DEFAULT_SERVER,
    apiToken: "",
  });
  return {
    serverUrl: (serverUrl || DEFAULT_SERVER).replace(/\/$/, ""),
    apiToken: String(apiToken || "").trim(),
  };
}

async function getServerUrl() {
  return (await getSettings()).serverUrl;
}

async function apiFetch(path, opts = {}) {
  const { serverUrl, apiToken } = await getSettings();
  const headers = { ...(opts.headers || {}) };
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;
  const res = await fetch(`${serverUrl}${path}`, { ...opts, headers });
  if (res.status === 401) {
    throw new Error("API token yanlış veya eksik — eklenti ayarlarına yapıştırın");
  }
  if (res.status === 403) {
    throw new Error("Bu IP'den panele izin yok (ALLOWED_IPS)");
  }
  return res;
}

async function createTrack({ toEmail, subject, fromEmail, source }) {
  const res = await apiFetch("/api/tracks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toEmail, subject, fromEmail, source }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || "Track oluşturulamadı");
  }
  return res.json();
}

async function getTrackStatus(trackId) {
  try {
    const res = await apiFetch(`/api/tracks/${trackId}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function signalTitle(signal) {
  return signal.type === "cv" ? "CV indirildi" : "Mail açıldı";
}

function signalMessage(signal) {
  const who = signal.toEmail || "Alıcı";
  const subject = signal.subject || "(konu yok)";
  return `${who} · ${subject}`;
}

async function notifySignals(signals) {
  for (const signal of signals.slice(-5)) {
    await chrome.notifications.create(`mp-${signal.type}-${signal.trackId}-${signal.at}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: signalTitle(signal),
      message: signalMessage(signal).slice(0, 180),
      priority: 2,
    });
  }
}

async function pollSignals() {
  const { lastSignalAt } = await chrome.storage.local.get({ lastSignalAt: "" });
  const after = lastSignalAt || new Date().toISOString();
  try {
    const res = await apiFetch(`/api/signals?after=${encodeURIComponent(after)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (lastSignalAt && data.signals?.length) await notifySignals(data.signals);
    await chrome.storage.local.set({ lastSignalAt: data.now || new Date().toISOString() });
  } catch {
    /* sunucu kapalı veya kilit */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("mailping-signals", { periodInMinutes: 1 });
  pollSignals();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("mailping-signals", { periodInMinutes: 1 });
  pollSignals();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "mailping-signals") pollSignals();
});
chrome.alarms.create("mailping-signals", { periodInMinutes: 1 });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CREATE_TRACK") {
    createTrack(msg.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "GET_TRACK") {
    getTrackStatus(msg.trackId)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "GET_SERVER") {
    getServerUrl().then((url) => sendResponse({ url }));
    return true;
  }
});
