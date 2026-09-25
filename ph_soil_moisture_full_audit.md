# Audit Menyeluruh: Pemisahan Sensor pH Tanah dan Soil Moisture

Tanggal audit: 25 September 2026 (WITA)  
Metode: read, search, trace, analyze, report. Tidak ada source code, konfigurasi, migration, dependency, maupun data yang diubah. Dokumen ini adalah satu-satunya artefak audit yang dibuat.

## 1. Executive Summary

Implementasi saat ini **belum memodelkan ESP32 pH Tanah sebagai perangkat/sensor yang independen**. Firmware pH mengirim satu nilai pH ke endpoint Soil Moisture yang sama, lalu membungkusnya sebagai enam payload `sensor1` sampai `sensor6`. Setiap payload tersebut juga berisi `kelembaban: 0`. Backend memetakan nama key tersebut ke `sensor_id` bedengan yang sama dengan Soil Moisture dan menulisnya sebagai pembacaan biasa di `sensor_readings`/`sensor_logs`.

Akibat langsungnya, pembacaan pH menjadi pembacaan terbaru untuk setiap sensor Soil Moisture. Status online dihitung dari `created_at` pembacaan terbaru per `sensor_id`, dengan ambang tiga menit. Oleh karena itu, ketika hanya ESP32 pH menyala, setiap bedengan memiliki record baru dan Dashboard menyatakan sensor Soil Moisture aktif/online. Ini adalah root cause yang dapat dibuktikan dari source code, bukan dugaan.

pH disimpan pada kolom `soil_ph` di record yang sama dengan `moisture`. Tidak ada `device_id`, `device_type`, `sensor_type`, MAC address, API key, atau heartbeat per perangkat pada jalur backend aktif. Tidak ada `last_ph_seen`/timestamp pH independen. Setelah pH dilepas, nilai pH terakhir tidak dijamin dipertahankan pada API UI: pembacaan Soil Moisture berikutnya untuk `sensor_id` yang sama akan memiliki `soil_ph = null` dan menjadi record terbaru.

## 2. Git Status

Pemeriksaan sebelum pembuatan laporan:

| Item | Hasil |
| --- | --- |
| Branch aktif | `main` |
| Upstream | `origin/main` |
| HEAD | `a1f21edb feat(ph-tanah): add WiFi connectivity and broadcast soil pH readings to all bedengans` |
| Working tree sebelum audit | CLEAN (`git status --short --branch` hanya menampilkan `## main...origin/main`) |
| Modified files sebelum audit | Tidak ada |
| Staged files sebelum audit | Tidak ada |
| Untracked files sebelum audit | Tidak ada |
| Remote | `origin` fetch/push ke repository GitHub UnggulTech |
| Merge/cherry-pick/revert aktif | Tidak ada (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, dan `REVERT_HEAD` tidak ada) |
| Rebase aktif | Tidak ada folder `rebase-merge` atau `rebase-apply`, dan `git status` tidak menyatakan rebase |
| Catatan metadata | File `.git/REBASE_HEAD` ada tanpa struktur rebase aktif. Dari repository saat ini ini tampak artefak metadata stale; status Git tidak menunjukkan operasi rebase berjalan. |

Commit paling baru menambahkan seluruh folder `packages/PH-tanah/` dan secara eksplisit berjudul “broadcast soil pH readings to all bedengans”. Tidak ada Git operation yang dijalankan pada audit ini. Setelah audit, file laporan ini sendiri akan membuat working tree tidak lagi bersih; tidak ada source code yang berubah.

## 3. Project Architecture

Repository adalah monorepo npm/Lerna:

```text
root package.json + lerna.json
├── packages/backend      Express 5 API + Supabase service-role + Gemini + export PDF/XLSX/CSV
├── packages/frontend     React 19 + Vite + Axios + Supabase client/auth + Recharts
├── packages/soil-moisture PlatformIO/Arduino firmware ESP32 (terdaftar sebagai npm workspace)
└── packages/PH-tanah     PlatformIO/Arduino firmware ESP32 pH (tracked, tetapi tidak terdaftar sebagai npm workspace)
```

- Backend entry point: `packages/backend/src/server.js`; route utama dipasang di `/api/sensors`, `/api/historical-readings`, `/api/reports`, `/api/recommendation`, `/api/chatbot`, `/api/rainfall`, `/api/weather`, dan `/api/auth`.
- Frontend route: `packages/frontend/src/App.jsx`: Dashboard `/`, Sensor `/sensor`, Data Historis `/data-historis`, dan Recommendation AI `/rekomendasi-ai`.
- Vite proxy mengarahkan `/api` ke `http://127.0.0.1:3001` pada development (`packages/frontend/vite.config.js`).
- Database yang dideklarasikan adalah Supabase PostgreSQL; backend memakai service-role client (`packages/backend/src/config/supabase.js`). Frontend memakai anon client terutama untuk auth. Ada satu service frontend `src/services/sensorService.js` yang dapat membaca tabel `sensors` langsung, tetapi tidak ditemukan import/pemakaian pada halaman aktif.
- Supabase files tersedia di `packages/frontend/supabase/`: schema dan Edge Function `ingest-sensor-reading`. Tidak ditemukan pemanggil Edge Function ini dari firmware atau frontend aktif.
- SQL schema tersedia ganda di `packages/backend/database/schema.sql` dan `packages/frontend/supabase/schema.sql`; ada `safe_migration.sql` serta migration status moisture. Tidak ada folder migration Supabase standar atau bukti schema live yang dapat diverifikasi.
- Tidak ada Dockerfile, docker-compose, Vercel/Netlify/Render/Railway/Fly config, CI workflow, atau konfigurasi deployment lain yang tracked. Routing deployment produksi tidak dapat diverifikasi dari repository.
- Tes yang ditemukan hanya pada backend: `recommendationDecisionEngine.test.js` dan `p5LiteDataSafety.test.js`; tidak ada tes khusus pH, identity perangkat, atau status independen.

## 4. Soil Moisture Data Flow

```text
ESP32 Soil Moisture
  packages/soil-moisture/src/main.cpp
  buildSensorJson() → sendDataToServer() setiap 60 detik
  payload: sensor1..sensor6 { channel, kelembaban, status, adc } + dht11
        ↓ POST https://unggulmonitoring.com/api/sensors
Express
  packages/backend/src/server.js → /api/sensors
  packages/backend/src/routes/sensorRoutes.js POST /
        ↓
Service
  packages/backend/src/services/sensorService.js insertSensorReadings()
  sensor1..sensor6 → SENSOR_ID_MAP/default ID 1..6
  classify `kelembaban` sebagai moisture; validasi; insert
        ↓
Supabase PostgreSQL
  config.logsTable default `sensor_logs` (view)
  write: insert via view/table contract to reading { sensor_id, moisture, soil_ph, temperature, humidity }
  schema sumber: `sensor_readings` dan compatibility view `sensor_logs`
        ↓
Backend read API
  GET /api/sensors/overview → getNurseryOverview()
  GET /api/sensors/:sensorId/data → getSensorData()
  GET /api/sensors/:sensorId/recent-logs → getRecentLogs()
  GET /api/sensors/moisture-trend → getNurseryMoistureTrend()
        ↓
Frontend
  src/api/sensorApi.js → DashboardPage.jsx, SensorPage.jsx,
  HistoricalDataPage.jsx, RecommendationAIPage.jsx, export modal
```

Soil Moisture firmware memang mengirim `sensor1` sampai `sensor6`, membaca ADC multiplexer dan DHT11, dan mengirim setiap satu menit (`serverInterval = 60000`). Tidak mengirim device identity eksplisit, tetapi fungsinya sebagai sumber moisture secara implisit oleh bentuk payload tersebut.

## 5. pH Data Flow

```text
ESP32 pH
  packages/PH-tanah/src/main.cpp
  bacaADC_RataRata() → pHValue → sendDataToServer(adcValue, pHValue)
  setiap ±10 detik
        ↓ POST https://unggulmonitoring.com/api/sensors (endpoint yang sama)
  loop i = 1..6 membentuk:
  sensor{i} { channel: i-1, soil_ph: pH, ph: pH, adc, kelembaban: 0, status: "pH Monitor" }
        ↓
Express dan service Soil Moisture yang sama
  POST /api/sensors → insertSensorReadings()
  key sensor1..sensor6 → ID 1..6; moisture 0 dianggap valid; soil_ph disimpan
        ↓
Tabel/view dan timestamp yang sama
  sensor_readings / sensor_logs; satu `created_at` per row
        ↓
Frontend dan fitur downstream yang sama
  SensorPage: data, chart, tabel log pada sensor/bedengan yang sama
  Dashboard: averageSoilPh dan status/lastSeen overview yang sama
  Historical/exports: row campuran moisture+pH
  RecommendationAIPage: pH dari `getSensorData()` untuk sensor yang sama
```

Jawaban audit khusus:

- Endpoint Soil Moisture dipakai pH: **YA**.
- Service Soil Moisture dipakai pH: **YA**, `insertSensorReadings()`.
- Tabel/view dan row model yang sama: **YA**.
- Timestamp/last seen/status health yang sama: **YA**.
- Device identity yang sama: **YA; tepatnya tidak ada identity perangkat terpisah. Keduanya memakai key logis `sensor1`–`sensor6`.**
- pH hanya ditambahkan sebagai field ke payload Soil Moisture: **YA**, bersama `kelembaban: 0` agar lolos validasi moisture wajib.

## 6. Root Cause

Root cause ditemukan dan berantai sebagai berikut.

1. `packages/PH-tanah/src/main.cpp`, fungsi `sendDataToServer()` (baris 118–180), melakukan loop `i = 1..JUMLAH_BEDENGAN` dan mengirim ke `/api/sensors`. Isi penting payload (baris 141–149):

   ```cpp
   "sensor" + String(i) + ":{"
   "soil_ph": pHValue,
   "ph": pHValue,
   "kelembaban": 0,
   "status": "pH Monitor"
   ```

2. `packages/backend/src/services/sensorService.js`, `insertSensorReadings()` (baris 302–386), memilih seluruh key yang cocok dengan `/^sensor\d+$/i` lalu menerjemahkan `sensor1`…`sensor6` ke `sensor_id` 1…6 (baris 303 dan 313). Tidak ada pemeriksaan `device_id`, jenis device, atau sumber payload.

3. Service tersebut mewajibkan moisture valid (baris 320–325). Karena firmware pH selalu memberikan `kelembaban: 0`, nilai itu lolos sebagai Soil Moisture dan record yang ditulis (baris 364–370) adalah:

   ```js
   { sensor_id, moisture: 0, soil_ph: soilPh, temperature, humidity }
   ```

4. `getSensorData()` memilih record paling baru untuk `sensor_id` tersebut (`order(created_at desc).limit(1)`, baris 89–107), lalu menghitung `isOnline` dari timestamp record itu saja (baris 146–154):

   ```js
   const isOnline = minutesSinceLastReading <= 3;
   ```

5. `getNurseryOverview()` menggunakan pola sama: `getLatestReadings()` memilih record paling baru per `sensor_id`, lalu `lastSeen = latest.created_at` dan `isOnline` bila umur record ≤ 3 menit (baris 185–225). Dashboard memanggil endpoint overview ini.

Dengan ESP32 pH aktif, enam row baru untuk ID Soil Moisture dibuat setiap sekitar 10 detik. Maka row tersebut adalah latest reading dan berumur <3 menit; UI benar menampilkan hasil API `online`, tetapi semantik sumbernya keliru karena API tidak tahu bahwa record datang dari ESP32 pH, bukan ESP32 Soil Moisture.

## 7. Device Identity Audit

**Apakah backend benar-benar mengetahui perbedaan ESP32 Soil Moisture dan ESP32 pH? Tidak.**

Jalur backend aktif mengidentifikasi hanya nama properti payload `sensor1`…`sensor6`, kemudian mengubahnya menjadi `sensor_id` menggunakan `SENSOR_ID_MAP` atau default `{ sensor1:1, ..., sensor6:6 }`. `channel` juga dikirim firmware tetapi tidak digunakan backend untuk identity. Tidak ditemukan `device_id`, `sensor_type`, `device_type`, `source`, MAC address, token device, API key device, atau header autentikasi sensor pada `POST /api/sensors`.

Ada Edge Function Supabase terpisah (`packages/frontend/supabase/functions/ingest-sensor-reading/index.ts`) yang mengharuskan `sensor_id`, `moisture`, dan header `x-device-key`, dengan mapping secret `SENSOR_DEVICE_KEYS`. Namun fungsi ini tidak menerima `soil_ph`, tidak direferensikan oleh firmware yang tersedia, dan tidak dipasang oleh `server.js`. Ia bukan mekanisme identity pada alur yang menimbulkan bug ini.

## 8. Status Logic Audit

| Lokasi | Mekanisme | Threshold / hasil |
| --- | --- | --- |
| `sensorService.getSensorData()` | `Date.now() - latest.created_at` | ≤3 menit: `isOnline=true`, `sensorHealth=online`; >3 menit: `stale`; tanpa record: `offline` |
| `sensorService.getNurseryOverview()` | Record terbaru per `sensor_id` dari semua `sensor_logs` | batas yang sama, ≤3 menit |
| `SensorPage.jsx` | Menggunakan `sensorData.isOnline` dan `sensorHealth` dari backend | refresh data 30 detik; daftar sensors 60 detik |
| `DashboardPage.jsx` | Menggunakan overview dari backend | refresh overview/trend 60 detik |
| `sensors.status` DB | Konfigurasi administratif (`Active`, `Inactive`, `Maintenance`, `Offline`) | tidak dipakai sebagai freshness/online runtime |
| `sensor_readings.status` | Generated dari moisture: ≤30 Low, ≤70 Normal, >70 High | ini kondisi moisture, bukan konektivitas |

Tidak ada heartbeat table/endpoint, WebSocket, atau Supabase Realtime subscription untuk status sensor. Frontend melakukan polling HTTP. pH dan Soil Moisture memakai satu `created_at`, satu latest-row query, dan satu `isOnline`/`lastSeen` untuk setiap `sensor_id`.

## 9. Database Audit

Source SQL menggambarkan tabel berikut. Kondisi database live tidak dapat diverifikasi dari repository.

| Tabel/view | PK / FK | Kolom relevan | Timestamp / relasi |
| --- | --- | --- | --- |
| `sensors` | PK `id`; unique `sensor_name`, `(bedengan, sensor_name)` | `sensor_name`, `bedengan`, `location`, `status` | `created_at`, `updated_at`; satu entitas sensor per bedengan menurut implementasi sekarang, bukan device fisik/sensor type |
| `sensor_readings` | PK `id`; FK `sensor_id → sensors.id` `ON DELETE CASCADE` | `moisture numeric(5,2) NOT NULL`, `soil_ph numeric(5,2)` nullable, `temperature`, `humidity`, `pump_status`; generated `status` dari moisture | `created_at`; index `(sensor_id, created_at desc)` |
| `sensor_logs` | compatibility view dari `sensor_readings` | mengekspos `id`, `sensor_id`, `moisture`, `soil_ph`, `temperature`, `humidity`, moisture status, `pump`, `created_at` | view yang dibaca default oleh backend melalui `SUPABASE_LOGS_TABLE` |
| `rainfall_readings` | PK `id` | rainfall / nursery / bedengan | independen; tidak memakai sensor reading |
| `profiles`, `user_sessions`, `audit_logs` | auth/audit | tidak berhubungan langsung dengan pH | schema lengkap user_sessions/audit dapat bervariasi menurut safe migration |

`soil_ph` memang merupakan kolom di `sensor_readings`, bukan tabel pH terpisah. Kolom `moisture` `NOT NULL` menjelaskan mengapa firmware pH saat ini mengirim kelembapan palsu `0`: pH-only record tidak dapat masuk schema kontrak sekarang tanpa nilai moisture. Tidak ada foreign key atau tabel device terpisah.

`packages/backend/database/safe_migration.sql` juga menambahkan `soil_ph` dan menciptakan `sensor_logs` view; ia bukan bukti bahwa migration telah dijalankan. Terdapat dua schema source yang perlu diselaraskan saat pekerjaan masa depan dilakukan: backend SQL dan frontend Supabase SQL.

## 10. Supabase Audit

Pola yang aktif untuk data sensor adalah:

```text
Frontend React --Axios /api--> Express backend --service-role Supabase client--> sensor_logs / sensors
```

Frontend memiliki Supabase anon client dan RLS policy source, tetapi pemakaian langsung yang ditemukan di aplikasi aktif adalah Supabase Auth. Service `packages/frontend/src/services/sensorService.js` dapat memilih tabel `sensors` secara langsung, tetapi pencarian import tidak menemukan pemakaiannya. Tidak ada realtime channel/subscription sensor.

Backend menggunakan environment names `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, opsional `SUPABASE_LOGS_TABLE`, `SUPABASE_LOGS_TIMESTAMP_COLUMN`, dan `SUPABASE_LOGS_STATUS_COLUMN`; nilai tidak diperiksa/dicetak. Frontend menggunakan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`. Edge Function memakai names `SENSOR_DEVICE_KEYS`, `SUPABASE_URL`, dan `SERVICE_ROLE_KEY`, tetapi bukan jalur aktif firmware yang dapat dibuktikan.

## 11. Dashboard Audit

`packages/frontend/src/pages/DashboardPage.jsx` memanggil `getNurseryOverview()` dan `getNurseryMoistureTrend()` pada load, perubahan period, manual refresh, dan setiap 60 detik. Loading mengosongkan overview/trend bila error; fallback timestamp adalah “Belum ada data”.

Dashboard saat ini tidak memiliki kartu pH individual dengan konektivitas sendiri. `NurserySummaryCards.jsx` menampilkan “Rata-rata Soil pH”, dihitung oleh `getNurseryOverview()` dari `soil_ph` pada latest record setiap `sensor_id`; status sensor aktif dan data Moisture memakai array latest record yang sama. `SensorStatusOverview`, `SoilMoistureCondition`, dan `AttentionBedengans` juga mendapat data dari overview tersebut.

Jadi jawaban yang tepat adalah: **UI tidak menampilkan dua card status terpisah per perangkat; pH dan Soil Moisture tampak sebagai metric berbeda, tetapi sumber terbaru, `lastSeen`, dan statusnya sama pada level record `sensor_id`.**

## 12. Sensor Page Audit

`packages/frontend/src/pages/SensorPage.jsx` memilih satu `sensors.id` (default sensor pertama), lalu tiap 30 detik memanggil:

- `GET /api/sensors/:id/data` melalui `getSensorData()`;
- `GET /api/sensors/:id/recent-logs` melalui `getRecentLogs()`.

Satu respons `sensorData` digunakan untuk kartu Soil Moisture, Soil pH, suhu, humidity, `StatusBadge`, `lastSeen`, grafik moisture, grafik pH, dan spesifikasi perangkat yang statis “Capacitive Soil Moisture Sensor V2.0”. Recent-log table menampilkan moisture dan pH pada baris yang sama. Maka halaman ini memperlakukan pH sebagai atribut satu sensor Moisture, bukan perangkat kedua.

## 13. Historical Data Audit

`HistoricalDataPage.jsx` memakai `historicalApi.js` ke `GET /api/historical-readings`, `/statistics`, dan `/trend`, dengan filter tanggal, `sensorId`/bedengan, pagination, sorting, serta chart trend moisture. `historicalService.js` membaca `sensor_logs` yang sama dan memilih `moisture, soil_ph, temperature, humidity` dalam satu row.

- Tabel historis dapat memuat `soil_ph` karena API reading menyertakannya.
- Statistik dan trend historis hanya menghitung moisture (`getHistoricalStatistics()` dan `getHistoricalTrend()`); tidak ada agregasi pH independen di endpoint historis.
- Export dipicu `DownloadDataModal.jsx` → `POST /api/reports/download`. `reportService.js` membuat CSV, XLSX, dan PDF dengan kolom Soil Moisture dan Soil pH dari row yang sama, serta rata-rata keduanya dalam laporan.

Pemisahan data akan berdampak pada query/filter row, chart, tabel, dan seluruh format export. Nilai pH yang dikirim sekarang juga menciptakan row moisture 0; data historis moisture dan rata-rata bisa sudah tercemar oleh record pH tersebut.

## 14. Recommendation AI Audit

Ada dua bagian berbeda:

1. Backend deterministic recommendation: `GET /api/recommendation/decision` → `getRecommendationForSensor()` → `getSensorData(sensorId)`. Ia hanya memakai `moisture`, `sensorHealth`, dan rainfall; tidak memakai pH (`recommendationService.js` baris 24–33).
2. Halaman `RecommendationAIPage.jsx` mengambil data sensor yang sama dari `sensorApi.getSensorData()`. Ia menetapkan `phRaw` dari `selectedSensorData.soilPh/soil_ph`, membuat `phTrend` dari `selectedSensorData.chart`, menampilkan nilai pH dan trend pH di UI. Karena `getSensorData()` berasal dari row `sensor_id` tunggal yang sama, nilai pH UI tersebut bukan sumber pH independen.

Tidak ditemukan prompt LLM untuk Recommendation AI pada jalur recommendation; keputusan backend adalah rule engine. Data weather/rainfall dikonsumsi untuk keputusan penyiraman, tetapi tidak pH.

## 15. Chatbot Audit

Frontend chatbot memanggil `POST /api/chatbot` dari `src/api/chatbotApi.js`. Backend `chatbotRoutes.js` memanggil `generateChatbotReply()`.

`chatbotService.js` membangun context dari `getNurseryOverview()`, historical moisture statistic/trend, BMKG weather, dan rainfall scoped. Untuk setiap sensor, context hanya menyalin `moisture`, `lastSeen`, `isOnline`, condition, dan `sensorHealth`; `soil_ph` tidak disertakan. Historical context juga moisture-only. System instruction menerima istilah “pH tanah” sebagai topik yang diizinkan, tetapi tidak menyediakan nilai pH aktual kepada Gemini.

Kesimpulan: Chatbot membedakan pH dan Soil Moisture **tidak secara data**; saat ini ia tidak mengirim pH ke LLM sama sekali. Status yang dipakai Chatbot adalah status Soil Moisture yang terkena coupling.

## 16. ESP32 Firmware Audit

Firmware kedua tersedia, sehingga dapat diverifikasi dari source code.

| Aspek | Soil Moisture | pH Tanah |
| --- | --- | --- |
| Folder | `packages/soil-moisture` | `packages/PH-tanah` |
| Board / serial config | ESP32 `esp32dev`, COM3, 115200 | ESP32 `esp32dev`, COM6, 9600 |
| Endpoint | `https://unggulmonitoring.com/api/sensors` | Endpoint yang sama |
| Payload identity | `sensor1..sensor6`, tanpa device identity | `sensor1..sensor6`, tanpa device identity |
| Nilai utama | moisture tiap bedengan, DHT11 | satu pH lalu disiarkan ke semua bedengan |
| Interval kirim | 60.000 ms | 10.000 ms setelah pengukuran/warm-up |
| Payload pH | tidak ada | `soil_ph` dan duplikat alias `ph`, tetapi juga `kelembaban: 0` |
| Auth device | tidak ada | tidak ada |

Kredensial Wi-Fi ada hard-coded di source firmware; nilainya tidak direproduksi dalam laporan ini. Keduanya juga menggunakan `WiFiClientSecure.setInsecure()` untuk HTTPS. Audit tidak mengubahnya.

## 17. Duplicate / Hardcoded / Fallback Findings

| Temuan | Lokasi | Dampak / catatan |
| --- | --- | --- |
| Duplikasi alias pH | Firmware pH mengirim `soil_ph` dan `ph`; backend menerima keduanya | Tidak menyebabkan bug sendiri, tetapi kontrak ganda memperbesar ambiguity |
| Hardcoded moisture pH | `PH-tanah/main.cpp`: `kelembaban:0` | Root cause data moisture 0 dan validasi bypass; bukan pembacaan sensor moisture |
| Broadcast enam bedengan | `PH-tanah/main.cpp`: loop `1..6` | Satu probe pH menghasilkan enam latest reading dan enam heartbeat palsu |
| Default sensor mapping | `sensorService.js` default `sensor1:1 ... sensor6:6` | Mengikat identity logis ke bedengan; tidak membedakan perangkat |
| Auto-register sensor Active | `insertSensorReadings()` upsert `sensors` dengan `status: "Active"` | Bukan online runtime, namun lifecycle device tidak dimodelkan |
| pH calibration hardcode | firmware pH `m`, `c`, range clamp 0–14 | Parameter kalibrasi normal untuk firmware, namun tidak dikonfigurasi dari luar source |
| Frontend fallback moisture classifier | `src/api/sensorApi.js` | Hanya fallback tampilan kondisi 0/30/70 bila field backend tidak ada; bukan fallback pH |
| pH range UI hardcode | `SensorPage.jsx`: target <5 dan >6.5 | Logic presentasi, bukan source data |
| Mock dashboard data | `src/data/dashboardData.js` dan `SummaryCards.jsx` | `SummaryCards` tidak diimpor Dashboard aktif; kandidat dead/legacy UI, tidak ditemukan sebagai penyebab bug |
| Direct Supabase sensor service | `src/services/sensorService.js` | Tidak ditemukan import di aplikasi; kandidat unused/duplicate dengan API `getSensors` |
| Schema duplicate | backend dan frontend schema SQL | Harus dijaga sinkron jika schema diubah; bukan dua database yang dapat dibuktikan |
| Edge Function ingestion terpisah | `supabase/functions/ingest-sensor-reading` | Kontrak berbeda dan tidak mendukung pH; tidak terbukti dipakai |

Tidak ditemukan `Math.random`, mock, sample, atau fallback yang memasok nilai pH pada jalur pH UI. Satu-satunya nilai pH source yang aktif adalah `soil_ph` dari row sensor yang sama.

## 18. Dependency Map

### MUST CHANGE

| File/area | Alasan |
| --- | --- |
| `packages/PH-tanah/src/main.cpp` | Sumber broadcast `sensor1..6`, `kelembaban:0`, endpoint dan identity terkopel |
| `packages/backend/src/services/sensorService.js` | Parser payload, mapping identity, insert, latest query, overview, timestamp dan status health semuanya menjadi pusat coupling |
| Database schema live + migration baru | Schema sekarang mengharuskan moisture dan tidak punya device/type/last pH identity independen |
| `packages/backend/database/schema.sql` dan `packages/frontend/supabase/schema.sql` | Source schema yang mendokumentasikan kontrak perlu disinkronkan dengan migration yang benar-benar dipilih |
| API contract pada `sensorRoutes.js` / `POST /api/sensors` | Kontrak ingestion perlu memuat sumber/jenis perangkat terpisah; route dapat tetap sama atau dipisah, tetapi kontraknya harus berubah |
| `packages/frontend/src/api/sensorApi.js` | Normalisasi respons saat ini mengasumsikan satu `sensorData` memuat moisture+pH+status yang sama |
| `packages/frontend/src/pages/SensorPage.jsx` | Seluruh kartu, chart, log, lastSeen, dan status mengasumsikan satu perangkat per sensor/bedengan |

### MAY NEED CHANGE

| File/area | Alasan |
| --- | --- |
| `packages/soil-moisture/src/main.cpp` | Diperlukan bila protokol baru meminta identity pada semua firmware; tidak wajib bila kompatibilitas backend dipertahankan khusus untuk payload moisture lama |
| `packages/frontend/src/pages/DashboardPage.jsx` dan `components/Dashboard/NurserySummaryCards.jsx` | Overview perlu menampilkan/mengagregasi status dan last measurement pH dari sumber independen |
| `packages/backend/src/services/historicalService.js`, `routes/historicalRoutes.js`, `frontend/src/api/historicalApi.js`, `HistoricalDataPage.jsx` | Historis/filter/trend pH perlu query sumber pH terpisah dan tanpa contaminasi row moisture 0 |
| `packages/backend/src/services/reportService.js`, `routes/reportRoutes.js`, `DownloadDataModal.jsx` | CSV/XLSX/PDF sekarang satu row gabungan; format/report semantics dapat perlu disesuaikan |
| `packages/frontend/src/pages/RecommendationAIPage.jsx` | pH UI/trend harus mengambil sumber baru bila pH dipisahkan |
| `packages/backend/src/services/recommendationService.js`, `routes/recommendationRoutes.js` | Hanya bila rekomendasi di masa depan perlu menggunakan pH atau mengungkapkannya; saat ini decision moisture-only |
| `packages/backend/src/services/chatbotService.js`, `routes/chatbotRoutes.js`, `frontend/src/components/Chatbot/ChatbotAssistant.jsx` | Hanya bila chatbot harus menjawab pH aktual/status independen; kini pH tidak diteruskan ke LLM |
| `packages/frontend/supabase/functions/ingest-sensor-reading/index.ts` | Hanya bila Edge Function akan dijadikan jalur ingestion; saat ini kontraknya moisture-only dan tidak terbukti aktif |
| Tes baru/yang ada di `packages/backend/test/` | Perlu coverage identity, ingest, latest timestamp, status independen, historical/export regression |

### DO NOT NEED CHANGE

| File/area | Alasan |
| --- | --- |
| `rainfallService.js`, `rainfallRoutes.js`, rainfall API/UI | Model dan sumber data rainfall independen; tidak ada coupling pH secara langsung |
| `weatherService.js`, `weatherRoutes.js`, `WeatherCard.jsx` | Mengonsumsi BMKG dan tidak membaca row pH/moisture |
| Auth (`AuthContext.jsx`, auth routes/middleware) | Tidak berhubungan dengan identity perangkat pada endpoint aktif; jangan dicampur dengan perubahan sensor |
| Layout, routing umum, assets, CSS | Tidak menentukan source sensor; cukup disentuh bila UI baru memerlukan tampilan baru |
| `recommendationDecisionEngine.js` | Mengatur keputusan moisture/rainfall; tidak memproses pH sekarang |

## 19. Conflict Risk

| Area | Risiko | Alasan teknis |
| --- | --- | --- |
| Database schema/data migration | HIGH | `moisture NOT NULL`, shared row/timestamp, compatibility view `sensor_logs`, dua source schema, dan data historis pH sudah bercampur dengan moisture 0. Perubahan tanpa strategi backward compatibility dapat mematahkan insert/read/report. |
| Backend ingestion & identity | HIGH | `insertSensorReadings()` dipakai kedua firmware dan merupakan pusat mapping/validasi. Contract baru harus membedakan sumber tanpa mengganggu firmware Soil Moisture saat rollout. |
| Firmware pH | HIGH | Firmware sekarang adalah penyebab langsung; perubahan endpoint/payload/identity perlu diselaraskan dengan backend production. Firmware pH juga tidak berada di npm workspace sehingga workflow build root tidak mencakupnya. |
| Status online/offline | HIGH | Banyak UI, recommendation, dan chatbot bergantung pada `sensorHealth` dari latest row. Salah migrasi dapat kembali memalsukan availability atau menandai perangkat sah offline. |
| Dashboard | MEDIUM | Mengonsumsi overview agregat. Kartu pH dan sensor summary tidak punya source status pH sendiri, sehingga contract response/UI perlu disusun hati-hati. |
| Sensor Page | HIGH | Satu object/API/table log/chart untuk kedua metric. Paling jelas mengalami asumsi “satu perangkat”. |
| Historical/report export | HIGH | CSV/XLSX/PDF menganggap moisture dan pH satu row. Filter/average pH perlu tetap benar dan data legacy perlu ditandai/diperlakukan. |
| Recommendation AI page | MEDIUM | Nilai/trend pH di UI terkopel, tetapi decision engine backend tidak memakai pH. |
| Chatbot | MEDIUM | Tidak mengirim pH ke LLM sekarang; perubahan dapat menambah context tanpa mengubah keputusan moisture/rainfall yang existing. |
| Rainfall/weather | LOW | Sumber tabel/service terpisah. Risiko terutama regresi tidak langsung bila overview contract diubah terlalu luas. |
| Authentication/RLS | LOW | Endpoint sensor aktif tidak memakai auth device; auth user terpisah. Risiko ada hanya bila scope perubahan diperluas ke device authentication. |
| Deployment | MEDIUM | Tidak ada deployment config tracked; cara route produksi `/api/sensors` dan apply migration di hosting tidak dapat diverifikasi. |

## 20. Recommended Implementation Plan

Urutan aman yang disarankan, **bukan implementasi yang telah dilakukan**:

1. **P0 — Kontrak dan identity:** tetapkan model eksplisit untuk perangkat/jenis pembacaan (contoh: device/source/type) dan definisikan apakah satu pH device mengukur satu atau semua bedengan. Saat ini firmware mengirim nilai probe tunggal ke enam bedengan, sehingga pemetaan lokasi harus dikonfirmasi.
2. **P1 — Database design dan migration teruji:** rancang storage pH independen yang dapat menyimpan `value`, `measured_at`, dan source device tanpa moisture palsu. Tetapkan strategi data legacy/compatibility view. Jangan mengasumsikan source SQL sama dengan live database.
3. **P2 — Backend ingestion/read separation:** ubah validasi, insert, latest pH query, latest moisture query, `lastSeen`/status per device, serta overview contract. Pertahankan compatibility sementara bila rollout firmware bertahap diperlukan.
4. **P3 — Firmware:** deploy firmware pH dengan identity dan payload kontrak baru, tanpa broadcast kelembapan 0. Perbarui firmware Soil Moisture bila kontrak baru memerlukannya.
5. **P4 — Sensor Page dan Dashboard:** tampilkan sumber nilai, timestamp, dan status pH serta Soil Moisture secara independen.
6. **P5 — Historical dan export:** pisahkan query/aggregation serta tetapkan cara laporan menampilkan pembacaan yang waktunya berbeda. Validasi PDF/XLSX/CSV.
7. **P6 — Recommendation AI:** gunakan pH source baru untuk UI/logic hanya bila requirement benar-benar menggunakannya; jangan mengubah decision moisture/rainfall tanpa requirement.
8. **P7 — Chatbot:** jika chatbot harus menjawab pH aktual, tambahkan context pH yang memiliki timestamp/status terpisah, bukan borrowing sensor overview moisture.
9. **P8 — Regression and rollout test:** uji empat kondisi: hanya moisture online, hanya pH online, keduanya online, dan pH dilepas. Verifikasi nilai terakhir/timestamp pH, API, dashboard, sensor page, historical, export, recommendation, and chatbot.

## 21. Files Potentially Affected

| File | Current Responsibility | Potential Change | Risk | Reason |
| ---- | ---------------------- | ---------------- | ---- | ------ |
| `packages/PH-tanah/src/main.cpp` | Mengukur pH dan broadcast ke 6 key Soil Moisture | Payload, destination/identity, interval semantics | HIGH | Penyebab langsung coupling dan moisture 0 |
| `packages/soil-moisture/src/main.cpp` | Mengirim moisture+DHT dengan key 1..6 | Tambah identity jika contract baru mewajibkan | HIGH | Sender counterpart pada endpoint sama |
| `packages/backend/src/routes/sensorRoutes.js` | POST ingestion dan GET data sensor | Contract/route pH terpisah atau dispatch | HIGH | Pintu masuk aktif firmware |
| `packages/backend/src/services/sensorService.js` | Mapping, insert, latest, overview, health | Pisah parser/store/query/status pH-moisture | HIGH | Sumber utama coupling |
| `packages/backend/database/schema.sql` | Schema backend reference | Represent device/reading pH independen | HIGH | `moisture NOT NULL`, shared row |
| `packages/backend/database/safe_migration.sql` | Safe schema migration/view | Reference/compatibility review atau migration successor | HIGH | Mendefinisikan `soil_ph` dan `sensor_logs` view |
| `packages/frontend/supabase/schema.sql` | Schema/RLS reference | Sinkron dengan desain schema | HIGH | Duplikat contract schema |
| `packages/frontend/src/api/sensorApi.js` | API frontend dan normalisasi model tunggal | Model response pH/moisture terpisah | HIGH | Mengubah `soil_ph` menjadi `soilPh` dalam object shared |
| `packages/frontend/src/pages/SensorPage.jsx` | Menampilkan detail/status/chart/log satu sensor | UI data/status/timestamp per device | HIGH | Semua pH/moisture berasal dari satu `sensorData` |
| `packages/frontend/src/pages/DashboardPage.jsx` | Poll overview | Render overview contract baru | MEDIUM | Dashboard source status shared |
| `packages/frontend/src/components/Dashboard/NurserySummaryCards.jsx` | Rata-rata pH dan summary | Label/source/status pH independen | MEDIUM | `averageSoilPh` dari latest row sama |
| `packages/backend/src/services/historicalService.js` | Query and aggregate historical readings | Query/source pH independent | HIGH | Select shared row; statistic/trend moisture-only |
| `packages/frontend/src/pages/HistoricalDataPage.jsx` | Historical table/chart/filter | Present/filter data pH independent | HIGH | Page derives from mixed rows |
| `packages/backend/src/services/reportService.js` | CSV/XLSX/PDF rows and averages | Format multi-source readings | HIGH | Assumes shared pH/moisture row |
| `packages/frontend/src/components/Dashboard/DownloadDataModal.jsx` | Export request UI | Filter/report type if contract changes | MEDIUM | Calls shared sensor report |
| `packages/frontend/src/pages/RecommendationAIPage.jsx` | pH panel/trend and recommendation UI | Read pH source separately | MEDIUM | pH derives from `getSensorData` shared object |
| `packages/backend/src/services/chatbotService.js` | Builds LLM context | Add independent pH context only if required | MEDIUM | Current pH omitted, health borrowed from moisture |
| `packages/frontend/supabase/functions/ingest-sensor-reading/index.ts` | Alternative Supabase Edge ingestion | Only if adopted | MEDIUM | Has device-key concept but moisture-only and unreferenced |

## 22. Things That Must Not Be Changed

At minimum, keep the following out of the separation scope unless a concrete dependency is proven during implementation:

- Rainfall storage, rainfall CRUD, rainfall freshness and scoped rainfall lookup.
- BMKG weather integration.
- Authentication/session/audit functionality and user RLS policies.
- Generic app routing/layout/assets/styles.
- Moisture classification thresholds and deterministic watering rule engine, unless a separately approved requirement changes those policies.
- Existing data deletion or destructive rewrite; legacy mixed readings must be handled through an explicit reviewed migration/data policy.

## 23. Final Audit Conclusion

1. **Mengapa pH dan Soil Moisture saling terikat?** Karena firmware pH menyamar sebagai `sensor1..sensor6` Soil Moisture, mengirim ke endpoint/service/table yang sama, dan menambahkan `soil_ph` pada record moisture dengan nilai hardcoded `0`.
2. **Sumber utama coupling?** `packages/PH-tanah/src/main.cpp::sendDataToServer()` dan `packages/backend/src/services/sensorService.js::insertSensorReadings()`; coupling lalu diperkuat oleh `getSensorData()`/`getNurseryOverview()` yang memakai latest row per `sensor_id`.
3. **Apakah pemisahan membutuhkan perubahan database?** **YA, sangat kemungkinan diperlukan** untuk pemisahan yang benar. Schema sekarang tidak dapat menulis pH-only reading (`moisture NOT NULL`) dan tidak memiliki device/type/timestamp independen. Bentuk tepat perubahan harus diputuskan setelah desain identity disetujui.
4. **Apakah membutuhkan perubahan API?** **YA.** Ingestion aktif harus dapat membedakan sumber/jenis perangkat; read API perlu memberi nilai/timestamp/status pH dan moisture secara terpisah.
5. **Apakah membutuhkan perubahan firmware ESP32?** **YA untuk firmware pH.** Ia harus berhenti broadcast sebagai enam Soil Moisture record dan mengirim identity/kontrak pH sendiri. Firmware Soil Moisture mungkin perlu diubah bila protocol identity baru diterapkan ke semua sender.
6. **File apa yang benar-benar perlu disentuh?** Minimal firmware pH, sensor route/service backend, migration/schema yang authoritative, frontend sensor API, dan Sensor Page. Dashboard/historical/export/Recommendation UI perlu disesuaikan karena konsumsi shared data; daftar tepat ada di bagian 21.
7. **Risiko regression terbesar?** Database/compatibility view serta historical/export, karena pH sekarang tersimpan dalam row moisture 0 dan seluruh downstream memperlakukan keduanya sebagai satu pembacaan.
8. **Urutan paling aman?** Identity/contract → database migration teruji → backend separation/status → firmware rollout → UI Dashboard/Sensor → historical/export → AI/chatbot bila diperlukan → regression test empat kondisi perangkat.

## 24. Scope and Verifiability Notes

- Nilai environment secret, password Wi-Fi, token, API key, dan private key tidak dicetak dalam laporan.
- Schema/deployment/database production state, data production aktual, DNS/routing deployment, dan apakah Supabase Edge Function dipanggil dari luar repository: **Tidak dapat diverifikasi dari repository saat ini.**
- Tidak ada build/lint/test dijalankan karena audit source/static trace sudah cukup untuk root cause, dan user meminta tahap tanpa implementasi. Tidak ada auto-fix atau command mutasi.

