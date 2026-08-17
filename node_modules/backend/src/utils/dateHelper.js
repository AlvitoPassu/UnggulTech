import { config } from "../config/supabase.js";

export const witaDateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: config.reportTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const witaDateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: config.reportTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function getWitaRange(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const startUtc = new Date(Date.UTC(year, month - 1, day, -config.witaOffsetHours, 0, 0, 0));
  const endExclusiveUtc = new Date(Date.UTC(year, month - 1, day + 1, -config.witaOffsetHours, 0, 0, 0));

  return {
    startUtc: startUtc.toISOString(),
    endExclusiveUtc: endExclusiveUtc.toISOString(),
  };
}

export function formatWitaTimestamp(value) {
  if (!value) {
    return "";
  }

  return `${witaDateTimeFormatter.format(new Date(value))} WITA`;
}
