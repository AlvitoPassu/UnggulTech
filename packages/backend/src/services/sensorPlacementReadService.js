import { supabase } from "../config/supabase.js";
import { getSensorPlacementReadSource } from "../config/sensorPlacementRead.js";
import { withSensorPlacements } from "../config/sensorPlacements.js";
import { bedNumber, isPositiveBigintString, isPlacementLocation, normalizePlacementLocation } from "../domain/sensorPlacement.js";

// Cast BEFORE JSON transport: converting an already rounded JS number is unsafe.
export const SENSOR_REGISTRY_COLUMNS = "id::text, sensor_name, bedengan, location, status";
const PLACEMENT_COLUMNS = "sensor_id::text,location_key,bed_number,row_index::text,column_index::text,version::text,updated_at";
const integerIn = (value, maximum) => Number.isInteger(value) && value >= 1 && value <= maximum;
// PostgreSQL numeric may include a zero scale (e.g. 1.00). Reject fractional text
// BEFORE Number conversion, including fractions too small for JS to preserve.
const coordinate = (value, maximum) => typeof value === "string" && /^[1-9][0-9]*(?:\.0+)?$/.test(value)
  && integerIn(Number(value), maximum) ? Number(value) : null;
const validRow = (row) => row && isPositiveBigintString(row.sensor_id) && isPositiveBigintString(row.version)
  && integerIn(row.row_index, 10) && integerIn(row.column_index, 100) && integerIn(row.bed_number, 60)
  && isPlacementLocation(row.location_key)
  && typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at));

export async function readPlacementSensorRegistry() {
  const sensors = [], ids = new Set();
  let total;
  while (true) {
    const result = await supabase.from("sensors").select(SENSOR_REGISTRY_COLUMNS, { count: "exact" })
      .order("id", { ascending: true }).range(sensors.length, sensors.length + 499);
    if (result?.error) throw result.error;
    if (!Array.isArray(result?.data) || !Number.isSafeInteger(result.count) || result.count < 0
      || (total !== undefined && total !== result.count) || result.count < sensors.length + result.data.length
      || (!result.data.length && sensors.length < result.count)) throw new Error("Sensor registry read incomplete");
    total = result.count;
    for (const sensor of result.data) {
      if (!isPositiveBigintString(sensor?.id) || ids.has(sensor.id)) throw new Error("Invalid registry identity");
      ids.add(sensor.id); sensors.push(sensor);
    }
    if (sensors.length === total) return sensors;
  }
}

async function readRows(sensorIds) {
  if (!sensorIds.every(isPositiveBigintString) || new Set(sensorIds).size !== sensorIds.length) throw new Error("Invalid registry identity");
  const rows = [];
  // Exact count detects a truncated response rather than claiming omitted rows are unconfigured.
  for (let start = 0; start < sensorIds.length; start += 100) {
    const ids = sensorIds.slice(start, start + 100);
    const result = await supabase.from("sensor_placements").select(PLACEMENT_COLUMNS, { count: "exact" }).in("sensor_id", ids);
    if (result?.error || !Array.isArray(result?.data) || result.count !== result.data.length
      || result.data.some((row) => !row || !ids.includes(row.sensor_id))) throw new Error("Placement read unavailable");
    rows.push(...result.data.map((row) => ({ ...row,
      row_index: coordinate(row.row_index, 10), column_index: coordinate(row.column_index, 100) })));
  }
  return rows;
}

const unavailable = (sensors, source) => sensors.map((sensor) => ({ ...sensor, placement: null,
  placementSource: source, placementState: "unavailable" }));

export async function readSensorPlacements(sensors, source = getSensorPlacementReadSource()) {
  if (source === "json") return withSensorPlacements(sensors);
  if (source !== "db") return unavailable(sensors, source);
  let rows;
  try { rows = await readRows(sensors.map((sensor) => sensor.id)); }
  catch { return unavailable(sensors, source); }
  return sensors.map((sensor) => {
    const matches = rows.filter((row) => row.sensor_id === sensor.id);
    const row = matches[0];
    let placementState = "unconfigured", placement = null;
    if (matches.length) {
      const collision = validRow(row) && rows.some((other) => other !== row && validRow(other)
        && other.location_key === row.location_key && other.bed_number === row.bed_number
        && other.row_index === row.row_index && other.column_index === row.column_index);
      if (matches.length !== 1 || !validRow(row) || collision) placementState = "invalid";
      else if (!isPlacementLocation(normalizePlacementLocation(sensor.location))
        || normalizePlacementLocation(sensor.location) !== row.location_key
        || bedNumber(sensor.bedengan) !== row.bed_number) placementState = "context_mismatch";
      else {
        placementState = "configured";
        placement = { sensorId: row.sensor_id, row: row.row_index, column: row.column_index,
          context: { location: row.location_key, bedengan: row.bed_number }, version: row.version,
          updatedAt: new Date(row.updated_at).toISOString() };
      }
    }
    return { ...sensor, placement, placementSource: source, placementState };
  });
}

// Probe on EVERY save, not a cached readiness flag. The RPC still owns all write/session validation.
export async function isSensorPlacementReadReady(sensorId) {
  if (getSensorPlacementReadSource() !== "db") return false;
  try {
    const registry = await supabase.from("sensors").select(SENSOR_REGISTRY_COLUMNS).eq("id", sensorId).maybeSingle();
    if (registry?.error || !Object.hasOwn(registry || {}, "data")
      || (registry.data !== null && registry.data?.id !== sensorId)) return false;
    const rows = await readRows([sensorId]);
    // A missing sensor is left to the RPC's existing SENSOR_NOT_FOUND contract.
    return rows.length <= 1 && rows.every(validRow) && getSensorPlacementReadSource() === "db";
  } catch { return false; }
}
