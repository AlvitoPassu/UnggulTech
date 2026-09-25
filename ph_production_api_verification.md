# Verifikasi Production API: Soil pH Global

Tanggal: 25 September 2026 (WITA)

## Scope dan Batasan

Tahap ini memverifikasi source backend, test backend, tabel pH production secara read-only, serta availability endpoint production. Tidak ada migration baru, deploy/restart backend, POST pH production, perubahan Soil Moisture, flashing ESP32, commit, atau push.

Pengujian production dihentikan pada route check sesuai instruksi, karena endpoint pH masih HTTP 404. Oleh sebab itu tidak ada data pH test yang dibuat dan tidak ada data Soil Moisture yang diubah.

## Production Database

```text
soil_ph_readings exists: YES
columns verified: YES — id, ph_value, measured_at dapat di-query read-only
constraint verified: YES — dikonfirmasi operator: PRIMARY KEY(id), CHECK 0 <= ph_value <= 14
index verified: YES — dikonfirmasi operator: soil_ph_readings_measured_at_idx (measured_at DESC)
```

Read-only query production terhadap `public.soil_ph_readings` berhasil dan menghasilkan:

```text
ROW_COUNT: 0
ROWS_RETURNED: 0
```

Jadi migration telah tersedia dan tabel kosong sebelum pembacaan pH pertama. Constraint dan index dicatat berdasarkan konfirmasi manual operator pada request ini; query REST read-only hanya memverifikasi tabel serta tiga kolom dapat dibaca.

## Backend Source Final

| Check | Result |
| --- | --- |
| `POST /api/sensors/ph` | PASS — tersedia di `sensorRoutes.js` |
| `GET /api/sensors/ph` | PASS — tersedia di `sensorRoutes.js` |
| `GET /api/sensors/ph/history` | PASS — tersedia di `sensorRoutes.js` |
| Routing order | PASS — route `/ph` didefinisikan sebelum route `/:sensorId/...` |
| PGRST205 latest fallback | PASS — `getLatestSoilPh()` mengembalikan `no_data` |
| PGRST205 history fallback | PASS — `getSoilPhHistory()` mengembalikan `[]` |
| PGRST205 write behavior | PASS — `createSoilPhReading()` tetap melempar error |
| Soil Moisture isolation source | PASS — pH hanya menulis `soil_ph_readings`; tidak memakai `sensor_id`/`sensor_logs` |

## Backend Tests

```text
Command: node --test packages/backend/test/*.test.js
PASS: 25
FAIL: 0
```

Syntax check untuk `soilPhService.js`, `sensorRoutes.js`, dan `sensorService.js` juga PASS.

## Backend Deployment

```text
deployment mechanism: BLOCKED
backend deployed: NO
backend restarted: NO
```

Repository tidak memuat konfigurasi atau dokumentasi deployment production yang dapat dipakai untuk `https://unggulmonitoring.com`: tidak ada PM2 ecosystem config, Docker/Compose, systemd unit, CI workflow, hosting configuration, deploy script, atau startup documentation. File `packages/backend/package.json` hanya mendefinisikan `start: node src/server.js`; ini membuktikan cara menjalankan aplikasi Node secara lokal, bukan cara mengakses/restart server production.

Tidak ada tindakan deploy/restart yang dilakukan, karena menebak nama service, target SSH, atau supervisor production dapat mengganggu layanan yang sedang berjalan.

## API Production

| Endpoint | Result | Evidence |
| --- | --- | --- |
| `GET /api/sensors/ph` | FAIL | `https://unggulmonitoring.com/api/sensors/ph` mengembalikan HTTP 404. |
| `POST /api/sensors/ph` | NOT TESTED | Dihentikan: backend production belum memuat route pH. |
| `GET /api/sensors/ph/history` | NOT TESTED | Dihentikan: backend production belum memuat route pH. |

Karena GET latest bukan HTTP sukses, Test 1 gagal. Tidak aman untuk meneruskan POST pH atau test isolasi production sampai backend terbaru berhasil dideploy dan route tersedia.

## First Valid Reading

```text
soilPh: NOT TESTED
measuredAt: NOT TESTED
status: NOT TESTED
isActive: NOT TESTED
```

Tidak ada POST `6.4` dilakukan. Database tetap berisi nol row pH pada akhir verifikasi ini.

## Isolation

```text
pH created moisture reading: NOT TESTED production; NO pada automated test/source path
pH changed moisture lastSeen: NOT TESTED production; NO pada automated test/source path
pH changed moisture online status: NOT TESTED production; NO pada automated test/source path
```

Snapshot Soil Moisture before/after tidak diambil karena tidak ada POST pH yang boleh dibandingkan. Test automated membuktikan request pH global menulis satu record ke `soil_ph_readings`, sedangkan payload legacy pH pada jalur moisture ditolak sebelum insert.

## Validation

```text
-1: PASS automated (HTTP 400 path); NOT TESTED production
15: PASS automated (HTTP 400 path); NOT TESTED production
latest valid preserved: PASS automated; NOT TESTED production
```

## Inactive Persistence

```text
last value: PASS automated — valid value terakhir tetap dikembalikan
last measuredAt: PASS automated — timestamp valid terakhir tetap dikembalikan
status after threshold: PASS automated — inactive setelah 90 detik default
production verification: NOT TESTED
```

## Reactivation

```text
new value: NOT TESTED production
new measuredAt: NOT TESTED production
status: NOT TESTED production
```

Tidak ada POST `6.6` dilakukan dan tidak ada row pH yang ditambahkan.

## Database Row Count

```text
Global pH rows before test: 0
Global pH rows created during test: 0
Global pH rows after test: 0
Duplicate per-bedengan: NO data created; automated path guarantees one global insert per POST
```

## Legacy Payload Protection

**PASS automated.** Test existing tetap membuktikan payload `status: "pH Monitor"` dengan `soil_ph` pada route Soil Moisture ditolak sebelum upsert/insert.

## Frontend Smoke Test

```text
Dashboard: NOT TESTED — production pH API 404
Sensor Page: NOT TESTED — production pH API 404
Historical: NOT TESTED — production pH API 404
Recommendation AI: NOT TESTED — production pH API 404
```

Tidak ada perubahan UI pada tahap ini.

## Required Manual Deployment Step

Mekanisme deploy tidak dapat ditentukan dari repository. Operator production perlu memakai prosedur release yang memang digunakan untuk server `unggulmonitoring.com` untuk memasang source backend terbaru, lalu restart **hanya** proses backend yang telah diidentifikasi secara pasti. Jangan menebak command PM2/systemd/Docker.

Sesudah backend aktif, jalankan berurutan:

1. `GET /api/sensors/ph` — harus HTTP 200 dan `no_data` saat tabel masih kosong.
2. Snapshot latest Soil Moisture seluruh bedengan.
3. `POST /api/sensors/ph` dengan `soil_ph: 6.4`.
4. GET latest/history, read-only row verification, dan perbandingan snapshot Soil Moisture.
5. Test invalid `-1`/`15`, inactive persistence, lalu reactivation `6.6`.
6. Smoke test frontend sebelum firmware pH diflash.

## Final Decision

```text
NOT READY FOR ESP32 pH FIRMWARE DEPLOYMENT
```

Blocker utama: backend production belum terdeploy dengan endpoint pH; `GET /api/sensors/ph` masih HTTP 404. Critical production tests (GET latest, POST valid, history, isolation, invalid validation, last-valid persistence, dan reactivation) belum boleh dilakukan sampai blocker ini selesai.

## Final Summary

```text
PRODUCTION pH API STATUS:
- Database migration: APPLIED
- Database structure: VERIFIED
- Backend deployed: NO (deployment mechanism BLOCKED)
- GET pH: FAIL (HTTP 404)
- POST pH: NOT TESTED
- pH history: NOT TESTED
- Global one-reading behavior: NOT TESTED production; PASS automated
- pH → moisture isolation: NOT TESTED production; PASS automated
- Invalid pH protection: NOT TESTED production; PASS automated
- Last valid pH persistence: NOT TESTED production; PASS automated
- Reactivation: NOT TESTED production
- Frontend smoke test: NOT TESTED
- Backend tests: 25 PASS, 0 FAIL
- Ready to flash ESP32 pH: NO
- Git commit performed: NO
- Git push performed: NO
- Report: ph_production_api_verification.md
```
