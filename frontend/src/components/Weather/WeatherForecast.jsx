import { useEffect, useState } from "react";
import {
  WiCloud,
  WiCloudy,
  WiDaySunny,
  WiRain,
  WiThunderstorm,
} from "react-icons/wi";
import { getWeatherForecast } from "../../api/weatherApi";

const getWeatherIcon = (weather = "") => {
  const description = weather.toLowerCase();

  if (description.includes("petir")) return <WiThunderstorm className="text-5xl text-blue-500" aria-hidden="true" />;
  if (description.includes("hujan")) return <WiRain className="text-5xl text-blue-500" aria-hidden="true" />;
  if (description.includes("cerah")) return <WiDaySunny className="text-5xl text-blue-500" aria-hidden="true" />;
  if (description.includes("berawan")) return <WiCloudy className="text-5xl text-blue-500" aria-hidden="true" />;
  return <WiCloud className="text-5xl text-blue-500" aria-hidden="true" />;
};

const formatForecastTime = (date) => {
  if (!date) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Makassar",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
};

const getUpcomingForecasts = (forecasts) => {
  const now = Date.now();
  const upcoming = forecasts.filter((forecast) => {
    const time = new Date(forecast.local_datetime ?? forecast.utc_datetime).getTime();
    return !Number.isNaN(time) && time >= now;
  });

  return (upcoming.length ? upcoming : forecasts).slice(0, 4);
};

const WeatherForecast = () => {
  const [forecasts, setForecasts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadWeather = async () => {
      try {
        const data = await getWeatherForecast();
        if (isMounted) setForecasts(getUpcomingForecasts(data));
      } catch {
        if (isMounted) setError("Weather data unavailable");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadWeather();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold">Weather Forecast</h2>
        <p className="mt-4 text-gray-500">Loading weather forecast...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold">Weather Forecast</h2>
        <p className="mt-2 text-sm text-gray-500">Balanti, Baras, Pasangkayu, Sulawesi Barat</p>
        <p className="mt-4 text-gray-500">{error}</p>
        <p className="mt-4 text-xs text-gray-400">Sumber prakiraan cuaca: BMKG</p>
      </section>
    );
  }

  if (!forecasts.length) {
    return (
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold">Weather Forecast</h2>
        <p className="mt-4 text-gray-500">Weather data unavailable</p>
      </section>
    );
  }

  const current = forecasts[0];

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-xl font-bold">Weather Forecast</h2>
      <p className="mt-1 text-sm text-gray-500">Balanti, Baras, Pasangkayu, Sulawesi Barat</p>

      <div className="flex items-center gap-4 mt-5">
        {getWeatherIcon(current.weather)}
        <div>
          <p className="text-3xl font-bold">{current.temperature ?? "-"}&deg;C</p>
          <p className="text-gray-600">{current.weather ?? "Tidak diketahui"}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5 text-sm">
        <p><span className="text-gray-500">Humidity</span><br />{current.humidity ?? "-"}%</p>
        <p><span className="text-gray-500">Wind</span><br />{current.wind_speed ?? "-"} km/h</p>
        <p><span className="text-gray-500">Cloud Cover</span><br />{current.cloud_cover ?? "-"}%</p>
      </div>

      <div className="mt-5 border-t border-gray-100 divide-y divide-gray-100">
        {forecasts.map((forecast) => (
          <div key={forecast.local_datetime ?? forecast.utc_datetime} className="grid grid-cols-[4rem_4rem_1fr] gap-2 py-3 text-sm">
            <span className="font-medium">{formatForecastTime(forecast.local_datetime ?? forecast.utc_datetime)}</span>
            <span>{forecast.temperature ?? "-"}&deg;C</span>
            <span className="text-gray-600">{forecast.weather ?? "Tidak diketahui"}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-gray-400">Sumber prakiraan cuaca: BMKG</p>
    </section>
  );
};

export default WeatherForecast;
