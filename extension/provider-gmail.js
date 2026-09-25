(() => {
  const { qs, parseEmails, startProvider, pollReadBadges, applyStatusBadge } = window.MailTrackerCore;

  const gmailAdapter = {
    getRecipients(root) {
      const emails = new Set();
      root.querySelectorAll("[email]").forEach((n) => {
        const e = n.getAttribute("email");
        if (e) emails.add(e);
      });
      root.querySelectorAll('input[name="to"], input[aria-label*="To"], input[aria-label*="Kime"]').forEach((inp) => {
        parseEmails(inp.value).forEach((e) => emails.add(e));
      });
      return [...emails];
    },
    getSubject(root) {
      return qs(
        root,
        'input[name="subjectbox"]',
        'input[aria-label*="Subject"]',
        'input[aria-label*="Konu"]'
      )?.value?.trim() || "";
    },
    getBodyEditable(root) {
      return qs(
        root,
        'div[aria-label*="Message Body"]',
        'div[aria-label*="Mesaj"]',
        'div[g_editable="true"]'
      );
    },
    findSendButton(root) {
      return qs(
        root,
        'div[role="button"][data-tooltip*="Send"]',
        'div[role="button"][aria-label*="Send"]',
        'div[role="button"][aria-label*="Gönder"]'
      );
    },
    refreshReadBadges() {
      pollReadBadges((tracks) => {
        document.querySelectorAll("tr.zA").forEach((row) => {
          const subjectEl = row.querySelector("span.bog, span.bqe");
          if (!subjectEl) return;
          const email = row.querySelector("[email]")?.getAttribute("email");
          const subject = subjectEl.childNodes[0]?.textContent?.trim() || subjectEl.textContent.replace(/Mail açıldı|Mail bekliyor|CV indirildi/g, "").trim();
          if (!subject) return;
          const match = tracks.find((t) => {
            const sameSubject = t.subject === subject;
            if (email) return sameSubject && t.to_email === email;
            return sameSubject;
          });
          if (!match) return;
          applyStatusBadge(subjectEl, match);
        });
      });
    },
  };

  startProvider(gmailAdapter, "gmail", () => [
    ...document.querySelectorAll('div[role="dialog"]'),
    ...document.querySelectorAll(".AD"),
  ]);
})();
