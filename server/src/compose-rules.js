const CV_HINT =
  "CV veya özgeçmiş içeren mailleri Gmail (veya kullandığın posta) üzerinden gönder. MailPing yalnızca takip / hatırlatma metni için.";

export function mentionsCv(...parts) {
  const text = parts
    .filter(Boolean)
    .map((p) => String(p))
    .join("\n")
    .toLowerCase();
  if (/\bcv\b/.test(text) || /(^|[^\w])cv['\u2019]/.test(text)) return true;
  if (/özgeçmiş|özgecmis|resume|curriculum\s*vitae/.test(text)) return true;
  return false;
}

export function cvComposeError() {
  return CV_HINT;
}
