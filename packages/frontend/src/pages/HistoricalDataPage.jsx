import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiCalendar, FiChevronLeft, FiChevronRight, FiDownload, FiEdit2, FiInfo, FiRefreshCw, FiSearch } from "react-icons/fi";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getHistoricalReadings, getHistoricalStatistics, getHistoricalTrend } from "../api/historicalApi";
import { getSensors } from "../api/sensorApi";
import { getRainfallHistory, updateRainfallReading } from "../api/rainfallApi";
import DownloadDataModal from "../components/Dashboard/DownloadDataModal";
import { useAuth } from "../context/AuthContext";
import HeaderAuthStatus from "../components/Auth/HeaderAuthStatus";

const today = new Date().toISOString().slice(0, 10);
const dateDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};
const initialFilters = { startDate: dateDaysAgo(7), endDate: today, sensorId: "", bedengan: "", interval: "day", sort: "created_at_desc", page: 1, limit: 50 };

const unwrap = (value, key) => value?.[key] ?? value?.data?.[key] ?? value?.data ?? value ?? [];
const formatWita = (value, options = {}) => value ? new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Makassar", ...options }).format(new Date(value)) : "-";
const displayValue = (value, suffix = "") => value === null || value === undefined || Number.isNaN(Number(value)) ? "-" : `${value}${suffix}`;
const formatMeasurementDate = (value) => formatWita(value, { dateStyle: "medium", timeStyle: "short" });
const toDateTimeLocal = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const getRainfallFilters = (nursery, bedengan) => ({
  nursery: nursery !== "all" ? nursery : undefined,
  bedengan: bedengan !== "all" ? bedengan : undefined,
});

const Panel = ({ children, className = "" }) => <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>;

function StatCard({ label, value, detail, accent }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p></div><div className="h-2 w-2 rounded-full bg-current opacity-70" /></div><p className="mt-2 text-[11px] text-slate-400">{detail}</p></div>;
}

function HistoricalDataPage() {
  const { executeProtectedAction, openLoginModal } = useAuth();
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [activeFilters, setActiveFilters] = useState(initialFilters);
  const [sensors, setSensors] = useState([]);
  const [readings, setReadings] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [trend, setTrend] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0, hasNext: false, hasPrevious: false });
  const [loading, setLoading] = useState({ table: true, stats: true, trend: true });
  const [error, setError] = useState(false);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [rainfallHistory, setRainfallHistory] = useState([]);
  const [rainfallHistoryLoading, setRainfallHistoryLoading] = useState(true);
  const [rainfallHistoryError, setRainfallHistoryError] = useState("");
  const [selectedRainfallNursery, setSelectedRainfallNursery] = useState("all");
  const [selectedRainfallBedengan, setSelectedRainfallBedengan] = useState("all");
  const [editingRainfall, setEditingRainfall] = useState(null);
  const [editForm, setEditForm] = useState({ rainfall_value: "", measured_at: "", nursery: "", bedengan: "", notes: "" });
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [rainfallMessage, setRainfallMessage] = useState({ type: "", text: "" });
  const rainfallHistoryRequestId = useRef(0);

  const fetchRainfallHistory = useCallback(async (filters) => {
    const requestId = ++rainfallHistoryRequestId.current;
    setRainfallHistoryLoading(true);
    setRainfallHistoryError("");
    try {
      const rainfallReadings = await getRainfallHistory(filters);
      if (requestId === rainfallHistoryRequestId.current) setRainfallHistory(rainfallReadings);
    } catch {
      if (requestId === rainfallHistoryRequestId.current) setRainfallHistoryError("Gagal memuat data curah hujan.");
    } finally {
      if (requestId === rainfallHistoryRequestId.current) setRainfallHistoryLoading(false);
    }
  }, []);

  useEffect(() => { getSensors().then(setSensors).catch(() => setSensors([])); }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getHistoricalReadings(activeFilters),
      getHistoricalStatistics(activeFilters),
      getHistoricalTrend(activeFilters),
    ]).then(([readingResponse, statisticsResponse, trendResponse]) => {
      if (cancelled) return;
      const readingData = unwrap(readingResponse, "readings");
      setReadings(Array.isArray(readingData) ? readingData : []);
      setPagination((current) => readingResponse?.pagination ?? readingResponse?.data?.pagination ?? { ...current, page: activeFilters.page });
      setStatistics(statisticsResponse?.statistics ?? statisticsResponse?.data ?? statisticsResponse);
      const trendData = unwrap(trendResponse, "trend");
      setTrend(Array.isArray(trendData) ? trendData : []);
    }).catch(() => { if (!cancelled) setError(true); }).finally(() => {
      if (!cancelled) setLoading({ table: false, stats: false, trend: false });
    });
    return () => { cancelled = true; };
  }, [activeFilters]);

  useEffect(() => {
    const filters = getRainfallFilters(selectedRainfallNursery, selectedRainfallBedengan);
    const timer = window.setTimeout(() => fetchRainfallHistory(filters), 0);
    return () => window.clearTimeout(timer);
  }, [fetchRainfallHistory, selectedRainfallBedengan, selectedRainfallNursery]);

  const bedengans = useMemo(() => [...new Set(sensors.map((sensor) => sensor.bedengan ?? sensor.bedengan_id ?? sensor.bed_id).filter((value) => value !== null && value !== undefined && value !== ""))].sort((a, b) => String(a).localeCompare(String(b), "id", { numeric: true })), [sensors]);
  const updateDraft = (key, value) => setDraftFilters((current) => ({ ...current, [key]: value }));
  const startRequest = () => { setError(false); setLoading({ table: true, stats: true, trend: true }); };
  const applyFilters = () => { startRequest(); setActiveFilters({ ...draftFilters, page: 1 }); };
  const resetFilters = () => { startRequest(); setDraftFilters(initialFilters); setActiveFilters(initialFilters); };
  const setPage = (page) => { setLoading((current) => ({ ...current, table: true })); setError(false); setActiveFilters((current) => ({ ...current, page })); };
  const setInterval = (interval) => { startRequest(); setActiveFilters((current) => ({ ...current, interval, page: 1 })); };
  const stat = (key) => statistics?.[key] ?? statistics?.[`${key}Moisture`];
  const rainfallNurseries = [...new Set([...sensors.map((sensor) => sensor.location), ...rainfallHistory.map((reading) => reading.nursery)].filter(Boolean))];
  const rainfallBedengans = [...new Set([...sensors.filter((sensor) => selectedRainfallNursery === "all" || sensor.location === selectedRainfallNursery).map((sensor) => sensor.bedengan), ...rainfallHistory.map((reading) => reading.bedengan)].filter((value) => value !== null && value !== undefined && value !== ""))];
  const openEditModal = (reading) => {
    setRainfallMessage({ type: "", text: "" });
    setEditError("");
    setEditingRainfall(reading);
    setEditForm({ rainfall_value: reading.rainfall_value ?? "", measured_at: toDateTimeLocal(reading.measured_at), nursery: reading.nursery ?? "", bedengan: reading.bedengan ?? "", notes: reading.notes ?? "" });
  };
  const closeEditModal = () => {
    if (editSaving) return;
    setEditingRainfall(null);
    setEditError("");
  };
  const handleRainfallUpdate = async (event) => {
    event.preventDefault();
    setEditError("");
    const rainfallValue = Number(editForm.rainfall_value);
    if (editForm.rainfall_value === "" || !Number.isFinite(rainfallValue) || rainfallValue < 0) {
      setEditError("Curah hujan harus berupa angka nol atau lebih.");
      return;
    }
    const measuredAt = new Date(editForm.measured_at);
    if (!editForm.measured_at || Number.isNaN(measuredAt.getTime())) {
      setEditError("Tanggal dan waktu pengukuran tidak valid.");
      return;
    }
    if (!window.confirm("Apakah Anda yakin ingin memperbarui data curah hujan ini?")) return;

    setEditSaving(true);
    try {
      await updateRainfallReading(editingRainfall.id, { rainfall_value: rainfallValue, measured_at: measuredAt.toISOString(), nursery: editForm.nursery || null, bedengan: editForm.bedengan || null, notes: editForm.notes });
      rainfallHistoryRequestId.current += 1;
      await fetchRainfallHistory(getRainfallFilters(selectedRainfallNursery, selectedRainfallBedengan));
      window.dispatchEvent(new Event("rainfall:updated"));
      setEditingRainfall(null);
      setRainfallMessage({ type: "success", text: "Data curah hujan berhasil diperbarui." });
    } catch (updateError) {
      if (updateError.response?.status === 401) {
        setEditError(updateError.response?.data?.message || "Sesi telah kedaluwarsa. Silakan login kembali untuk menyimpan perubahan.");
        openLoginModal();
      } else {
        setEditError(updateError.response?.data?.message || "Gagal memperbarui data curah hujan.");
      }
    } finally {
      setEditSaving(false);
    }
  };

  return <div className="min-h-screen bg-white text-slate-800">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex min-h-[92px] max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1DAADF] text-white"><img src="/apple-touch-icon.png" alt="Smart Soil" className="h-full w-full rounded-lg object-contain" /></div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold tracking-tight text-slate-900 sm:text-base">Smart Soil Monitoring System</p><p className="mt-0.5 text-xs text-slate-500">Overview operasional nursery</p></div>
        </div>
        <div className="ml-auto flex items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-2 text-right">
            <div><p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Terakhir diperbarui</p><p className="text-xs font-semibold text-slate-700">{formatWita(new Date(), { hour: "2-digit", minute: "2-digit" })} WITA</p></div>
            <button type="button" onClick={() => window.location.reload()} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-[#1DAADF]" aria-label="Refresh data"><FiRefreshCw aria-hidden="true" /></button>
          </div>
          <HeaderAuthStatus />
        </div>
      </div>
    </header>

    <main className="min-h-screen px-4 py-6 sm:px-6 sm:py-7 lg:px-8"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-sm font-medium text-[#1DAADF]">Monitoring / Analitik</p><h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Data Historis</h1><p className="mt-1 text-sm text-slate-500">Pantau dan analisis riwayat kondisi soil moisture berdasarkan periode, sensor, dan bedengan.</p></div><div className="text-right text-xs text-slate-400">Terakhir diperbarui<br /><strong className="text-[#1DAADF]">{formatWita(new Date(), { hour: "2-digit", minute: "2-digit" })} WITA</strong></div></header>

    <Panel className="mb-6 p-4 sm:p-5"><div className="mb-4 flex items-center gap-2"><FiSearch className="text-[#1DAADF]" /><h2 className="text-sm font-bold text-slate-800">Filter Data</h2></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs font-medium text-slate-600">Tanggal Mulai<input type="date" value={draftFilters.startDate} onChange={(event) => updateDraft("startDate", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700" /></label><label className="text-xs font-medium text-slate-600">Tanggal Akhir<input type="date" value={draftFilters.endDate} onChange={(event) => updateDraft("endDate", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700" /></label><label className="text-xs font-medium text-slate-600">Sensor<select value={draftFilters.sensorId} onChange={(event) => updateDraft("sensorId", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"><option value="">Semua Sensor</option>{sensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{sensor.sensor_name || sensor.name || `Sensor ${sensor.id}`}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Bedengan<select value={draftFilters.bedengan} onChange={(event) => updateDraft("bedengan", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"><option value="">Semua Bedengan</option>{bedengans.map((bedengan) => <option key={bedengan} value={bedengan}>Bedengan {bedengan}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Urutan<select value={draftFilters.sort} onChange={(event) => updateDraft("sort", event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"><option value="created_at_desc">Terbaru</option><option value="created_at_asc">Terlama</option><option value="moisture_desc">Moisture tertinggi</option><option value="moisture_asc">Moisture terendah</option></select></label></div><div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" onClick={applyFilters} className="rounded-md bg-[#1DAADF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1686b3]">Terapkan</button><button type="button" onClick={resetFilters} className="flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><FiRefreshCw /> Reset</button></div></Panel>

    {error && <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><FiInfo /> Gagal memuat data historis. Silakan coba lagi.</div>}
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Rata-rata Soil Moisture" value={loading.stats ? "..." : displayValue(stat("average"), "%")} detail="Berdasarkan filter aktif" accent="text-blue-700" /><StatCard label="Nilai Terendah" value={loading.stats ? "..." : displayValue(stat("minimum"), "%")} detail="Pembacaan minimum" accent="text-orange-600" /><StatCard label="Nilai Tertinggi" value={loading.stats ? "..." : displayValue(stat("maximum"), "%")} detail="Pembacaan maksimum" accent="text-[#1DAADF]" /><StatCard label="Jumlah Data" value={loading.stats ? "..." : displayValue(stat("count"))} detail="Total pembacaan" accent="text-violet-700" /></div>

    <Panel className="mb-6 p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">Trend Soil Moisture</h2><p className="mt-1 text-xs text-slate-500">Rata-rata soil moisture berdasarkan waktu</p></div><select value={activeFilters.interval} onChange={(event) => setInterval(event.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"><option value="hour">Per Jam</option><option value="day">Per Hari</option></select></div>{loading.trend ? <div className="flex h-64 items-center justify-center text-sm text-slate-400">Memuat chart...</div> : trend.length === 0 ? <div className="flex h-64 items-center justify-center text-sm text-slate-400">Tidak ada data trend untuk filter yang dipilih.</div> : <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 10, right: 12, left: -18, bottom: 4 }}><CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="timestamp" tickFormatter={(value) => formatWita(value, { day: "2-digit", month: "short" })} tick={{ fontSize: 11, fill: "#64748b" }} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11, fill: "#64748b" }} /><Tooltip labelFormatter={(value) => `${formatWita(value, { dateStyle: "medium", timeStyle: "short" })} WITA`} formatter={(value) => [`${value}%`, "Rata-rata Moisture"]} /><Line type="monotone" dataKey="averageMoisture" stroke="#238b45" strokeWidth={2} dot={{ r: 3, fill: "#238b45" }} /></LineChart></ResponsiveContainer></div>}</Panel>

    <Panel><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5"><div><h2 className="text-base font-bold text-slate-900">Data Historis Sensor</h2><p className="mt-1 text-xs text-slate-500">Waktu operasional ditampilkan dalam WITA</p></div><button type="button" onClick={() => executeProtectedAction(() => setIsDownloadOpen(true))} className="flex items-center gap-2 rounded-md bg-[#1DAADF] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1686b3] focus:outline-none focus:ring-2 focus:ring-[#a3e1f5] focus:ring-offset-2"><FiDownload /> Download Data</button></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{["Waktu", "Sensor", "Bedengan", "Soil Moisture", "Temperature", "Humidity", "Status"].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{loading.table ? <tr><td colSpan="7" className="px-4 py-12 text-center text-slate-400">Memuat data historis...</td></tr> : readings.length === 0 ? <tr><td colSpan="7" className="px-4 py-12 text-center"><p className="font-semibold text-slate-700">Tidak ada data historis</p><p className="mt-1 text-slate-400">Tidak ditemukan data untuk filter yang dipilih.</p></td></tr> : readings.map((reading, index) => <tr key={reading.id ?? `${reading.created_at}-${index}`} className="text-slate-600"><td className="whitespace-nowrap px-4 py-3">{formatWita(reading.created_at, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} WITA</td><td className="px-4 py-3 font-medium text-slate-800">{reading.sensor?.sensor_name || reading.sensor_name || reading.sensor?.name || `Sensor ${reading.sensor_id}`}</td><td className="px-4 py-3">{reading.bedengan ?? reading.sensor?.bedengan ?? "-"}</td><td className="px-4 py-3 font-semibold text-slate-800">{displayValue(reading.moisture, "%")}</td><td className="px-4 py-3">{displayValue(reading.temperature, "°C")}</td><td className="px-4 py-3">{displayValue(reading.humidity, "%")}</td><td className="px-4 py-3">{reading.status ?? "-"}</td></tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4 text-xs text-slate-500"><span>Menampilkan halaman {pagination.page ?? activeFilters.page} dari {pagination.totalPages ?? 0} ({pagination.total ?? 0} data)</span><div className="flex items-center gap-2"><button type="button" disabled={!pagination.hasPrevious} onClick={() => setPage((pagination.page ?? activeFilters.page) - 1)} className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40"><FiChevronLeft /> Sebelumnya</button><button type="button" disabled={!pagination.hasNext} onClick={() => setPage((pagination.page ?? activeFilters.page) + 1)} className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40">Berikutnya <FiChevronRight /></button></div></div></Panel>
    <Panel className="mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5"><div><h2 className="text-base font-bold text-slate-900">Riwayat Curah Hujan</h2><p className="mt-1 text-xs text-slate-500">Pengukuran aktual dari tabung ombrometer</p></div></div>
      <div className="grid gap-4 border-b border-slate-100 bg-slate-50 p-4 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Nursery<select value={selectedRainfallNursery} onChange={(event) => { setSelectedRainfallNursery(event.target.value); setSelectedRainfallBedengan("all"); }} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"><option value="all">Semua Nursery</option>{rainfallNurseries.map((nursery) => <option key={nursery} value={nursery}>{nursery}</option>)}</select></label><label className="text-xs font-medium text-slate-600">Bedengan<select value={selectedRainfallBedengan} onChange={(event) => setSelectedRainfallBedengan(event.target.value)} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"><option value="all">Semua Bedengan</option>{rainfallBedengans.map((bedengan) => <option key={bedengan} value={bedengan}>Bedengan {bedengan}</option>)}</select></label></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[940px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{["Waktu Pengukuran", "Nursery", "Bedengan", "Curah Hujan", "Catatan", "Sumber", "Aksi"].map((heading) => <th key={heading} className={`px-4 py-3 font-semibold ${heading === "Aksi" ? "text-right" : ""}`}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rainfallHistoryLoading ? <tr><td colSpan="7" className="px-4 py-12 text-center text-slate-400">Memuat data curah hujan...</td></tr> : rainfallHistoryError ? <tr><td colSpan="7" className="px-4 py-12 text-center text-red-600">{rainfallHistoryError}</td></tr> : rainfallHistory.length === 0 ? <tr><td colSpan="7" className="px-4 py-12 text-center"><p className="font-semibold text-slate-700">Belum ada pengukuran ombrometer</p><p className="mt-1 text-slate-400">Tidak ditemukan data untuk filter curah hujan yang dipilih.</p></td></tr> : rainfallHistory.map((reading) => <tr key={reading.id} className="text-slate-600"><td className="whitespace-nowrap px-4 py-3">{formatMeasurementDate(reading.measured_at)} WITA</td><td className="px-4 py-3">{reading.nursery || "-"}</td><td className="px-4 py-3">{reading.bedengan ? `Bedengan ${reading.bedengan}` : "-"}</td><td className="px-4 py-3 font-semibold text-slate-800">{reading.rainfall_value} {reading.unit}</td><td className="max-w-64 px-4 py-3">{reading.notes || "-"}</td><td className="px-4 py-3">{reading.source ? `${reading.source.charAt(0).toUpperCase()}${reading.source.slice(1)}` : "Ombrometer"}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => executeProtectedAction(() => openEditModal(reading))} className="inline-flex items-center gap-1.5 rounded-md border border-[#1DAADF] px-3 py-1.5 text-xs font-semibold text-[#1686b3] transition hover:bg-[#e8f7fc]"><FiEdit2 aria-hidden="true" /> Edit</button></td></tr>)}</tbody></table></div>
    </Panel>
    {rainfallMessage.text && <p className={`mt-4 rounded-md px-4 py-3 text-sm ${rainfallMessage.type === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{rainfallMessage.text}</p>}
    <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#e8f7fc] px-4 py-3 text-xs text-[#1686b3]"><FiCalendar /> Gunakan filter untuk melihat data historis sesuai periode, sensor, dan bedengan yang diinginkan.</div>
    {isDownloadOpen && <DownloadDataModal sensors={sensors} selectedSensorId={activeFilters.sensorId || sensors[0]?.id || ""} onClose={() => setIsDownloadOpen(false)} />}
    {editingRainfall && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-rainfall-title">
      <form onSubmit={handleRainfallUpdate} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 p-5"><h2 id="edit-rainfall-title" className="text-lg font-bold text-slate-900">Edit Data Curah Hujan</h2><p className="mt-1 text-sm text-slate-500">Koreksi hasil pengukuran tabung ombrometer.</p></div>
        <div className="grid gap-4 p-5 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Nilai Curah Hujan (ml)<input required min="0" step="any" type="number" value={editForm.rainfall_value} onChange={(event) => setEditForm((current) => ({ ...current, rainfall_value: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 font-normal outline-none focus:border-[#1DAADF] focus:ring-2 focus:ring-[#d1f0fa]" /></label><label className="text-sm font-medium text-slate-700">Tanggal/Waktu Pengukuran<input required type="datetime-local" value={editForm.measured_at} onChange={(event) => setEditForm((current) => ({ ...current, measured_at: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 font-normal outline-none focus:border-[#1DAADF] focus:ring-2 focus:ring-[#d1f0fa]" /></label><label className="text-sm font-medium text-slate-700">Nursery<select value={editForm.nursery} onChange={(event) => setEditForm((current) => ({ ...current, nursery: event.target.value, bedengan: "" }))} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal outline-none focus:border-[#1DAADF] focus:ring-2 focus:ring-[#d1f0fa]"><option value="">Semua nursery</option>{rainfallNurseries.map((nursery) => <option key={nursery} value={nursery}>{nursery}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Bedengan<select value={editForm.bedengan} onChange={(event) => setEditForm((current) => ({ ...current, bedengan: event.target.value }))} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal outline-none focus:border-[#1DAADF] focus:ring-2 focus:ring-[#d1f0fa]"><option value="">Semua bedengan</option>{rainfallBedengans.map((bedengan) => <option key={bedengan} value={bedengan}>Bedengan {bedengan}</option>)}</select></label><label className="text-sm font-medium text-slate-700 sm:col-span-2">Catatan<textarea value={editForm.notes} onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))} rows="3" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 font-normal outline-none focus:border-[#1DAADF] focus:ring-2 focus:ring-[#d1f0fa]" /></label>{editError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{editError}</p>}</div>
        <div className="flex justify-end gap-3 border-t border-slate-200 p-5"><button type="button" onClick={closeEditModal} disabled={editSaving} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">Batal</button><button type="submit" disabled={editSaving} className="rounded-md bg-[#1DAADF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1686b3] disabled:cursor-not-allowed disabled:opacity-60">{editSaving ? "Menyimpan..." : "Simpan Perubahan"}</button></div>
      </form>
    </div>}
  </div></main>
  </div>;
}

export default HistoricalDataPage;
