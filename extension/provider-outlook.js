(() => {
  const { qs, parseEmails, startProvider, pollReadBadges, applyStatusBadge } = window.MailTrackerCore;

  function findComposeRegions() {
    const regions = new Set();
    document.querySelectorAll('[role="dialog"], [role="main"]').forEach((el) => {
      if (el.querySelector('[aria-label*="Subject"], [aria-label*="Konu"]')) {
        regions.add(el);
      }
    });
    document.querySelectorAll('div[class*="Compose"]').forEach((el) => regions.add(el));
    return [...regions];
  }

  const outlookAdapter = {
    getRecipients(root) {
      const emails = new Set();
      root.querySelectorAll('[aria-label="To"], [aria-label="Kime"], [aria-label*="To recipients"]').forEach((el) => {
        parseEmails(el.textContent || el.getAttribute("aria-label") || "").forEach((e) => emails.add(e));
        if (el.value) parseEmails(el.value).forEach((e) => emails.add(e));
      });
      root.querySelectorAll('input[type="text"], div[role="textbox"]').forEach((el) => {
        const label = (el.getAttribute("aria-label") || "").toLowerCase();
        if (label.includes("to") || label.includes("kime")) {
          parseEmails(el.textContent || el.innerText || "").forEach((e) => emails.add(e));
        }
      });
      root.querySelectorAll("[data-hovercard-id]").forEach((el) => {
        const id = el.getAttribute("data-hovercard-id");
        if (id?.includes("@")) emails.add(id);
      });
      return [...emails];
    },
    getSubject(root) {
      const subj = qs(
        root,
        'input[aria-label*="Subject"]',
        'input[aria-label*="Konu"]',
        '[aria-label*="Subject"]'
      );
      return subj?.value?.trim() || subj?.textContent?.trim() || "";
    },
    getBodyEditable(root) {
      return qs(
        root,
        '[aria-label*="Message body"]',
        '[aria-label*="Mesaj gövdesi"]',
        '[role="textbox"][contenteditable="true"]'
      );
    },
    findSendButton(root) {
      return qs(
        root,
        'button[aria-label*="Send"]',
        'button[aria-label*="Gönder"]',
        '[aria-label*="Send"][role="button"]'
      );
    },
    refreshReadBadges() {
      pollReadBadges((tracks) => {
        document.querySelectorAll('[role="option"], [role="row"], [data-convid]').forEach((row) => {
          const subjectEl =
            row.querySelector('[title]') ||
            row.querySelector("span, div");
          const raw = subjectEl?.getAttribute("title") || subjectEl?.textContent || "";
          const subject = raw.replace(/Mail açıldı|Mail bekliyor|CV indirildi/g, "").trim();
          if (!subject) return;
          const match = tracks.find((t) => t.subject && subject.includes(t.subject));
          if (!match) return;
          applyStatusBadge(subjectEl, match);
        });
      });
    },
  };

  startProvider(outlookAdapter, "outlook", findComposeRegions);
})();
