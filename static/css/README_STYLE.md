# Style Guide (static/css/style.css)

Bagian utama:
- :root: variabel warna dan token tema
- .card, .card-header, .card-title, .card-body: kontainer UI
- .input, .btn, .btn-primary/.btn-accent/.btn-soft: kontrol form & tombol
- .segmented*, .status-dot, .pill: komponen kecil
- .progress, .progress-bar: indikator progres
- .table*, .badge-* : tabel hasil & warna status
- .toast*: notifikasi ringan
- .info-btn: tombol (!) untuk deskripsi singkat
- .skel-row, .skeleton-line*, @keyframes shimmer: animasi skeleton

Cara ubah cepat:
- Ganti warna tema di :root
- Intensitas shadow/hover tombol: di .btn:hover
- Kecepatan shimmer: durasi animation pada .skeleton-line
- Ketebalan border: gunakan rgba di border-color untuk menambah/kurangi kontras