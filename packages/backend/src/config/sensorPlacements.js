import { readFileSync } from "node:fs";
import { attachSensorPlacements } from "../domain/sensorPlacement.js";

let configuration = [];
try {
  configuration = JSON.parse(readFileSync(new URL("./sensor-placements.json", import.meta.url), "utf8"));
  if (!Array.isArray(configuration)) throw new Error("Expected an array");
} catch {
  // A bad mapping must not interrupt existing monitoring or ingestion.
  console.error("Konfigurasi posisi sensor tidak valid. Marker dinonaktifkan; monitoring tetap tersedia.");
}

export const withSensorPlacements = (sensors) => attachSensorPlacements(sensors, configuration);
