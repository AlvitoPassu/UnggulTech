# Implementasi Final: Pemisahan Soil Moisture dan Soil pH Global

Tanggal: 25 September 2026 (WITA)

## 1. Implementation Status

**COMPLETED** untuk source code dan migration artifact. Migration belum diterapkan ke database production, firmware pH belum di-flash, dan verifikasi perangkat/production tetap memerlukan langkah manual pada bagian 19.

## 2. Root Cause Fixed

Coupling lama dihilangkan pada dua sisi:

- Firmware pH tidak lagi mengirim `sensor1` sampai `sensor6`, `kelembaban: 0`, atau request ke endpoint moisture.
- Backend menerima pH hanya pada `POST /api/sensors/ph` dan menyimpannya ke `soil_ph_readings`, bukan `sensor_readings`/`sensor_logs`.

Jalur `POST /api/sensors` untuk Soil Moisture tetap kompatibel dengan payload firmware Soil Moisture saat ini. Payload broadcast pH lama dengan signature `status: "pH Monitor"` ditolak sebelum database insert, sehingga tidak dapat lagi menjadi heartbeat Soil Moisture.

## 3. Architecture Before

```text
ESP32 pH
  -> sensor1..sensor6
  -> POST /api/sensors
  -> kelembaban = 0 + soil_ph
  -> sensor_readings / sensor_logs per bedengan
  -> latest created_at Soil Moisture diperbarui
  -> Soil Moisture terlihat online
```

## 4. Architecture After

```text
ESP32 Soil Moisture
  -> POST /api/sensors
  -> sensor_readings per bedengan
  -> lastSeen/status Soil Moisture per bedengan

ESP32 pH (satu probe)
  -> POST /api/sensors/ph { "soil_ph": 6.4 }
  -> soil_ph_readings (satu row global)
  -> measuredAt/status pH sendiri
  -> nilai global yang sama digunakan seluruh bedengan
```

`GET /api/sensors/ph` dan `GET /api/sensors/ph/history` adalah sumber pH baru. Request pH tidak menyentuh timestamp Soil Moisture.

## 5. Database Changes

Storage baru: `public.soil_ph_readings`.

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | `bigint` identity primary key | ID satu pembacaan pH global |
| `ph_value` | `numeric(5,2)` dengan check 0–14 | Nilai pH valid |
| `measured_at` | `timestamptz`, default UTC now | Waktu pembacaan dan dasar status pH |

Index `soil_ph_readings_measured_at_idx` dibuat untuk latest/history query. Migration non-destruktif tersedia di `packages/backend/database/20260925_create_soil_ph_readings.sql`; source schema backend dan frontend Supabase telah diselaraskan.

Tidak ada table/row existing yang di-drop, truncate, delete, atau rewrite.

## 6. API Changes

### Soil Moisture

| Item | Contract |
| --- | --- |
| Endpoint | `POST /api/sensors` |
| Method | `POST` |
| Payload | Payload existing `sensor1..sensor6` dengan `kelembaban`, optional DHT11 |
| Response | Existing `{ message, results }` |
| Behavior baru | Field pH tidak disimpan ke moisture record. Broadcast legacy pH dengan `status: "pH Monitor"` ditolak. |

Read API Soil Moisture (`/overview`, `/:sensorId/data`, `/:sensorId/recent-logs`, `/moisture-trend`) kini membaca/menampilkan data moisture tanpa field pH legacy sebagai data saat ini.

### pH Global

| Item | Contract |
| --- | --- |
| Ingestion endpoint | `POST /api/sensors/ph` |
| Payload | `{ "soil_ph": 6.4 }` (`ph` juga diterima untuk compatibility input) |
| Success response | `201 { message, reading: { soilPh, measuredAt, status, isActive } }` |
| Latest endpoint | `GET /api/sensors/ph` |
| History endpoint | `GET /api/sensors/ph/history?limit=100` |
| Invalid pH | `400`; tidak ada insert dan last valid pH tidak berubah |

Response latest saat belum ada reading:

```json
{ "soilPh": null, "measuredAt": null, "status": "no_data", "isActive": false }
```

## 7. Firmware Changes

`packages/PH-tanah/src/main.cpp` sekarang:

- mempertahankan logic kalibrasi, Wi-Fi, pengukuran, dan interval ±10 detik;
- mengirim ke `https://unggulmonitoring.com/api/sensors/ph`;
- mengirim tepat satu payload `{ "soil_ph": value }`;
- tidak lagi mengirim sensor key bedengan, `ph` duplicate, ADC, status `pH Monitor`, atau dummy moisture.

`packages/soil-moisture/src/main.cpp` **tidak diubah**.

## 8. Backend Changes

- Menambah `soilPhService.js` untuk validasi 0–14, insert, latest query, history query, dan status pH.
- Menambah route pH pada `sensorRoutes.js`.
- Menambah pH global pada overview Dashboard tanpa memasukkannya ke `latestBySensor` moisture.
- Menghapus pH dari object/detail/chart/log Soil Moisture runtime dan dari historical moisture query.
- Mengubah Chatbot context agar menggunakan `globalSoilPh`, bukan pH per-bedengan.
- Menjaga recommendation decision engine tidak berubah; ia tetap hanya memakai moisture, health, dan rainfall.

## 9. Frontend Changes

- **Dashboard:** kartu “Rata-rata Soil pH” menjadi “Soil pH Global”, menampilkan status dan waktu terakhir saat inactive.
- **Sensor Page:** pH global, status, last measurement, dan chart diambil dari endpoint pH terpisah. Berpindah bedengan tidak mengubah pH.
- **Data Historis:** menambah chart history pH global; tabel historis sensor tetap khusus moisture per-bedengan.
- **Export:** pH tidak lagi ada pada setiap row moisture. CSV menaruh metadata pH global di atas header; XLSX menaruhnya di sheet Ringkasan; PDF menaruh value dan timestamp pH di ringkasan.
- **Recommendation AI Page:** nilai dan trend pH memakai global pH endpoint, sedangkan moisture tetap mengikuti bedengan terpilih.
- **Chatbot:** menerima pH global beserta status/timestamp dalam context, dengan instruksi bahwa pH berlaku untuk seluruh bedengan.

## 10. pH Status Logic

Konstanta `PH_ACTIVE_THRESHOLD_SECONDS` berada di `soilPhService.js`.

- Default: **90 detik**.
- Bisa dikonfigurasi melalui environment variable `PH_ACTIVE_THRESHOLD_SECONDS`.
- Alasan: firmware mengirim sekitar setiap 10 detik; 90 detik memberi toleransi Wi-Fi/network tanpa menganggap probe yang dicabut tetap aktif terlalu lama.

| Kondisi | `status` | `isActive` |
| --- | --- | --- |
| Tidak ada reading | `no_data` | `false` |
| Latest `measured_at` berumur ≤90 detik | `active` | `true` |
| Latest `measured_at` berumur >90 detik | `inactive` | `false` |

## 11. Last Valid pH Logic

`getLatestSoilPh()` selalu mengambil row valid terakhir dari `soil_ph_readings`; status dihitung saat read, bukan dengan menghapus/mengganti row.

Jadi ketika perangkat pH berhenti setelah mengirim `6.4`, respons berubah menjadi `inactive`, tetapi tetap mengandung `soilPh: 6.4` dan `measuredAt` terakhir. Invalid payload tidak membuat insert, sehingga tidak dapat menggantikan last valid pH.

## 12. Global pH Logic

Satu `POST /api/sensors/ph` membuat satu row `soil_ph_readings`. Tidak ada `sensor_id` Bedengan dan tidak ada loop enam record. Semua Bedengan membaca latest global pH yang sama melalui API pH.

## 13. Legacy Data

Historical mixed data lama (`sensor_readings` dengan `moisture = 0` dan `soil_ph`) dipertahankan tanpa penghapusan atau rewrite.

Data tersebut tidak dipakai sebagai source pH runtime baru dan tidak lagi ditampilkan sebagai pH per-row pada detail/history/export moisture baru. Cleanup atau klasifikasi legacy sengaja tidak diotomatisasi karena `moisture = 0` tidak dapat dipastikan selalu data pH.

## 14. Files Changed

| File | Change | Reason |
| --- | --- | --- |
| `packages/PH-tanah/src/main.cpp` | Endpoint dan satu payload pH global | Menghapus broadcast/heartbeat palsu |
| `packages/backend/database/20260925_create_soil_ph_readings.sql` | Migration baru | Storage pH independen non-destruktif |
| `packages/backend/database/schema.sql` | Reference table/index | Sinkron source schema backend |
| `packages/frontend/supabase/schema.sql` | Reference table/index/RLS read policy | Sinkron source schema Supabase |
| `packages/backend/src/services/soilPhService.js` | Service baru | Validation, latest/history, last-valid, status pH |
| `packages/backend/src/routes/sensorRoutes.js` | GET/POST pH routes | API pH terpisah |
| `packages/backend/src/services/sensorService.js` | Remove pH coupling, overview global pH | Menjaga lastSeen moisture independen |
| `packages/backend/src/services/historicalService.js` | Historical moisture tanpa pH mixed | Semantik history benar |
| `packages/backend/src/services/reportService.js` | pH global metadata terpisah | Hindari fake pH per moisture row |
| `packages/backend/src/routes/reportRoutes.js` | Pass global pH ke exporter | Summary report benar |
| `packages/backend/src/services/chatbotService.js` | Context global pH | Chatbot tidak memakai pH per bedengan |
| `packages/frontend/src/api/sensorApi.js` | Client latest/history global pH | Source frontend pH baru |
| `packages/frontend/src/components/Dashboard/NurserySummaryCards.jsx` | Card global pH | Tidak lagi average enam latest row |
| `packages/frontend/src/pages/SensorPage.jsx` | pH global card/chart | Bedengan dan pH independen |
| `packages/frontend/src/pages/HistoricalDataPage.jsx` | pH global history chart | Tidak mencampur with moisture history |
| `packages/frontend/src/pages/RecommendationAIPage.jsx` | pH global source/trend | Rekomendasi UI benar |
| `packages/backend/test/soilPhService.test.js` | Test pH service | Regression coverage core pH |
| `packages/backend/test/reportService.test.js` | Test CSV/XLSX/PDF | Verifikasi export global pH terpisah |

## 15. Database Migration Instructions

Production database **belum diubah oleh pekerjaan ini**.

1. Backup/ikuti prosedur operasional Supabase yang berlaku.
2. Jalankan hanya SQL non-destruktif pada `packages/backend/database/20260925_create_soil_ph_readings.sql` melalui Supabase SQL Editor atau workflow migration yang digunakan deployment.
3. Verifikasi table `public.soil_ph_readings` dan index `soil_ph_readings_measured_at_idx` terbentuk.
4. Restart backend setelah migration tersedia.
5. Jangan menjalankan delete/truncate pada `sensor_readings` atau `sensor_logs`.

Backend read API mengembalikan `no_data` bila table belum ada agar monitoring moisture tidak crash saat rollout bertahap. `POST /api/sensors/ph` tetap memerlukan migration sebelum dapat menerima pH.

## 16. Firmware Deployment Instructions

Flash ulang **hanya ESP32 pH** dari `packages/PH-tanah` setelah backend dan migration siap.

ESP32 Soil Moisture tidak memerlukan flash karena source dan kontraknya tidak diubah.

## 17. Test Results

| Test | Result | Notes |
| --- | --- | --- |
| Moisture ON / pH OFF | NOT RUN | Memerlukan perangkat/database deployment nyata |
| Moisture OFF / pH ON | NOT RUN | Memerlukan perangkat/database deployment nyata |
| Both ON | NOT RUN | Memerlukan perangkat/database deployment nyata |
| Both OFF | NOT RUN | Memerlukan perangkat/database deployment nyata |
| Last pH persistence | PASS | Unit test: pH valid terakhir tetap bernilai saat threshold inactive |
| Global pH | PASS | Unit test memastikan satu insert global; frontend build berhasil |
| Independent timestamp | PASS | Unit test memastikan pH insert memakai `soil_ph_readings`; legacy broadcast ditolak sebelum moisture insert |
| Historical | PASS | Frontend build dan endpoint/UI source pH global terpisah; runtime DB tetap perlu manual verification |
| CSV | PASS | Unit test memverifikasi metadata global pH dan tanpa kolom pH per row |
| XLSX | PASS | Unit test membuat dan membuka workbook |
| PDF | PASS | Unit test menghasilkan stream PDF valid |
| Recommendation | PASS | Frontend build; source pH baru global |
| Chatbot | PASS | Backend test suite dan syntax check; context global pH ditambahkan |
| Frontend build | PASS | `npm.cmd run build --workspace=frontend` |
| Backend tests | PASS | `node --test packages/backend/test/*.test.js`: 21 pass, 0 fail |
| Firmware compile | NOT RUN | `pio`/`platformio` tidak tersedia di environment ini |
| Frontend lint | FAIL (pre-existing) | 8 error hanya pada `AuthContext.jsx`, `HeaderAuthStatus.jsx`, dan `SessionTimeoutWarningModal.jsx`; file tersebut tidak diubah |

## 18. Known Limitations

- Migration dan firmware flashing belum dapat dilakukan dari repository; production state tidak diverifikasi.
- Tes device A–D belum dapat dijalankan tanpa kedua ESP32 dan database target.
- Historical mixed legacy pH tidak direkonstruksi menjadi global history; tetap dipertahankan sebagai legacy data.
- `POST /api/sensors/ph` belum memakai device authentication baru, sesuai batas scope.
- Frontend lint project masih gagal pada error Auth yang sudah ada dan tidak terkait implementasi ini.

## 19. Manual Steps Required

1. Apply migration `packages/backend/database/20260925_create_soil_ph_readings.sql` ke Supabase production.
2. Deploy/restart backend yang berisi endpoint `/api/sensors/ph`.
3. Flash ulang ESP32 pH dengan `packages/PH-tanah/src/main.cpp` baru.
4. Bila ingin override default, set `PH_ACTIVE_THRESHOLD_SECONDS=90` (atau nilai operasional yang disetujui) pada environment backend, lalu restart backend.
5. Jalankan uji fisik A–D, last pH, global pH, timestamp independen, dashboard/history/export/recommendation/chatbot di production atau staging.

## 20. Final Git Status

Changed source, migration, frontend, and test files ada di tabel bagian 14. Selain itu terdapat `ph_soil_moisture_full_audit.md` sebagai laporan audit sebelumnya dan dokumen implementasi ini sebagai file baru.

- Git commit: **TIDAK DILAKUKAN**
- Git push: **TIDAK DILAKUKAN**
- Git pull/merge/rebase/reset: **TIDAK DILAKUKAN**

