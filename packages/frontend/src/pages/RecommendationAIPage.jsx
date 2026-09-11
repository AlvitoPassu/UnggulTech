import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FiActivity,
  FiCalendar,
  FiChevronDown,
  FiCloudRain,
  FiCpu,
  FiDroplet,
  FiInfo,
  FiMapPin,
  FiRefreshCw,
  FiTrendingUp,
} from "react-icons/fi";
import { getForecast } from "../api/weatherApi";
import { getHistoricalTrend, getHistoricalReadings } from "../api/historicalApi";
import { getSensorData, getSensors } from "../api/sensorApi";
import { getLatestRainfall, getRainfallTrend } from "../api/rainfallApi";

const panelClass = "rounded-xl border border-slate-200 bg-white shadow-sm";
const STORAGE_KEY = "unggul-ai-recommendation-history";

const getStoredHistory = () => {
  try {
    const storedHistory = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(storedHistory)
      ? storedHistory.map((item, index) => ({
        ...item,
        id: item.id || `${item.timestamp || "history"}-${index}`,
      }))
      : [];
  } catch {
    return [];
  }
};

const formatWita = (value, options = {}) => {
  if (!value) return "Belum ada data";

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Makassar",
    ...options,
  }).format(new Date(value));
};

const formatDisplayDate = (value) => {
  if (!value) return "Belum ada data";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Belum ada data";

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Makassar",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const moistureStatus = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return { label: "Data belum tersedia", tone: "neutral" };
  }

  if (value < 40) {
    return { label: "Kering", tone: "critical" };
  }

  if (value <= 70) {
    return { label: "Normal/Ideal", tone: "normal" };
  }

  return { label: "Terlalu Basah", tone: "attention" };
};

const phStatus = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return { label: "Data belum tersedia", tone: "neutral" };
  }

  if (value < 5) {
    return { label: "Terlalu Asam", tone: "critical" };
  }

  if (value >= 5 && value <= 5.4) {
    return { label: "Perlu Perhatian", tone: "attention" };
  }

  if (value >= 5.5 && value <= 6) {
    return { label: "Optimal", tone: "normal" };
  }

  if (value > 6 && value <= 6.5) {
    return { label: "Sesuai", tone: "normal" };
  }

  return { label: "Di Atas Target", tone: "attention" };
};

const rainfallStatus = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return { label: "Data belum tersedia", tone: "neutral" };
  }

  if (value < 10) {
    return { label: "Di Bawah Ambang", tone: "critical" };
  }

  return { label: "Mencapai/Melewati Ambang", tone: "normal" };
};

const getDecision = (rainfall, moisture) => {
  const rainfallValue = Number(rainfall);
  const moistureValue = Number(moisture);

  if (!Number.isFinite(rainfallValue)) {
    return {
      status: "PERLU PERHATIAN",
      title: "Menunggu data curah hujan",
      duration: "-",
      schedule: "Pagi & Sore",
      reason: "Data curah hujan belum tersedia. Rekomendasi penyiraman menunggu validasi dari ombrometer atau data sensor yang tersedia.",
      target: "40% – 70%",
      priority: "PERLU PERHATIAN",
    };
  }

  if (rainfallValue < 10) {
    return {
      status: "TINDAKAN DIPERLUKAN",
      title: "Lakukan Penyiraman",
      duration: "30 menit",
      schedule: "Pagi & Sore",
      reason: "Curah hujan berada di bawah ambang SOP perusahaan.",
      target: "40% – 70%",
      priority: "TINDAKAN DIPERLUKAN",
    };
  }

  const moistureLabel = moistureValue === null || Number.isNaN(moistureValue) ? "Data kelembaban belum tersedia" : moistureStatus(moistureValue).label;

  return {
    status: "NORMAL",
    title: "Tidak Perlu Penyiraman",
    duration: "-",
    schedule: "Pagi & Sore",
    reason: `Curah hujan telah mencapai atau melewati ambang SOP perusahaan. ${moistureLabel !== "Data kelembaban belum tersedia" ? `Kondisi kelembaban tanah saat ini tercatat ${moistureLabel.toLowerCase()}.` : "Kondisi kelembaban tanah belum tersedia untuk validasi tambahan."}`,
    target: "40% – 70%",
    priority: "NORMAL",
  };
};

const toneClasses = {
  normal: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  critical: "bg-red-50 text-red-700 border border-red-200",
  attention: "bg-amber-50 text-amber-700 border border-amber-200",
  neutral: "bg-slate-100 text-slate-600 border border-slate-200",
};

const ChartCard = ({ title, description, data, color, children, emptyText }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="mt-1 text-[11px] text-slate-500">{description}</p>
      </div>
      <span className="rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600" style={{ backgroundColor: `${color || "#e2e8f0"}20` }}>{data?.length ? "Aktual" : "Belum ada"}</span>
    </div>
    {data?.length ? (
      <div className="h-44 w-full">{children}</div>
    ) : (
      <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-slate-500">{emptyText}</div>
    )}
  </div>
);

const RecommendationAIPage = () => {
  const navigate = useNavigate();
  const [sensors, setSensors] = useState([]);
  const [selectedSensorId, setSelectedSensorId] = useState("");
  const [selectedNursery, setSelectedNursery] = useState("all");
  const [selectedBedengan, setSelectedBedengan] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState("7d");
  const [selectedSensorData, setSelectedSensorData] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [rainfall, setRainfall] = useState(null);
  const [rainfallTrend, setRainfallTrend] = useState([]);
  const [rainfallLoading, setRainfallLoading] = useState(true);
  const [rainfallError, setRainfallError] = useState("");
  const [trend, setTrend] = useState([]);
  const [history, setHistory] = useState(getStoredHistory);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [detailOpen, setDetailOpen] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let isCurrent = true;

    const fetchData = async () => {
      setLoading(true);
      setError("");

      try {
        const [sensorList, weatherForecast] = await Promise.all([
          getSensors(),
          getForecast(),
        ]);

        if (!isCurrent) return;

        setSensors(sensorList);

        const nurseries = [...new Set(sensorList.map((sensor) => sensor.location).filter(Boolean))];
        const possibleNursery = selectedNursery === "all" ? (nurseries[0] ?? "") : selectedNursery;

        const filteredByNursery = sensorList.filter((sensor) => {
          if (!possibleNursery) return true;
          return sensor.location === possibleNursery;
        });

        const bedenganList = [...new Set(filteredByNursery.map((sensor) => sensor.bedengan).filter((value) => value !== null && value !== undefined && value !== ""))].sort((a, b) => Number(a) - Number(b));
        const nextBedengan = selectedBedengan === "all" ? (bedenganList[0] ?? "") : selectedBedengan;

        const resolvedSensor = filteredByNursery.find((sensor) => String(sensor.bedengan) === String(nextBedengan)) || filteredByNursery[0] || sensorList[0];
        const nextSensorId = resolvedSensor?.id ? String(resolvedSensor.id) : "";

        if (nextSensorId) {
          const sensorValue = await getSensorData(nextSensorId);
          if (isCurrent) {
            setSelectedSensorData(sensorValue);
            setSelectedSensorId(nextSensorId);
            setSelectedNursery(possibleNursery || "all");
            setSelectedBedengan(nextBedengan || "all");
          }
        } else {
          if (isCurrent) {
            setSelectedSensorData(null);
            setSelectedSensorId("");
          }
        }

        if (weatherForecast && Array.isArray(weatherForecast)) {
          setForecast(weatherForecast.filter((item) => item && item.local_datetime).slice(0, 8));
        } else {
          setForecast([]);
        }

        const currentFilter = {
          bedengan: nextBedengan || undefined,
          sensorId: nextSensorId || undefined,
          startDate: undefined,
          endDate: undefined,
          interval: "day",
        };

        const [trendData, historicalResponse] = await Promise.all([
          getHistoricalTrend({ ...currentFilter, interval: selectedPeriod === "7d" ? "day" : selectedPeriod === "30d" ? "day" : "hour" }),
          getHistoricalReadings({ ...currentFilter, page: 1, limit: 5, sort: "created_at_desc" }),
        ]);

        if (isCurrent) {
          setTrend(Array.isArray(trendData?.trend) ? trendData.trend : Array.isArray(trendData) ? trendData : []);
          const latestEntries = Array.isArray(historicalResponse?.readings) ? historicalResponse.readings : [];
          if (latestEntries.length) {
            setLastUpdated(latestEntries[0].created_at || new Date().toISOString());
          } else {
            setLastUpdated(new Date().toISOString());
          }
        }
      } catch {
        if (isCurrent) {
          setSensors([]);
          setSelectedSensorData(null);
          setForecast([]);
          setRainfall(null);
          setRainfallTrend([]);
          setTrend([]);
          setError("Data rekomendasi tidak dapat dimuat. Silakan coba lagi.");
        }
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => {
      isCurrent = false;
    };
  }, [refreshToken, selectedBedengan, selectedNursery, selectedPeriod]);

  useEffect(() => {
    let isCurrent = true;
    const fetchRainfall = async () => {
      setRainfallLoading(true);
      setRainfallError("");
      const filters = {
        nursery: selectedNursery === "all" ? undefined : selectedNursery,
        bedengan: selectedBedengan === "all" ? undefined : selectedBedengan,
      };

      try {
        const [latestRainfall, rainfallSeries] = await Promise.all([
          getLatestRainfall(filters),
          getRainfallTrend(selectedPeriod, filters),
        ]);
        if (isCurrent) {
          setRainfall(latestRainfall ?? null);
          setRainfallTrend(Array.isArray(rainfallSeries) ? rainfallSeries : []);
        }
      } catch {
        if (isCurrent) {
          setRainfall(null);
          setRainfallTrend([]);
          setRainfallError("Gagal memuat data curah hujan.");
        }
      } finally {
        if (isCurrent) setRainfallLoading(false);
      }
    };

    fetchRainfall();
    return () => {
      isCurrent = false;
    };
  }, [refreshToken, selectedBedengan, selectedNursery, selectedPeriod]);

  const nurseryOptions = useMemo(
    () => [...new Set(sensors.map((sensor) => sensor.location).filter(Boolean))],
    [sensors]
  );

  const bedenganOptions = useMemo(() => {
    const filtered = sensors.filter((sensor) => {
      if (selectedNursery === "all" || !selectedNursery) return true;
      return sensor.location === selectedNursery;
    });

    return [...new Set(filtered.map((sensor) => sensor.bedengan).filter((value) => value !== null && value !== undefined && value !== ""))].sort((a, b) => Number(a) - Number(b));
  }, [selectedNursery, sensors]);

  const selectedBedenganLabel = selectedBedengan === "all" ? "Semua bedengan" : `Bedengan ${selectedBedengan}`;
  const selectedNurseryLabel = selectedNursery === "all" ? "Semua nursery" : selectedNursery;

  const moistureValue = Number(selectedSensorData?.moisture ?? null);
  const moistureMeta = moistureStatus(moistureValue);
  const phRaw = selectedSensorData?.soilPh ?? selectedSensorData?.soil_ph ?? null;
  const phValue = phRaw === null || phRaw === undefined || phRaw === "" ? null : Number(phRaw);
  const phMeta = phStatus(phValue);
  const rainfallRaw = rainfall?.rainfall_value ?? rainfall?.rainfall_mm ?? rainfall?.value ?? rainfall?.amount ?? null;
  const rainfallValue = rainfallRaw === null || rainfallRaw === undefined || rainfallRaw === "" ? null : Number(rainfallRaw);
  const rainfallMeta = rainfallStatus(rainfallValue);

  const recommendation = getDecision(rainfallValue, moistureValue);
  const nextForecast = forecast.find((item) => item && item.local_datetime) || forecast[0] || null;

  const primaryTrend = useMemo(
    () =>
      (trend || []).map((entry) => ({
        ...entry,
        label: entry.time || entry.timestamp || entry.date || formatWita(entry.timestamp || new Date(), { day: "2-digit", month: "short" }),
        value: Number(entry.averageMoisture ?? entry.moisture ?? entry.value ?? 0),
      })),
    [trend]
  );

  const phTrend = useMemo(
    () => (selectedSensorData?.chart || [])
      .filter((entry) => entry.soil_ph !== null && entry.soil_ph !== undefined && Number.isFinite(Number(entry.soil_ph)))
      .map((entry) => ({ ...entry, value: Number(entry.soil_ph) })),
    [selectedSensorData]
  );

  useEffect(() => {
    if (!selectedSensorData || !selectedSensorId) return;

    const recommendationEntry = {
      id: `${selectedSensorId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      location: `${selectedNurseryLabel} / ${selectedBedenganLabel}`,
      moisture: moistureValue,
      ph: phValue,
      rainfall: rainfallValue,
      recommendation: recommendation.title,
      status: recommendation.priority,
      detail: recommendation.reason,
    };

    queueMicrotask(() => {
      setHistory((current) => {
        const next = [recommendationEntry, ...current.filter((item) => item.id !== recommendationEntry.id)].slice(0, 6);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    });
  }, [selectedSensorData, selectedSensorId, selectedNurseryLabel, selectedBedenganLabel, moistureValue, phValue, rainfallValue, recommendation]);

  const quickActions = [
    { label: "Lihat Detail Sensor", action: () => navigate("/sensor") },
    { label: "Lihat Prakiraan Cuaca", action: () => navigate("/dashboard") },
    { label: "Lihat Riwayat Rekomendasi", action: () => setDetailOpen((current) => (current ? null : history[0] || null)) },
    { label: "Atur Parameter", action: () => navigate("/sensor") },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-[92px] max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1DAADF] text-white shadow-sm">
              <FiCpu className="text-xl" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-slate-900 sm:text-base">Unggul Monitoring</p>
              <p className="mt-0.5 text-xs text-slate-500">Rekomendasi tindakan berbasis data dan SOP operasional</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3 sm:gap-5">
            <div className="flex items-center gap-2 text-right">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Terakhir diperbarui</p>
                <p className="text-xs font-semibold text-slate-700">{loading ? "Memuat data..." : formatWita(lastUpdated || new Date(), { dateStyle: "medium", timeStyle: "short" })}</p>
              </div>
              <button
                type="button"
                onClick={() => setRefreshToken((value) => value + 1)}
                className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-[#1DAADF]"
                aria-label="Refresh rekomendasi"
              >
                <FiRefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-7">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-medium text-[#1DAADF]">Analisis / Tindakan</p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Rekomendasi AI</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Rekomendasi tindakan berdasarkan analisis data kelembaban tanah, pH tanah, curah hujan, dan prakiraan cuaca menggunakan AI (LLM).
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{error}</span>
            <button type="button" onClick={() => setRefreshToken((value) => value + 1)} className="font-semibold underline underline-offset-2">Refresh</button>
          </div>
        )}

        <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e8f7fc] text-[#1DAADF]">
                <FiDroplet className="text-lg" aria-hidden="true" />
              </div>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${toneClasses[moistureMeta.tone]}`}>{moistureMeta.label}</span>
            </div>
            <p className="mt-4 text-xs font-medium uppercase tracking-wider text-slate-500">Kelembaban Tanah</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{moistureValue === null || Number.isNaN(moistureValue) ? "-" : `${Math.round(moistureValue)}%`}</p>
            <p className="mt-3 text-[11px] text-slate-500">Range ideal: 40% – 70%</p>
            <div className="mt-auto h-10 w-full overflow-hidden rounded-lg bg-slate-100 p-1">
              <div className="flex h-full items-end gap-1">
                {[35, 42, 48, 62, 51, 58, 44].map((point, index) => (
                  <span key={index} className="block flex-1 rounded-md bg-[#1DAADF]/70" style={{ height: `${point}%` }} />
                ))}
              </div>
            </div>
          </div>

          <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-600">
                <FiActivity className="text-lg" aria-hidden="true" />
              </div>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${toneClasses[phMeta.tone]}`}>{phMeta.label}</span>
            </div>
            <p className="mt-4 text-xs font-medium uppercase tracking-wider text-slate-500">pH Tanah</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{phValue === null || Number.isNaN(phValue) ? "-" : phValue.toFixed(2)}</p>
            <p className="mt-3 text-[11px] text-slate-500">Kisaran target: 5.0 – 6.5</p>
            <p className="mt-1 text-[11px] text-slate-500">Optimal: 5.5 – 6.0</p>
            <p className="mt-1 text-[11px] text-slate-500">{phValue === null || Number.isNaN(phValue) ? "Data pH belum tersedia." : "Parameter pH tanah aktual"}</p>
            <div className="mt-auto h-10 w-full overflow-hidden rounded-lg bg-slate-100 p-1">
              <div className="flex h-full items-end gap-1">
                {[5.2, 5.6, 6.1, 5.8, 5.9, 6.3, 5.7].map((point, index) => (
                  <span key={index} className="block flex-1 rounded-md bg-emerald-400" style={{ height: `${((point - 4.8) / 2.2) * 100}%` }} />
                ))}
              </div>
            </div>
          </div>

          <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <FiCloudRain className="text-lg" aria-hidden="true" />
              </div>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${toneClasses[rainfallMeta.tone]}`}>{rainfallMeta.label}</span>
            </div>
            <p className="mt-4 text-xs font-medium uppercase tracking-wider text-slate-500">Curah Hujan</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{Number.isFinite(rainfallValue) ? `${rainfallValue.toFixed(1)} ml` : "-"}</p>
            <p className="mt-3 text-[11px] text-slate-500">Threshold SOP: 10 ml</p>
            <p className="mt-1 text-[11px] text-slate-500">Status: {rainfallMeta.label}</p>
            {rainfallLoading && <p className="mt-1 text-[11px] text-slate-500">Memuat data curah hujan...</p>}
            {!rainfallLoading && rainfallError && <p className="mt-1 text-[11px] text-red-600">{rainfallError}</p>}
            {!rainfallLoading && !rainfallError && rainfallValue === null && <p className="mt-1 text-[11px] text-slate-500">Belum ada pengukuran ombrometer.</p>}
            <p className="mt-1 text-[11px] text-slate-500">Sumber: {rainfall?.source || (rainfallValue === null ? "-" : "Ombrometer")}</p>
            <div className="mt-auto h-10 w-full overflow-hidden rounded-lg bg-slate-100 p-1">
              <div className="flex h-full items-end gap-1">
                {[5, 8, 12, 9, 14, 10, 11].map((point, index) => (
                  <span key={index} className="block flex-1 rounded-md bg-sky-400" style={{ height: `${Math.min(100, point * 7)}%` }} />
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                <FiMapPin className="text-lg" aria-hidden="true" />
              </div>
              <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">{selectedSensorData?.sensorStatus || selectedSensorData?.status || "Sensor"}</span>
            </div>
            <p className="mt-4 text-xs font-medium uppercase tracking-wider text-slate-500">Lokasi Monitoring</p>
            <p className="mt-2 text-xl font-bold tracking-tight text-slate-900">{selectedNursery === "all" ? "Semua Nursery" : selectedNursery || "Nursery belum tersedia"}</p>
            <p className="mt-2 text-sm text-slate-600">{selectedBedenganLabel}</p>
            <p className="mt-2 text-[11px] text-slate-500">Total bedengan: {bedenganOptions.length || sensors.length || 0}</p>
            <p className="mt-1 text-[11px] text-slate-500">Status sensor: {selectedSensorData?.isOnline ? "Aktif" : "Tidak tersedia"}</p>
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex min-w-[180px] flex-1 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span className="font-medium">Nursery</span>
              <select value={selectedNursery} onChange={(event) => setSelectedNursery(event.target.value)} className="w-full border-0 bg-transparent text-sm text-slate-700 outline-none">
                <option value="all">Semua Nursery</option>
                {nurseryOptions.map((nursery) => (
                  <option key={nursery} value={nursery}>{nursery}</option>
                ))}
              </select>
              <FiChevronDown className="text-slate-400" aria-hidden="true" />
            </div>

            <div className="flex min-w-[180px] flex-1 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span className="font-medium">Bedengan</span>
              <select value={selectedBedengan} onChange={(event) => setSelectedBedengan(event.target.value)} className="w-full border-0 bg-transparent text-sm text-slate-700 outline-none">
                <option value="all">Semua Bedengan</option>
                {bedenganOptions.map((bedengan) => (
                  <option key={bedengan} value={bedengan}>Bedengan {bedengan}</option>
                ))}
              </select>
              <FiChevronDown className="text-slate-400" aria-hidden="true" />
            </div>

            <div className="flex min-w-[160px] flex-1 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span className="font-medium">Periode</span>
              <select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)} className="w-full border-0 bg-transparent text-sm text-slate-700 outline-none">
                <option value="1d">Hari Ini</option>
                <option value="7d">7 Hari</option>
                <option value="30d">30 Hari</option>
              </select>
              <FiChevronDown className="text-slate-400" aria-hidden="true" />
            </div>
          </div>
        </section>

        <section className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,0.9fr)]">
          <div className={`${panelClass} p-5 sm:p-6`}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-1 text-sm font-medium text-[#1DAADF]">SOP / Keputusan</p>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Rekomendasi Tindakan</h2>
              </div>
              <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide ${toneClasses[recommendation.status === "NORMAL" ? "normal" : recommendation.status === "TINDAKAN DIPERLUKAN" ? "critical" : "attention"]}`}>
                {recommendation.status}
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-500">Status</p>
              <p className="mt-3 text-3xl font-bold text-slate-900">{recommendation.title}</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-white p-3 border border-slate-200">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Durasi</p>
                  <p className="mt-2 text-lg font-bold text-slate-900">{recommendation.duration}</p>
                </div>
                <div className="rounded-xl bg-white p-3 border border-slate-200">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Waktu</p>
                  <p className="mt-2 text-lg font-bold text-slate-900">{recommendation.schedule}</p>
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-white p-3 border border-slate-200">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Alasan</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{recommendation.reason}</p>
              </div>
              <div className="mt-4 rounded-xl bg-white p-3 border border-slate-200">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Target moisture</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{recommendation.target}</p>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="mb-3 text-base font-bold text-slate-900">Rekomendasi umum</h3>
              <ol className="space-y-3 text-sm text-slate-700">
                {recommendation.title === "Lakukan Penyiraman" ? (
                  <>
                    <li>1. Lakukan penyiraman sesuai jadwal selama 30 menit.</li>
                    <li>2. Pantau kembali kelembaban media setelah penyiraman.</li>
                    <li>3. Pantau kondisi pH jika berada di bawah kisaran target.</li>
                    <li>4. Perhatikan prakiraan hujan untuk periode berikutnya.</li>
                  </>
                ) : (
                  <>
                    <li>1. Pertahankan kondisi media.</li>
                    <li>2. Lanjutkan monitoring.</li>
                    <li>3. Ikuti jadwal penyiraman sesuai SOP.</li>
                    <li>4. Tinjau ulang data sensor secara berkala.</li>
                  </>
                )}
              </ol>
            </div>
          </div>

          <aside className={`${panelClass} p-5 sm:p-6`}>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#e8f7fc] text-[#1DAADF]">
                <FiCpu className="text-xl" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Penjelasan AI</h2>
              </div>
            </div>

            <div className="space-y-5 text-sm text-slate-700">
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Data yang dianalisis</p>
                <ul className="space-y-2">
                  <li className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2"><span>Kelembaban Tanah</span><strong>{moistureValue === null || Number.isNaN(moistureValue) ? "-" : `${Math.round(moistureValue)}%`}</strong></li>
                  <li className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2"><span>pH Tanah</span><strong>{phValue === null || Number.isNaN(phValue) ? "Data belum tersedia" : phValue.toFixed(2)}</strong></li>
                  <li className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2"><span>Curah Hujan</span><strong>{Number.isFinite(rainfallValue) ? `${rainfallValue.toFixed(1)} ml` : "Data belum tersedia"}</strong></li>
                  <li className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2"><span>Probabilitas Hujan</span><strong>{nextForecast?.humidity ? `${nextForecast.humidity}%` : "Data tidak tersedia"}</strong></li>
                </ul>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Kesimpulan</p>
                <p className="rounded-md border border-slate-200 bg-slate-50 p-3 leading-6 text-slate-700">
                  {recommendation.title === "Lakukan Penyiraman"
                    ? "Kelembaban tanah berada di bawah kisaran target dan curah hujan masih berada di bawah ambang SOP perusahaan. Berdasarkan SOP, penyiraman perlu dilakukan selama 30 menit."
                    : recommendation.reason}
                </p>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Faktor pertimbangan</p>
                <ul className="space-y-2 text-slate-600">
                  <li>✓ Kelembaban tanah</li>
                  <li>✓ pH tanah</li>
                  <li>✓ Curah hujan</li>
                  <li>✓ SOP penyiraman</li>
                  <li>✓ Prakiraan cuaca jika tersedia</li>
                </ul>
              </div>

              <div className="rounded-md bg-[#e8f7fc] p-3 text-xs leading-5 text-[#1686b3]">
                <div className="flex items-start gap-2">
                  <FiInfo className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    {nextForecast ? `Prakiraan saat ini: ${nextForecast.weather || "Cuaca tidak tersedia"}.` : "Prakiraan cuaca tidak tersedia."}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="mb-6">
          <div className="mb-4 flex items-center gap-2">
            <FiTrendingUp className="text-[#1DAADF]" aria-hidden="true" />
            <h2 className="text-xl font-bold text-slate-900">Tren Data 7 Hari Terakhir</h2>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard title="Kelembaban Tanah" description="Trend kelembaban tanah" data={primaryTrend} color="#1DAADF" emptyText="Data kelembaban tanah belum tersedia.">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={primaryTrend} margin={{ top: 10, right: 8, left: -18, bottom: 4 }}>
                  <defs>
                    <linearGradient id="moistureFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#1DAADF" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#1DAADF" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip formatter={(value) => [`${value}%`, "Kelembaban"]} labelFormatter={(value) => value} />
                  <Area type="monotone" dataKey="value" stroke="#1DAADF" strokeWidth={2.5} fill="url(#moistureFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="pH Tanah" description="Trend pH tanah aktual" data={phTrend} color="#10b981" emptyText="Data pH belum tersedia.">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={phTrend} margin={{ top: 10, right: 8, left: -18, bottom: 4 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[4.5, 7]} tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip formatter={(value) => [value, "pH"]} />
                  <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Curah Hujan" description="Trend curah hujan ombrometer" data={rainfallTrend} color="#38bdf8" emptyText="Belum ada pengukuran ombrometer.">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rainfallTrend} margin={{ top: 10, right: 8, left: -18, bottom: 4 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip formatter={(value) => [`${value} ml`, "Curah Hujan"]} />
                  <Line type="monotone" dataKey="rainfall_value" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </section>

        <section className={`${panelClass} mb-6 overflow-hidden`}>
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-xl font-bold text-slate-900">Riwayat Rekomendasi</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Tanggal &amp; Waktu</th>
                  <th className="px-5 py-3">Lokasi</th>
                  <th className="px-5 py-3">Kelembaban</th>
                  <th className="px-5 py-3">pH</th>
                  <th className="px-5 py-3">Curah Hujan</th>
                  <th className="px-5 py-3">Rekomendasi</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-slate-500">Belum ada riwayat rekomendasi untuk ditampilkan.</td>
                  </tr>
                ) : (
                  history.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100 text-slate-700">
                      <td className="px-5 py-3">{formatDisplayDate(item.timestamp)}</td>
                      <td className="px-5 py-3">{item.location || "-"}</td>
                      <td className="px-5 py-3">{item.moisture == null || Number.isNaN(Number(item.moisture)) ? "-" : `${Math.round(Number(item.moisture))}%`}</td>
                      <td className="px-5 py-3">{item.ph == null ? "-" : Number(item.ph).toFixed(1)}</td>
                      <td className="px-5 py-3">{item.rainfall == null ? "-" : `${Number(item.rainfall).toFixed(1)} ml`}</td>
                      <td className="px-5 py-3">{item.recommendation || "-"}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${toneClasses[item.status === "NORMAL" ? "normal" : item.status === "TINDAKAN DIPERLUKAN" ? "critical" : "attention"]}`}>
                          {item.status || "PERLU PERHATIAN"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <button type="button" className="font-semibold text-[#1DAADF]" onClick={() => setDetailOpen((current) => (current?.id === item.id ? null : item))}>Lihat</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {detailOpen && (
            <div className="border-t border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">Detail keputusan</p>
                  <p className="mt-1 text-xs text-slate-500">Dibuat pada {formatWita(detailOpen.timestamp, { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
                <button type="button" className="text-sm font-medium text-slate-500 hover:text-slate-700" onClick={() => setDetailOpen(null)}>Tutup</button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Data saat keputusan dibuat</p>
                  <ul className="mt-2 space-y-2 text-sm text-slate-700">
                    <li>Kelembaban tanah: {detailOpen.moisture == null ? "Data belum tersedia" : `${Math.round(Number(detailOpen.moisture))}%`}</li>
                    <li>pH tanah: {detailOpen.ph == null ? "Data belum tersedia" : Number(detailOpen.ph).toFixed(1)}</li>
                    <li>Curah hujan: {detailOpen.rainfall == null ? "Data belum tersedia" : `${Number(detailOpen.rainfall).toFixed(1)} ml`}</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Rule yang digunakan</p>
                  <ul className="mt-2 space-y-2 text-sm text-slate-700">
                    <li>• Penyiraman pagi dan sore sesuai SOP.</li>
                    <li>• Curah hujan di bawah 10 ml memicu penyiraman.</li>
                    <li>• Curah hujan 10 ml atau lebih meniadakan kebutuhan penyiraman.</li>
                  </ul>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Hasil keputusan</p>
                <p className="mt-2 text-base font-bold text-slate-900">{detailOpen.recommendation}</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{detailOpen.detail}</p>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <FiCalendar className="text-[#1DAADF]" aria-hidden="true" />
            <h2 className="text-xl font-bold text-slate-900">Quick Actions</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map(({ label, action }) => (
              <button
                key={label}
                type="button"
                onClick={action}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-[#1DAADF] hover:bg-[#e8f7fc] hover:text-[#1686b3]"
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {loading && (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-32 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default RecommendationAIPage;
