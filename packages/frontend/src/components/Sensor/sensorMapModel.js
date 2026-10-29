export const BED_NUMBERS = Array.from({ length: 60 }, (_, index) => index + 1);
export const SEEDLING_ROWS = 10;
export const SEEDLING_COLUMNS = 100;
export const BED_MAP_WIDTH = 880;
export const BED_MAP_HEIGHT = 440;
export const SEEDLING_POINTS = Array.from({ length: SEEDLING_ROWS * SEEDLING_COLUMNS }, (_, index) => ({
  row: Math.floor(index / SEEDLING_COLUMNS) + 1,
  column: index % SEEDLING_COLUMNS + 1,
}));

export const getBedNumber = (value) => {
  const match = /^(?:bedengan\s*|b\s*)?(\d+)$/i.exec(String(value ?? "").trim());
  const number = match ? Number(match[1]) : 0;
  return number >= 1 && number <= 60 ? number : null;
};

// Explicit NULL is a real context. Missing/invalid metadata must never become NULL.
export const getLocation = (sensor) => sensor.location === null ? null
  : typeof sensor.location === "string" ? sensor.location.trim() : undefined;
export const isMapLocation = (location) => location === null
  || typeof location === "string" && location.length > 0 && location === location.trim();
// The Sensor page maps one existing location. Never invent or merge nursery metadata.
export const getMapLocation = (sensors) => {
  const locations = sensors.map(getLocation);
  return locations.filter((location) => typeof location === "string" && isMapLocation(location)).sort()[0]
    ?? (locations.includes(null) ? null : "");
};
export const isOutsideMap = (sensor, location) => !isMapLocation(getLocation(sensor))
  || getLocation(sensor) !== location || !getBedNumber(sensor.bedengan);
export const sensorsForBed = (sensors, location, bed) => sensors.filter((sensor) => (
  isMapLocation(location) && getLocation(sensor) === location && getBedNumber(sensor.bedengan) === bed
));
export const hasPosition = (sensor) => Boolean(isMapLocation(getLocation(sensor)) && getBedNumber(sensor.bedengan)
  && Number.isInteger(sensor.placement?.row) && sensor.placement.row >= 1 && sensor.placement.row <= SEEDLING_ROWS
  && Number.isInteger(sensor.placement?.column) && sensor.placement.column >= 1 && sensor.placement.column <= SEEDLING_COLUMNS);

// SVG and HTML markers share exactly the same coordinate system.
// Leave space for the full 44px marker target even at the 300px minimum width.
export const pointCoordinates = ({ row, column }) => ({
  x: 80 + (column - 1) * 720 / (SEEDLING_COLUMNS - 1),
  y: 70 + (row - 1) * 300 / (SEEDLING_ROWS - 1),
});

export const formatTimestamp = (value) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Belum ada data";
  return `${new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Makassar",
  }).format(new Date(value))} WITA`;
};
