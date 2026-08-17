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
