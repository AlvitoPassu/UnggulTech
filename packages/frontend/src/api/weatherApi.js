import axios from "axios";

/**
 * Fetch normalized weather forecast from backend
 */
export async function getForecast() {
  try {
    const response = await axios.get("/api/weather/forecast");
    return response.data;
  } catch (error) {
    console.error("Error fetching weather forecast:", error);
    return [];
  }
}

/**
 * Fetch location information from backend
 */
export async function getLocation() {
  try {
    const response = await axios.get("/api/weather/location");
    return response.data;
  } catch (error) {
    console.error("Error fetching weather location:", error);
    return null;
  }
}
