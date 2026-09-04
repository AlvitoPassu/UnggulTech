import axios from "axios";

const compactParams = (params) => Object.fromEntries(
  Object.entries(params).filter(([, value]) => value !== "" && value !== null && value !== undefined)
);

const readingParams = (filters) => compactParams(
  Object.fromEntries(Object.entries(filters).filter(([key]) => key !== "interval"))
);
const filterParams = ({ startDate, endDate, sensorId, bedengan }) => compactParams({ startDate, endDate, sensorId, bedengan });

export const getHistoricalReadings = async (filters) => {
  const response = await axios.get("/api/historical-readings", { params: readingParams(filters) });
  return response.data;
};

export const getHistoricalStatistics = async (filters) => {
  const response = await axios.get("/api/historical-readings/statistics", { params: filterParams(filters) });
  return response.data;
};

export const getHistoricalTrend = async (filters) => {
  const response = await axios.get("/api/historical-readings/trend", { params: compactParams({ ...filterParams(filters), interval: filters.interval }) });
  return response.data;
};