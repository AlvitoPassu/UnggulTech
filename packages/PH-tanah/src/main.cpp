#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ================= INPUT OUTPUT =================
#define DMSpin     13    // pin output untuk DMS
#define indikator  2     // pin output led built-in untuk indikator pembacaan sensor
#define adcPin     34    // pin input sensor pH tanah

// ================= VARIABEL =====================
int ADC;
float lastReading;
float pH;

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
  Serial.begin(115200);          // setting baudrate komunikasi serial
  analogReadResolution(10);      // setting resolusi pembacaan ADC menjadi 10 bit
  pinMode(DMSpin, OUTPUT);
  pinMode(indikator, OUTPUT);
  digitalWrite(DMSpin, HIGH);     // non-aktifkan DMS

  // Hubungkan WiFi saat awal booting
  connectToWiFi();
}

void loop() {
  digitalWrite(DMSpin, LOW);      // aktifkan DMS
  digitalWrite(indikator, HIGH); // led indikator built-in ESP32 menyala
  delay(10 * 1000);              // wait DMS capture data
  ADC = analogRead(adcPin); 

  pH = (-0.0233 * ADC) + 12.698;  // rumus regresi linier konversi adc ke pH
  if (pH != lastReading) { 
    lastReading = pH; 
  }

  if(lastReading > 14.0){lastReading = 0.0;}  // nol kan nilai pH saat out of range

  Serial.print("ADC=");
  Serial.print(ADC);             // menampilkan nilai ADC di serial monitor pada baudrate 115200
  Serial.print(" pH=");
  Serial.println(lastReading, 1); // menampilkan nilai pH di serial monitor pada baudrate 115200

  digitalWrite(DMSpin, HIGH);
  digitalWrite(indikator, LOW);

  // Kirim data pH ke backend server
  sendDataToServer(lastReading);

  delay(50 * 1000);              // tunggu 50 detik (total siklus = 10s baca + 50s jeda = 60 detik / 1 menit)
}
