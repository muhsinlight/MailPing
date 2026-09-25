# MailPing

Kendi sunucunuzda çalışan mail + CV takip paneli. Alıcı maili açınca ve CV’yi indirince kayıt düşer; isterseniz **Windows / Mac masaüstü bildirimi** gelir.

Panel kilitlidir: VPS’e koysanız da CV, mailler ve Gmail başkasının eline geçmez. Alıcıya giden piksel ve CV indirme linki bilinçli olarak açıktır (okundu takibi bununla çalışır).

Panel: `http://localhost:3847/` → şifre ister.

## Ne yapar?

| Özellik | Açıklama |
|--------|----------|
| **Mail açıldı** | HTML maile görünmez piksel eklenir. Alıcı görseli yükleyince sayılır (kaç kez, ilk/son). |
| **CV indirildi** | Panele PDF yüklersiniz; maile tekil link eklenir. İndirme ayrı sayılır. |
| **Gmail çek** | Gönderilenleri panele alır (IMAP veya Google OAuth). Eski maillerde açıldı takibi yoktur. |
| **Başvuru filtresi** | Tek kutu: tür (şirket / İK / staj…) + durum + arama. `info@firma.com` de başvurudur. |
| **Sayfalama** | İlk 24 kayıt; aşağı kaydırınca devamı. |
| **Canlı sinyal** | Chrome eklentisi veya açık panel: mail açılınca / CV inince sistem bildirimi. |
| **Gmail / Outlook rozeti** | Gönderilenler listesinde açıldı / CV durumu. |

**Desteklenen gönderim**

| Kaynak | Nasıl |
|--------|--------|
| **Gmail Web** | Chrome eklentisi — Gönder’de piksel (+ CV linki) |
| **Outlook Web** | Aynı eklenti |
| **SMTP / API** | `POST /api/send` + `Authorization: Bearer` |
| **Manuel** | `POST /api/tracks` → `pixelHtml` / `cvHtml` |

Alıcı herhangi bir HTML istemci olabilir. Şart: piksel URL’sinin yüklenmesi.

## Nasıl çalışır?

1. Gönderimden önce sunucu bir `track id` üretir.
2. Mail gövdesine `https://SUNUCU/t/{id}.png` ve (CV varsa) `/c/{id}` eklenir.
3. Mail açılınca piksel istenir → `open_count` artar.
4. CV linkine basılıp **PDF indir** denince indirme kaydı düşer (önizleme taraması sayılmaz).
5. Eklenti ~1 dakikada bir `/api/signals` bakar; yeni olayda masaüstü bildirimi çıkar.

**Önemli:** Piksel **internetten** gelir. Gerçek Gmail okundusu için `localhost` yetmez. VPS, [ngrok](https://ngrok.com) veya Cloudflare Tunnel kullanın; `.env` `PUBLIC_BASE_URL` ile eklenti URL’si **aynı** olsun.

## Kilit (VPS için şart)

İki katman. Piksel ve CV **alıcı linki** kilit dışındadır; panel, CV dosyası, mail listesi, SMTP ve Gmail kilitlidir.

| Katman | Ne | Kim geçer |
|--------|----|-----------|
| **1. IP kapısı** (isteğe bağlı) | `ALLOWED_IPS` | Yalnız listedeki IP’ler login/API görür |
| **2. Kimlik** | Panel şifresi + eklenti token | Şifre veya `Bearer API_TOKEN` |

**Açık kalan uçlar** (alıcı / Gmail proxy):

- `GET /t/{id}.png` — okundu pikseli
- `GET /c/{id}` — CV indirme sayfası
- `POST /c/{id}/file` — PDF indir (sayaç burada artar)
- `GET /health` — canlı mı kontrolü (CV sızdırmaz)
- `GET /api/gmail/callback` — Google OAuth dönüşü

**Kilitli uçlar:** panel, `/api/cv`, `/api/cv/file`, `/api/tracks`, `/api/send`, `/api/signals`, Gmail bağla/çek/kopar.

Panel şifresi, eklenti token’ı ve cookie imzası `.env` içindedir (`PANEL_PASSWORD`, `API_TOKEN`, `AUTH_SECRET`). Bu dosyayı git’e koymayın.

## Kurulum

```bash
cd server
copy .env.example .env
npm install
npm run keys
```

`npm run keys` üç satır basar. Komut `server` klasöründe çalışır; proje kökünden de aynı komut yeter. Çıktıyı `server/.env` içine yapıştırın, sonra `npm start`.

| Satır | Ne |
|--------|-----|
| `PANEL_PASSWORD` | Panel giriş şifresi. Bunu siz de seçebilirsiniz; uzun ve tahmin edilmesi zor olsun. |
| `API_TOKEN` | Eklenti ve API anahtarı. Rastgele kalsın. |
| `AUTH_SECRET` | Oturum çerezinin imzası. Rastgele kalsın. |

Sunucu bu üçünü kendisi üretmez; biri boşsa açılmaz. Sonradan `AUTH_SECRET` değişirse açık oturumlar kapanır. `API_TOKEN` değişirse eklenti ayarına yeni token yazılır.

Tarayıcı: [http://localhost:3847/](http://localhost:3847/) → **Panel kilidi**. Şifre `.env` içindeki `PANEL_PASSWORD`.

`.env` özeti:

```
PUBLIC_BASE_URL=https://SIZIN-ACIK-URL
PANEL_PASSWORD=uzun-sifre
API_TOKEN=uzun-rastgele-token
SMTP_USER=...@gmail.com
SMTP_PASS=uygulama-sifresi
NOTIFY_TO=...@gmail.com
NOTIFY_WATCH_RECIPIENTS=*
```

| Değişken | Ne işe yarar |
|----------|----------------|
| `PUBLIC_BASE_URL` | Maile yazılan piksel/CV adresi. Eklenti URL’si ile aynı olsun. |
| `PANEL_PASSWORD` | Panel girişi. |
| `API_TOKEN` | Chrome eklentisi ve `POST /api/send` / `/api/tracks`. |
| `ALLOWED_IPS` | İsteğe bağlı. Örnek: `127.0.0.1,203.0.113.10` — yalnız panel. Piksel yine herkese açık. |
| `TRUST_PROXY` | Nginx / Cloudflare arkasında `true`. Yoksa `X-Forwarded-For` sahte IP sayılır. |
| `AUTH_SECRET` | Cookie imzası. |

Gmail gönderilenlerini çekmek için SMTP hesabı Gmail + uygulama şifresi olsun (IMAP). İsteğe bağlı OAuth:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://SIZIN-ACIK-URL/api/gmail/callback
```

### İlk kullanım

1. Panele şifre ile girin.
2. **PDF yükle** (CV).
3. Sağ üstte **Eklenti token** → kopyalayın (eklenti ayarına yapıştırılacak).
4. **Gönderilenleri çek** (veya Google ile bağla).
5. Chrome eklentisini yükleyin — yeni başvuru maillerinde takip + CV linki eklenir.
6. Sağ üstte **Canlı** → bildirim izni verin. Eklenti yüklüyse Chrome açıkken de düşer.

### Test maili

```bash
npm run send-test
```

`API_TOKEN` `.env` içinden okunur. Maili açıp görselleri yükleyin; panelde açıldı görünmeli.

## Coolify

Repo kökündeki `docker-compose.yml` iki servis kurar: MailPing ve Cloudflare tüneli. VPS’te 3847 portu açılmaz. İnternet sadece tünelden gelir. Veritabanı ve CV, `mailping-data` volume’unda kalır.

1. Bu bilgisayarda, `server` klasöründe değil, tünelin kurulu olduğu makinede:

```bash
cloudflared tunnel token mailping
```

Çıkan değeri Coolify ortam değişkenine `TUNNEL_TOKEN` diye yazın. Repoya koymayın.

2. Cloudflare Zero Trust → Tunnels → `mailping` → Public Hostname: `mailpig.muhsinlight.com.tr` → servis `http://mailping:3847`. Bu adres Compose ağıdır; sunucunun herkese açık IP’si değildir.

3. Coolify → New Resource → Docker Compose. Kökteki `docker-compose.yml`. Environment Variables: `TUNNEL_TOKEN`, `PUBLIC_BASE_URL` (`https://mailpig.muhsinlight.com.tr`), `PANEL_PASSWORD`, `API_TOKEN`, `AUTH_SECRET`, SMTP alanları.

4. Deploy edin. Bu bilgisayardaki tünel sürecini kapatın. İkisi birden açıksa isteklerin yarısı hâlâ evdeki `localhost`a gider.

`server/data` içindeki mevcut veritabanını taşıyacaksanız, volume’u doldurmadan önce dosyaları kopyalayın.

İsteğe bağlı sıkılaştırma: `ALLOWED_IPS=ev.ip.adresiniz`. Ev IP’si değişirse hem panel hem eklenti 403 alır; piksel çalışmaya devam eder.

## Chrome eklentisi

1. `chrome://extensions` → Geliştirici modu → **Paketlenmemiş öğe yükle** → `extension`.
2. Panelde giriş → **Eklenti token**.
3. Uzantı seçenekleri → sunucu URL + API token. VPS domain’inde Chrome izin penceresini onaylayın.
4. Gmail / Outlook Web’de **Gönder**.

Token yoksa veya yanlışsa track oluşmaz (Gönder yine gider; takip eklenmez).

Eklenti **dakikada bir** sunucuyu sorar. Mail açılınca veya CV inince:

- **Windows** → Action Center
- **Mac** → Bildirim Merkezi

Chrome (veya eklentinin olduğu tarayıcı) çalışıyor olsun. Mac’te **Sistem Ayarları → Bildirimler → Chrome** açık olmalı.

Eski “Mail Tracker” eklentisini kaldırın; ikisi çift piksel ekler.

## API

Tüm `/api/*` (login, Gmail callback, health hariç) kimlik ister: panel cookie **veya** `Authorization: Bearer API_TOKEN`.

**Piksel (mailı siz gönderirsiniz)**

```http
POST /api/tracks
Authorization: Bearer API_TOKEN
Content-Type: application/json

{ "toEmail": "alici@firma.com", "subject": "Teklif", "source": "crm" }
```

`pixelHtml` / `cvHtml` gövdeye yapıştırılır.

**SMTP ile gönder**

```http
POST /api/send
Authorization: Bearer API_TOKEN
Content-Type: application/json

{ "toEmail": "alici@firma.com", "subject": "Merhaba", "html": "<p>İçerik</p>", "source": "smtp" }
```

**Canlı sinyal**

```http
GET /api/signals?after=2026-09-24T09:00:00.000Z
Authorization: Bearer API_TOKEN
```

`open` ve `cv` olaylarını döner. Eklenti ve panel bunu kullanır.

**Gmail** (panel oturumu veya token)

- `GET /api/gmail/status`
- `POST /api/gmail/sync` — OAuth varsa API, yoksa IMAP
- `GET /api/gmail/connect` — Google OAuth

Okundu e-postası: `NOTIFY_WATCH_RECIPIENTS=*` veya `a@x.com,b@y.com`.

## Proje yapısı

- `server/` — Express, SQLite, piksel, CV, Gmail, panel
  - `src/auth.js` — şifre, session cookie, API token
  - `src/security.js` — IP kapısı, güvenlik başlıkları, rate limit
- `extension/` — Gmail / Outlook + masaüstü bildirimi
- `server/data/` — veritabanı ve CV PDF (git’te yok)

## Sınırlamalar

- Metin-only mail veya kapalı görseller → okundu gelmeyebilir.
- Kurumsal filtreler harici URL’yi kesebilir.
- Gmail görseli proxy’ler; public URL şart.
- Gmail’den çekilen **eski** mailler listelenir; açıldı/CV takibi yalnız piksel/link eklenenlerde olur.
- Canlı sinyal için Chrome’un çalışması (eklenti) veya panelin açık + bildirim izni gerekir.
- `gmail.readonly` OAuth yayın için Google doğrulaması ister; geliştirmede test kullanıcıları yeter.
- Tek kiracı: bir sunucu = bir panel = bir CV. Aynı VPS’i iki kişi paylaşıyorsa birbirinin verisini görür; ayrı kurulum veya ayrı `data/` kullanın.
- `ALLOWED_IPS` piksele uygulanmaz. Uygulanırsa Gmail okundusu kırılır.

## Chrome Web Store (özet)

Gmail erişen eklentiler incelenir. Formda toplanan veriyi dürüst yazın (açılış zamanı, IP, user-agent). Self-hosted: kullanıcı sunucu URL’sini ve API token’ı options’tan girer. VPS domain’i `optional_host_permissions` ile istenir; `host_permissions` içinde localhost hazırdır.
