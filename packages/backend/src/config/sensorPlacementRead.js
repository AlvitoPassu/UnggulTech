// Backend only. An unknown value must never silently select the JSON fallback.
export function getSensorPlacementReadSource() {
  const source = process.env.SENSOR_PLACEMENT_READ_SOURCE ?? "json";
  return source === "json" || source === "db" ? source : "invalid";
}
