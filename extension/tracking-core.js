(() => {
  const TRACK_ATTR = "data-mailtracker-id";

  function qs(root, ...selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function parseEmails(raw) {
    if (!raw) return [];
    return raw
      .split(/[,;]/)
      .map((s) => s.replace(/.*<([^>]+)>.*/, "$1").trim())
      .filter((e) => e.includes("@"));
  }

  function injectPixel(bodyEl, pixelHtml, trackId) {
    if (!bodyEl || bodyEl.querySelector(`[${TRACK_ATTR}="${trackId}"]`)) return;
    const wrap = document.createElement("div");
    wrap.setAttribute(TRACK_ATTR, trackId);
    wrap.style.cssText = "height:0;width:0;overflow:hidden;line-height:0;font-size:0;";
    wrap.innerHTML = pixelHtml;
    bodyEl.appendChild(wrap);
  }

  function injectCvLink(bodyEl, cvHtml, trackId) {
    if (!bodyEl || !cvHtml || bodyEl.querySelector(`[data-mailtracker-cv="${trackId}"]`)) return;
    const wrap = document.createElement("div");
    wrap.setAttribute("data-mailtracker-cv", trackId);
    wrap.innerHTML = cvHtml;
    bodyEl.appendChild(wrap);
  }

  async function prepareTracking(composeRoot, adapter, source) {
    const toList = adapter.getRecipients(composeRoot);
    const toEmail = toList[0];
    if (!toEmail) return null;

    const subject = adapter.getSubject(composeRoot);
    const bodyEl = adapter.getBodyEditable(composeRoot);
    if (!bodyEl) return null;

    const res = await chrome.runtime.sendMessage({
      type: "CREATE_TRACK",
      payload: {
        toEmail,
        subject,
        fromEmail: adapter.getFromEmail?.(composeRoot) || "",
        source,
      },
    });
    if (!res?.ok) {
      console.warn("[MailTracker]", res?.error);
      return null;
    }
    const { id, pixelHtml, cvHtml } = res.data;
    injectPixel(bodyEl, pixelHtml, id);
    injectCvLink(bodyEl, cvHtml, id);
    await chrome.storage.local.set({
      [`track:${id}`]: { toEmail, subject, source, createdAt: Date.now() },
    });
    return id;
  }

  function bindComposeSend(composeRoot, adapter, source) {
    if (composeRoot.dataset.mailtrackerBound) return;
    composeRoot.dataset.mailtrackerBound = "1";

    const sendBtn = adapter.findSendButton(composeRoot);
    if (!sendBtn) return;

    sendBtn.addEventListener(
      "mousedown",
      () => {
        prepareTracking(composeRoot, adapter, source).catch(() => {});
      },
      true
    );
  }

  async function pollReadBadges(matchRow) {
    try {
      const { url: base } = await chrome.runtime.sendMessage({ type: "GET_SERVER" });
      if (!base) return;
      const res = await fetch(`${base}/api/tracks`);
      if (!res.ok) return;
      matchRow(await res.json());
    } catch {
      /* sunucu kapalı */
    }
  }

  function startProvider(adapter, source, scanRoots) {
    function scan() {
      scanRoots().forEach((root) => bindComposeSend(root, adapter, source));
    }

    const observer = new MutationObserver(() => {
      scan();
      if (adapter.refreshReadBadges) adapter.refreshReadBadges();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    scan();
    if (adapter.refreshReadBadges) {
      setInterval(() => adapter.refreshReadBadges(), 15000);
    }
  }

  function applyStatusBadge(hostEl, track) {
    if (!hostEl || !track) return;
    let badge = hostEl.querySelector(":scope > .mailtracker-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "mailtracker-badge";
      hostEl.appendChild(badge);
    }
    badge.innerHTML = track.read
      ? `<span class="mt-open">Mail açıldı</span>`
      : `<span class="mt-wait">Mail bekliyor</span>`;
    badge.innerHTML += track.cvDownloaded
      ? `<span class="mt-cv">CV indirildi</span>`
      : `<span class="mt-wait">CV bekliyor</span>`;
    badge.title = `${track.open_count || 0} mail açılışı · ${track.cv_download_count || 0} CV indirme`;
  }

  window.MailTrackerCore = {
    qs,
    parseEmails,
    pollReadBadges,
    startProvider,
    applyStatusBadge,
  };
})();
