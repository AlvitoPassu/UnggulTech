import { supabase, config } from "../config/supabase.js";
import { formatWitaTimestamp, getWitaRange } from "../utils/dateHelper.js";

// Mapping nama sensor ESP32 -> sensor_id di database
// Bisa dikonfigurasi via env: SENSOR_ID_MAP={"sensor1":1,"sensor2":2,...}
let sensorIdMap;
try {
  sensorIdMap = process.env.SENSOR_ID_MAP
    ? JSON.parse(process.env.SENSOR_ID_MAP)
    : { sensor1: 1, sensor2: 2, sensor3: 3, sensor4: 4 };
} catch {
  sensorIdMap = { sensor1: 1, sensor2: 2, sensor3: 3, sensor4: 4 };
}

export const getMoistureStatus = (moisture) => {
  const value = Number(moisture);
  if (!Number.isFinite(value)) return "Tidak tersedia";
  if (value < 40) return "Low";
  if (value > 70) return "High";
  return "Normal";
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
      .select("id, moisture, temperature, humidity, created_at")
      .eq("sensor_id", sensorId)
      .order(config.timestampColumn, { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from(config.logsTable)
      .select("id, moisture, created_at")
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
    created_at: reading.created_at,
  }));

  if (!latest) {
    return {
      sensor: sensorResponse.data,
      latest: null,
      chart,
      isOnline: false,
      lastSeen: null,
    };
  }

  const lastSeenDate = new Date(latest.created_at);
  const minutesSinceLastReading = (Date.now() - lastSeenDate.getTime()) / 1000 / 60;
  const moisture = latest.moisture === null ? null : Number(latest.moisture);
  const temperature = latest.temperature === null ? null : Number(latest.temperature);
  const humidity = latest.humidity === null ? null : Number(latest.humidity);

  return {
    sensor: sensorResponse.data,
    latest: {
      moisture,
      temperature,
      humidity,
      status: getMoistureStatus(moisture),
      created_at: latest.created_at,
    },
    chart,
    moisture,
    temperature,
    humidity,
    status: getMoistureStatus(moisture),
    sensorStatus: sensorResponse.data?.status || "Unknown",
    isOnline: minutesSinceLastReading <= 1,
    lastSeen: latest.created_at,
  };
}

const getMoistureCategory = (moisture) => {
  if (moisture === null || moisture === undefined) return "offline";
  if (moisture < 30) return "dry";
  if (moisture < 60) return "attention";
  return "normal";
};

const getLatestReadings = async () => {
  const { data, error } = await supabase
    .from(config.logsTable)
    .select("sensor_id, moisture, created_at")
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
    const isOnline = Boolean(lastSeen && (now - new Date(lastSeen).getTime()) / 60000 <= 1);
    const moisture = latest?.moisture === null || latest?.moisture === undefined ? null : Number(latest.moisture);

    return {
      ...sensor,
      moisture,
      lastSeen,
      isOnline,
      category: isOnline ? getMoistureCategory(moisture) : "offline",
    };
  });
  const readings = sensorRows.filter((sensor) => sensor.moisture !== null);
  const categoryCounts = sensorRows.reduce((counts, sensor) => {
    counts[sensor.category] += 1;
    return counts;
  }, { normal: 0, attention: 0, dry: 0, offline: 0 });
  const latestTimestamps = sensorRows.map((sensor) => sensor.lastSeen).filter(Boolean);

  return {
    sensors: sensorRows,
    summary: {
      totalBedengan: new Set(sensorRows.map((sensor) => sensor.bedengan).filter((value) => value !== null && value !== undefined && value !== "")).size,
      totalSensors: sensorRows.length,
      activeSensors: sensorRows.filter((sensor) => sensor.isOnline).length,
      offlineSensors: sensorRows.filter((sensor) => sensor.category === "offline").length,
      nonactiveSensors: sensorRows.filter((sensor) => sensor.status !== "Active").length,
      averageMoisture: readings.length ? readings.reduce((total, sensor) => total + sensor.moisture, 0) / readings.length : null,
      conditions: categoryCounts,
      lastUpdated: latestTimestamps.length ? latestTimestamps.sort().at(-1) : null,
    },
    attention: sensorRows
      .filter((sensor) => ["dry", "attention", "offline"].includes(sensor.category))
      .sort((first, second) => ({ dry: 0, attention: 1, offline: 2 }[first.category] - { dry: 0, attention: 1, offline: 2 }[second.category] || (first.moisture ?? 101) - (second.moisture ?? 101)))
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

    const moisture = Number(sensorData.kelembaban ?? sensorData.moisture ?? null);

    // Ambil data DHT11 dari payload (berlaku untuk semua sensor dalam satu pengiriman)
    const dht11 = payload.dht11;
    const temperatureRaw = dht11?.valid ? (dht11.suhu ?? dht11.temperature ?? null) : null;
    const humidityRaw = dht11?.valid ? (dht11.kelembaban_udara ?? dht11.humidity ?? null) : null;
    const temperature = temperatureRaw !== null && Number.isFinite(Number(temperatureRaw)) ? Number(temperatureRaw) : null;
    const humidity = humidityRaw !== null && Number.isFinite(Number(humidityRaw)) ? Number(humidityRaw) : null;

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
