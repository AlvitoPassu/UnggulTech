import axios from "axios";

export const getLatestRainfall = async (params = {}) => {
  const response = await axios.get("/api/rainfall/latest", { params });
  return response.data?.reading ?? null;
};

export const getRainfallTrend = async (period = "7d", params = {}) => {
  const response = await axios.get("/api/rainfall/trend", { params: { period, ...params } });
  return response.data ?? [];
};

export const createRainfallReading = async (payload = {}) => {
  const response = await axios.post("/api/rainfall", payload);
  return response.data;
};

export const getRainfallHistory = async (params = {}) => {
  const response = await axios.get("/api/rainfall/history", { params });
  return response.data?.readings ?? [];
};