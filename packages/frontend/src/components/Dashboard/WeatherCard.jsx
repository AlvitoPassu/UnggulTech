import { createElement, useEffect, useState } from "react";
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
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">Prakiraan Cuaca</h3>
          <p className="mt-1 text-xs text-slate-500">Kondisi lingkungan sekitar</p>
        </div>
        {location && (
          <span className="flex items-center gap-1 text-right text-xs text-slate-500">
            <FaMapMarkerAlt className="shrink-0 text-green-600" aria-hidden="true" />
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
          <div className="mb-5 flex items-center gap-4">
            {createElement(current ? getWeatherIcon(current.weather) : WiDaySunny, { className: "shrink-0 text-6xl text-yellow-500", "aria-hidden": true })}
            <div>
              <p className="text-3xl font-bold tracking-tight text-slate-900">{current.temperature}°C</p>
              <p className="capitalize text-slate-500">{current.weather}</p>
              <div className="mt-1 flex gap-4 text-xs text-slate-500">
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
            <div className="grid grid-cols-3 gap-2 border-t border-slate-200 pt-4">
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
    </section>
  );
};

export default WeatherCard;
