# Gojek Ride-Hailing Platform (Full MVP Simulation)

Aplikasi tiruan Gojek (Super-App) berbasis **Node.js, Express, Socket.IO, dan Leaflet OpenStreetMap** dengan visualisasi peta interaktif, simulasi telemetri GPS driver realtime, algoritma dispatching armada, kalkulasi tarif dinamis, dan in-app chat.

---

## 🌟 Fitur Utama

1. **Aplikasi Pelanggan (Customer App - GoRide & GoCar)**:
   - Saldo GoPay terintegrasi & simulasi Top Up.
   - Peta interaktif Jakarta (Monas, Grand Indonesia, SCBD, Stasiun Gambir, Senayan, dll).
   - Pemilihan armada: **GoRide** (Motor) & **GoCar** (Mobil) dengan estimasi waktu & tarif jarak dinamis.
   - Pencarian driver dengan animasi radar (*Searching state*).
   - Kartu info mitra driver ketika terhubung (foto, nama, plat nomor, rating, tipe kendaraan).
   - Tracking posisi mitra driver bergerak secara realtime di peta menuju titik jemput dan ke titik tujuan.
   - Fitur chat dua arah dengan driver.
   - Penilaian bintang & opsi tip saat perjalanan selesai.

2. **Aplikasi Mitra Driver (GoPartner)**:
   - Profil pengemudi, rating bintang, dan statistik harian (Pendapatan Hari Ini & Saldo Dompet).
   - Tombol toggle status **Online / Offline**.
   - Ganti akun driver (tersedia mitra GoRide & GoCar).
   - Notifikasi orderan masuk dengan suara radar dan *progress bar countdown* 15 detik.
   - Stepper perjalanan: *Saya Sudah Sampai di Titik Jemput* ➔ *Mulai Antar* ➔ *Selesaikan Pesanan*.
   - **Simulasi GPS Otomatis**: Fitur simulasi berkendara otomatis dengan tombol kecepatan (1x, 2x, 5x) yang menggerakkan motor/mobil di sepanjang rute secara halus dan menyiarkan koordinat GPS via WebSockets.

3. **Admin & Dispatch Control Center**:
   - Peta sebaran seluruh armada aktif di area Jakarta.
   - Status badge realtime (Tersedia, Offering, Sedang Dalam Trip, Offline).
   - Statistik Gross Merchandise Value (GMV), total trip sukses, dan armada online.
   - Live stream log dispatching event.
   - Tombol Reset data demo ke kondisi awal.

4. **Dual Simulator Mode (`index.html`)**:
   - Tampilan mockup dua smartphone berdampingan (Customer + Driver) dalam satu layar, sehingga Anda dapat langsung menguji alur pemesanan dan penerimaan order secara realtime tanpa harus bolak-balik membuka banyak jendela.

---

## 🚀 Cara Menjalankan

Buka terminal di folder project:
```bash
cd "C:\Users\MyBook Hype\.gemini\antigravity\scratch\gojek-clone"
node server.js
```

Lalu buka browser Anda di:
- **Simulator Lengkap (Dual Phone View)**: [http://localhost:3000](http://localhost:3000)
- **Aplikasi Pelanggan**: [http://localhost:3000/customer.html](http://localhost:3000/customer.html)
- **Aplikasi Mitra Driver**: [http://localhost:3000/driver.html](http://localhost:3000/driver.html)
- **Admin Dispatch Control**: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

---

## 🛠️ Arsitektur & Teknologi

- **Backend**: Node.js, Express, Socket.IO, UUID.
- **Frontend**: Vanilla JS (ES Modules), Tailwind CSS, Phosphor Icons, Web Audio API (Synthesizer efek suara).
- **Mapping & Geospasial**: Leaflet.js, OpenStreetMap / Carto Tiles, Formula Haversine (jarak KM & tarif dinamis), Bezier waypoint interpolation untuk pergerakan kendaraan halus.
- **Database Layer**: In-Memory Store dengan persistensi JSON (`store.js` modular yang siap dihubungkan ke PostgreSQL / Prisma).
