import axios from "axios";

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
  const response = await axios.get("/api/sensors");
  return sortSensorsByBedengan(response.data);
};

export const getNurseryOverview = async () => {
  const response = await axios.get("/api/sensors/overview");
  return response.data;
};

export const getNurseryMoistureTrend = async (period = "24h") => {
  const response = await axios.get("/api/sensors/moisture-trend", { params: { period } });
  return response.data;
};

export const getGlobalSoilPh = async () => {
  const response = await axios.get("/api/sensors/ph");
  return response.data;
};

export const getGlobalSoilPhHistory = async (limit = 100) => {
  const response = await axios.get("/api/sensors/ph/history", { params: { limit } });
  return response.data?.readings ?? [];
};

const getFallbackMoistureClassification = (input) => {
  if (input === null || input === undefined || typeof input === "boolean") {
    return { condition: null, needsAttention: false, legacyStatus: null };
  }

  let value = input;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return { condition: null, needsAttention: false, legacyStatus: null };
    value = Number(trimmed);
  } else if (typeof value !== "number") {
    return { condition: null, needsAttention: false, legacyStatus: null };
  }

  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { condition: null, needsAttention: false, legacyStatus: null };
  }

  if (value <= 30) return { condition: "dry", needsAttention: true, legacyStatus: "Low" };
  if (value <= 70) return { condition: "normal", needsAttention: false, legacyStatus: "Normal" };
  return { condition: "wet", needsAttention: false, legacyStatus: "High" };
};

const getHumidityStatus = (humidity) => {
  if (humidity === null) return "Tidak tersedia";
  if (humidity < 40) return "Kering";
  if (humidity > 80) return "Sangat Lembab";
  return "Normal";
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
export const getSensorData = async (sensorId) => {
  const response = await axios.get(`/api/sensors/${sensorId}/data`);
  const data = response.data;
  const humidityValue = data.humidity === null || data.humidity === undefined ? null : Number(data.humidity);
  const fallback = getFallbackMoistureClassification(data.moisture);
  const hasCondition = Object.prototype.hasOwnProperty.call(data, "condition");
  const hasNeedsAttention = Object.prototype.hasOwnProperty.call(data, "needsAttention");

  return {
    ...data,
    humidityStatus: getHumidityStatus(humidityValue),
    status: data.status || fallback.legacyStatus || "Tidak tersedia",
    legacyStatus: data.legacyStatus ?? fallback.legacyStatus,
    condition: hasCondition ? data.condition : fallback.condition,
    needsAttention: hasNeedsAttention ? data.needsAttention : fallback.needsAttention,
    sensorHealth: data.sensorHealth || (data.isOnline ? "online" : "offline"),
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
