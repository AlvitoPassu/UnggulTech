import { supabase, config } from "../config/supabase.js";
import { getWitaRange } from "../utils/dateHelper.js";

const getDateRange = ({ startDate, endDate }) => {
  if (!startDate && !endDate) return {};
  const start = startDate || endDate;
  const end = endDate || startDate;
  const { startUtc } = getWitaRange(start);
  const { endExclusiveUtc } = getWitaRange(end);
  return { startUtc, endExclusiveUtc };
};

async function resolveSensorIds(bedengan) {
  if (bedengan === undefined) return null;

  const { data, error } = await supabase
    .from("sensors")
    .select("id")
    .eq("bedengan", bedengan);

  if (error) throw error;
  return (data ?? []).map((sensor) => sensor.id);
}

function applyReadingFilters(query, filters, sensorIds) {
  const { startUtc, endExclusiveUtc } = getDateRange(filters);
  let filteredQuery = query;

  if (startUtc) filteredQuery = filteredQuery.gte(config.timestampColumn, startUtc);
  if (endExclusiveUtc) filteredQuery = filteredQuery.lt(config.timestampColumn, endExclusiveUtc);
  if (filters.sensorId !== undefined) filteredQuery = filteredQuery.eq("sensor_id", filters.sensorId);
  if (sensorIds) filteredQuery = filteredQuery.in("sensor_id", sensorIds);

  return filteredQuery;
}

async function getFilteredReadings(filters, select = "*") {
  const sensorIds = await resolveSensorIds(filters.bedengan);
  if (sensorIds && sensorIds.length === 0) return [];

  let query = supabase.from(config.logsTable).select(select);
  query = applyReadingFilters(query, filters, sensorIds);
  query = query.order(config.timestampColumn, { ascending: true });

  const { data, error } = await query.limit(100000);
  if (error) throw error;
  return data ?? [];
}

export async function getHistoricalReadings(filters) {
  const sensorIds = await resolveSensorIds(filters.bedengan);
  if (sensorIds && sensorIds.length === 0) {
    return { readings: [], pagination: { page: filters.page, limit: filters.limit, total: 0, totalPages: 0, hasNext: false, hasPrevious: filters.page > 1 } };
  }

  let query = supabase
    .from(config.logsTable)
    .select("id, sensor_id, moisture, temperature, humidity, created_at, sensors (sensor_name, bedengan, location)", { count: "exact" });
  query = applyReadingFilters(query, filters, sensorIds);
  query = query.order(filters.sort.column, { ascending: filters.sort.ascending });

  const start = (filters.page - 1) * filters.limit;
  const { data, count, error } = await query.range(start, start + filters.limit - 1);
  if (error) throw error;

  const total = count ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.limit);
  return {
    readings: (data ?? []).map(({ sensors, ...reading }) => ({ ...reading, sensor: sensors, status: null })),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages,
      hasNext: filters.page < totalPages,
      hasPrevious: filters.page > 1 && totalPages > 0,
    },
  };
}

export async function getHistoricalStatistics(filters) {
  const readings = await getFilteredReadings(filters, "moisture");
  const moistureValues = readings.map((reading) => Number(reading.moisture)).filter(Number.isFinite);
  const count = moistureValues.length;

  return {
    average: count ? Number((moistureValues.reduce((total, value) => total + value, 0) / count).toFixed(2)) : null,
    minimum: count ? Math.min(...moistureValues) : null,
    maximum: count ? Math.max(...moistureValues) : null,
    count,
  };
}

export async function getHistoricalTrend(filters) {
  const readings = await getFilteredReadings(filters, `moisture, ${config.timestampColumn}`);
  const buckets = new Map();

  readings.forEach((reading) => {
    const moisture = Number(reading.moisture);
    if (!Number.isFinite(moisture)) return;

    const date = new Date(reading[config.timestampColumn]);
    const bucketDate = new Date(date);
    if (filters.interval === "hour") {
      bucketDate.setUTCMinutes(0, 0, 0);
    } else {
      bucketDate.setUTCHours(0, 0, 0, 0);
    }

    const timestamp = bucketDate.toISOString();
    const bucket = buckets.get(timestamp) || { total: 0, count: 0 };
    bucket.total += moisture;
    bucket.count += 1;
    buckets.set(timestamp, bucket);
  });

  return [...buckets.entries()].map(([timestamp, bucket]) => ({
    timestamp,
    averageMoisture: Number((bucket.total / bucket.count).toFixed(2)),
  }));
}