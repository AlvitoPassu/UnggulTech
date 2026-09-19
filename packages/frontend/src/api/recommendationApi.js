import axios from "axios";

export const getRecommendationDecision = async (sensorId) => {
  const response = await axios.get("/api/recommendation/decision", { params: { sensorId } });
  return response.data;
};
