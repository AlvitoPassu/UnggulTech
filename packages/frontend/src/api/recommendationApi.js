import axios from "axios";
import { AI_REQUEST_TIMEOUT_MS } from "./aiRequestConfig.js";

export const getRecommendationDecision = async (sensorId) => {
  const response = await axios.get("/api/recommendation/decision", { params: { sensorId }, timeout: AI_REQUEST_TIMEOUT_MS });
  return response.data;
};
