const PAGE = 24;

const state = {
  tracks: [],
  cv: null,
  gmail: null,
  filter: "apps",
  status: "",
  query: "",
  openId: null,
  detail: null,
  stats: null,
  total: 0,
  hasMore: true,
  loading: false,
};

const $ = (id) => document.getElementById(id);

async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const res = await fetch(url, { credentials: "same-origin", ...opts, headers });
  if (res.status === 401) {
    location.replace("/login.html");
    throw new Error("Giriş gerekli");
  }
  if (res.status === 403) {
    throw new Error("Bu IP'den panele izin yok");
  }
  return res;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeAgo(iso) {
  if (!iso) return "—";
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return "az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} gün önce`;
  return new Date(iso).toLocaleString("tr-TR");
}

function formatBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

function renderStats() {
  const s = state.stats || { opened: 0, waiting: 0, cv: 0, total: 0 };
  $("statOpen").querySelector("b").textContent = s.opened;
  $("statWait").querySelector("b").textContent = s.waiting;
  $("statCv").querySelector("b").textContent = s.cv;
  $("statAll").querySelector("b").textContent = s.total;
}

function renderCv() {
  const cv = state.cv;
  $("cvName").textContent = cv?.filename || "Yüklenmedi";
  $("cvHint").textContent = cv
    ? `${formatBytes(cv.size)} · yeni maillere link eklenir`
    : "PDF yükle, sonraki maillere indirme linki eklenir.";
  $("cvPreview").hidden = !cv;
  $("cvRemove").hidden = !cv;
}

function statusPills(t) {
  const mail = t.read
    ? `<span class="pill ok">Mail açıldı · ${t.open_count}</span>`
    : t.tracked === false
      ? `<span class="pill">Takip yok</span>`
      : `<span class="pill">Mail bakılmadı</span>`;
  const cv = t.cvDownloaded
    ? `<span class="pill cv">CV indirildi · ${t.cv_download_count}</span>`
    : t.tracked === false
      ? `<span class="pill">CV takip yok</span>`
      : `<span class="pill">CV bekliyor</span>`;
  return mail + cv;
}

function renderGmail() {
  const g = state.gmail;
  if (!g) return;
  const connected = g.oauthConnected || g.imapReady;
  $("gmailTitle").textContent = g.email || (connected ? "Hazır" : "Bağlı değil");
  $("gmailHint").textContent = g.lastSyncAt
    ? `Son çekme: ${new Date(g.lastSyncAt).toLocaleString("tr-TR")} · ${g.lastImported || 0} yeni`
    : connected
      ? "Gönderilenleri çek. Eski mailler listelenir; açıldı takibi yalnız bundan sonra eklenenlerde olur."
      : "Google Cloud OAuth veya Gmail uygulama şifresi (.env SMTP) gerekir.";
  $("gmailOAuth").hidden = !g.oauthConfigured;
  $("gmailSync").hidden = !(g.oauthConnected || g.imapReady);
  $("gmailDisconnect").hidden = !g.oauthConnected;
}

function browserLabel(ua) {
  const s = String(ua || "");
  if (!s) return "";
  if (/GoogleImageProxy|ggpht\.com|Google-Firebase/i.test(s)) return "Gmail görsel proxy";
  if (/Outlook|Microsoft Office/i.test(s)) return "Outlook";
  if (/Thunderbird/i.test(s)) return "Thunderbird";
  if (/Edg\//.test(s)) return "Edge";
  if (/Chrome\//.test(s) && /Safari\//.test(s)) return "Chrome";
  if (/Firefox\//.test(s)) return "Firefox";
  if (/Safari\//.test(s)) return "Safari";
  return s.length > 72 ? `${s.slice(0, 72)}…` : s;
}

function cardHtml(t) {
  const when = t.last_open_at || t.last_cv_download_at || t.created_at;
  const company = String(t.company || "").trim();
  const who = company || t.to_email;
  const sub = company
    ? `${t.to_email} · ${t.subject || "(konu yok)"}`
    : `${t.subject || "(konu yok)"} · ${t.topicLabel || t.source || "api"}`;
  return `
    <button class="row" type="button" data-id="${escapeHtml(t.id)}">
      <div class="head">
        <div>
          <div class="who">${escapeHtml(who)}${t.topicLabel ? `<span class="tag">${escapeHtml(t.topicLabel)}</span>` : ""}</div>
          <div class="sub">${escapeHtml(sub)}</div>
        </div>
        <div class="when">${timeAgo(when)}</div>
      </div>
      <div class="pills">${statusPills(t)}</div>
    </button>`;
}

function sentinelVisible() {
  const more = $("more");
  if (!more || more.hidden) return false;
  return more.getBoundingClientRect().top <= window.innerHeight + 120;
}

function renderFooter() {
  const more = $("more");
  if (!state.tracks.length) {
    more.hidden = true;
    return;
  }
  more.hidden = false;
  more.textContent = state.hasMore
    ? `${state.tracks.length} / ${state.total} · devamını yükle`
    : `${state.tracks.length} / ${state.total}`;
}

function renderList() {
  const root = $("list");
  if (!state.tracks.length) {
    root.innerHTML = `<div class="empty">${state.loading ? "Yükleniyor…" : "Bu filtrede kayıt yok."}</div>`;
    renderFooter();
    return;
  }
  root.innerHTML = state.tracks.map(cardHtml).join("");
  renderFooter();
}

function eventHtml(e) {
  const label = e.type === "cv" ? "CV indirildi" : "Mail açıldı";
  const client = browserLabel(e.userAgent);
  const proxy = client === "Gmail görsel proxy";
  const bits = [new Date(e.at).toLocaleString("tr-TR")];
  if (client) bits.push(client);
  if (e.ip) bits.push(e.ip);
  const note = proxy
    ? `<small>IP Gmail sunucusuna ait; alıcının kendi adresi değil.</small>`
    : "";
  return `<li><strong>${label}</strong><small>${bits.map(escapeHtml).join(" · ")}</small>${note}</li>`;
}

function renderDrawer() {
  const t = state.detail;
  const box = $("drawerBody");
  if (!t) {
    box.innerHTML = "";
    return;
  }
  const company = String(t.company || "").trim();
  const events = t.events?.length
    ? t.events.map(eventHtml).join("")
    : t.tracked === false
      ? `<li><strong>Takip yok</strong><small>Bu mail piksel eklenmeden gitmiş. Açılma sayısı tutulmaz.</small></li>`
      : `<li><strong>Henüz hareket yok</strong><small>Mail açılınca veya CV inince saat, tarayıcı ve IP burada durur.</small></li>`;

  box.innerHTML = `
    <h2>${escapeHtml(company || t.to_email)}</h2>
    <p class="sub">${escapeHtml(company ? `${t.to_email} · ${t.subject || "(konu yok)"}` : t.subject || "(konu yok)")}</p>
    <div class="pills">${statusPills(t)}</div>
    <div class="copy">
      <button class="btn" type="button" data-copy="${escapeHtml(t.cvUrl)}">CV linki</button>
      <button class="btn" type="button" data-copy="${escapeHtml(t.pixelUrl)}">Piksel URL</button>
    </div>
    <div class="meta-grid">
      <div><span>Gönderildi</span><b>${new Date(t.created_at).toLocaleString("tr-TR")}</b></div>
      <div><span>İlk mail</span><b>${t.first_open_at ? new Date(t.first_open_at).toLocaleString("tr-TR") : "—"}</b></div>
      <div><span>Son mail</span><b>${t.last_open_at ? new Date(t.last_open_at).toLocaleString("tr-TR") : "—"}</b></div>
      <div><span>İlk CV</span><b>${t.cv_first_download_at ? new Date(t.cv_first_download_at).toLocaleString("tr-TR") : "—"}</b></div>
      <div><span>Açılma</span><b>${t.open_count || 0}</b></div>
      <div><span>CV indirme</span><b>${t.cv_download_count || 0}</b></div>
      <div><span>Kaynak</span><b>${escapeHtml(t.source || "—")}</b></div>
    </div>
    <h3>Hareketler</h3>
    <ol class="timeline">${events}</ol>
  `;
}

function syncBackdrop() {
  $("backdrop").hidden = $("drawer").hidden && $("cvSheet").hidden && $("composeSheet").hidden;
}

function setDrawer(open) {
  $("drawer").hidden = !open;
  $("drawer").setAttribute("aria-hidden", open ? "false" : "true");
  syncBackdrop();
}

function setCompose(open) {
  const sheet = $("composeSheet");
  sheet.hidden = !open;
  sheet.setAttribute("aria-hidden", open ? "false" : "true");
  syncBackdrop();
}

function setPreview(open) {
  const sheet = $("cvSheet");
  const frame = $("cvFrame");
  sheet.hidden = !open;
  sheet.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    $("cvSheetTitle").textContent = state.cv?.filename || "CV";
    frame.src = `/api/cv/file?inline=1&t=${Date.now()}`;
  } else {
    frame.removeAttribute("src");
  }
  syncBackdrop();
}

async function loadDetail(id) {
  state.openId = id;
  const res = await api(`/api/tracks/${id}`);
  if (!res.ok) return;
  state.detail = await res.json();
  renderDrawer();
  setDrawer(true);
}

async function loadPage({ reset = false } = {}) {
  if (state.loading) return;
  if (!reset && !state.hasMore) return;
  state.loading = true;
  if (reset) {
    state.tracks = [];
    state.hasMore = true;
    renderList();
  }
  let added = 0;
  const params = new URLSearchParams({
    paged: "1",
    limit: String(PAGE),
    offset: String(reset ? 0 : state.tracks.length),
    kind: state.filter,
    status: state.status,
    q: state.query,
  });
  try {
    const res = await api(`/api/tracks?${params}`);
    if (!res.ok) throw new Error("Liste alınamadı");
    const data = await res.json();
    state.stats = data.stats;
    state.total = data.total;
    if (reset) {
      state.tracks = data.items;
      added = data.items.length;
    } else {
      const seen = new Set(state.tracks.map((t) => t.id));
      const fresh = data.items.filter((t) => !seen.has(t.id));
      state.tracks.push(...fresh);
      added = fresh.length;
    }
    state.hasMore = data.hasMore;
    renderStats();
    renderList();
  } finally {
    state.loading = false;
    renderFooter();
  }
  if (added > 0 && state.hasMore && sentinelVisible()) {
    loadPage().catch(() => {});
  }
}

function signalText(signal) {
  const title = signal.type === "cv" ? "CV indirildi" : "Mail açıldı";
  const who = signal.toEmail || "Alıcı";
  const subject = signal.subject || "(konu yok)";
  return { title, body: `${who} · ${subject}` };
}

function liveOn() {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

function renderPulse() {
  const el = $("pulse");
  if (!el) return;
  el.textContent = liveOn() ? "Sinyal açık" : "Canlı";
  el.title = liveOn()
    ? "Masaüstü bildirimi açık (Windows / Mac)"
    : "Tıkla: mail açılınca veya CV inince bildirim düşsün";
}

async function enableLiveSignal() {
  if (typeof Notification === "undefined") {
    toast("Bu tarayıcı bildirim desteklemiyor");
    return;
  }
  const perm = await Notification.requestPermission();
  renderPulse();
  toast(perm === "granted" ? "Sinyal açık — masaüstüne düşer" : "Bildirim izni verilmedi");
}

async function checkSignals() {
  const after = localStorage.getItem("lastSignalAt") || "";
  const res = await api(`/api/signals?after=${encodeURIComponent(after || new Date().toISOString())}`);
  if (!res.ok) return;
  const data = await res.json();
  if (after && data.signals?.length) {
    for (const signal of data.signals.slice(-3)) {
      const { title, body } = signalText(signal);
      toast(`${title}: ${body}`);
      if (liveOn()) {
        try {
          new Notification(title, { body, tag: `${signal.type}-${signal.trackId}` });
        } catch {
          /* izin yok */
        }
      }
    }
  }
  if (data.now) localStorage.setItem("lastSignalAt", data.now);
}

async function refreshMeta() {
  await checkSignals().catch(() => {});
  const [cvRes, gmailRes] = await Promise.all([api("/api/cv"), api("/api/gmail/status")]);
  if (cvRes.ok) state.cv = (await cvRes.json()).cv;
  if (gmailRes.ok) state.gmail = await gmailRes.json();
  renderCv();
  renderGmail();
  if (state.openId) {
    const res = await api(`/api/tracks/${state.openId}`);
    if (res.ok) {
      state.detail = await res.json();
      renderDrawer();
    }
  }
  const params = new URLSearchParams({
    paged: "1",
    limit: String(PAGE),
    offset: "0",
    kind: state.filter,
    status: state.status,
    q: state.query,
  });
  const res = await api(`/api/tracks?${params}`);
  if (!res.ok) return;
  const data = await res.json();
  state.stats = data.stats;
  state.total = data.total;
  state.hasMore = state.tracks.length < data.total;
  const fresh = new Map(data.items.map((t) => [t.id, t]));
  state.tracks = state.tracks.map((t) => fresh.get(t.id) || t);
  const have = new Set(state.tracks.map((t) => t.id));
  const newcomers = data.items.filter((t) => !have.has(t.id));
  if (newcomers.length) state.tracks = [...newcomers, ...state.tracks];
  renderStats();
  renderList();
}

function applyFilters() {
  state.filter = $("kind").value;
  state.status = $("status").value;
  loadPage({ reset: true }).catch(() => toast("Liste alınamadı"));
}

$("kind").addEventListener("change", applyFilters);
$("status").addEventListener("change", applyFilters);

let searchTimer;
$("search").addEventListener("input", (e) => {
  state.query = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadPage({ reset: true }).catch(() => toast("Liste alınamadı"));
  }, 250);
});

const moreEl = $("more");
moreEl.addEventListener("click", () => {
  if (state.hasMore) loadPage().catch(() => toast("Liste alınamadı"));
});
window.addEventListener("scroll", () => {
  if (sentinelVisible()) loadPage().catch(() => {});
}, { passive: true });

$("list").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (row) loadDetail(row.dataset.id).catch(() => toast("Detay alınamadı"));
});

$("closeDrawer").addEventListener("click", () => {
  state.openId = null;
  state.detail = null;
  setDrawer(false);
});
$("backdrop").addEventListener("click", () => {
  if (!$("composeSheet").hidden) setCompose(false);
  if (!$("cvSheet").hidden) setPreview(false);
  if (!$("drawer").hidden) $("closeDrawer").click();
});
$("closePreview").addEventListener("click", () => setPreview(false));

$("drawer").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    toast("Kopyalandı");
  } catch {
    toast("Kopyalanamadı");
  }
});

$("cvFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    toast("Sadece PDF");
    return;
  }
  const res = await api("/api/cv", {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
      "X-Filename": encodeURIComponent(file.name),
    },
    body: await file.arrayBuffer(),
  });
  if (!res.ok) {
    toast("CV yüklenemedi");
    return;
  }
  state.cv = (await res.json()).cv;
  renderCv();
  toast("CV kaydedildi");
});

$("cvPreview").addEventListener("click", () => setPreview(true));

$("openCompose").addEventListener("click", () => setCompose(true));
$("closeCompose").addEventListener("click", () => setCompose(false));

function parseRecipients(raw) {
  return [...new Set(
    String(raw || "")
      .split(/[\s,;]+/)
      .map((part) => part.trim().toLowerCase())
      .filter((part) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part))
  )];
}

$("composeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button[type=submit]");
  const recipients = parseRecipients($("composeTo").value);
  if (!recipients.length) {
    toast("Geçerli bir e-posta yaz");
    return;
  }
  const subject = $("composeSubject").value.trim();
  const text = $("composeBody").value.trim();
  button.disabled = true;
  const failed = [];
  try {
    for (const toEmail of recipients) {
      const res = await api("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail, subject, text, source: "panel" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        failed.push(`${toEmail}: ${data.error || "gönderilemedi"}`);
      }
    }
    if (failed.length === recipients.length) {
      toast(failed[0]);
      return;
    }
    toast(failed.length ? `${recipients.length - failed.length} gitti, ${failed.length} kaldı` : "Gönderildi");
    setCompose(false);
    e.target.reset();
    await loadPage({ reset: true });
  } catch (err) {
    toast(err.message || "Gönderilemedi");
  } finally {
    button.disabled = false;
  }
});

$("cvRemove").addEventListener("click", async () => {
  if (!confirm("Aktif CV kaldırılsın mı?")) return;
  await api("/api/cv", { method: "DELETE" });
  state.cv = null;
  renderCv();
  toast("CV kaldırıldı");
});

$("gmailSync").addEventListener("click", async () => {
  $("gmailSync").disabled = true;
  $("gmailHint").textContent = "Gmail çekiliyor…";
  try {
    const res = await api("/api/gmail/sync", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Çekilemedi");
    state.gmail = data;
    renderGmail();
    await loadPage({ reset: true });
    await refreshMeta();
    toast(`${data.imported} yeni mail geldi`);
  } catch (err) {
    toast(err.message || "Gmail çekilemedi");
    renderGmail();
  } finally {
    $("gmailSync").disabled = false;
  }
});

$("gmailDisconnect").addEventListener("click", async () => {
  await api("/api/gmail/disconnect", { method: "POST" });
  await refreshMeta();
  toast("Gmail koptu");
});

const gmailQs = new URLSearchParams(location.search);
if (gmailQs.get("gmail") === "ok") toast("Gmail bağlandı");
if (gmailQs.get("gmail") === "error") toast(gmailQs.get("m") || "Gmail bağlanamadı");

$("pulse").addEventListener("click", () => enableLiveSignal());
renderPulse();

$("copyToken").addEventListener("click", async () => {
  try {
    const res = await api("/api/auth");
    const data = await res.json();
    await navigator.clipboard.writeText(data.apiToken || "");
    toast("Eklenti token kopyalandı");
  } catch {
    toast("Token alınamadı");
  }
});

$("logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.replace("/login.html");
});

Promise.all([loadPage({ reset: true }), refreshMeta()]).catch(() => {
  $("list").innerHTML = `<div class="empty">Sunucuya bağlanılamadı.</div>`;
});
setInterval(() => refreshMeta().catch(() => {}), 8000);
