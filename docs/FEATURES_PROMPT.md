# VortexVPN Manager — Full Feature Prompt (Frontend + Backend)

Anda adalah senior full‑stack engineer + UI/UX designer. Tugas: sempurnakan aplikasi “VortexVPN Manager” (Flask + Socket.IO) tanpa mengubah kapabilitas inti, dengan UI modern, minimalis, profesional, responsif, dua tema (gelap/terang), dan aksesibilitas yang baik.

## Konteks Teknis
- Backend: Flask + Flask‑SocketIO (threading), endpoints REST + event Socket.IO.
- Frontend: HTML + CSS + JS vanilla. PWA (manifest, SW). No framework.
- Storage lokal: SQLite (vortexvpn.db) untuk settings & test_sessions.
- Config template: `template.json` (sing‑box).
- Optional external: Xray binary untuk real geolocation (opsional, via RealGeolocationTester).

## Tujuan
- UI baru: card‑based, collapsible, simple, clean (inspirasi Radix UI + Linear/Vercel), dengan background animated “calm gradients” (respect `prefers-reduced-motion`).
- Integrasi fitur end‑to‑end tanpa regressions.
- State & feedback jelas: live testing, hasil akhir, export/download/upload.

## Fitur Wajib (sesuai kode)

### 1) Smart VPN Input (FE + BE)
- Textarea menerima:
  - Direct links: `vless://`, `vmess://`, `trojan://`, `ss://`
  - Single URL (API/raw) → auto‑fetch & extract links
  - Multiple URLs → fetch paralel, gabung, de‑dup
- Endpoint: `POST /api/add-links-and-test`
  - Backend: `smart_detect_input_type`, `fetch_vpn_links_from_url`, `parse_link` → `all_accounts` + `ensure_ws_path_field` → OK → siap testing
- Saat sukses FE:
  - Tampilkan progress area
  - Emit Socket.IO `start_testing` dengan mode terpilih
  - Mulai live updates

### 2) Advanced (Auto Fetch) builder (FE)
- Penyedia API (acak):
  - `https://admin.ari-andika2.site/api/v2ray`
  - `https://aink.workerz.site/api/v2ray`
- Param: `type` (vless/vmess/trojan/ss), `bug`, `country`, `tls`, `wildcard`, `limit`
- Default logic:
  - country kosong → `random`
  - bug kosong → `MASUKAN+BUG`
- Builder membentuk 1 URL per kombinasi (per country × per type), provider dipilih acak, de‑dup
- Aksi:
  - Preview: tampilkan jumlah & contoh URL
  - Fetch & Add (Advanced): kirim seluruh URL (multiline) ke `/api/add-links-and-test` (backend auto‑fetch), validasi → start testing
- Fallback: jika fetch gagal → otomatis fallback ke Smart Process (pakai isi textarea)

### 3) Mode Testing + Orkestrasi (Socket.IO)
- Emit dari frontend: `start_testing` dengan payload `{ mode, topN? }`
- Mode yang didukung:
  - `accurate` (fase filter non‑Xray → konfirmasi Xray pada yang sukses)
  - `fast` (non‑Xray saja)
  - `xray-only` (semua pakai Xray)
  - `hybrid` (non‑Xray semua → Xray top‑N latency terbaik)
- Backend pipeline:
  - `test_all_accounts` (async, semaphore)
  - `tester.test_account` per akun:
    - TCP connect (`is_alive`), optional TLS handshake (SNI), optional WS upgrade probe
    - Domain resolution: path IP > domain kandidat (host/SNI vs server) per rule
    - GeoIP lookup (ip-api) → Country flag + Provider
    - `USE_XRAY` (opsional) untuk real ISP (`RealGeolocationTester`)
  - Live update:
    - Socket: `testing_update` (hanya yang aktif/selesai; WAIT disaring)
    - `testing_complete` saat selesai
- Frontend live:
  - `showTestingProgress()`, progress bar, stats (success/failed/testing)
  - Tabel live (progressive): menambah/memperbarui baris saat status berubah

### 4) Hasil Akhir (result table + ringkasan + export)
- Setelah `testing_complete`:
  - Summary: jumlah sukses/gagal, avg latency
  - Detailed results table (rincian akun yang telah selesai ditest: status, lokasi, type, latency, IP)
  - Export:
    - `GET /api/export?format=json|csv` (opsional)
    - Download config final: `GET /api/download-config` (config sing‑box)
- UI:
  - Card “Summary” (`#results-summary`) dengan elemen:
    - `#summary-successful`, `#summary-failed`, `#summary-avg-latency`
  - Card “Detailed Results” (`#detailed-results`) dengan container:
    - `#results-table` (JS akan render tabel)
  - Tombol “⬇️ Download VPN Config”

### 5) Generasi Config + Custom Servers
- `build_final_accounts`: dari hasil sukses, restore domain asli (SNI/Host) untuk config final
- `inject_outbounds_to_template`: injeksi akun sukses ke `template.json` (tag & routing)
- Custom servers:
  - Input multiline, distribusi even + random assignment ke akun sukses
  - Auto‑apply saat config generated (emit `config_generated`)
- Endpoint: `POST /api/generate-config` (opsional, dengan `custom_servers`)
- UI: card dengan ringkasan distribusi & status

### 6) GitHub Integration
- Simpan token/owner/repo di SQLite (jangan expose token ke frontend):
  - `/api/save-github-config` (POST)
  - `/api/get-github-config` (GET) → owner, repo, has_token
- Operasi file:
  - List JSON files (opsional)
  - Load JSON config dari file (opsional)
  - Upload config final:
    - `/api/upload-to-github` (POST) → commit message + content (base64) → create/update
- UI: field commit message + tombol “⬆️ Upload to GitHub”

### 7) DNS Resolver & Settings
- `dns_resolver.py`: system vs DoH (Cloudflare/Google)
- ENV: `DNS_MODE`, `DOH_PROVIDER`
- Utils: ping/jitter/ICMP (subprocess ping), geoip lookup

### 8) Tema, Layout & Interaksi
- Tema Gelap/Terang (CSS variables, toggle tersimpan di localStorage)
- Layout card‑based, **collapsible** (Header: title, (!) info toggler, chevron Show/Hide)
- Background animated “calm gradient blobs” (disable pada `prefers-reduced-motion`)
- Header tipis (brand + status + aksi), split layout desktop (kiri kontrol, kanan hasil), mobile stacked + FAB “Smart Process & Start Testing”
- Aksesibilitas: focus ring, ARIA live untuk update

## Elemen Frontend Kritis (ID)
- Smart Input: `#vpn-links`, `#add-and-test-btn`
- Advanced: `#toggle-advanced`, `#adv-info-btn`, `#advanced-panel`, `#adv-preview-btn`, `#adv-fetch-add-btn`
- Status bar: `#status-summary`, `#status-fill`
- Progress (live): `#testing-progress`, `#progress-text`, `#progress-percent`, `#progress-fill`
- Live table: `#live-results`, `#testing-table-body`
- Summary: `#results-summary`, `#summary-successful`, `#summary-failed`, `#summary-avg-latency`
- Detailed: `#detailed-results`, `#results-table`
- Export: `#download-config-btn`, `#export-buttons`
- Upload: `#commit-message`, `#upload-github-btn`
- Toast: `#toast-container`
- Theme toggle: `#theme-toggle`
- FAB: `#fab-start` (harus memicu Smart Process & Start Testing)

## Endpoints & Events Utama
- REST
  - `POST /api/add-links-and-test`
  - `GET /api/get-accounts`
  - `GET /api/get-results`
  - `POST /api/generate-config`
  - `GET /api/download-config`
  - `GET /api/export?format=json|csv`
  - `POST /api/upload-to-github`
  - `POST /api/save-github-config`
  - `GET /api/get-github-config`
  - `POST /api/load-config` (local/github), `GET /api/list-github-files` (opsional)
  - `GET /api/load-template-config` (auto load template)
- Socket.IO
  - Client emit: `start_testing` `{ mode, topN? }`
  - Server emit: `testing_update`, `testing_complete`, `config_generated`, `testing_error`

## Non‑Fungsi
- Aksesibilitas: kontras AA, keyboard navigable, ARIA
- Performance: de‑dup link, batasi concurrency fetch, cache singkat hasil fetch, virtualized list jika entries > 200
- Keamanan: token GitHub tidak pernah dikirim ke frontend; gunakan DB lokal

## Deliverables
- UI baru card‑based (collapsible) yang mengikat semua ID & handler di atas
- Tema gelap/terang rapi dengan CSS variables
- Background animated lembut
- Semua alur: Smart Process → Testing Live → Results (summary + detailed) → Download/Upload → Config + Custom servers → OK

## Sukses Jika
- Klik FAB atau “Smart Process & Start Testing” → langsung proses & testing live muncul
- Advanced Show/Hide + Info (!) berfungsi
- Live updates terlihat; setelah selesai, summary + detailed results tampil; Download & Upload jalan
- Tidak ada regresi integrasi ke backend