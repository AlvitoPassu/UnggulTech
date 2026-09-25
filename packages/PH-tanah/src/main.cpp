#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ================= PIN CONFIGURATION =================
#define DMS_PIN     13    // Pin kontrol untuk modul DMS (kotak biru)
#define LED_PIN     2     // Pin LED built-in ESP32 sebagai indikator
#define ADC_PIN     34    // Pin input analog dari sensor pH

// ================= KALIBRASI ANDA ====================
// Nilai ini didapat dari kalibrasi buffer 6.86 dan 4.01
float m = -0.0129;  
float c = 26.39;    
// =====================================================

// =====================================================
// WIFI
// =====================================================

const char* ssid = "sensorsoil";
const char* password = "unklab123";

// =====================================================
// SERVER
// =====================================================

// Backend VPS Anda
const char* serverUrl =
    "https://unggulmonitoring.com/api/sensors/ph";

// Endpoint health check backend
const char* pingUrl =
    "https://unggulmonitoring.com/health";

// ================= CLIENT SECURE =====================
WiFiClientSecure secureWifiClient;
WiFiClient wifiClient;

// ================= HELPER HTTP CLIENT =================
bool beginHttpClient(HTTPClient& http, const String& targetUrl) {
  if (targetUrl.startsWith("https://")) {
    secureWifiClient.setInsecure(); // Mengabaikan verifikasi sertifikat SSL
    http.begin(secureWifiClient, targetUrl);
    http.setTimeout(15000);
    return true;
  }

  http.begin(wifiClient, targetUrl);
  http.setTimeout(15000);
  return true;
}

// ================= KONEKSI WIFI =======================
void connectToWiFi() {
  const unsigned long wifiTimeout = 20000;
  const unsigned long startAttempt = millis();

  Serial.println();
  Serial.println("Menghubungkan ke WiFi...");
  Serial.print("SSID: ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < wifiTimeout) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi berhasil terhubung");
    Serial.print("Alamat IP ESP32: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi belum terhubung");
    Serial.println("Periksa SSID dan password");
  }
}

// ================= TEST KONEKSI BACKEND ===============
void testBackendConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Tes backend gagal: WiFi belum terhubung");
    return;
  }

  HTTPClient http;
  String targetUrl = String(pingUrl);

  beginHttpClient(http, targetUrl);
  int httpResponseCode = http.GET();

  Serial.println();
  Serial.print("Tes backend: ");
  Serial.println(targetUrl);
  Serial.print("HTTP Response: ");
  Serial.println(httpResponseCode);

  if (httpResponseCode > 0) {
    String responseBody = http.getString();
    Serial.print("Respons: ");
    Serial.println(responseBody);
  } else {
    Serial.print("Error: ");
    Serial.println(http.errorToString(httpResponseCode));
  }

  http.end();
}

// ================= KIRIM DATA KE SERVER ===============
void sendDataToServer(float adcValue, float pHValue) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi terputus, mencoba menghubungkan kembali...");
    WiFi.disconnect();
    WiFi.begin(ssid, password);
    unsigned long startRetry = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startRetry < 5000) {
      delay(500);
      Serial.print(".");
    }
    Serial.println();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Gagal kirim data: WiFi belum terhubung");
      return;
    }
  }

  HTTPClient http;
  String targetUrl = String(serverUrl);

  // Satu probe pH menghasilkan satu pembacaan global. Jangan kirim sebagai
  // sensor1..sensor6 atau menyertakan dummy moisture.
  String jsonPayload = "{\"soil_ph\":" + String(pHValue, 2) + "}";

  beginHttpClient(http, targetUrl);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.POST(jsonPayload);

  Serial.println();
  Serial.println("========== SERVER ==========");
  Serial.print("URL: ");
  Serial.println(targetUrl);
  Serial.print("Payload: ");
  Serial.println(jsonPayload);
  Serial.print("HTTP Response: ");
  Serial.println(httpResponseCode);

  if (httpResponseCode <= 0) {
    Serial.print("Keterangan Error: ");
    Serial.println(http.errorToString(httpResponseCode));
  } else {
    Serial.println("Data berhasil dikirim ke backend");
    Serial.print("Respons Server: ");
    Serial.println(http.getString());
  }
  Serial.println("============================");

  http.end();
}

// ================= FUNGSI PEMBACAAN RATA-RATA =================
float bacaADC_RataRata() {
  long totalAnalog = 0;
  int jumlahSampel = 30; 

  for(int i = 0; i < jumlahSampel; i++){
    totalAnalog += analogRead(ADC_PIN);
    delay(10); // Jeda 10ms antar sampel
  }
  
  return (float)totalAnalog / jumlahSampel;
}

void setup() {
  Serial.begin(9600); // Sesuaikan dengan platformio.ini
  
  // Gunakan resolusi 12-bit (0-4095) agar sama dengan kode kalibrasi
  analogReadResolution(12); 
  
  pinMode(DMS_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  
  // Matikan sensor dan LED di awal
  digitalWrite(DMS_PIN, HIGH); // HIGH = DMS Off
  digitalWrite(LED_PIN, LOW);  // LOW = LED Off
  
  Serial.println("==================================================");
  Serial.println("       SISTEM MONITORING pH TANAH AKTIF           ");
  Serial.println("==================================================");
  delay(1000);

  // Inisialisasi WiFi & Test Backend
  connectToWiFi();
  testBackendConnection();
}

void loop() {
  // 1. Nyalakan Sensor (DMS) dan Indikator LED
  digitalWrite(DMS_PIN, LOW);  // LOW = DMS On
  digitalWrite(LED_PIN, HIGH); // HIGH = LED On
  
  // 2. Tunggu sensor stabil (Warm-up)
  delay(5000); 
  
  // 3. Baca nilai ADC dengan metode rata-rata
  float adcValue = bacaADC_RataRata();
  
  // 4. Hitung nilai pH menggunakan rumus kalibrasi Anda
  float pHValue = (m * adcValue) + c;
  
  // 5. Batasi nilai pH agar tidak error (Out of range protection)
  if (pHValue > 14.0) pHValue = 14.0;
  if (pHValue < 0.0)  pHValue = 0.0;
  
  // 6. Tampilkan hasil ke Serial Monitor
  Serial.print("ADC: ");
  Serial.print(adcValue, 0); // Tampilkan ADC tanpa desimal
  Serial.print(" | pH Tanah: ");
  Serial.println(pHValue, 2); // Tampilkan pH dengan 2 desimal
  
  // 7. Matikan Sensor (DMS) dan Indikator LED
  // WAJIB dimatikan agar probe logam tidak berkarat saat ditanam!
  digitalWrite(DMS_PIN, HIGH); // HIGH = DMS Off
  digitalWrite(LED_PIN, LOW);  // LOW = LED Off
  
  // 8. Kirim data hasil pengukuran ke backend server web
  sendDataToServer(adcValue, pHValue);
  
  // 9. Jeda sebelum pengukuran berikutnya
  // Anda bisa memperlama jeda ini (misal 1 menit / 60000ms) jika ingin menghemat daya.
  delay(10000); 
}
