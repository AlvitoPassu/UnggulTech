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

const getMoistureStatus = (moisture) => {
  if (moisture < 40) {
    return "Low";
  }

  if (moisture > 70) {
    return "High";
  }

  return "Normal";
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

  return {
    ...data,
    humidityStatus: getHumidityStatus(humidityValue),
    status: data.status || (data.moisture === null || data.moisture === undefined ? "Tidak tersedia" : getMoistureStatus(Number(data.moisture))),
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
