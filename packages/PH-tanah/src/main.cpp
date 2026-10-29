#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

/* Syarat Pengoperasian Berdasarkan Pabrikan *******
 * 1. Tanah wajib lembab dan padat.
 * 2. Pembacaan di air bening TANPA TANAH tidak valid.
 * 3. Minimal ujung sensor masuk sedalam 8cm.
***************************************************/

// ================= INPUT OUTPUT =================
#define DMSpin     13    // Pin output untuk menyalakan/mematikan DMS
#define indikator  2     // Pin LED built-in ESP32
#define adcPin     34    // Pin input analog dari Sensor

// ================= KONFIGURASI WIFI =============
const char* ssid = "sensorsoil";
const char* password = "unklab123";

// ================= KONFIGURASI SERVER ===========
const char* serverUrl = "https://unggulmonitoring.com/api/sensors/ph";

// ================= CLIENT SECURE ================
WiFiClientSecure secureWifiClient;
WiFiClient wifiClient;

// Helper untuk koneksi HTTP / HTTPS
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

// Inisialisasi koneksi WiFi
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

// Kirim data pembacaan pH ke server
void sendDataToServer(float phValue) {
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
  String jsonPayload = "{\"soil_ph\":" + String(phValue, 2) + "}";

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

void setup() {
  Serial.begin(115200);          // Baudrate 115200 (sesuai monitor_speed di platformio.ini)
  analogReadResolution(10);      // WAJIB: ESP32 dipaksa ke resolusi 10-bit (0-1023)
  
  pinMode(DMSpin, OUTPUT);
  pinMode(indikator, OUTPUT);
  digitalWrite(DMSpin, HIGH);    // Matikan DMS saat pertama kali menyala (Standby)
  
  Serial.println("Sistem Sensor pH Tanah (DMS) Siap!");

  // Hubungkan WiFi saat awal booting
  connectToWiFi();
}

void loop() {
  Serial.println("Mengaktifkan sensor... Menunggu 10 detik agar reaksi tanah stabil...");
  
  digitalWrite(DMSpin, LOW);     // Aktifkan DMS
  digitalWrite(indikator, HIGH); // Nyalakan LED biru ESP32 tanda sedang membaca
  
  delay(10000);                  // Jeda 10 detik wajib dari pabrik agar sinyal matang
  
  // --- MULAI PROSES SMOOTHING (MENGAMBIL 30 DATA) ---
  long totalAnalog = 0;
  int jumlahSampel = 30;
  
  for(int i = 0; i < jumlahSampel; i++) {
    totalAnalog += analogRead(adcPin);
    delay(10);
  }
  
  float ADC_rata_rata = (float)totalAnalog / jumlahSampel;
  // --------------------------------------------------
  
  // Rumus kalibrasi bawaan pabrik penjual
  float pH = (-0.0233 * ADC_rata_rata) + 12.698;  
  
  // Filter jika nilai error / di luar nalar
  if(pH > 14.0) { pH = 0.0; }
  if(pH < 0.0)  { pH = 0.0; }
  
  // Tampilkan hasil ke terminal
  Serial.print("Nilai ADC (Rata-rata) = ");
  Serial.print(ADC_rata_rata, 1);             
  Serial.print(" | pH Tanah = ");
  Serial.println(pH, 1); 

  digitalWrite(DMSpin, HIGH);    // Matikan modul DMS agar sensor awet
  digitalWrite(indikator, LOW);  // Matikan LED
  
  // Kirim data pH ke backend server
  sendDataToServer(pH);

  Serial.println("Sensor istirahat 50 detik...");
  Serial.println("------------------------------------");
  delay(50000);                  // Jeda istirahat agar total siklus tepat 1 menit (60 detik)
}
