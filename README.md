# MailPing

Kendi sunucunuzda çalışan **mail açıldı mı** takip paneli.

- **İlk başvuru (CV dahil):** Gmail veya kullandığınız posta istemcisinden — gerçek PDF eki, normal metin.
- **Hatırlatma / takip:** Panelden **Takip maili** — görünmez okundu pikseli eklenir; CV dosyası veya “ekte” tarzı ifadeler panelden gönderilmez.

İsterseniz takip maili açıldığında **e-posta bildirimi** veya açık panelde **masaüstü bildirimi** alırsınız.

Panel kilitlidir: VPS’e koysanız da başvuru listesi, Gmail bağlantısı ve SMTP ayarları başkasının eline geçmez. Alıcıya giden okundu pikseli bilinçli olarak herkese açıktır (takip böyle çalışır).

Yerel geliştirme: [http://localhost:3847/](http://localhost:3847/) → panel şifresi.

## Önerilen akış

1. **Gmail’den** başvuru at (CV ekiyle). Kurulumda **Gmail bağla** → **Gönderilenleri çek**; kayıtlar listede görünür (**Takip yok** — piksel yok).
2. Bir süre sessiz kalırsa panelden **Takip maili** yaz (kısa metin). Bu mailde piksel vardır → **Açtı / Sessiz**.
3. Metinde “cv’mde sorun yok” gibi cümleler serbest; **“CV ekte”**, **“ektedir”**, CV linki/PDF eki gibi ifadeler panelden engellenir (CV’yi yine Gmail’den gönder).

## Ne yapar?

| Özellik | Açıklama |
|--------|----------|
| **Mail açıldı** | Panelden giden takip mailine görünmez piksel. Alıcı HTML’de görseli yükleyince sayılır (ilk/son, sayı). |
| **Gmail çek** | Gönderilenleri panele alır (IMAP + uygulama şifresi veya Google OAuth). Listeleme ve sınıflandırma; bu maillerde açılma takibi yok. |
| **Takip maili** | SMTP ile gönderim; oturum çerezi gerekir. CV eki / takip linki yok. |
| **Başvuru filtresi** | Durum (sessiz, açtı, takip yok…) + tür (İK, staj, kariyer…) + arama. |
| **Liste** | Sayfalı liste; aşağı kaydırınca devamı yüklenir. |
| **Canlı sinyal** | Panel açıkken periyodik kontrol; yeni açılışta toast / bildirim. |
| **Okundu e-postası** | İsteğe bağlı: alıcı takip mailini açtığında size SMTP ile bildirim. |
| **Şifremi unuttum** | Giriş ekranından; yeni panel şifresi SMTP ile `NOTIFY_TO` / `MAIL_TO` kutusuna gider. |

Eski kurulumlardan kalan **CV indirme linki** (`/c/{id}`) hâlâ çalışabilir; yeni mailde panel artık CV linki üretmez.

## Nasıl çalışır?

1. Panel **Takip maili** gönderirken sunucu bir `track id` üretir.
2. HTML gövdesine `https://SUNUCU/t/{id}.png` eklenir.
3. Alıcı maili açıp görseli yüklediğinde piksel istenir → `open_count` artar.
4. Açık panel ~8 saniyede bir `/api/signals` sorar; yeni olayda bildirim.

**Önemli:** Piksel **internetten** erişilebilir bir `PUBLIC_BASE_URL` ister. Sadece `localhost` ile gerçek Gmail okundusu test edilemez. Üretimde VPS + [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) veya ngrok kullanın.

## Kimlik ve kilit

Harici **API token yok**. Yalnızca panel şifresi + imzalı oturum çerezi (`PANEL_PASSWORD`, `AUTH_SECRET`).

| Katman | Ne | Kim geçer |
|--------|----|-----------|
| **IP kapısı** (isteğe bağlı) | `ALLOWED_IPS` | Yalnız listedeki IP’ler login ve `/api/*` görür |
| **Oturum** | Panel şifresi + çerez | Giriş sonrası tarayıcı |

**Herkese açık uçlar** (alıcı / proxy):

- `GET /t/{id}.png` — okundu pikseli
- `GET /c/{id}`, `POST /c/{id}/file` — eski CV takibi (varsa)
- `GET /health`
- `POST /api/recover` — şifre sıfırlama (rate limit)
- `GET /api/gmail/callback` — OAuth dönüşü

**Kilitli:** panel statikleri (login hariç), `/api/tracks`, `/api/send`, `/api/signals`, Gmail bağla/çek/kopar, `/api/cv` (eski API; panel UI kullanmaz).

`ALLOWED_IPS` piksele uygulanmaz; uygulanırsa panel/API 403 alır ama alıcı pikseli yine yüklenir.

## Kurulum

```bash
cd server
copy .env.example .env   # Windows — Mac/Linux: cp
npm install
npm run keys
```

`npm run keys` `PANEL_PASSWORD` ve `AUTH_SECRET` üretir. `server/.env` içine yapıştırın, SMTP ve `PUBLIC_BASE_URL` doldurun, sonra:

```bash
npm start
```

Proje kökünden: `npm run keys`, `npm start` (aynı iş).

### `.env` özeti

```
PUBLIC_BASE_URL=https://mailping.ornek.com
PANEL_PASSWORD=uzun-sifre
AUTH_SECRET=uzun-rastgele

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...@gmail.com
SMTP_PASS=uygulama-sifresi
MAIL_FROM=...@gmail.com
MAIL_FROM_NAME=Adın Soyadın

NOTIFY_TO=...@gmail.com
NOTIFY_WATCH_RECIPIENTS=*
NOTIFY_FROM_NAME=MailPing
```

| Değişken | Açıklama |
|----------|----------|
| `PUBLIC_BASE_URL` | Piksel URL’sinin kökü; tünel/domain ile birebir aynı olmalı. |
| `PANEL_PASSWORD` | Panel girişi; `recover` ile değişebilir (veritabanında saklanır). |
| `AUTH_SECRET` | Çerez imzası; değişince oturumlar düşer. |
| `MAIL_FROM_NAME` | Takip mailinde görünen gönderen adı. |
| `TRUST_PROXY` | Nginx / Cloudflare arkasında `true`. |
| `ALLOWED_IPS` | İsteğe bağlı panel IP listesi. |

Gmail **gönderilenler** için `SMTP_USER` / `SMTP_PASS` Gmail uygulama şifresi yeter (IMAP). İsteğe bağlı **Google ile bağla**:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://SIZIN-URL/api/gmail/callback
```

### İlk kullanım (panel)

1. Şifre ile giriş.
2. **Kurulum (Gmail)** → bağla veya IMAP ile **Gönderilenleri çek**.
3. Gmail’den başvuru at; listede görünür.
4. **Takip maili** ile hatırlatma gönder.
5. İsteğe bağlı: kurulumda **Bildirimi aç**.

### Test maili

```bash
cd server
npm run send-test
```

Panel şifresiyle oturum açılır, örnek takip maili gider. Maili açıp görselleri yükleyin; panelde **Açtı** görünmeli.

## Coolify + Cloudflare Tunnel

Kök `docker-compose.yml`: **mailping** (3847, sadece iç ağ) + **cloudflared** (`TUNNEL_TOKEN`).

1. Tünel token’ını Coolify’da `TUNNEL_TOKEN` olarak verin (repoya koymayın).
2. Cloudflare’de hostname → `http://mailping:3847` (compose servis adı).
3. Ortam: `PUBLIC_BASE_URL`, `PANEL_PASSWORD`, `AUTH_SECRET`, `SMTP_*`, isteğe bağlı `GOOGLE_*`, `ALLOWED_IPS`.
4. Veri `mailping-data` volume’unda (`server/data` eşdeğeri). Eski DB taşıyorsanız volume’u doldurmadan önce kopyalayın.

Evde ayrı `cloudflared` çalışıyorsa üretim tüneliyle çakışmaz; ikisini aynı hostname’e bağlamayın.

## Chrome eklentisi

**Devre dışı.** Sunucu Bearer token kullanmaz; takip ve gönderim panelden.

`extension/` klasörü gelecekte panel oturumu ile yeniden bağlanabilir. Bildirim için panel açık + tarayıcı bildirim izni yeterli.

## API (özet)

Tüm `/api/*` (health, recover, gmail callback, piksel/CV hariç) **oturum çerezi** ister.

**Takip maili gönder:**

```http
POST /api/send
Cookie: mp=...
Content-Type: application/json

{
  "toEmail": "ik@firma.com",
  "subject": "Başvurum hakkında",
  "text": "Merhaba, kısa bir hatırlatma…",
  "source": "panel"
}
```

`includeCv: true` veya metinde CV **gönderim/ek** kalıpları → `400` ve açıklayıcı hata.

**Canlı sinyal:**

```http
GET /api/signals?after=2026-09-24T09:00:00.000Z
```

**Gmail:** `GET /api/gmail/status`, `POST /api/gmail/sync`, `GET /api/gmail/connect`, `POST /api/gmail/disconnect`.

## Proje yapısı

```
MailPing/
├── docker-compose.yml      # VPS: app + cloudflared
├── server/
│   ├── src/
│   │   ├── index.js        # HTTP, piksel, API
│   │   ├── auth.js         # şifre, oturum
│   │   ├── email.js        # SMTP, piksel, bildirim
│   │   ├── compose-rules.js # takip maili CV-ek engeli
│   │   ├── gmail.js        # OAuth / IMAP sync
│   │   ├── db.js           # SQLite
│   │   └── security.js     # IP, rate limit, CSP
│   ├── public/             # panel, login, compose-rules.js
│   └── data/               # git’te yok — DB + eski CV dosyası
└── extension/              # şimdilik kullanılmıyor
```

## Sınırlamalar

- Düz metin mail veya kapalı görseller → okundu sayılmayabilir.
- Kurumsal filtreler harici piksel URL’sini kesebilir.
- Gmail görseli proxy’ler; `PUBLIC_BASE_URL` her zaman erişilebilir olmalı.
- Gmail’den çekilen mailler **takip yok**; açılma yalnız panelden giden takip maillerinde.
- Tek kiracı: bir kurulum = bir kullanıcı verisi. Paylaşımlı VPS’te ayrı instance veya volume.
- `gmail.readonly` OAuth mağaza yayınında Google doğrulaması gerekebilir; test kullanıcıları geliştirme için yeterli.
