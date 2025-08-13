# prahu

Setup cepat:

- Python 3.11/3.12
- Optional: `xray` binary untuk tes real via proxy (taruh di root project, chmod +x)

Instalasi dependensi:

```
pip install -r requirements.txt
```

Konfigurasi env (opsional tapi disarankan):

```
SECRET_KEY=your-secret
XRAY_PATH=./xray  # jika menggunakan Xray
ALLOWED_ORIGINS=http://localhost:5000
# Opsional: kontrol DNS & logging Xray saat testing real geolocation
XRAY_DNS_MODE=doh         # doh|udp (default: doh)
XRAY_DNS1=https+local://1.1.1.1/dns-query
XRAY_DNS2=https+local://8.8.8.8/dns-query
XRAY_LOG_LEVEL=info       # info|warning|error
XRAY_LOG_DIR=~/xray       # default: $HOME/xray
```

Menjalankan aplikasi:

```
python run.py
# atau
python -c "import app; app.socketio.run(app.app, host='0.0.0.0', port=5000, debug=False)"
```

Catatan testing:

- Tanpa Xray: tester melakukan TCP connect dan fallback ping; akan ditingkatkan dengan TLS/WS probe.
- Dengan Xray (opsional): tester melakukan koneksi HTTP melalui proxy untuk mengambil egress IP dan ISP yang real. DNS menggunakan DoH IPv4-only secara default dan log ditulis ke `~/xray/`.

Keamanan:

- Simpan token GitHub di database, jangan kirim kembali ke frontend.
- Gunakan `.env` untuk SECRET_KEY dan path Xray.