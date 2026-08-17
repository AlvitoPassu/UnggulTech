import { supabase, config } from "../config/supabase.js";
import { getWitaRange } from "../utils/dateHelper.js";

export async function getLogs({ sensorId, startDate, endDate, status }) {
  const { startUtc } = getWitaRange(startDate);
  const { endExclusiveUtc } = getWitaRange(endDate);
  let query = supabase
    .from(config.logsTable)
    .select("*")
    .eq("sensor_id", sensorId)
    .gte(config.timestampColumn, startUtc)
    .lt(config.timestampColumn, endExclusiveUtc)
    .order(config.timestampColumn, { ascending: true })
    .limit(10000);

  if (status) {
    query = query.eq(config.statusColumn, status);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data;
}

export async function getRecentLogs(sensorId) {
  const { data, error } = await supabase
    .from(config.logsTable)
    .select("*")
    .eq("sensor_id", sensorId)
    .order(config.timestampColumn, { ascending: false })
    .limit(config.recentLogsLimit);

  if (error) {
    throw error;
  }

  return data;
}
