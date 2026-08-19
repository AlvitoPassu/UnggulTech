const BMKG_BASE_URL = "https://api.bmkg.go.id/publik/prakiraan-cuaca"; 

const BMKG_ADM4 = "76.01.03.2002";

/**
 * Get raw weather data from BMKG API
 */
export async function getWeatherForecastRaw() {
    try {
        const response = await fetch(
            `${BMKG_BASE_URL}?adm4=${BMKG_ADM4}`
        );

        if (!response.ok) {
            throw new Error(
                `BMKG API error: ${response.status} ${response.statusText}`
            );
        }

        return await response.json();
    } catch (error) {
        console.error("Failed to fetch BMKG weather data:", error);
        throw error;
    }
}

/**
 * Get normalized weather forecast
 */
export async function getWeatherForecast() {
    const data = await getWeatherForecastRaw();

    if (!data?.data?.length) {
        return [];
    }

    const forecasts = [];

    data.data.forEach((locationData) => {
        if (!Array.isArray(locationData.cuaca)) {
            return;
        }

        locationData.cuaca.forEach((day) => {
            if (!Array.isArray(day)) {
                return;
            }

            day.forEach((weather) => {
                forecasts.push({
                    utc_datetime: weather.utc_datetime,
                    local_datetime: weather.local_datetime,

                    temperature: weather.t,
                    humidity: weather.hu,

                    weather: weather.weather_desc,
                    weather_en: weather.weather_desc_en,

                    wind_speed: weather.ws,
                    wind_direction: weather.wd,

                    cloud_cover: weather.tcc,
                    visibility: weather.vs_text
                });
            });
        });
    });

    return forecasts;
}

/**
 * Get location information
 */
export async function getWeatherLocation() {
    const data = await getWeatherForecastRaw();

    return data?.lokasi ?? null;
}