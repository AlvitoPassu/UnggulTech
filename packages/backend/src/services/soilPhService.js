import { supabase } from "../config/supabase.js";
import { parseStrictFiniteNumber } from "../utils/strictNumber.js";

// The pH firmware transmits approximately every 10 seconds. Ninety seconds
// tolerates intermittent Wi-Fi while still marking a disconnected probe quickly.
const configuredPhActiveThreshold = Number(process.env.PH_ACTIVE_THRESHOLD_SECONDS || 90);
export const PH_ACTIVE_THRESHOLD_SECONDS = Number.isFinite(configuredPhActiveThreshold) && configuredPhActiveThreshold > 0
  ? configuredPhActiveThreshold
  : 90;

const normalizePh = (value) => {
  const parsed = parseStrictFiniteNumber(value);
  return parsed !== null && parsed >= 0 && parsed <= 14 ? parsed : null;
};

const isMissingSoilPhTable = (error) => error?.code === "42P01"
  || error?.code === "PGRST205"
  || /soil_ph_readings.*does not exist/i.test(error?.message || "");

export function getSoilPhStatus(measuredAt, now = Date.now()) {
  if (!measuredAt) return { status: "no_data", isActive: false };

  const measuredAtMs = new Date(measuredAt).getTime();
  if (!Number.isFinite(measuredAtMs) || now - measuredAtMs > PH_ACTIVE_THRESHOLD_SECONDS * 1000) {
    return { status: "inactive", isActive: false };
  }

  return { status: "active", isActive: true };
}

const toSoilPhResponse = (reading, now) => {
  if (!reading) {
    return { soilPh: null, measuredAt: null, status: "no_data", isActive: false };
  }

  return {
    soilPh: Number(reading.ph_value),
    measuredAt: reading.measured_at,
    ...getSoilPhStatus(reading.measured_at, now),
  };
};

export async function createSoilPhReading(payload = {}) {
  const soilPh = normalizePh(payload.soil_ph ?? payload.ph);
  if (soilPh === null) {
    const error = new Error("soil_ph harus berupa angka dalam rentang 0-14.");
    error.statusCode = 400;
    throw error;
  }

  const { data, error } = await supabase
    .from("soil_ph_readings")
    .insert({ ph_value: soilPh })
    .select("id, ph_value, measured_at")
    .single();

  if (error) throw error;
  return toSoilPhResponse(data);
}

export async function getLatestSoilPh(now = Date.now()) {
  const { data, error } = await supabase
    .from("soil_ph_readings")
    .select("id, ph_value, measured_at")
    .order("measured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Keeping read APIs available before the non-destructive migration is
    // applied avoids breaking moisture monitoring during a staged rollout.
    if (isMissingSoilPhTable(error)) return toSoilPhResponse(null, now);
    throw error;
  }
  return toSoilPhResponse(data, now);
}

export async function getSoilPhHistory(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { data, error } = await supabase
    .from("soil_ph_readings")
    .select("id, ph_value, measured_at")
    .order("measured_at", { ascending: true })
    .limit(safeLimit);

  if (error) {
    if (isMissingSoilPhTable(error)) return [];
    throw error;
  }
  return (data ?? []).map((reading) => ({
    id: reading.id,
    soilPh: Number(reading.ph_value),
    measuredAt: reading.measured_at,
  }));
}
