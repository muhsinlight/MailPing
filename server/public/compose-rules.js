/** Panel ile sunucu compose-rules.js aynı mantık — değişirse ikisini güncelle. */
(function () {
  const CV_BLOCK_MSG =
    "CV dosyası veya ekte/linke dair ifadeler Gmail (veya kullandığın posta) ile gider. MailPing yalnızca takip / hatırlatma için.";

  function foldTr(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/ı/g, "i")
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ş/g, "s")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c");
  }

  function plain(subject, body) {
    return foldTr(`${subject || ""}\n${body || ""}`);
  }

  const DELIVERY = [
    /\bcv\b[^.\n]{0,48}\b(ekte|ektedir|ekli|ekliyorum|ekledim|ekteki|ek olarak|ekte bulun)/,
    /\b(ekte|ektedir|ekli|ekteki)[^.\n]{0,48}\bcv\b/,
    /\bozgecmis[^.\n]{0,48}\b(ekte|ektedir|ekli|ekliyorum|ekledim)/,
    /\b(ekte|ektedir|ekli)[^.\n]{0,48}\bozgecmis/,
    /\bcv\s*['\u2019]?(yi|ni|yi|mi)?\s*(ekliyorum|ekledim|gonderiyorum|yolluyorum|iletiyorum|paylasiyorum)/,
    /\bcv\s*(linki|linkini|baglantisi|url)/,
    /\bcv\.pdf\b/,
    /\bcv\s*(dosyasi|dosyam|pdf\s*eki|pdfi)\b/,
    /\bresume\s+attach/,
    /\battach(ed|ment)?\s+.{0,24}\b(cv|resume)\b/,
    /\b(cv|resume)\s+attach/,
    /\bcurriculum\s+vitae\b/,
    /\bplease\s+find\s+(my\s+)?(cv|resume)\b/,
    /\b(enclosed|attached)\s+.{0,20}\b(cv|resume)\b/,
    /\bsee\s+(the\s+)?attach/,
    /\bilgili\s+cv\s+ekte/,
    /\bcv\s+ekte\b/,
    /\bekte\s+cv\b/,
  ];

  function mentionsCv(subject, body) {
    const text = plain(subject, body);
    return DELIVERY.some((re) => re.test(text));
  }

  window.mailpingComposeRules = { mentionsCv, CV_BLOCK_MSG };
})();
