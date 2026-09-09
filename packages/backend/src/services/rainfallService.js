import { supabase } from "../config/supabase.js";

const rainfallSelect = "id, nursery, bedengan, rainfall_value, unit, measured_at, source, notes, created_at";

const applyLocationFilters = (query, { nursery, bedengan } = {}) => {
  let filteredQuery = query;
  if (nursery) filteredQuery = filteredQuery.eq("nursery", nursery);
  if (bedengan) filteredQuery = filteredQuery.eq("bedengan", bedengan);
  return filteredQuery;
};

export async function getLatestRainfall(filters = {}) {
  let query = supabase
    .from("rainfall_readings")
    .select(rainfallSelect)
    .order("measured_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  query = applyLocationFilters(query, filters);
  const { data, error } = await query;
  if (error) throw error;
  return { available: Boolean(data), reading: data };
}

export async function getRainfallHistory(filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100);
  let query = supabase
    .from("rainfall_readings")
    .select(rainfallSelect)
    .order("measured_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  query = applyLocationFilters(query, filters);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getRainfallTrend(period = "7d", filters = {}) {
  const validPeriod = ["1d", "7d", "30d"].includes(period) ? period : "7d";
  const periodDays = validPeriod === "1d" ? 1 : validPeriod === "7d" ? 7 : 30;
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from("rainfall_readings")
    .select("rainfall_value, measured_at")
    .gte("measured_at", since)
    .order("measured_at", { ascending: true });

  query = applyLocationFilters(query, filters);
  const { data, error } = await query;
  if (error) throw error;

  const buckets = new Map();
  (data ?? []).forEach((reading) => {
    const value = Number(reading.rainfall_value);
    if (!Number.isFinite(value)) return;
    const date = new Date(reading.measured_at);
    if (validPeriod === "1d") date.setMinutes(0, 0, 0);
    else date.setUTCHours(0, 0, 0, 0);
    const timestamp = date.toISOString();
    const bucket = buckets.get(timestamp) || { total: 0, count: 0 };
    bucket.total += value;
    bucket.count += 1;
    buckets.set(timestamp, bucket);
  });

  return [...buckets.entries()].map(([timestamp, bucket]) => ({
    timestamp,
    label: new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Makassar", day: "2-digit", month: "short", ...(validPeriod === "1d" ? { hour: "2-digit" } : {}) }).format(new Date(timestamp)),
    rainfall_value: Number((bucket.total / bucket.count).toFixed(2)),
    unit: "ml",
  }));
}

export async function createRainfallReading(payload = {}) {
  const rainfallValue = Number(payload.rainfall_value);
  const unit = String(payload.unit || "").toLowerCase();
  const measuredAt = new Date(payload.measured_at);

  if (!Number.isFinite(rainfallValue) || rainfallValue < 0) {
    const error = new Error("Nilai curah hujan harus berupa angka nol atau lebih.");
    error.statusCode = 400;
    throw error;
  }
  if (unit !== "ml") {
    const error = new Error("Satuan curah hujan harus ml.");
    error.statusCode = 400;
    throw error;
  }
  if (!payload.measured_at || Number.isNaN(measuredAt.getTime())) {
    const error = new Error("Tanggal dan waktu pengukuran tidak valid.");
    error.statusCode = 400;
    throw error;
  }

  const nursery = payload.nursery ? String(payload.nursery).trim() : null;
  const bedengan = payload.bedengan === null || payload.bedengan === undefined || payload.bedengan === "" ? null : String(payload.bedengan).trim();
  const { data, error } = await supabase
    .from("rainfall_readings")
    .insert({ nursery, bedengan, rainfall_value: rainfallValue, unit: "ml", measured_at: measuredAt.toISOString(), source: "ombrometer", notes: payload.notes ? String(payload.notes).trim() : null })
    .select(rainfallSelect)
    .single();

  if (error) throw error;
  return data;
}
