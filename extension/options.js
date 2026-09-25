const serverInput = document.getElementById("serverUrl");
const tokenInput = document.getElementById("apiToken");
const status = document.getElementById("status");

chrome.storage.sync.get({ serverUrl: "http://localhost:3847", apiToken: "" }, (data) => {
  serverInput.value = data.serverUrl;
  tokenInput.value = data.apiToken || "";
});

async function ensureHostAccess(serverUrl) {
  const origin = `${new URL(serverUrl).origin}/*`;
  const have = await chrome.permissions.contains({ origins: [origin] });
  if (have) return true;
  return chrome.permissions.request({ origins: [origin] });
}

document.getElementById("save").addEventListener("click", async () => {
  const serverUrl = serverInput.value.trim().replace(/\/$/, "");
  const apiToken = tokenInput.value.trim();
  try {
    await ensureHostAccess(serverUrl);
  } catch {
    status.textContent = "Sunucu adresi geçersiz.";
    return;
  }
  await chrome.storage.sync.set({ serverUrl, apiToken });
  try {
    const res = await fetch(`${serverUrl}/health`);
    if (!res.ok) throw new Error("health");
    if (!apiToken) {
      status.textContent = "Kaydedildi. API token boş — VPS’te track oluşmaz.";
      return;
    }
    const check = await fetch(`${serverUrl}/api/auth`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    status.textContent = check.ok
      ? "Kaydedildi. Sunucu kilidi açıldı."
      : "Kaydedildi ama token reddedildi.";
  } catch {
    status.textContent = "Kaydedildi ama sunucuya ulaşılamadı.";
  }
});
