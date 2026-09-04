export function validateSensorId(value) {
  const sensorId = Number(value);

  if (!Number.isInteger(sensorId) || sensorId <= 0) {
    return null;
  }

  return sensorId;
}

export function validateRequest(body) {
  const { sensorId, startDate, endDate, format, status } = body || {};
  const validFormats = ["csv", "xlsx", "pdf"];
  const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (!sensorId || !validDate(startDate) || !validDate(endDate) || startDate > endDate || !validFormats.includes(format)) {
    return null;
  }

  return { sensorId: String(sensorId), startDate, endDate, format, status: status ? String(status) : null };
}

const historicalSorts = {
  created_at_desc: { column: "created_at", ascending: false },
  created_at_asc: { column: "created_at", ascending: true },
  moisture_desc: { column: "moisture", ascending: false },
  moisture_asc: { column: "moisture", ascending: true },
};

const isValidDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

export function validateHistoricalFilters(query = {}) {
  const { startDate, endDate, sensorId, bedengan } = query;
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  const sort = query.sort || "created_at_desc";

  if (startDate !== undefined && !isValidDate(startDate)) return null;
  if (endDate !== undefined && !isValidDate(endDate)) return null;
  if (startDate && endDate && startDate > endDate) return null;
  if (!Number.isInteger(page) || page < 1) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  if (sensorId !== undefined && (!/^\d+$/.test(String(sensorId)) || Number(sensorId) < 1)) return null;
  if (bedengan !== undefined && String(bedengan).trim() === "") return null;
  if (!historicalSorts[sort]) return null;

  return {
    startDate,
    endDate,
    sensorId: sensorId === undefined ? undefined : Number(sensorId),
    bedengan: bedengan === undefined ? undefined : String(bedengan),
    page,
    limit,
    sort: historicalSorts[sort],
  };
}

export function validateHistoricalTrend(query = {}) {
  const filters = validateHistoricalFilters({ ...query, page: 1, limit: 100 });
  if (!filters || !["hour", "day"].includes(query.interval || "day")) return null;
  return { ...filters, interval: query.interval || "day" };
}
