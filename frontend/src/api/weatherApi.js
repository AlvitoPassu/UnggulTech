const BMKG_BASE_URL = "https://api.bmkg.go.id/publik/prakiraan-cuaca";
const BMKG_ADM4 = "76.01.03.2002";

const normalizeForecast = (forecast) => ({
  utc_datetime: forecast.utc_datetime ?? forecast.datetime ?? null,
  local_datetime: forecast.local_datetime ?? null,
  temperature: forecast.t ?? null,
  humidity: forecast.hu ?? null,
  weather: forecast.weather_desc ?? null,
  weather_en: forecast.weather_desc_en ?? null,
  wind_speed: forecast.ws ?? null,
  wind_direction: forecast.wd ?? null,
  cloud_cover: forecast.tcc ?? null,
  visibility: forecast.vs_text ?? null,
});

// BMKG groups forecasts by location and then by day. The UI only needs one
// chronological list, so keep the API-specific nesting isolated here.
const extractForecasts = (payload) => {
  const locations = payload?.data;

  if (!Array.isArray(locations)) {
    return [];
  }

  return locations.flatMap((location) => {
    const days = location?.cuaca;

    if (!Array.isArray(days)) {
      return [];
    }

    return days.flatMap((day) =>
      Array.isArray(day) ? day.map(normalizeForecast) : []
    );
  });
};

export const getWeatherForecast = async () => {
  try {
    const response = await fetch(`${BMKG_BASE_URL}?adm4=${BMKG_ADM4}`);

    if (!response.ok) {
      throw new Error(`BMKG returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const forecasts = extractForecasts(payload);

    if (!forecasts.length) {
      throw new Error("BMKG returned no forecast data");
    }

    return forecasts;
  } catch (error) {
    console.error("Error mengambil prakiraan cuaca BMKG:", error);
    throw error;
  }
};
