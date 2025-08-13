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
XRAY_TLS_INSECURE=0       # set 1 untuk skip verifikasi TLS (darurat saja)
```

Catatan Termux/Android:
- Pastikan paket CA terpasang: `pkg install ca-certificates`
- Jika masih gagal TLS, set env berikut sebelum menjalankan:
```
export SSL_CERT_FILE=$PREFIX/etc/tls/cert.pem
export SSL_CERT_DIR=$PREFIX/etc/tls/certs
```

Menjalankan aplikasi:

```