import { getRecommendationDecision } from "../domain/recommendationDecisionEngine.js";
import { getLatestRainfall } from "./rainfallService.js";
import { getSensorData } from "./sensorService.js";
import { getLatestSoilPh } from "./soilPhService.js";
import { getWeatherForecast } from "./weatherService.js";
import { generateGeneralRecommendations } from "./recommendationNarrativeService.js";

const getNearestForecast = (forecasts = []) => {
  if (!Array.isArray(forecasts) || !forecasts.length) return null;

  const now = Date.now();
  return forecasts.reduce((nearest, forecast) => {
    const nearestTime = new Date(nearest?.local_datetime || nearest?.utc_datetime).getTime();
    const forecastTime = new Date(forecast?.local_datetime || forecast?.utc_datetime).getTime();
    return Math.abs(forecastTime - now) < Math.abs(nearestTime - now) ? forecast : nearest;
  }, forecasts[0]);
};

const getRecommendationForecast = () => {
  if (!process.env.GEMINI_API_KEY) return Promise.resolve([]);

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Permintaan prakiraan cuaca melebihi batas waktu.")), 8000));
  return Promise.race([getWeatherForecast(), timeout]).catch(() => []);
};

/**
 * Menggabungkan data sensor individual dan rainfall aktual tanpa menduplikasi
 * aturan keputusan maupun perhitungan freshness.
 */
export async function getRecommendationForSensor(sensorId) {
  const [sensorData, rainfall, soilPh, forecasts] = await Promise.all([
    getSensorData(sensorId),
    getLatestRainfall(),
    getLatestSoilPh().catch(() => null),
    getRecommendationForecast(),
  ]);
  const sensor = sensorData.sensor ?? {};
  const decisionResult = getRecommendationDecision({
    moisture: sensorData.moisture,
    sensorHealth: sensorData.sensorHealth,
    rainfall: {
      value: rainfall?.reading?.rainfall_value,
      unit: rainfall?.reading?.unit ?? "mm",
      freshness: rainfall?.freshness ?? "missing",
      measuredAt: rainfall?.reading?.measured_at ?? null,
    },
  });
  const weather = getNearestForecast(forecasts);
  const generalRecommendations = await generateGeneralRecommendations({
    decision: decisionResult.decision,
    moisture: decisionResult.moisture,
    sensorHealth: decisionResult.sensorHealth,
    rainfall: decisionResult.rainfall,
    soilPh,
    weather: weather ? {
      timestamp: weather.local_datetime || weather.utc_datetime,
      description: weather.weather,
      temperature: weather.temperature,
      humidity: weather.humidity,
    } : null,
  });

  return {
    sensor: {
      id: sensor.id ?? sensorId,
      sensorName: sensor.sensor_name ?? null,
      nursery: sensor.location ?? null,
      bedengan: sensor.bedengan ?? null,
    },
    ...decisionResult,
    generalRecommendations,
  };
}
