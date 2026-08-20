import axios from 'axios';

// Sesuaikan BASE_URL dengan konfigurasi backend Anda
const API_BASE_URL = 'http://localhost:3000/api'; // Contoh, sesuaikan jika backend berjalan di port berbeda

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Fetch normalized weather forecast from backend
 */
export async function getForecast() {
  try {
    const response = await apiClient.get('/weather/forecast');
    return response.data;
  } catch (error) {
    console.error('Error fetching weather forecast:', error);
    throw error;
  }
}

/**
 * Fetch location information from backend
 */
export async function getLocation() {
  try {
    const response = await apiClient.get('/weather/location');
    return response.data;
  } catch (error) {
    console.error('Error fetching weather location:', error);
    throw error;
  }
}
