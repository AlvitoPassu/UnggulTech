import { supabase, config } from "../config/supabase.js";
import { getWitaRange } from "../utils/dateHelper.js";

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

  if (status) {
    query = query.eq(config.statusColumn, status);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data;
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

/**
 * Menerima payload JSON dari ESP32 dan menyimpan ke sensor_readings.
 * Format payload ESP32:
 * {
 *   "sensor1": { "channel": 0, "kelembaban": 55, "status": "Lembab", "adc": 2800 },
 *   "sensor2": { ... },
 *   ...
 * }
 */
export async function insertSensorReadings(payload) {
  const sensorKeys = Object.keys(payload).filter((key) => /^sensor\d+$/i.test(key));

  if (sensorKeys.length === 0) {
    throw new Error("Payload tidak mengandung data sensor yang valid.");
  }

  const insertPromises = sensorKeys.map(async (key) => {
    const sensorData = payload[key];
    const sensorId = sensorIdMap[key];

    if (!sensorId) {
      console.warn(`Sensor ID untuk "${key}" tidak ditemukan di peta. Dilewati.`);
      return { key, skipped: true, reason: "Sensor ID tidak ada di mapping" };
    }

    const moisture = Number(sensorData.kelembaban ?? sensorData.moisture ?? null);
    const status = sensorData.status ?? null;

    const record = {
      sensor_id: sensorId,
      moisture: Number.isFinite(moisture) ? moisture : null,
      [config.statusColumn]: status,
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
