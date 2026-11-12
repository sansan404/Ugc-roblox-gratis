# 🎁 UGC Gratis Hari Ini

Website yang menampilkan **UGC gratis Roblox terbaru** dan yang **masih bisa diklaim**.
Ada robot yang mengecek otomatis **tiap jam** dan mengirim notif ke **Telegram** dan **Discord**.
Semuanya gratis: berjalan di GitHub Actions dan GitHub Pages.

## Isi folder

| File | Fungsi |
|---|---|
| `index.html` | Tampilan website |
| `config.json` | Nama website, link Telegram dan Discord (boleh diedit) |
| `data/items.json` | Data UGC (diisi otomatis oleh robot, jangan diedit) |
| `scripts/update.mjs` | Robot pengecek |
| `.github/workflows/update.yml` | Jadwal robot (tiap jam) |

---

## Langkah 1: Bikin repo GitHub

1. Daftar atau masuk ke **github.com** (bisa lewat browser HP; pakai mode "Desktop site" biar menunya lengkap).
2. Klik **+** → **New repository**.
3. Nama repo: misalnya `ugc-gratis`. Pilih **Public**. Klik **Create repository**.

## Langkah 2: Upload file

**Lewat komputer:** ekstrak zip, lalu di halaman repo klik **Add file → Upload files** dan seret **semua isi folder** (termasuk folder `.github`, `scripts`, `data`). Klik **Commit changes**.

> Folder `.github` kadang tersembunyi. Kalau tidak ikut ter-upload, bikin manual: **Add file → Create new file**, ketik nama `.github/workflows/update.yml` (tanda `/` otomatis jadi folder), lalu tempel isi file-nya.

**Lewat HP:** pakai **Add file → Create new file** untuk tiap file. Ketik nama lengkap dengan foldernya (contoh `scripts/update.mjs`), lalu tempel isinya. Ulangi untuk 5 file di tabel atas.

## Langkah 3: Nyalakan website

1. Di repo, buka **Settings → Pages**.
2. Di bagian **Source**, pilih **GitHub Actions**.

## Langkah 4: Jalankan robot pertama kali

1. Buka tab **Actions**. Kalau ada tombol "I understand… enable", klik.
2. Pilih **Update UGC Gratis** → **Run workflow** → **Run workflow**.
3. Tunggu 2–5 menit sampai centang hijau ✅.
4. Website kamu ada di: `https://NAMA-GITHUB-KAMU.github.io/ugc-gratis/`

Setelah ini robot jalan sendiri tiap jam. Jalan pertama **tidak** kirim notif (supaya channel tidak kebanjiran item lama). Notif baru dikirim mulai jalan berikutnya, khusus item yang benar-benar baru.

---

## Langkah 5 (opsional): Notif Telegram

1. Di Telegram, chat **@BotFather** → kirim `/newbot` → ikuti petunjuk. Kamu akan dapat **token** (contoh `123456:ABC-xyz`).
2. Bikin **channel** publik, misalnya `@ugcgratisupdate`.
3. Masukkan bot kamu ke channel sebagai **Admin** (izin posting).
4. Di GitHub: **Settings → Secrets and variables → Actions → New repository secret**, tambahkan:
   - `TELEGRAM_BOT_TOKEN` = token dari BotFather
   - `TELEGRAM_CHAT_ID` = `@ugcgratisupdate` (username channel kamu, pakai @)
5. Edit `config.json`, isi `"telegramUrl": "https://t.me/ugcgratisupdate"` supaya tombolnya muncul di website.

## Langkah 6 (opsional): Notif Discord

1. Di server Discord kamu: **Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL**.
2. Di GitHub tambahkan secret `DISCORD_WEBHOOK_URL` = link webhook tadi.
3. Edit `config.json`, isi `"discordUrl"` dengan link undangan server kamu.

> ⚠️ Token bot dan link webhook itu **rahasia**. Simpan HANYA di Secrets, jangan ditulis di file mana pun.

---

## Pengaturan tambahan

- **Jadwal:** ubah baris `cron` di `.github/workflows/update.yml`. `"7 * * * *"` = tiap jam. `"*/30 * * * *"` = tiap 30 menit.
- **Jumlah item dicek:** di **Settings → Secrets and variables → Actions → tab Variables**, tambah `SEARCH_PAGES` (default 3 halaman = 360 item terbaru).
- **Batas notif per jam:** variabel `MAX_NOTIF` (default 15).

## Kalau ada masalah

- **Tanda ❌ merah di Actions:** klik untuk lihat log. Kalau isinya `HTTP 429`, Roblox sedang membatasi request. Biasanya pulih sendiri di jam berikutnya.
- **Website menampilkan "Diperbarui X jam lalu" dengan titik kuning:** robot gagal beberapa kali berturut-turut. Cek tab Actions.
- **GitHub mematikan jadwal:** di repo publik, jadwal otomatis berhenti kalau repo tidak ada aktivitas 60 hari. Robot ini commit data tiap jam, jadi biasanya aman. Kalau tetap mati, buka Actions lalu nyalakan lagi.
- **API Roblox berubah:** API yang dipakai adalah API publik Marketplace yang bisa berubah tanpa pemberitahuan. Kalau data tiba-tiba kosong terus, kemungkinan perlu penyesuaian kode.

## Uji coba tanpa internet

```bash
MOCK_DIR=test/mock node scripts/update.mjs
```

---

Tidak berafiliasi dengan Roblox Corporation. Robot hanya memakai data publik, tanpa login akun siapa pun.
