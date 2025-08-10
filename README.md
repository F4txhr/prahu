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
```

Menjalankan aplikasi:

```
python run.py
# atau
python -c "import app; app.socketio.run(app.app, host='0.0.0.0', port=5000, debug=False)"
```

Catatan testing:

- Tanpa Xray: tester melakukan TCP connect dan fallback ping; akan ditingkatkan dengan TLS/WS probe.
- Dengan Xray (opsional): tester melakukan koneksi HTTP melalui proxy untuk mengambil egress IP dan ISP yang real.

Keamanan:

- Simpan token GitHub di database, jangan kirim kembali ke frontend.
- Gunakan `.env` untuk SECRET_KEY dan path Xray.