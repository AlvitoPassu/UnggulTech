import { SEEDLING_COLUMNS, SEEDLING_ROWS } from "./sensorMapModel.js";

export const coordinateMaximum = { row: SEEDLING_ROWS, column: SEEDLING_COLUMNS };

// Form values stay as strings until their complete format and range are valid.
export function parseDraftCoordinate(value, maximum) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= maximum ? number : null;
}

export function draftPosition(values) {
  const row = parseDraftCoordinate(values.row, SEEDLING_ROWS);
  const column = parseDraftCoordinate(values.column, SEEDLING_COLUMNS);
  return row !== null && column !== null ? { row, column } : null;
}

export function stepDraftCoordinate(value, direction, maximum) {
  const number = parseDraftCoordinate(value, maximum);
  if (value === "" && direction === 1) return "1";
  if (number === null) return value;
  return String(Math.max(1, Math.min(maximum, number + direction)));
}
