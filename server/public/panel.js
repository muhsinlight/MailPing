const PAGE = 40;
const SETUP_KEY = "mailping-setup-later";
const RULE_KEY = "mailping-compose-rule-seen";
const PRODUCT_KEY = "mailping-product-rule-seen";
const CV_BLOCK_MSG =
  "CV veya özgeçmiş içeren mailleri Gmail (veya kullandığın posta) üzerinden gönder. MailPing yalnızca takip / hatırlatma için.";

const state = {
  tracks: [],
  gmail: null,
  filter: "all",
  status: "",
  query: "",
  openId: null,
  detail: null,
  stats: null,
  total: 0,
  hasMore: false,
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
  return new Date(iso).toLocaleDateString("tr-TR");
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

function liveOn() {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

function gmailReady() {
  const g = state.gmail;
  return Boolean(g && (g.oauthConnected || g.imapReady));
}

function mentionsCv(subject, body) {
  const text = `${subject || ""}\n${body || ""}`.toLowerCase();
  if (/\bcv\b/.test(text) || /(^|[^\w])cv['\u2019]/.test(text)) return true;
  if (/özgeçmiş|özgecmis|resume|curriculum\s*vitae/.test(text)) return true;
  return false;
}

function updateComposeCvWarn() {
  const warn = $("composeCvWarn");
  if (!warn || $("composeSheet").hidden) return;
  const hit = mentionsCv($("composeSubject").value, $("composeBody").value);
  warn.hidden = !hit;
  warn.textContent = hit ? CV_BLOCK_MSG : "";
}

function daysSince(iso) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function stageOf(t) {
  if (t.cvDownloaded) return { key: "cv", label: `CV indi · ${t.cv_download_count || 0}` };
  if (t.tracked === false) return { key: "none", label: "Takip yok" };
  if (t.read) return { key: "ok", label: `Açtı · ${t.open_count || 0}` };
  return { key: "wait", label: "Sessiz" };
}

function followHint(t) {
  if (t.cvDownloaded || t.tracked === false) return "";
  const days = daysSince(t.created_at);
  if (days >= 3) return `${days} gün`;
  return "";
}

function renderWeek() {
  const s = state.stats || {};
  $("weekLine").textContent = `Bu hafta ${s.weekOpened || 0} açıldı · ${s.inboxSilent || 0} sessiz`;
}

function renderSegments() {
  const s = state.stats || {};
  const counts = {
    "": s.total || 0,
    silent: s.silent || 0,
    opened: s.opened || 0,
    cv: s.cv || 0,
    untracked: s.untracked || 0,
  };
  for (const button of $("segments").querySelectorAll("button")) {
    const on = button.dataset.status === state.status;
    button.classList.toggle("on", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
    const count = button.querySelector("b");
    if (count) count.textContent = String(counts[button.dataset.status] ?? 0);
  }
}

function renderKinds() {
  for (const button of $("kinds").querySelectorAll("button")) {
    button.classList.toggle("on", button.dataset.kind === state.filter);
  }
}

function renderSetup() {
  const g = state.gmail;
  const connected = gmailReady();
  $("stepGmail").classList.toggle("done", connected);
  $("stepLive").classList.toggle("done", liveOn());
  $("setupDone").disabled = !connected;
  $("setupTitle").textContent = connected && liveOn() ? "Takip hazır" : connected ? "Gmail bağlı" : "Takip hazır değil";

  if (!g) return;
  $("gmailHint").textContent = g.email
    ? `${g.email}${g.lastSyncAt ? ` · son çekme ${new Date(g.lastSyncAt).toLocaleString("tr-TR")}` : ""}`
    : connected
      ? "Gönderilenleri çek. Eski mailler listelenir."
      : "Google hesabı veya Gmail uygulama şifresi gerekir.";
  $("gmailOAuth").hidden = !g.oauthConfigured || g.oauthConnected;
  $("gmailSync").hidden = !connected;
  $("gmailDisconnect").hidden = !g.oauthConnected;
  $("enableLive").textContent = liveOn() ? "Bildirim açık" : "Bildirimi aç";
}

function browserLabel(ua) {
  const s = String(ua || "");
  if (!s) return "";
  if (/GoogleImageProxy|ggpht\.com|Google-Firebase/i.test(s)) return "Gmail";
  if (/Outlook|Microsoft Office/i.test(s)) return "Outlook";
  if (/Thunderbird/i.test(s)) return "Thunderbird";
  if (/Edg\//.test(s)) return "Edge";
  if (/Chrome\//.test(s) && /Safari\//.test(s)) return "Chrome";
  if (/Firefox\//.test(s)) return "Firefox";
  if (/Safari\//.test(s)) return "Safari";
  return "";
}

function rowHtml(t) {
  const company = String(t.company || "").trim();
  const who = company || t.to_email;
  const stage = stageOf(t);
  const hint = followHint(t);
  const selected = state.openId === t.id ? " is-on" : "";
  const pillClass = stage.key === "ok" || stage.key === "cv" ? stage.key : "";
  return `
    <button class="row${selected}" type="button" data-id="${escapeHtml(t.id)}">
      <span class="who">${escapeHtml(who)}</span>
      <span class="sub">${escapeHtml(t.subject || "(konu yok)")}</span>
      <span class="when">${timeAgo(t.created_at)}</span>
      <span class="stage">
        ${hint ? `<span class="age">${escapeHtml(hint)}</span>` : ""}
        <span class="pill ${pillClass}">${escapeHtml(stage.label)}</span>
      </span>
    </button>`;
}

function emptyCopy() {
  if (state.loading && !state.tracks.length) return "Yükleniyor…";
  if (!state.query && state.filter === "all" && !state.status && !state.total) {
    return "Henüz başvuru yok. Gmail’den başvuru at ve kurulumdan gönderilenleri çek.";
  }
  return "Bu aşamada kayıt yok.";
}

function renderList() {
  const root = $("list");
  if (!state.tracks.length) {
    root.innerHTML = `<div class="empty">${emptyCopy()}</div>`;
  } else {
    root.innerHTML = state.tracks.map(rowHtml).join("");
  }
  $("more").hidden = !state.hasMore;
  if (state.hasMore) {
    requestAnimationFrame(() => {
      const box = $("more").getBoundingClientRect();
      const rootBox = $("main").getBoundingClientRect();
      if (box.top < rootBox.bottom + 80) {
        loadPage({ append: true }).catch(() => toast("Liste alınamadı"));
      }
    });
  }
}

function eventHtml(e) {
  const label = e.type === "cv" ? "CV indirildi" : "Açıldı";
  const bits = [new Date(e.at).toLocaleString("tr-TR")];
  const client = browserLabel(e.userAgent);
  if (client) bits.push(client);
  return `<li><strong>${label}</strong><small>${bits.map(escapeHtml).join(" · ")}</small></li>`;
}

function renderDetail() {
  const t = state.detail;
  const box = $("detailBody");
  $("detail").dataset.open = t ? "true" : "false";
  if (!t) {
    box.innerHTML = `<p class="empty-detail">Bir başvuru seç.</p>`;
    return;
  }
  const company = String(t.company || "").trim();
  const stage = stageOf(t);
  const pillClass = stage.key === "ok" || stage.key === "cv" ? stage.key : "";
  const sent = `<li><strong>Gönderildi</strong><small>${escapeHtml(new Date(t.created_at).toLocaleString("tr-TR"))}</small></li>`;
  const events = t.events?.length
    ? t.events.map(eventHtml).join("")
    : t.tracked === false
      ? `<li><strong>Takip yok</strong><small>Bu mail piksel eklenmeden gitmiş.</small></li>`
      : `<li><strong>Hareket yok</strong><small>Takip maili açılınca burada görünür.</small></li>`;
  box.innerHTML = `
    <h2>${escapeHtml(company || t.to_email)}</h2>
    <p class="mail">${escapeHtml(t.to_email)}</p>
    <p class="sub">${escapeHtml(t.subject || "(konu yok)")}</p>
    <span class="pill ${pillClass}">${escapeHtml(stage.label)}</span>
    <div class="detail-actions">
      <button class="btn solid" type="button" data-follow="1">Takip maili yaz</button>
    </div>
    <ol class="timeline">${sent}${events}</ol>
  `;
}

function syncBackdrop() {
  $("backdrop").hidden = $("setupSheet").hidden && $("composeSheet").hidden;
}

function setSheet(id, open) {
  const sheet = $(id);
  sheet.hidden = !open;
  sheet.setAttribute("aria-hidden", open ? "false" : "true");
  syncBackdrop();
}

function closeDetail() {
  state.openId = null;
  state.detail = null;
  renderDetail();
  renderList();
}

async function loadDetail(id) {
  state.openId = id;
  renderList();
  const res = await api(`/api/tracks/${id}`);
  if (!res.ok) return;
  state.detail = await res.json();
  renderDetail();
}

async function loadPage({ reset = false, append = false, refresh = false } = {}) {
  if (state.loading) {
    state.pending = reset ? "reset" : state.pending;
    return;
  }
  state.loading = true;
  if (reset) {
    state.tracks = [];
    state.hasMore = false;
    renderList();
  }
  const offset = append ? state.tracks.length : 0;
  const limit = refresh ? Math.max(PAGE, state.tracks.length || PAGE) : PAGE;
  const params = new URLSearchParams({
    paged: "1",
    limit: String(limit),
    offset: String(refresh ? 0 : offset),
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
    state.hasMore = Boolean(data.hasMore);
    state.tracks = append ? state.tracks.concat(data.items) : data.items;
    renderWeek();
    renderSegments();
    renderKinds();
    renderList();
  } finally {
    state.loading = false;
  }
  if (state.pending === "reset") {
    state.pending = null;
    return loadPage({ reset: true });
  }
}

function signalText(signal) {
  const title = signal.type === "cv" ? "CV indirildi" : "Mail açıldı";
  const who = signal.toEmail || "Alıcı";
  const subject = signal.subject || "(konu yok)";
  return { title, body: `${who} · ${subject}` };
}

async function enableLiveSignal() {
  if (typeof Notification === "undefined") {
    toast("Bu tarayıcı bildirim desteklemiyor");
    return;
  }
  const perm = await Notification.requestPermission();
  renderSetup();
  toast(perm === "granted" ? "Bildirim açık" : "Bildirim izni verilmedi");
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

function maybeOpenSetup() {
  if (!gmailReady() && localStorage.getItem(SETUP_KEY) !== "1") setSheet("setupSheet", true);
}

function openComposeSheet() {
  setSheet("composeSheet", true);
  updateComposeCvWarn();
  if (!localStorage.getItem(RULE_KEY)) {
    localStorage.setItem(RULE_KEY, "1");
    toast("CV’li mail Gmail’den; buradan yalnız takip hatırlatması.");
  }
}

async function refreshMeta() {
  await checkSignals().catch(() => {});
  const gmailRes = await api("/api/gmail/status");
  if (gmailRes.ok) state.gmail = await gmailRes.json();
  renderSetup();
  if (state.openId) {
    const res = await api(`/api/tracks/${state.openId}`);
    if (res.ok) {
      state.detail = await res.json();
      renderDetail();
    }
  }
  await loadPage({ refresh: true });
}

function openFollow(track) {
  $("composeForm").reset();
  openComposeSheet();
  if (!track) return;
  $("composeTo").value = track.to_email || "";
  const subject = String(track.subject || "").trim();
  $("composeSubject").value = subject ? `Takip: ${subject}` : "Takip";
  $("composeBody").value =
    "Merhaba,\n\nGönderdiğim başvuruyu hatırlatmak istedim. Uygun olduğunuzda dönüşünüzü beklerim.\n\nİyi çalışmalar.";
  updateComposeCvWarn();
}

$("segments").addEventListener("click", (e) => {
  const button = e.target.closest("[data-status]");
  if (!button) return;
  state.status = button.dataset.status;
  loadPage({ reset: true }).catch(() => toast("Liste alınamadı"));
});

$("kinds").addEventListener("click", (e) => {
  const button = e.target.closest("[data-kind]");
  if (!button) return;
  state.filter = button.dataset.kind;
  loadPage({ reset: true }).catch(() => toast("Liste alınamadı"));
});

let searchTimer;
$("search").addEventListener("input", (e) => {
  state.query = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadPage({ reset: true }).catch(() => toast("Liste alınamadı"));
  }, 250);
});

$("list").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (row) loadDetail(row.dataset.id).catch(() => toast("Detay alınamadı"));
});

$("closeDetail").addEventListener("click", closeDetail);

$("detail").addEventListener("click", (e) => {
  if (e.target.closest("[data-follow]")) openFollow(state.detail);
});

$("followTop").addEventListener("click", () => openFollow(state.detail));
$("openCompose").addEventListener("click", () => {
  $("composeForm").reset();
  openComposeSheet();
});
$("composeSubject").addEventListener("input", updateComposeCvWarn);
$("composeBody").addEventListener("input", updateComposeCvWarn);
$("closeCompose").addEventListener("click", () => setSheet("composeSheet", false));

$("navInbox").addEventListener("click", () => {
  closeDetail();
  $("main").scrollTo({ top: 0 });
});

$("openSetup").addEventListener("click", () => setSheet("setupSheet", true));
$("closeSetup").addEventListener("click", () => setSheet("setupSheet", false));
$("setupLater").addEventListener("click", () => {
  localStorage.setItem(SETUP_KEY, "1");
  setSheet("setupSheet", false);
});
$("setupDone").addEventListener("click", () => {
  localStorage.setItem(SETUP_KEY, "1");
  setSheet("setupSheet", false);
});

$("backdrop").addEventListener("click", () => {
  setSheet("composeSheet", false);
  setSheet("setupSheet", false);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  setSheet("composeSheet", false);
  setSheet("setupSheet", false);
  if (window.matchMedia("(max-width: 900px)").matches) closeDetail();
});

const moreObserver = new IntersectionObserver((entries) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  if (!state.hasMore || state.loading) return;
  loadPage({ append: true }).catch(() => toast("Liste alınamadı"));
}, { root: $("main"), rootMargin: "120px" });
moreObserver.observe($("more"));

$("gmailSync").addEventListener("click", async () => {
  $("gmailSync").disabled = true;
  $("gmailHint").textContent = "Gmail çekiliyor…";
  try {
    const res = await api("/api/gmail/sync", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Çekilemedi");
    state.gmail = data;
    renderSetup();
    await loadPage({ reset: true });
    toast(`${data.imported} yeni mail geldi`);
  } catch (err) {
    toast(err.message || "Gmail çekilemedi");
    renderSetup();
  } finally {
    $("gmailSync").disabled = false;
  }
});

$("gmailDisconnect").addEventListener("click", async () => {
  await api("/api/gmail/disconnect", { method: "POST" });
  const res = await api("/api/gmail/status");
  if (res.ok) state.gmail = await res.json();
  renderSetup();
  toast("Gmail koptu");
});

$("enableLive").addEventListener("click", () => enableLiveSignal());

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
  if (mentionsCv(subject, text)) {
    toast(CV_BLOCK_MSG);
    updateComposeCvWarn();
    return;
  }
  button.disabled = true;
  const failed = [];
  try {
    for (const toEmail of recipients) {
      const res = await api("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toEmail,
          subject,
          text,
          source: "panel",
        }),
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
    setSheet("composeSheet", false);
    e.target.reset();
    await loadPage({ reset: true });
  } catch (err) {
    toast(err.message || "Gönderilemedi");
  } finally {
    button.disabled = false;
  }
});

$("logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.replace("/login.html");
});

const gmailQs = new URLSearchParams(location.search);
if (gmailQs.get("gmail") === "ok") toast("Gmail bağlandı");
if (gmailQs.get("gmail") === "error") toast(gmailQs.get("m") || "Gmail bağlanamadı");

Promise.all([loadPage({ reset: true }), refreshMeta()])
  .then(() => {
    if (!localStorage.getItem(PRODUCT_KEY)) {
      localStorage.setItem(PRODUCT_KEY, "1");
      toast("MailPing: CV’li başvuru Gmail’den; buradan yalnız takip maili.");
    }
    maybeOpenSetup();
  })
  .catch(() => {
    $("list").innerHTML = `<div class="empty">Sunucuya bağlanılamadı.</div>`;
  });
setInterval(() => refreshMeta().catch(() => {}), 8000);
