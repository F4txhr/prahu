# Frontend UI Guide (static/js/app.js)

Ringkasan peran file:
- Mengatur interaksi UI, koneksi Socket.IO, dan komunikasi API ke backend
- Menangani rendering progres live testing: hanya menampilkan hasil final, urut berdasarkan yang selesai duluan
- Menampilkan satu skeleton global sebagai penanda proses testing sedang berlangsung

Struktur state penting:
- currentMode: mode testing (accurate/fast/xray-only/hybrid)
- displayOrder: urutan index akun yang selesai (hasil final)
- latestByIndex: snapshot hasil terbaru per index
- rowMap: peta index -> elemen <tr> untuk update cepat
- skeletonEl: satu baris skeleton global (diletakkan setelah hasil terakhir)

Alur utama:
1) addAndStart()
   - Memastikan config terbaca (template/GitHub)
   - POST /api/add-links-and-test
   - Reset state tabel, tampilkan skeleton global, emit 'start_testing'
2) initSocket()
   - Mendengarkan 'testing_update' dan 'testing_complete'
   - processResults(): catat hasil final, tangani nuansa dua fase (XRAY diperlukan untuk sukses pada accurate/hybrid)
   - rerenderTableInCompletionOrder(): render baris final sesuai displayOrder, lalu letakkan skeleton jika masih ada pending
3) download/upload/generate
   - Tombol di Results & Actions memanggil API terkait

Modifikasi perilaku tampilan:
- Hanya tampilkan sukses XRAY pada accurate/hybrid: ubah fungsi shouldShowResult()
- Ubah posisi skeleton: modifikasi ensureGlobalSkeleton()
- Tampilkan juga hasil fase 1: di processResults(), saat r.Status==='✅' && !r.XRAY, panggil upsertRow(r) sesuai kebutuhan

Debug cepat:
- Console log [API] di api(), [BOOT] saat inisialisasi, dan [Action] saat tombol diklik
- Jika gagal init: cek apakah Socket.IO CDN termuat (window.io tersedia)