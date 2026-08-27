import axios from "axios";
import { supabase } from "../lib/supabase";

export const getSensorDisplayName = (sensor = {}) => {
  const bedenganValue = sensor.bedengan ?? sensor.bedengan_id ?? sensor.bed_id;
  const sensorName = sensor.sensor_name?.trim() || sensor.name || `Sensor ${sensor.id ?? "baru"}`;

  if (bedenganValue === null || bedenganValue === undefined || bedenganValue === "") {
    return sensorName;
  }

  const bedenganLabel = `Bedengan ${bedenganValue}`;

  return sensorName && sensorName !== bedenganLabel ? `${bedenganLabel} - ${sensorName}` : bedenganLabel;
};

export const sortSensorsByBedengan = (sensors = []) => {
  return [...sensors].sort((a, b) => {
    const aBedengan = Number.parseFloat(a.bedengan ?? a.bedengan_id ?? a.bed_id ?? Number.MAX_SAFE_INTEGER);
    const bBedengan = Number.parseFloat(b.bedengan ?? b.bedengan_id ?? b.bed_id ?? Number.MAX_SAFE_INTEGER);

    const aValue = Number.isFinite(aBedengan) ? aBedengan : Number.MAX_SAFE_INTEGER;
    const bValue = Number.isFinite(bBedengan) ? bBedengan : Number.MAX_SAFE_INTEGER;

    return aValue - bValue;
  });
};

// -----------------------------
// GET LIST SENSOR
// -----------------------------
export const getSensors = async () => {
  const { data, error } = await supabase
    .from("sensors")
    .select("id, sensor_name, bedengan, location, status")
    .eq("status", "Active")
    .order("id", { ascending: true });

  if (error) {
    console.error("Error mengambil sensor:", error);
    return [];
  }

  return sortSensorsByBedengan(data);
};

const getMoistureStatus = (moisture) => {
  if (moisture < 40) {
    return "Low";
  }

  if (moisture > 70) {
    return "High";
  }

  return "Normal";
};

const formatTime = (date) => {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Makassar",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
};

export const getRecentLogs = async (sensorId) => {
  try {
    const response = await axios.get(`/api/sensors/${sensorId}/recent-logs`);
    return response.data;
  } catch (error) {
    console.error("Error mengambil recent logs:", error);
    return [];
  }
};

// -----------------------------
// GET DASHBOARD DATA
// -----------------------------
const CHART_DATA_LIMIT = 10;

export const getSensorData = async (sensorId) => {
  const [latestResponse, chartResponse, sensorResponse] = await Promise.all([
    // Data terbaru untuk summary cards (1 row)
    supabase
      .from("sensor_readings")
      .select("id, moisture, temperature, humidity, created_at")
      .eq("sensor_id", sensorId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    // 10 data terbaru untuk grafik (descending, lalu dibalik)
    supabase
      .from("sensor_readings")
      .select("id, moisture, created_at")
      .eq("sensor_id", sensorId)
      .order("created_at", { ascending: false })
      .limit(CHART_DATA_LIMIT),
    // Status sensor
    supabase
      .from("sensors")
      .select("status")
      .eq("id", sensorId)
      .single(),
  ]);

  const { data: latest, error } = latestResponse;

  if (error || !latest) {
    return null;
  }

  const lastSeenDate = new Date(latest.created_at);
  const minutesSinceLastReading = (Date.now() - lastSeenDate.getTime()) / 1000 / 60;

  // Balik urutan chart dari descending → ascending agar grafik mengalir kiri ke kanan
  const chartData = (chartResponse.data ?? []).reverse();

  return {
    moisture: Number(latest.moisture),
    temperature: latest.temperature === null ? null : Number(latest.temperature),
    sensorStatus: sensorResponse.data?.status || "Unknown",
    isOnline: minutesSinceLastReading <= 1,
    lastSeen: lastSeenDate,
    status: getMoistureStatus(Number(latest.moisture)),
    chart: chartData.map((reading) => ({
      time: formatTime(reading.created_at),
      moisture: Number(reading.moisture),
    })),
  };
};

// -----------------------------
// DOWNLOAD REPORT
// -----------------------------
export const downloadSensorReport = async ({
  sensorId,
  startDate,
  endDate,
  format,
  status,
}) => {
  return axios.post(
    "/api/reports/download",
    {
      sensorId,
      startDate,
      endDate,
      format,
      status,
    },
    {
      responseType: "blob",
    }
  );
};
