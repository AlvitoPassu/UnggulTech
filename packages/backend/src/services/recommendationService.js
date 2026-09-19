import { getRecommendationDecision } from "../domain/recommendationDecisionEngine.js";
import { getLatestRainfall } from "./rainfallService.js";
import { getSensorData } from "./sensorService.js";

/**
 * Menggabungkan data sensor individual dan rainfall aktual tanpa menduplikasi
 * aturan keputusan maupun perhitungan freshness.
 */
export async function getRecommendationForSensor(sensorId) {
  const sensorData = await getSensorData(sensorId);
  const sensor = sensorData.sensor ?? {};
  const rainfall = await getLatestRainfall({
    nursery: sensor.location || undefined,
    bedengan: sensor.bedengan || undefined,
  });

  return {
    sensor: {
      id: sensor.id ?? sensorId,
      sensorName: sensor.sensor_name ?? null,
      nursery: sensor.location ?? null,
      bedengan: sensor.bedengan ?? null,
    },
    ...getRecommendationDecision({
      moisture: sensorData.moisture,
      sensorHealth: sensorData.sensorHealth,
      rainfall: {
        value: rainfall?.reading?.rainfall_value,
        unit: rainfall?.reading?.unit ?? "mm",
        freshness: rainfall?.freshness ?? "missing",
        measuredAt: rainfall?.reading?.measured_at ?? null,
      },
    }),
  };
}
