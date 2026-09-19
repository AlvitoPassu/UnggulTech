import { classifyMoisture } from "./moistureClassifier.js";

const unavailableDecision = (reasonCode, title, reason) => ({
  code: reasonCode.startsWith("sensor_") || reasonCode === "invalid_moisture" ? "sensor_unavailable" : "rainfall_unavailable",
  reasonCode,
  title,
  reason,
  durationMinutes: null,
  schedule: [],
});

const normalizeRainfallValue = (input) => {
  if (input === null || input === undefined || typeof input === "boolean") return null;

  let value = input;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    value = Number(trimmed);
  } else if (typeof value !== "number") {
    return null;
  }

  return Number.isFinite(value) && value >= 0 ? value : null;
};

const normalizeFreshness = (freshness) => (
  freshness === "fresh" || freshness === "stale" || freshness === "missing"
    ? freshness
    : "missing"
);

const normalizeSensorHealth = (sensorHealth) => (
  sensorHealth === "online" || sensorHealth === "stale" || sensorHealth === "offline"
    ? sensorHealth
    : "offline"
);

const matrixDecision = (condition, rainfallValue) => {
  const lowRainfall = rainfallValue < 10;
  const definitions = {
    dry: lowRainfall
      ? ["water", "dry_low_rainfall", "Lakukan Penyiraman", "Kondisi tanah kering dan curah hujan aktual hari ini di bawah 10 mm."]
      : ["no_watering", "dry_sufficient_rainfall", "Tidak Perlu Penyiraman", "Kondisi tanah tetap kering, tetapi curah hujan aktual hari ini telah mencapai 10 mm atau lebih."],
    normal: lowRainfall
      ? ["inspect_bed", "normal_low_rainfall", "Periksa Kondisi Bedengan Terlebih Dahulu", "Kelembaban tanah normal dan curah hujan aktual hari ini di bawah 10 mm."]
      : ["no_watering", "normal_sufficient_rainfall", "Tidak Perlu Penyiraman", "Kelembaban tanah normal dan curah hujan aktual hari ini telah mencapai 10 mm atau lebih."],
    wet: lowRainfall
      ? ["inspect_bed", "wet_low_rainfall", "Periksa Kondisi Bedengan Terlebih Dahulu", "Kelembaban tanah basah dan curah hujan aktual hari ini di bawah 10 mm."]
      : ["no_watering", "wet_sufficient_rainfall", "Tidak Perlu Penyiraman", "Kelembaban tanah basah dan curah hujan aktual hari ini telah mencapai 10 mm atau lebih."],
  };
  const [code, reasonCode, title, reason] = definitions[condition];

  return {
    code,
    reasonCode,
    title,
    reason,
    durationMinutes: code === "water" ? 30 : null,
    schedule: code === "water" ? ["pagi", "sore"] : [],
  };
};

/**
 * Menentukan rekomendasi operasional tanpa I/O.
 * Freshness harus berasal dari rainfallService (P2), bukan dihitung ulang di sini.
 */
export const getRecommendationDecision = ({ moisture, sensorHealth, rainfall = {} } = {}) => {
  const moistureResult = classifyMoisture(moisture);
  const normalizedSensorHealth = normalizeSensorHealth(sensorHealth);
  const normalizedRainfallValue = normalizeRainfallValue(rainfall.value);
  const freshness = normalizeFreshness(rainfall.freshness);
  const unit = rainfall.unit === undefined || rainfall.unit === null || rainfall.unit === "" ? "mm" : String(rainfall.unit).toLowerCase();
  const rainfallResult = {
    value: normalizedRainfallValue,
    unit: unit === "mm" ? "mm" : unit,
    freshness,
    measuredAt: rainfall.measuredAt ?? null,
  };

  if (moistureResult.condition === null) {
    return {
      moisture: moistureResult,
      sensorHealth: normalizedSensorHealth,
      rainfall: rainfallResult,
      decision: unavailableDecision("invalid_moisture", "Data Kelembaban Tanah Tidak Tersedia", "Data kelembaban tanah tidak tersedia atau tidak valid."),
    };
  }

  if (normalizedSensorHealth === "stale") {
    return {
      moisture: moistureResult,
      sensorHealth: normalizedSensorHealth,
      rainfall: rainfallResult,
      decision: unavailableDecision("sensor_stale", "Data Sensor Tidak Terbarui", "Data sensor tidak terbarui sehingga keputusan operasional tidak dibuat."),
    };
  }

  if (normalizedSensorHealth !== "online") {
    return {
      moisture: moistureResult,
      sensorHealth: normalizedSensorHealth,
      rainfall: rainfallResult,
      decision: unavailableDecision("sensor_offline", "Data Sensor Tidak Tersedia", "Sensor offline atau tidak tersedia sehingga keputusan operasional tidak dibuat."),
    };
  }

  if (freshness === "stale") {
    return {
      moisture: moistureResult,
      sensorHealth: normalizedSensorHealth,
      rainfall: rainfallResult,
      decision: unavailableDecision("rainfall_stale", "Data Curah Hujan Tidak Terbaru", "Data curah hujan terakhir bukan pengukuran hari ini (WITA), sehingga tidak digunakan untuk keputusan operasional."),
    };
  }

  if (freshness === "missing") {
    return {
      moisture: moistureResult,
      sensorHealth: normalizedSensorHealth,
      rainfall: rainfallResult,
      decision: unavailableDecision("rainfall_missing", "Data Curah Hujan Tidak Tersedia", "Data pengukuran curah hujan aktual belum tersedia."),
    };
  }

  if (normalizedRainfallValue === null || unit !== "mm") {
    return {
      moisture: moistureResult,
      sensorHealth: normalizedSensorHealth,
      rainfall: rainfallResult,
      decision: unavailableDecision("rainfall_invalid", "Data Curah Hujan Tidak Valid", "Nilai atau satuan curah hujan aktual tidak valid."),
    };
  }

  return {
    moisture: moistureResult,
    sensorHealth: normalizedSensorHealth,
    rainfall: rainfallResult,
    decision: matrixDecision(moistureResult.condition, normalizedRainfallValue),
  };
};

export default getRecommendationDecision;
