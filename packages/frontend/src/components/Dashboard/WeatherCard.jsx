import { useEffect, useState } from "react";
import { getForecast, getLocation } from "../../api/weatherApi";
import {
  WiDaySunny,
  WiCloud,
  WiRain,
  WiThunderstorm,
  WiFog,
  WiDayCloudy,
} from "react-icons/wi";
import { WiHumidity, WiStrongWind } from "react-icons/wi";
import { FaMapMarkerAlt } from "react-icons/fa";

const getWeatherIcon = (desc = "") => {
  const d = desc.toLowerCase();
  if (d.includes("hujan") || d.includes("rain")) return WiRain;
  if (d.includes("petir") || d.includes("thunder")) return WiThunderstorm;
  if (d.includes("kabut") || d.includes("fog") || d.includes("mist")) return WiFog;
  if (d.includes("berawan") || d.includes("cloudy")) return WiCloud;
  if (d.includes("cerah berawan") || d.includes("partly")) return WiDayCloudy;
  return WiDaySunny;
};

const formatLocalTime = (localDatetime = "") => {
  // Format: "2026-08-26 18:00:00"
  const date = new Date(localDatetime.replace(" ", "T") + "+08:00");
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Makassar",
  }).format(date);
};

const WeatherCard = () => {
  const [forecasts, setForecasts] = useState([]);
  const [location, setLocation] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchWeather = async () => {
      setIsLoading(true);
      const [forecastData, locationData] = await Promise.all([
        getForecast(),
        getLocation(),
      ]);
      // Ambil 4 slot waktu terdekat dari sekarang
      const now = new Date();
      const upcoming = forecastData
        .filter((f) => new Date(f.local_datetime.replace(" ", "T") + "+08:00") >= now)
        .slice(0, 4);
      setForecasts(upcoming);
      setLocation(locationData);
      setIsLoading(false);
    };

    fetchWeather();
  }, []);

  const current = forecasts[0];
  const rest = forecasts.slice(1);
  const Icon = current ? getWeatherIcon(current.weather) : WiDaySunny;

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-semibold">Prakiraan Cuaca</h3>
        {location && (
          <span className="flex items-center gap-1 text-sm text-gray-500">
            <FaMapMarkerAlt className="text-green-500" />
            {location.desa}, {location.kecamatan}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          Memuat data cuaca...
        </div>
      ) : !current ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          Data cuaca tidak tersedia
        </div>
      ) : (
        <>
          {/* Cuaca saat ini */}
          <div className="flex items-center gap-4 mb-5">
            <Icon className="text-6xl text-yellow-500 shrink-0" />
            <div>
              <p className="text-4xl font-bold text-gray-800">{current.temperature}°C</p>
              <p className="text-gray-500 capitalize">{current.weather}</p>
              <div className="flex gap-4 mt-1 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <WiHumidity className="text-blue-400 text-lg" />
                  {current.humidity}%
                </span>
                <span className="flex items-center gap-1">
                  <WiStrongWind className="text-gray-400 text-lg" />
                  {current.wind_speed} km/h
                </span>
              </div>
            </div>
          </div>

          {/* Prakiraan berikutnya */}
          {rest.length > 0 && (
            <div className="grid grid-cols-3 gap-2 border-t pt-4">
              {rest.map((f, i) => {
                const SlotIcon = getWeatherIcon(f.weather);
                return (
                  <div key={i} className="flex flex-col items-center text-center">
                    <span className="text-xs text-gray-400 mb-1">
                      {formatLocalTime(f.local_datetime)}
                    </span>
                    <SlotIcon className="text-3xl text-blue-400" />
                    <span className="text-sm font-semibold">{f.temperature}°C</span>
                    <span className="text-xs text-gray-400">{f.humidity}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default WeatherCard;
