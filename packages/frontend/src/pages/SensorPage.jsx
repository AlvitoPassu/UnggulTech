import { useEffect, useState } from "react";
import {
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
  FiAlertCircle,
  FiBattery,
  FiInfo,
  FiMapPin,
  FiRefreshCw,
  FiThermometer,
  FiDroplet,
} from "react-icons/fi";
import { WiHumidity } from "react-icons/wi";
import {
  getRecentLogs,
  getSensorData,
  getSensors,
  getSensorDisplayName,
} from "../api/sensorApi";

const panelClass = "rounded-lg border border-slate-200 bg-white shadow-sm";

const formatLastSeen = (date) => {
  if (!date) return "Belum ada data";

  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  if (diffMinutes < 1) return "Baru saja";
  if (diffMinutes < 60) return `${diffMinutes} menit lalu`;

  return `${Math.floor(diffMinutes / 60)} jam lalu`;
};

const StatusBadge = ({ isOnline }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${isOnline ? "bg-[#e8f7fc] text-[#1DAADF]" : "bg-red-50 text-red-700"}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-[#1DAADF]" : "bg-red-500"}`} />
    {isOnline ? "Aktif" : "Tidak Aktif"}
  </span>
);

const Metric = ({ icon: Icon, label, value, status, color = "text-[#1DAADF]" }) => (
  <div className="rounded-md border border-slate-200 p-4">
    <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
      <Icon className={`text-lg ${color}`} aria-hidden="true" />
      {label}
    </div>
    <p className="mt-3 text-xl font-bold tracking-tight text-slate-900">{value}</p>
    <p className="mt-1 text-xs text-slate-500">{status}</p>
  </div>
);

const SensorPage = () => {
  const [sensors, setSensors] = useState([]);
  const [selectedSensorId, setSelectedSensorId] = useState("");
  const [sensorData, setSensorData] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);

  useEffect(() => {
    const fetchSensors = () => {
      getSensors().then((data) => {
        setSensors(data);
        setSelectedSensorId((previousId) => previousId || data[0]?.id || "");
      });
    };

    fetchSensors();
    const interval = setInterval(fetchSensors, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedSensorId) return;

    const fetchData = () => {
      getSensorData(selectedSensorId).then(setSensorData);
      getRecentLogs(selectedSensorId).then(setRecentLogs);
    };

    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [selectedSensorId]);

  const selectedSensor = sensors.find((sensor) => sensor.id === selectedSensorId);
  const isOnline = sensorData?.isOnline ?? false;
  const moisture = sensorData?.moisture ?? "-";
  const sensorLocation = selectedSensor?.location || "Lokasi belum tersedia";

  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-[92px] max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1DAADF] text-white">
              <img src="/apple-touch-icon.png" alt="Smart Soil" className="h-full w-full rounded-lg object-contain" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-slate-900 sm:text-base">Smart Soil Monitoring System</p>
              <p className="mt-0.5 text-xs text-slate-500">Monitoring detail sensor</p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            <div className="hidden items-center gap-2 text-right sm:flex">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Terakhir diperbarui</p>
                <p className="text-xs font-semibold text-slate-700">{formatLastSeen(sensorData?.lastSeen)}</p>
              </div>
              <FiRefreshCw className="text-slate-500" aria-hidden="true" />
            </div>
            <div>
              <label htmlFor="sensor-page-selector" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">Pilih Bedengan</label>
              <select
                id="sensor-page-selector"
                value={selectedSensorId}
                onChange={(event) => setSelectedSensorId(event.target.value)}
                className="min-w-44 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-[#1DAADF] focus:ring-2 focus:ring-[#d1f0fa]"
              >
                {sensors.length === 0 ? <option value="">Belum ada bedengan aktif</option> : sensors.map((sensor) => <option key={sensor.id} value={sensor.id}>{getSensorDisplayName(sensor)}</option>)}
              </select>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8">
        <div className="mb-6">
          <p className="mb-1 text-sm font-medium text-[#1DAADF]">Sensor / Detail Sensor</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Sensor</h1>
        </div>

        <section className={`${panelClass} p-5 sm:p-6`}>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f7fc] text-[#1DAADF]">
                <FiActivity className="text-2xl" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">{selectedSensor ? getSensorDisplayName(selectedSensor) : "Sensor belum dipilih"}</h2>
                <p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><FiMapPin aria-hidden="true" /> {sensorLocation}</p>
              </div>
            </div>
            <StatusBadge isOnline={isOnline} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,2fr)]">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
              <div><dt className="text-xs text-slate-500">Lokasi</dt><dd className="mt-1 font-medium text-slate-800">{sensorLocation}</dd></div>
              <div><dt className="text-xs text-slate-500">Jenis Tanaman</dt><dd className="mt-1 font-medium text-slate-800">Kelapa Sawit</dd></div>
              <div><dt className="text-xs text-slate-500">Status Sensor</dt><dd className="mt-1"><StatusBadge isOnline={isOnline} /></dd></div>
              <div><dt className="text-xs text-slate-500">Terakhir Update</dt><dd className="mt-1 font-medium text-slate-800">{formatLastSeen(sensorData?.lastSeen)}</dd></div>
            </dl>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Metric icon={FiDroplet} label="Soil Moisture" value={moisture === "-" ? "-" : `${moisture}%`} status={sensorData?.status || "Tidak tersedia"} />
              <Metric icon={FiThermometer} label="Temperature" value={sensorData?.temperature == null ? "-" : `${sensorData.temperature}°C`} status={sensorData?.temperature == null ? "Tidak tersedia" : "Data terbaru"} color="text-orange-500" />
              <Metric icon={WiHumidity} label="Air Humidity" value={sensorData?.humidity == null ? "-" : `${sensorData.humidity}%`} status={sensorData?.humidityStatus || "Tidak tersedia"} color="text-sky-600" />
              <Metric icon={FiBattery} label="Voltage" value="-" status="Tidak tersedia" color="text-violet-500" />
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <section className={`${panelClass} p-5 sm:p-6 xl:col-span-2`}>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div><h2 className="text-base font-bold text-slate-900">Grafik Soil Moisture</h2><p className="mt-1 text-xs text-slate-500">Data aktual dari pembacaan sensor</p></div>
              <span className="rounded-md bg-[#e8f7fc] px-2.5 py-1 text-xs font-medium text-[#1DAADF]">10 data terbaru</span>
            </div>
            {sensorData?.chart?.length ? (
              <div className="h-[290px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sensorData.chart} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={35} />
                    <Tooltip contentStyle={{ border: "1px solid #e2e8f0", borderRadius: "6px" }} />
                    <Line type="monotone" dataKey="moisture" name="Soil Moisture (%)" stroke="#1DAADF" strokeWidth={2.5} dot={{ r: 3, fill: "#1DAADF", strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <div className="flex h-[290px] items-center justify-center text-sm text-slate-400">Data grafik belum tersedia</div>}
          </section>

          <section className={`${panelClass} p-5 sm:p-6`}>
            <div className="flex items-center gap-2"><FiInfo className="text-lg text-[#1DAADF]" aria-hidden="true" /><h2 className="text-base font-bold text-slate-900">Informasi Sensor</h2></div>
            <dl className="mt-5 divide-y divide-slate-100 text-sm">
              <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Tipe Sensor</dt><dd className="text-right font-medium text-slate-800">Capacitive Soil Moisture Sensor V2.0</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Interval Pengiriman</dt><dd className="font-medium text-slate-800">1 menit</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Tegangan Operasional</dt><dd className="font-medium text-slate-800">3.3V - 5.5V DC</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Status Koneksi</dt><dd><StatusBadge isOnline={isOnline} /></dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Terakhir Update</dt><dd className="font-medium text-slate-800">{formatLastSeen(sensorData?.lastSeen)}</dd></div>
            </dl>
            <div className="mt-4 flex gap-2 rounded-md bg-[#e8f7fc] p-3 text-xs leading-5 text-[#1686b3]"><FiInfo className="mt-0.5 shrink-0" aria-hidden="true" /> Status ditentukan dari pembacaan sensor terakhir.</div>
          </section>
        </div>

        <section className={`${panelClass} mt-6 overflow-hidden`}>
          <div className="border-b border-slate-200 p-5"><h2 className="text-base font-bold text-slate-900">Data Terakhir</h2><p className="mt-1 text-xs text-slate-500">Riwayat pembacaan sensor terbaru</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Waktu</th><th className="px-5 py-3 font-semibold">Soil Moisture (%)</th><th className="px-5 py-3 font-semibold">Temperature (°C)</th><th className="px-5 py-3 font-semibold">Air Humidity (%)</th><th className="px-5 py-3 font-semibold">Status</th></tr></thead><tbody>{recentLogs.length === 0 ? <tr><td colSpan="5" className="p-6 text-center text-slate-500">Belum ada data terbaru.</td></tr> : recentLogs.map((log) => <tr key={log.id}><td className="border-t border-slate-100 px-5 py-3 text-slate-600">{log.time || "-"}</td><td className="border-t border-slate-100 px-5 py-3 font-medium text-slate-800">{log.moisture ?? "-"}</td><td className="border-t border-slate-100 px-5 py-3 text-slate-600">{log.temperature ?? "-"}</td><td className="border-t border-slate-100 px-5 py-3 text-slate-600">{log.humidity ?? "-"}</td><td className="border-t border-slate-100 px-5 py-3"><StatusBadge isOnline={isOnline} /></td></tr>)}</tbody></table></div>
        </section>

        <section className={`${panelClass} mt-6 p-5 sm:p-6`}><div className="flex items-start gap-3"><FiAlertCircle className="mt-0.5 text-lg text-slate-400" aria-hidden="true" /><div><h2 className="text-base font-bold text-slate-900">Catatan Status</h2><p className="mt-1 text-sm text-slate-500">{isOnline ? "Sensor sedang mengirimkan pembacaan terbaru." : "Sensor tidak mengirimkan pembacaan dalam periode terakhir."}</p></div></div></section>
      </main>

    </div>
  );
};

export default SensorPage;
