import { supabase, config } from "../config/supabase.js";
import { formatWitaTimestamp, getWitaRange } from "../utils/dateHelper.js";
import { classifyMoisture } from "../domain/moistureClassifier.js";
import { parseStrictFiniteNumber } from "../utils/strictNumber.js";

// Mapping nama sensor ESP32 -> sensor_id di database
// Bisa dikonfigurasi via env: SENSOR_ID_MAP={"sensor1":1,"sensor2":2,...}
let sensorIdMap;
try {
  sensorIdMap = process.env.SENSOR_ID_MAP
    ? JSON.parse(process.env.SENSOR_ID_MAP)
    : { sensor1: 1, sensor2: 2, sensor3: 3, sensor4: 4, sensor5: 5, sensor6: 6 };
} catch {
  sensorIdMap = { sensor1: 1, sensor2: 2, sensor3: 3, sensor4: 4, sensor5: 5, sensor6: 6 };
}

export const getMoistureStatus = (moisture) => {
  return classifyMoisture(moisture).legacyStatus || "Tidak tersedia";
};

export const validateSoilPh = (value, isPresent = true) => {
  if (!isPresent || value === null) return { valid: true, value: null };

  const numericValue = parseStrictFiniteNumber(value);
  return {
    valid: numericValue !== null && numericValue >= 0 && numericValue <= 14,
    value: numericValue,
  };
};

export const validateOptionalSensorMetric = (value, minimum, maximum) => {
  if (value === null || value === undefined) return { valid: true, value: null };

  const numericValue = parseStrictFiniteNumber(value);
  return {
    valid: numericValue !== null && numericValue >= minimum && numericValue <= maximum,
    value: numericValue,
  };
};

export async function getLogs({ sensorId, startDate, endDate, status }) {
  const { startUtc } = getWitaRange(startDate);
  const { endExclusiveUtc } = getWitaRange(endDate);
  let query = supabase
    .from(config.logsTable)
    .select("*")
    .eq("sensor_id", sensorId)
    .gte(config.timestampColumn, startUtc)
    .lt(config.timestampColumn, endExclusiveUtc)
    .order(config.timestampColumn, { ascending: true })
    .limit(10000);

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return status ? data.filter((reading) => getMoistureStatus(reading.moisture) === status) : data;
}

export async function getRecentLogs(sensorId) {
  const { data, error } = await supabase
    .from(config.logsTable)
    .select("*")
    .eq("sensor_id", sensorId)
    .order(config.timestampColumn, { ascending: false })
    .limit(config.recentLogsLimit);

  if (error) {
    throw error;
  }

  return data;
}

export async function getSensors() {
  const { data, error } = await supabase
    .from("sensors")
    .select("id, sensor_name, bedengan, location, status")
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}

export async function getSensorData(sensorId) {
  const [latestResponse, chartResponse, sensorResponse] = await Promise.all([
    supabase
      .from(config.logsTable)
      .select("id, moisture, soil_ph, temperature, humidity, created_at")
      .eq("sensor_id", sensorId)
      .order(config.timestampColumn, { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from(config.logsTable)
        .select("id, moisture, soil_ph, created_at")
      .eq("sensor_id", sensorId)
      .order(config.timestampColumn, { ascending: false })
      .limit(config.recentLogsLimit),
    supabase
      .from("sensors")
      .select("id, sensor_name, bedengan, location, status")
      .eq("id", sensorId)
      .single(),
  ]);

  if (latestResponse.error) {
    throw latestResponse.error;
  }

  if (chartResponse.error) {
    throw chartResponse.error;
  }

  if (sensorResponse.error) {
    throw sensorResponse.error;
  }

  const latest = latestResponse.data;
  const chart = (chartResponse.data ?? []).reverse().map((reading) => ({
    time: formatWitaTimestamp(reading.created_at),
    moisture: reading.moisture === null ? null : Number(reading.moisture),
    soil_ph: reading.soil_ph === null ? null : Number(reading.soil_ph),
    created_at: reading.created_at,
  }));

  if (!latest) {
    return {
      sensor: sensorResponse.data,
      latest: null,
      chart,
      moisture: null,
      status: null,
      legacyStatus: null,
      condition: null,
      needsAttention: false,
      sensorHealth: "offline",
      isOnline: false,
      lastSeen: null,
    };
  }

  const lastSeenDate = new Date(latest.created_at);
  const minutesSinceLastReading = (Date.now() - lastSeenDate.getTime()) / 1000 / 60;
  const classification = classifyMoisture(latest.moisture);
  const moisture = classification.value;
  const soilPh = latest.soil_ph === null || latest.soil_ph === undefined ? null : Number(latest.soil_ph);
  const temperature = latest.temperature === null ? null : Number(latest.temperature);
  const humidity = latest.humidity === null ? null : Number(latest.humidity);
  const isOnline = minutesSinceLastReading <= 3;
  const sensorHealth = isOnline ? "online" : "stale";

  return {
    sensor: sensorResponse.data,
    latest: {
      moisture,
      soil_ph: soilPh,
      temperature,
      humidity,
      status: classification.legacyStatus,
      legacyStatus: classification.legacyStatus,
      condition: classification.condition,
      needsAttention: classification.needsAttention,
      created_at: latest.created_at,
    },
    chart,
    moisture,
    soil_ph: soilPh,
    temperature,
    humidity,
    status: classification.legacyStatus,
    legacyStatus: classification.legacyStatus,
    condition: classification.condition,
    needsAttention: classification.needsAttention,
    sensorStatus: sensorResponse.data?.status || "Unknown",
    sensorHealth,
    isOnline,
    lastSeen: latest.created_at,
  };
}

const getLatestReadings = async () => {
  const { data, error } = await supabase
    .from(config.logsTable)
    .select("sensor_id, moisture, soil_ph, created_at")
    .order(config.timestampColumn, { ascending: false })
    .limit(10000);

  if (error) throw error;

  const latestBySensor = new Map();
  data.forEach((reading) => {
    if (!latestBySensor.has(reading.sensor_id)) {
      latestBySensor.set(reading.sensor_id, reading);
    }
  });

  return latestBySensor;
};

export async function getNurseryOverview() {
  const [sensors, latestBySensor] = await Promise.all([
    getSensors(),
    getLatestReadings(),
  ]);
  const now = Date.now();
  const sensorRows = sensors.map((sensor) => {
    const latest = latestBySensor.get(sensor.id);
    const lastSeen = latest?.created_at || null;
    const isOnline = Boolean(lastSeen && (now - new Date(lastSeen).getTime()) / 60000 <= 3);
    const classification = classifyMoisture(latest?.moisture);
    const moisture = classification.value;
    const soilPh = latest?.soil_ph === null || latest?.soil_ph === undefined ? null : Number(latest.soil_ph);
    const sensorHealth = !lastSeen ? "offline" : isOnline ? "online" : "stale";

    return {
      ...sensor,
      moisture,
      soil_ph: soilPh,
      lastSeen,
      isOnline,
      sensorHealth,
      legacyStatus: classification.legacyStatus,
      condition: classification.condition,
      needsAttention: classification.needsAttention,
    };
  });
  const readings = sensorRows.filter((sensor) => sensor.condition !== null);
  const conditionCounts = sensorRows.reduce((counts, sensor) => {
    if (sensor.sensorHealth === "online" && sensor.condition) counts[sensor.condition] += 1;
    return counts;
  }, { dry: 0, normal: 0, wet: 0 });
  const latestTimestamps = sensorRows.map((sensor) => sensor.lastSeen).filter(Boolean);

  return {
    sensors: sensorRows,
    summary: {
      totalBedengan: new Set(sensorRows.map((sensor) => sensor.bedengan).filter((value) => value !== null && value !== undefined && value !== "")).size,
      totalSensors: sensorRows.length,
      activeSensors: sensorRows.filter((sensor) => sensor.isOnline).length,
      offlineSensors: sensorRows.filter((sensor) => sensor.sensorHealth !== "online").length,
      nonactiveSensors: sensorRows.filter((sensor) => sensor.status !== "Active").length,
      averageMoisture: readings.length ? readings.reduce((total, sensor) => total + sensor.moisture, 0) / readings.length : null,
      averageSoilPh: sensorRows.filter((sensor) => sensor.soil_ph !== null).length
        ? sensorRows.filter((sensor) => sensor.soil_ph !== null).reduce((total, sensor) => total + sensor.soil_ph, 0) / sensorRows.filter((sensor) => sensor.soil_ph !== null).length
        : null,
      conditions: conditionCounts,
      lastUpdated: latestTimestamps.length ? latestTimestamps.sort().at(-1) : null,
    },
    attention: sensorRows
      .filter((sensor) => sensor.sensorHealth === "online" && sensor.needsAttention)
      .sort((first, second) => (first.moisture ?? 101) - (second.moisture ?? 101))
      .slice(0, 5),
  };
}

export async function getNurseryMoistureTrend(period = "24h") {
  const periodHours = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }[period] || 24;
  const since = new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(config.logsTable)
    .select("moisture, created_at")
    .gte(config.timestampColumn, since)
    .order(config.timestampColumn, { ascending: true })
    .limit(10000);

  if (error) throw error;

  const buckets = new Map();
  data.filter((reading) => reading.moisture !== null).forEach((reading) => {
    const date = new Date(reading.created_at);
    const bucketDate = new Date(date);
    if (period === "24h") bucketDate.setMinutes(0, 0, 0);
    else bucketDate.setUTCHours(0, 0, 0, 0);
    const key = bucketDate.toISOString();
    const bucket = buckets.get(key) || { total: 0, count: 0 };
    bucket.total += Number(reading.moisture);
    bucket.count += 1;
    buckets.set(key, bucket);
  });

  return [...buckets.entries()].map(([timestamp, bucket]) => ({
    timestamp,
    time: formatWitaTimestamp(timestamp),
    moisture: Number((bucket.total / bucket.count).toFixed(1)),
  }));
}

/**
 * Menerima payload JSON dari ESP32 dan menyimpan ke sensor_readings.
 * Format payload ESP32:
 * {
 *   "sensor1": { "channel": 0, "kelembaban": 55, "status": "Lembab", "adc": 2800 },
 *   "sensor2": { ... },
 *   ...,
 *   "dht11": { "suhu": 28.5, "kelembaban_udara": 72.0, "valid": true }
 * }
 */
export async function insertSensorReadings(payload) {
  const sensorKeys = Object.keys(payload).filter((key) => /^sensor\d+$/i.test(key));

  if (sensorKeys.length === 0) {
    throw new Error("Payload tidak mengandung data sensor yang valid.");
  }

  const insertPromises = sensorKeys.map(async (key) => {
    const sensorData = payload[key];

    // Auto-extract sensor ID dari nama key (sensor1 → 1, sensor7 → 7)
    const sensorId = sensorIdMap[key] ?? Number(key.replace(/\D/g, ""));

    if (!sensorId || sensorId <= 0) {
      console.warn(`Tidak bisa menentukan sensor ID untuk "${key}". Dilewati.`);
      return { key, skipped: true, reason: "Sensor ID tidak valid" };
    }

    const moistureClassification = classifyMoisture(sensorData.kelembaban ?? sensorData.moisture);
    if (moistureClassification.value === null) {
      return { key, sensorId, success: false, error: "moisture harus berupa angka dalam rentang 0-100." };
    }

    const moisture = moistureClassification.value;
    const hasSoilPh = Object.prototype.hasOwnProperty.call(sensorData, "soil_ph") || Object.prototype.hasOwnProperty.call(sensorData, "ph");
    const soilPhRaw = sensorData.soil_ph ?? sensorData.ph ?? null;
    const soilPhValidation = validateSoilPh(soilPhRaw, hasSoilPh);
    const soilPh = soilPhValidation.value;

    if (!soilPhValidation.valid) {
      return { key, sensorId, success: false, error: "soil_ph harus berupa angka dalam rentang 0-14." };
    }

    // Ambil data DHT11 dari payload (berlaku untuk semua sensor dalam satu pengiriman)
    const dht11 = payload.dht11;
    const temperatureRaw = dht11?.valid ? (dht11.suhu ?? dht11.temperature ?? null) : null;
    const humidityRaw = dht11?.valid ? (dht11.kelembaban_udara ?? dht11.humidity ?? null) : null;
    const temperatureValidation = validateOptionalSensorMetric(temperatureRaw, -50, 100);
    const humidityValidation = validateOptionalSensorMetric(humidityRaw, 0, 100);

    if (!temperatureValidation.valid || !humidityValidation.valid) {
      return { key, sensorId, success: false, error: "temperature dan humidity harus berupa angka valid dalam rentang sensor." };
    }

    const temperature = temperatureValidation.value;
    const humidity = humidityValidation.value;

    // Auto-daftarkan sensor ke tabel sensors jika belum ada
    // Jika sudah ada, tidak mengubah data yang sudah ada (ignoreDuplicates: true)
    const sensorNum = sensorId;
    await supabase
      .from("sensors")
      .upsert(
        {
          id: sensorId,
          sensor_name: `Sensor ${sensorNum}`,
          bedengan: sensorNum,
          status: "Active",
        },
        { onConflict: "id", ignoreDuplicates: true }
      );

    const record = {
      sensor_id: sensorId,
      moisture: Number.isFinite(moisture) ? moisture : null,
      soil_ph: soilPh,
      temperature,
      humidity,
    };

    const { data, error } = await supabase
      .from(config.logsTable)
      .insert(record)
      .select("id")
      .single();

    if (error) {
      console.error(`Gagal menyimpan data ${key}:`, error.message);
      return { key, sensorId, success: false, error: error.message };
    }

    return { key, sensorId, success: true, id: data?.id };
  });

  return Promise.all(insertPromises);
}
