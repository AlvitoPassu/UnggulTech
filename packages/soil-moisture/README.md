# Soil Moisture Firmware

Folder ini dipisahkan dari frontend agar kode Arduino/PlatformIO tetap rapi.

## Struktur

- `platformio.ini`: konfigurasi PlatformIO
- `src/main.cpp`: program utama Arduino

## Cara pakai

1. Masuk ke folder ini:

   ```powershell
   cd firmware/soil-moisture
   ```

2. Build firmware:

   ```powershell
   pio run
   ```

3. Upload ke board:

   ```powershell
   pio run --target upload
   ```

4. Buka serial monitor:

   ```powershell
   pio device monitor
   ```

## Catatan sensor

Kode contoh saat ini membaca sensor dari pin `A0` dan mengubah nilai mentah menjadi persen.
Nilai `AIR_VALUE` dan `WATER_VALUE` di `src/main.cpp` perlu dikalibrasi sesuai sensor Anda.

## Jika board bukan Arduino Uno

Ubah bagian ini di `platformio.ini`:

```ini
board = uno
```

Misalnya untuk beberapa board umum:

- `nodemcuv2`
- `esp32dev`
- `nanoatmega328`
