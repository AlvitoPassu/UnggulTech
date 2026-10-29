// Only verified, explicitly configured positions may become map markers.
export const bedNumber = (value) => {
  const match = /^(?:bedengan\s*|b\s*)?(\d+)$/i.exec(String(value ?? "").trim());
  const number = match ? Number(match[1]) : 0;
  return number >= 1 && number <= 60 ? number : null;
};

export const isPositiveBigintString = (value) => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n;

export const normalizePlacementLocation = (value) => value === null ? null
  : typeof value === "string" ? value.trim() : undefined;
export const isPlacementLocation = (value) => value === null
  || typeof value === "string" && value.length > 0 && value === value.trim();

export function attachSensorPlacements(sensors, configuration) {
  const entries = Array.isArray(configuration) ? configuration : [];
  const validEntries = entries.filter((entry) => entry && typeof entry === "object"
    && /^(?:[1-9]\d*)$/.test(String(entry.sensorId))
    && typeof entry.location === "string" && entry.location.trim()
    && Number.isInteger(entry.bedengan) && entry.bedengan >= 1 && entry.bedengan <= 60
    && Number.isInteger(entry.row) && entry.row >= 1 && entry.row <= 10
    && Number.isInteger(entry.column) && entry.column >= 1 && entry.column <= 100);
  return sensors.map((sensor) => {
    const matches = validEntries.filter((entry) => String(entry.sensorId) === String(sensor.id));
    const entry = matches[0];
    const duplicateId = entries.filter((item) => item && String(item.sensorId) === String(sensor.id)).length !== 1;
    const occupied = entry && validEntries.filter((item) => item.location.trim() === entry.location.trim()
      && item.bedengan === entry.bedengan && item.row === entry.row && item.column === entry.column).length > 1;
    const matchesMetadata = entry && typeof sensor.location === "string"
      && sensor.location.trim() === entry.location.trim() && bedNumber(sensor.bedengan) === entry.bedengan;
    return {
      ...sensor,
      placement: !duplicateId && !occupied && matchesMetadata
        ? { row: entry.row, column: entry.column }
        : null,
    };
  });
}
