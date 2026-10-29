import { getRecommendationDecision } from "../domain/recommendationDecisionEngine.js";
import { getLatestRainfall } from "./rainfallService.js";
import { getSensorData } from "./sensorService.js";
import { getLatestSoilPh } from "./soilPhService.js";
import { getWeatherForecast } from "./weatherService.js";
import { generateRecommendationNarratives } from "./recommendationNarrativeService.js";
import { retrieveKnowledge } from "./knowledgeBaseService.js";
import { withAiTimeout } from "./agronomyAnalysisService.js";

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
  return withAiTimeout(Promise.resolve().then(() => getWeatherForecast()), 3000).catch(() => []);
};

/**
 * Menggabungkan data sensor individual dan rainfall aktual tanpa menduplikasi
 * aturan keputusan maupun perhitungan freshness.
 */
export async function getRecommendationForSensor(sensorId) {
  const [sensorData, rainfall, soilPh, forecasts] = await Promise.all([
    getSensorData(sensorId),
    withAiTimeout(getLatestRainfall(), 3000).catch(() => null),
    withAiTimeout(getLatestSoilPh(), 3000).catch(() => null),
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
  const query = `Analisis pemeliharaan pembibitan: kelembapan soil moisture ${decisionResult.moisture.condition || "tidak tersedia"}; penyiraman; pH; curah hujan; cuaca.`;
  // No reliable structured age/phase field currently exists on the sensor record.
  const knowledge = await retrieveKnowledge({ query, plantPhase: "general" });
  const narrativeContext = {
    decision: decisionResult.decision,
    moisture: decisionResult.moisture,
    sensorHealth: decisionResult.sensorHealth,
    rainfall: decisionResult.rainfall,
    soilPh,
    plantPhase: "general",
    plantAge: null,
    measuredAt: sensorData.lastSeen ?? null,
    temperature: sensorData.latest?.temperature ?? null,
    humidity: sensorData.latest?.humidity ?? null,
    knowledge,
    weather: weather ? {
      type: "forecast",
      timestamp: weather.utc_datetime || weather.local_datetime,
      description: weather.weather,
      temperature: weather.temperature,
      humidity: weather.humidity,
    } : null,
  };
  const { generalRecommendations, decisionNarrative, analysis } = await generateRecommendationNarratives(narrativeContext);

  return {
    sensor: {
      id: sensor.id ?? sensorId,
      sensorName: sensor.sensor_name ?? null,
      nursery: sensor.location ?? null,
      bedengan: sensor.bedengan ?? null,
    },
    ...decisionResult,
    generalRecommendations,
    decisionNarrative,
    analysis,
    knowledge: { status: knowledge.status, method: knowledge.method, count: knowledge.chunks.length },
    sopComparison: decisionResult.decision,
  };
}
