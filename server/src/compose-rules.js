const CV_HINT =
  "CV dosyası veya ekte/linke dair ifadeler Gmail (veya kullandığın posta) ile gider. MailPing yalnızca takip / hatırlatma metni için.";

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

function plain(...parts) {
  return foldTr(
    parts
      .filter(Boolean)
      .map((p) => String(p).replace(/<[^>]+>/g, " "))
      .join("\n")
  );
}

/** CV kelimesi geçse bile günlük cümleler serbest; yalnız “ekte / link / pdf eki” vb. engellenir. */
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

export function mentionsCv(...parts) {
  const text = plain(...parts);
  return DELIVERY.some((re) => re.test(text));
}

export function cvComposeError() {
  return CV_HINT;
}
