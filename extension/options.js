const serverInput = document.getElementById("serverUrl");
const status = document.getElementById("status");

chrome.storage.sync.get({ serverUrl: "http://localhost:3847" }, (data) => {
  serverInput.value = data.serverUrl;
});

document.getElementById("save").addEventListener("click", async () => {
  const serverUrl = serverInput.value.trim().replace(/\/$/, "");
  if (!serverUrl) {
    status.textContent = "Adres yazın.";
    return;
  }
  await chrome.storage.sync.set({ serverUrl });
  try {
    const res = await fetch(`${serverUrl}/health`);
    status.textContent = res.ok ? "Kaydedildi. Sunucu yanıt veriyor." : "Kaydedildi ama health başarısız.";
  } catch {
    status.textContent = "Kaydedildi ama sunucuya ulaşılamadı.";
  }
});
