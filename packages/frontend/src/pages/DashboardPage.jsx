import { useEffect, useState } from "react";
import { FiActivity, FiDownload, FiRefreshCw } from "react-icons/fi";
import AttentionBedengans from "../components/Dashboard/AttentionBedengans";
import DownloadDataModal from "../components/Dashboard/DownloadDataModal";
import NurseryMoistureTrend from "../components/Dashboard/NurseryMoistureTrend";
import NurserySummaryCards from "../components/Dashboard/NurserySummaryCards";
import SensorStatusOverview from "../components/Dashboard/SensorStatusOverview";
import SoilMoistureCondition from "../components/Dashboard/SoilMoistureCondition";
import WeatherCard from "../components/Dashboard/WeatherCard";
import { getNurseryMoistureTrend, getNurseryOverview } from "../api/sensorApi";

const DashboardPage = () => {
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState([]);
  const [period, setPeriod] = useState("24h");
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    const fetchOverview = async () => {
      setIsLoading(true);
      setError("");
      try {
        const [overviewData, trendData] = await Promise.all([
          getNurseryOverview(),
          getNurseryMoistureTrend(period),
        ]);
        if (isCurrent) {
          setOverview(overviewData);
          setTrend(trendData);
        }
      } catch {
        if (isCurrent) {
          setOverview(null);
          setTrend([]);
          setError("Data nursery tidak dapat dimuat.");
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    fetchOverview();
    const interval = setInterval(fetchOverview, 60_000);
    return () => {
      isCurrent = false;
      clearInterval(interval);
    };
  }, [period, refreshToken]);

  const lastUpdated = overview?.summary?.lastUpdated;
  const formattedLastUpdated = lastUpdated
    ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastUpdated))
    : "Belum ada data";
  const sensors = overview?.sensors || [];

  return (
    <div className="min-h-screen bg-[#f4f7f3] text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-700 text-white"><FiActivity className="text-xl" aria-hidden="true" /></div>
            <div><p className="text-sm font-semibold tracking-tight text-slate-900 sm:text-base">Smart Soil Monitoring System</p><p className="mt-0.5 text-xs text-slate-500">Overview operasional nursery</p></div>
          </div>
          <div className="flex items-center gap-3 sm:gap-5">
            <div className="flex items-center gap-2 text-right">
              <div><p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Terakhir diperbarui</p><p className="text-xs font-semibold text-slate-700">{isLoading ? "Memuat data..." : formattedLastUpdated}</p></div>
              <button type="button" onClick={() => setRefreshToken((value) => value + 1)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-green-700" aria-label="Refresh data"><FiRefreshCw aria-hidden="true" /></button>
            </div>
            <button type="button" onClick={() => setIsDownloadModalOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"><FiDownload aria-hidden="true" />Download Data</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8">
        <div className="mb-6"><p className="mb-1 text-sm font-medium text-green-700">Overview kondisi nursery secara real-time</p><h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Dashboard</h1></div>
        {error && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => setRefreshToken((value) => value + 1)} className="font-semibold underline underline-offset-2">Refresh</button></div>}
        {isLoading && <p className="mb-4 text-sm text-slate-500">Memuat data nursery...</p>}

        <NurserySummaryCards summary={overview?.summary} />
        <div className="mt-6 grid gap-6 xl:grid-cols-2"><SoilMoistureCondition conditions={overview?.summary?.conditions} total={overview?.summary?.totalSensors} /><NurseryMoistureTrend data={trend} period={period} onPeriodChange={setPeriod} /></div>
        <div className="mt-6 grid gap-6 xl:grid-cols-3"><SensorStatusOverview summary={overview?.summary} /><AttentionBedengans sensors={overview?.attention} /><WeatherCard /></div>
      </main>

      {isDownloadModalOpen && <DownloadDataModal sensors={sensors} selectedSensorId={sensors[0]?.id || ""} onClose={() => setIsDownloadModalOpen(false)} />}
    </div>
  );
};

export default DashboardPage;
