#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>

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
    "https://unggulmonitoring.com/api/sensors";

// Endpoint health check backend
const char* pingUrl =
    "https://unggulmonitoring.com/health";

// =====================================================
// DHT11
// JANGAN UBAH WIRING INI
// =====================================================

// DATA -> GPIO32

#define DHT_PIN  32
#define DHT_TYPE DHT11

DHT dht(DHT_PIN, DHT_TYPE);

// =====================================================
// CD74HC4067
// JANGAN UBAH WIRING INI
// =====================================================

// SIG -> GPIO34
// S0  -> GPIO14
// S1  -> GPIO27
// S2  -> GPIO26
// S3  -> GPIO25

constexpr int muxSigPin = 34;
constexpr int muxS0Pin = 14;
constexpr int muxS1Pin = 27;
constexpr int muxS2Pin = 26;
constexpr int muxS3Pin = 25;

// =====================================================
// CHANNEL SENSOR
// =====================================================

constexpr uint8_t sensor1Channel = 0; // CH0
constexpr uint8_t sensor2Channel = 1; // CH1

// =====================================================
// INTERVAL
// =====================================================

constexpr unsigned long serialInterval = 5000;   // Serial monitor tiap 5 detik (debug lokal)
constexpr unsigned long serverInterval = 60000;  // Kirim ke server tiap 1 menit

// Jumlah pembacaan ADC setiap sensor
constexpr uint8_t sensorSamplesPerRead = 8;

// Waktu settling setelah pindah channel
constexpr uint8_t muxSettleDelayMs = 5;

// =====================================================
// STRUKTUR SENSOR
// =====================================================

struct SensorReading {

    uint8_t channel;

    int adcValue;

    int moisturePercent;

    String soilStatus;
};

// =====================================================
// STRUKTUR DHT11
// =====================================================

struct DhtReading {

    float temperature; // Celsius

    float humidity;    // Persen RH

    bool valid;        // true jika pembacaan berhasil
};

// =====================================================
// DATA DHT11
// =====================================================

DhtReading dhtData = { 0.0f, 0.0f, false };

// =====================================================
// KONFIGURASI KALIBRASI SENSOR
// =====================================================

struct SensorConfig {

    uint8_t channel;

    int adcDry;

    int adcWet;

    const char* label;
};

// =====================================================
// SERVER DAN CLIENT
// =====================================================

WebServer server(80);

WiFiClient wifiClient;

WiFiClientSecure secureWifiClient;

// =====================================================
// KALIBRASI SENSOR
// =====================================================

// Sensor 1 - Capacitive v2.0
// map(adcValue, 2936, 2422, 0, 100)

constexpr SensorConfig sensor1Config = {

    sensor1Channel,

    2936,

    2422,

    "Sensor 1"
};

// Sensor 2 - Capacitive v2.0
// map(adcValue, 2936, 2422, 0, 100)

constexpr SensorConfig sensor2Config = {

    sensor2Channel,

    2936,

    2422,

    "Sensor 2"
};



// =====================================================
// DATA SENSOR
// =====================================================

SensorReading sensor1 = {
    sensor1Config.channel,
    0,
    0,
    "Tidak tersedia"
};

SensorReading sensor2 = {
    sensor2Config.channel,
    0,
    0,
    "Tidak tersedia"
};



// =====================================================
// STATUS TANAH
// =====================================================

String getSoilStatus(int kelembaban) {

    if (kelembaban >= 0 && kelembaban <= 30) {

        return "Kering";
    }

    if (kelembaban <= 70) {

        return "Lembab";
    }

    return "Basah";
}

// =====================================================
// BACA SENSOR DHT11
// =====================================================

DhtReading readDht() {

    DhtReading reading;

    reading.temperature = dht.readTemperature();

    reading.humidity    = dht.readHumidity();

    // isnan() mendeteksi nilai NaN jika DHT gagal baca
    reading.valid = (
        !isnan(reading.temperature) &&
        !isnan(reading.humidity)
    );

    if (!reading.valid) {

        reading.temperature = 0.0f;

        reading.humidity    = 0.0f;
    }

    return reading;
}

// =====================================================
// PILIH CHANNEL MULTIPLEXER
// =====================================================

void selectMuxChannel(uint8_t channel) {

    digitalWrite(
        muxS0Pin,
        channel & 0x01
    );

    digitalWrite(
        muxS1Pin,
        (channel >> 1) & 0x01
    );

    digitalWrite(
        muxS2Pin,
        (channel >> 2) & 0x01
    );

    digitalWrite(
        muxS3Pin,
        (channel >> 3) & 0x01
    );
}

// =====================================================
// BACA SATU SENSOR
// =====================================================

SensorReading readSoilSensor(
    const SensorConfig& config
) {

    // Pilih channel
    selectMuxChannel(config.channel);

    // Tunggu multiplexer stabil
    delay(muxSettleDelayMs);

    // Buang pembacaan pertama
    analogRead(muxSigPin);

    delay(2);

    // Ambil beberapa sampel
    long totalAdc = 0;

    for (
        uint8_t i = 0;
        i < sensorSamplesPerRead;
        i++
    ) {

        totalAdc += analogRead(muxSigPin);

        delay(2);
    }

    SensorReading reading;

    reading.channel = config.channel;

    // Rata-rata ADC
    reading.adcValue =
        totalAdc / sensorSamplesPerRead;

    // Konversi ADC ke kelembaban
    reading.moisturePercent = map(
        reading.adcValue,
        config.adcDry,
        config.adcWet,
        0,
        100
    );

    // Pastikan 0-100%
    reading.moisturePercent =
        constrain(
            reading.moisturePercent,
            0,
            100
        );

    // Status tanah
    reading.soilStatus =
        getSoilStatus(
            reading.moisturePercent
        );

    return reading;
}

// =====================================================
// BACA SEMUA SENSOR
// =====================================================

void updateAllSensors() {

    sensor1 =
        readSoilSensor(sensor1Config);

    sensor2 =
        readSoilSensor(sensor2Config);

    // Baca DHT11
    dhtData = readDht();
}

// =====================================================
// BUAT JSON
// =====================================================

String buildSensorJson() {

    String json = "{";

    // -------------------------------------------------
    // Sensor 1
    // -------------------------------------------------

    json += "\"sensor1\":{";

    json += "\"channel\":";
    json += String(sensor1.channel);

    json += ",";

    json += "\"kelembaban\":";
    json += String(sensor1.moisturePercent);

    json += ",";

    json += "\"status\":\"";
    json += sensor1.soilStatus;
    json += "\"";

    json += ",";

    json += "\"adc\":";
    json += String(sensor1.adcValue);

    json += "},";

    // -------------------------------------------------
    // Sensor 2
    // -------------------------------------------------

    json += "\"sensor2\":{";

    json += "\"channel\":";
    json += String(sensor2.channel);

    json += ",";

    json += "\"kelembaban\":";
    json += String(sensor2.moisturePercent);

    json += ",";

    json += "\"status\":\"";
    json += sensor2.soilStatus;
    json += "\"";

    json += ",";

    json += "\"adc\":";
    json += String(sensor2.adcValue);

    json += "}";

    // -------------------------------------------------
    // DHT11
    // -------------------------------------------------

    json += ",";

    json += "\"dht11\":{";

    json += "\"suhu\":";
    json += String(dhtData.temperature, 1);

    json += ",";

    json += "\"kelembaban_udara\":";
    json += String(dhtData.humidity, 1);

    json += ",";

    json += "\"valid\":";
    json += dhtData.valid ? "true" : "false";

    json += "}";

    json += "}";

    return json;
}

// =====================================================
// ENDPOINT /DATA
// =====================================================

void handleData() {

    updateAllSensors();

    server.sendHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    server.send(
        200,
        "application/json",
        buildSensorJson()
    );
}

// =====================================================
// ROOT
// =====================================================

void handleRoot() {

    server.send(
        200,
        "text/plain",
        "ESP32 Smart Soil Monitoring aktif. Buka /data untuk melihat data sensor."
    );
}

// =====================================================
// NOT FOUND
// =====================================================

void handleNotFound() {

    server.send(
        404,
        "text/plain",
        "Endpoint tidak ditemukan"
    );
}

// =====================================================
// WIFI
// =====================================================

void connectToWiFi() {

    const unsigned long wifiTimeout = 20000;

    const unsigned long startAttempt =
        millis();

    Serial.println();

    Serial.println(
        "Menghubungkan ke WiFi..."
    );

    Serial.print("SSID: ");

    Serial.println(ssid);

    WiFi.mode(WIFI_STA);

    WiFi.begin(
        ssid,
        password
    );

    while (
        WiFi.status() != WL_CONNECTED &&
        millis() - startAttempt < wifiTimeout
    ) {

        delay(500);

        Serial.print(".");
    }

    Serial.println();

    if (
        WiFi.status() ==
        WL_CONNECTED
    ) {

        Serial.println(
            "WiFi berhasil terhubung"
        );

        Serial.print(
            "Alamat IP ESP32: "
        );

        Serial.println(
            WiFi.localIP()
        );

    } else {

        Serial.println(
            "WiFi belum terhubung"
        );

        Serial.println(
            "Periksa SSID dan password"
        );
    }
}

// =====================================================
// SETUP SERVER ESP32
// =====================================================

void setupServer() {

    server.on(
        "/",
        HTTP_GET,
        handleRoot
    );

    server.on(
        "/data",
        HTTP_GET,
        handleData
    );

    server.onNotFound(
        handleNotFound
    );

    server.begin();

    Serial.println(
        "Web Server aktif pada port 80"
    );

    Serial.println(
        "Endpoint tersedia: /"
    );

    Serial.println(
        "Endpoint tersedia: /data"
    );
}

// =====================================================
// HTTP CLIENT
// =====================================================

bool beginHttpClient(
    HTTPClient& http,
    const String& targetUrl
) {

    if (
        targetUrl.startsWith(
            "https://"
        )
    ) {

        secureWifiClient.setInsecure();

        http.begin(
            secureWifiClient,
            targetUrl
        );

        http.setTimeout(15000);

        return true;
    }

    http.begin(
        wifiClient,
        targetUrl
    );

    http.setTimeout(15000);

    return true;
}

// =====================================================
// KIRIM DATA KE SERVER
// =====================================================

void sendDataToServer() {

    if (
        WiFi.status() !=
        WL_CONNECTED
    ) {

        Serial.println(
            "Gagal kirim data: WiFi belum terhubung"
        );

        return;
    }

    // Baca semua sensor
    updateAllSensors();

    HTTPClient http;

    String targetUrl =
        String(serverUrl);

    String jsonPayload =
        buildSensorJson();

    int httpResponseCode = -1;

    beginHttpClient(
        http,
        targetUrl
    );

    http.addHeader(
        "Content-Type",
        "application/json"
    );

    httpResponseCode =
        http.POST(
            jsonPayload
        );

    Serial.println();
    Serial.println(
        "========== SERVER =========="
    );

    Serial.print(
        "URL: "
    );

    Serial.println(
        targetUrl
    );

    Serial.print(
        "Payload: "
    );

    Serial.println(
        jsonPayload
    );

    Serial.print(
        "HTTP Response: "
    );

    Serial.println(
        httpResponseCode
    );

    if (
        httpResponseCode <= 0
    ) {

        Serial.print(
            "Keterangan Error: "
        );

        Serial.println(
            http.errorToString(
                httpResponseCode
            )
        );

    } else {

        Serial.println(
            "Data berhasil dikirim ke backend"
        );

        Serial.print(
            "Respons Server: "
        );

        Serial.println(
            http.getString()
        );
    }

    Serial.println(
        "============================"
    );

    http.end();
}

// =====================================================
// TEST BACKEND
// =====================================================

void testBackendConnection() {

    if (
        WiFi.status() !=
        WL_CONNECTED
    ) {

        Serial.println(
            "Tes backend gagal: WiFi belum terhubung"
        );

        return;
    }

    HTTPClient http;

    String targetUrl =
        String(pingUrl);

    int httpResponseCode = -1;

    beginHttpClient(
        http,
        targetUrl
    );

    httpResponseCode =
        http.GET();

    Serial.println();

    Serial.print(
        "Tes backend: "
    );

    Serial.println(
        targetUrl
    );

    Serial.print(
        "HTTP Response: "
    );

    Serial.println(
        httpResponseCode
    );

    if (
        httpResponseCode > 0
    ) {

        String responseBody =
            http.getString();

        Serial.print(
            "Respons: "
        );

        Serial.println(
            responseBody
        );

    } else {

        Serial.print(
            "Error: "
        );

        Serial.println(
            http.errorToString(
                httpResponseCode
            )
        );
    }

    http.end();
}

// =====================================================
// SETUP
// =====================================================

void setup() {

    Serial.begin(115200);

    delay(2000);

    // GPIO multiplexer
    pinMode(
        muxS0Pin,
        OUTPUT
    );

    pinMode(
        muxS1Pin,
        OUTPUT
    );

    pinMode(
        muxS2Pin,
        OUTPUT
    );

    pinMode(
        muxS3Pin,
        OUTPUT
    );

    // ADC ESP32 12-bit
    analogReadResolution(12);

    // Inisialisasi DHT11
    dht.begin();

    Serial.println();

    Serial.println(
        "================================"
    );

    Serial.println(
        "SMART SOIL MONITORING SYSTEM"
    );

    Serial.println(
        "================================"
    );

    Serial.println(
        "CD74HC4067"
    );

    Serial.println(
        "SIG = GPIO34"
    );

    Serial.println(
        "S0  = GPIO14"
    );

    Serial.println(
        "S1  = GPIO27"
    );

    Serial.println(
        "S2  = GPIO26"
    );

    Serial.println(
        "S3  = GPIO25"
    );

    Serial.println(
        "DHT11"
    );

    Serial.println(
        "DATA = GPIO32"
    );

    Serial.println();

    Serial.printf(
        "Sensor 1 | CH%u | Dry=%d | Wet=%d\n",
        sensor1Config.channel,
        sensor1Config.adcDry,
        sensor1Config.adcWet
    );

    Serial.printf(
        "Sensor 2 | CH%u | Dry=%d | Wet=%d\n",
        sensor2Config.channel,
        sensor2Config.adcDry,
        sensor2Config.adcWet
    );



    Serial.println();

    connectToWiFi();

    setupServer();

    testBackendConnection();
}

// =====================================================
// LOOP
// =====================================================

void loop() {

    // Menangani request /data
    server.handleClient();

    static unsigned long lastSerialUpdate = 0;

    static unsigned long lastServerUpdate = 0;

    // ================================================
    // SERIAL MONITOR
    // ================================================

    if (
        millis() - lastSerialUpdate >=
        serialInterval
    ) {

        lastSerialUpdate = millis();

        updateAllSensors();

        Serial.println();

        Serial.println(
            "========== DATA SENSOR =========="
        );

        Serial.print(
            "WiFi: "
        );

        Serial.println(
            WiFi.status() ==
            WL_CONNECTED
                ? "Terhubung"
                : "Terputus"
        );

        Serial.print(
            "IP ESP32: "
        );

        Serial.println(
            WiFi.status() ==
            WL_CONNECTED
                ? WiFi.localIP().toString()
                : "Belum tersedia"
        );

        Serial.printf(
            "Sensor 1 | CH%u | ADC: %d | Kelembaban: %d%% | Status: %s\n",
            sensor1.channel,
            sensor1.adcValue,
            sensor1.moisturePercent,
            sensor1.soilStatus.c_str()
        );

        Serial.printf(
            "Sensor 2 | CH%u | ADC: %d | Kelembaban: %d%% | Status: %s\n",
            sensor2.channel,
            sensor2.adcValue,
            sensor2.moisturePercent,
            sensor2.soilStatus.c_str()
        );



        Serial.printf(
            "DHT11  | Suhu: %.1f C | Kelembaban Udara: %.1f%% | %s\n",
            dhtData.temperature,
            dhtData.humidity,
            dhtData.valid ? "OK" : "Gagal baca"
        );

        Serial.println(
            "================================="
        );
    }

    // ================================================
    // KIRIM KE SERVER
    // ================================================

    if (
        millis() - lastServerUpdate >=
        serverInterval
    ) {

        lastServerUpdate = millis();

        sendDataToServer();
    }
}