// sensor 1

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFi.h>
#include <WebServer.h>

// Isi dengan nama WiFi rumah/kantor Anda.
const char* ssid = "unklab";
const char* password = "11111111";

// Ganti setelah backend dideploy ke Railway.
// Contoh:
// const char* serverUrl = "https://renderesp8266-production.up.railway.app/api/sensor";
// const char* pingUrl = "https://renderesp8266-production.up.railway.app/ping";
const char* serverUrl = "https://renderesp8266-production.up.railway.app/api/sensor";
const char* pingUrl = "https://renderesp8266-production.up.railway.app/ping";

// Pin ADC default ESP32 untuk membaca sensor kelembaban tanah.
// Ubah ke pin ADC lain jika rangkaian Anda memakai pin berbeda.
const int soilSensorPin = 34;

// Web server berjalan pada port 80.
WebServer server(80);
WiFiClient wifiClient;
WiFiClientSecure secureWifiClient;

// Variabel global untuk menyimpan hasil pembacaan sensor terakhir.
int adcValue = 0;
int moisturePercent = 0;
String soilStatus = "Tidak tersedia";

// Fungsi untuk menentukan status tanah berdasarkan persentase kelembaban.
String getSoilStatus(int kelembaban) {
    if (kelembaban >= 0 && kelembaban <= 30) {
        return "Kering";
    }

    if (kelembaban <= 70) {
        return "Lembab";
    }

    return "Basah";
}

// Membaca sensor dari pin ADC ESP32, lalu mengubahnya ke persentase 0-100.
void readSoilSensor() {
    adcValue = analogRead(soilSensorPin);

    // map() digunakan untuk mengubah nilai ADC menjadi persentase.
    // Sesuaikan rentang ini jika hasil sensor Anda perlu dikalibrasi.
    moisturePercent = map(adcValue, 4095, 1515, 0, 100);

    // constrain() memastikan hasil tetap berada pada rentang 0 sampai 100.
    moisturePercent = constrain(moisturePercent, 0, 100);

    soilStatus = getSoilStatus(moisturePercent);
}

// Menangani request ke endpoint /data dan mengirim respons JSON.
void handleData() {
    readSoilSensor();

    String json = "{";
    json += "\"kelembaban\":" + String(moisturePercent) + ",";
    json += "\"status\":\"" + soilStatus + "\",";
    json += "\"adc\":" + String(adcValue);
    json += "}";

    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", json);
}

// Endpoint root dipakai untuk memastikan web server benar-benar bisa dijangkau.
void handleRoot() {
    server.send(200, "text/plain", "ESP32 Web Server aktif. Coba buka /data untuk melihat JSON sensor.");
}

// Menangani halaman yang tidak ditemukan.
void handleNotFound() {
    server.send(404, "text/plain", "Endpoint tidak ditemukan");
}

// Menghubungkan ESP32 ke WiFi router yang Anda pakai.
void connectToWiFi() {
    const unsigned long wifiTimeout = 20000;
    const unsigned long startAttempt = millis();

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
        Serial.println("Gunakan IP ini di browser atau file Website/script.js");
    } else {
        Serial.println("WiFi belum terhubung");
        Serial.println("Periksa SSID dan password, lalu upload ulang");
    }
}

// Menyiapkan endpoint-endpoint web server.
void setupServer() {
    server.on("/", HTTP_GET, handleRoot);
    server.on("/data", HTTP_GET, handleData);
    server.onNotFound(handleNotFound);
    server.begin();

    Serial.println("Web Server aktif pada port 80");
    Serial.println("Endpoint tersedia: /");
    Serial.println("Endpoint tersedia: /data");
}

bool beginHttpClient(HTTPClient& http, const String& targetUrl) {
    if (targetUrl.startsWith("https://")) {
        secureWifiClient.setInsecure();
        http.begin(secureWifiClient, targetUrl);
        http.setTimeout(15000);
        return true;
    }

    http.begin(wifiClient, targetUrl);
    http.setTimeout(15000);
    return true;
}

// Mengirim data sensor ke backend Railway dengan metode POST JSON.
void sendDataToServer() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("Gagal kirim data: WiFi belum terhubung");
        return;
    }

    HTTPClient http;
    String targetUrl = String(serverUrl);
    String jsonPayload = "{";
    jsonPayload += "\"kelembaban\":" + String(moisturePercent) + ",";
    jsonPayload += "\"status\":\"" + soilStatus + "\",";
    jsonPayload += "\"adc\":" + String(adcValue);
    jsonPayload += "}";
    int httpResponseCode = -1;

    beginHttpClient(http, targetUrl);

    http.addHeader("Content-Type", "application/json");
    httpResponseCode = http.POST(jsonPayload);

    Serial.print("Kirim data ke server: ");
    Serial.println(targetUrl);
    Serial.print("Payload JSON: ");
    Serial.println(jsonPayload);
    Serial.print("HTTP Response: ");
    Serial.println(httpResponseCode);

    if (httpResponseCode <= 0) {
        Serial.print("Keterangan Error: ");
        Serial.println(http.errorToString(httpResponseCode));
        Serial.println("Kemungkinan masalah: URL Railway salah, service belum aktif, atau koneksi HTTPS gagal");
    } else {
        Serial.println("Data berhasil dikirim ke backend");
        Serial.print("Respons Server: ");
        Serial.println(http.getString());
    }

    http.end();
}

// Menguji konektivitas dasar ke backend sebelum mengirim data sensor.
void testBackendConnection() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("Tes backend gagal: WiFi belum terhubung");
        return;
    }

    HTTPClient http;
    String targetUrl = String(pingUrl);
    int httpResponseCode = -1;

    beginHttpClient(http, targetUrl);
    httpResponseCode = http.GET();

    Serial.print("Tes koneksi backend: ");
    Serial.println(targetUrl);
    Serial.print("HTTP Response Ping: ");
    Serial.println(httpResponseCode);

    if (httpResponseCode > 0) {
        String responseBody = http.getString();
        Serial.print("Respons Ping: ");
        Serial.println(responseBody);
    } else {
        Serial.print("Error Ping: ");
        Serial.println(http.errorToString(httpResponseCode));
    }

    http.end();
}

void setup() {
    Serial.begin(9600);
    delay(2000);

    Serial.println();
    Serial.println("Booting ESP32...");
    Serial.println("Memulai sistem monitoring kelembaban tanah...");

    connectToWiFi();
    setupServer();
    testBackendConnection();
}

void loop() {
    // Selalu dengarkan request dari browser atau client lain.
    server.handleClient();

    // Tampilkan pembacaan sensor ke Serial Monitor setiap 2 detik.
    static unsigned long lastSerialUpdate = 0;
    const unsigned long serialInterval = 2000;
    static unsigned long lastServerUpdate = 0;
    const unsigned long serverInterval = 5000;

    if (millis() - lastSerialUpdate >= serialInterval) {
        lastSerialUpdate = millis();
        readSoilSensor();

        Serial.println("----- Data Sensor -----");
        Serial.print("Status WiFi: ");
        Serial.println(WiFi.status() == WL_CONNECTED ? "Terhubung" : "Terputus");
        Serial.print("IP ESP32: ");
        Serial.println(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "Belum tersedia");
        Serial.print("Nilai ADC: ");
        Serial.println(adcValue);
        Serial.print("Kelembaban: ");
        Serial.print(moisturePercent);
        Serial.println("%");
        Serial.print("Status Tanah: ");
        Serial.println(soilStatus);
        Serial.println("-----------------------");
    }

    // Kirim data ke backend secara berkala agar dashboard bisa dipantau dari internet lain.
    if (millis() - lastServerUpdate >= serverInterval) {
        lastServerUpdate = millis();
        readSoilSensor();
        sendDataToServer();
    }
}
