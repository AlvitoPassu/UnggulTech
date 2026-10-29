import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FiActivity } from "react-icons/fi";
import { formatTimestamp, getBedNumber, getLocation, hasPosition } from "./sensorMapModel";

const conditionLabels = { dry: "Kering", normal: "Normal", wet: "Basah", Low: "Kering", Normal: "Normal", High: "Basah" };

function StatusBadge({ health }) {
  const config = {
    online: ["Online", "bg-sky-50 text-[#1686b3]"],
    stale: ["Stale", "bg-orange-50 text-orange-700"],
    offline: ["Offline", "bg-red-50 text-red-700"],
  }[health];
  if (!config) return null;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${config[1]}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />{config[0]}
  </span>;
}

function ReadingChart({ data, ph = false }) {
  if (!data?.length) return <p className="py-6 text-sm text-slate-500">Data grafik belum tersedia.</p>;
  return <div className="mt-4 h-52 w-full min-w-0"><ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} />
      <YAxis domain={ph ? [4, 8] : [0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} />
      <Tooltip contentStyle={{ border: "1px solid #e2e8f0", borderRadius: 6 }} />
      <Line type="monotone" dataKey={ph ? "soilPh" : "moisture"} name={ph ? "pH Tanah Global" : "Soil Moisture (%)"} stroke={ph ? "#10b981" : "#1DAADF"} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
    </LineChart>
  </ResponsiveContainer></div>;
}

function SensorDetail({ sensor, data, loading, unavailable }) {
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-slate-900">Sensor {sensor.id}</h2><p className="mt-1 break-words text-sm text-slate-500">{sensor.sensor_name}</p></div>
      {!unavailable && <StatusBadge health={data?.sensorHealth} />}
    </div>
    <dl className="mt-4 grid min-w-0 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div><dt className="text-xs text-slate-500">ID sensor</dt><dd className="mt-1 break-all font-medium">{sensor.id}</dd></div>
      <div><dt className="text-xs text-slate-500">Lokasi bibitan</dt><dd className="mt-1 break-words font-medium">{getLocation(sensor) || "Lokasi belum tercatat"}</dd></div>
      <div><dt className="text-xs text-slate-500">Nomor bedengan</dt><dd className="mt-1 font-medium">{getBedNumber(sensor.bedengan) ?? "Belum terpetakan (B1–B60)"}</dd></div>
      <div><dt className="text-xs text-slate-500">Posisi pemasangan</dt><dd className="mt-1 font-medium">{hasPosition(sensor) ? `Baris ${sensor.placement.row}, kolom ${sensor.placement.column}` : "Belum dikonfigurasi"}</dd></div>
      {!unavailable && <div><dt className="text-xs text-slate-500">Pembacaan terakhir</dt><dd className="mt-1 font-medium">{loading ? "Memuat…" : formatTimestamp(data?.lastSeen)}</dd></div>}
      {!unavailable && data?.temperature != null && <div><dt className="text-xs text-slate-500">Suhu udara (DHT11, payload perangkat)</dt><dd className="mt-1 font-medium">{data.temperature}°C</dd></div>}
      {!unavailable && data?.humidity != null && <div><dt className="text-xs text-slate-500">Kelembaban udara (DHT11, payload perangkat)</dt><dd className="mt-1 font-medium">{data.humidity}%</dd></div>}
    </dl>
  </>;
}

function RecentLogs({ logs, error }) {
  const hasTemperature = logs?.some((log) => log.temperature != null);
  const hasHumidity = logs?.some((log) => log.humidity != null);
  return error ? <p role="alert" className="mt-4 text-sm text-red-700">Riwayat pembacaan gagal dimuat.</p>
    : logs?.length ? <div className="mt-4 max-h-72 overflow-auto"><table className="w-full text-left text-xs" aria-label="Pembacaan terbaru sensor terpilih">
      <thead><tr className="text-slate-500"><th className="py-2 pr-3">Waktu (WITA)</th><th className="py-2 pr-3">Moisture</th>{hasTemperature && <th className="py-2 pr-3">Suhu udara</th>}{hasHumidity && <th className="py-2 pr-3">Kelembaban udara</th>}<th className="py-2">Kondisi</th></tr></thead>
      <tbody>{logs.map((log) => <tr key={log.id} className="border-t border-slate-100"><td className="py-3 pr-3">{log.time}</td><td className="py-3 pr-3">{log.moisture == null ? "—" : `${log.moisture}%`}</td>{hasTemperature && <td className="py-3 pr-3">{log.temperature == null ? "—" : `${log.temperature}°C`}</td>}{hasHumidity && <td className="py-3 pr-3">{log.humidity == null ? "—" : `${log.humidity}%`}</td>}<td className="py-3">{conditionLabels[log.condition || log.action] || "Tidak tersedia"}{log.needsAttention && " · Perlu Perhatian"}</td></tr>)}</tbody>
    </table></div> : <p className="mt-4 text-sm text-slate-500">Belum ada data terbaru.</p>;
}

export default function SensorReadings({ sensor, readings, ph, unavailable }) {
  if (!sensor) return <div className="py-8 text-center"><FiActivity className="mx-auto mb-3 text-3xl text-slate-300" aria-hidden="true" />
    <h2 className="text-lg font-bold text-slate-900">Informasi sensor</h2><p role="status" className="mt-2 text-sm text-slate-500">Pilih sensor pada peta bedengan untuk melihat grafik monitoring dan pembacaan terbaru.</p></div>;
  const loading = Boolean(readings.loading || readings.sensorId !== String(sensor.id));
  const failed = readings.error || unavailable;
  const data = !loading && !failed ? readings.data : null;
  const condition = conditionLabels[data?.condition || data?.status] || "Tidak tersedia";
  const phHistory = (ph.history || []).map((reading) => ({ ...reading, time: formatTimestamp(reading.measuredAt) }));
  return <>
    <SensorDetail sensor={sensor} data={data} loading={loading} unavailable={unavailable} />
    <section className="mt-6 min-w-0 border-t border-slate-200 pt-5" aria-label="Pembacaan Terbaru">
      <h3 className="text-base font-bold text-slate-900">Pembacaan Terbaru</h3>
      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-sky-100 bg-[#f3fbfe] p-4">
          <h4 className="text-sm font-bold text-slate-900">Kelembaban tanah — Sensor {sensor.id}</h4>
          {loading ? <p role="status" className="mt-3 text-sm text-slate-500">Memuat pembacaan sensor…</p>
            : failed ? <p role="alert" className="mt-3 text-sm text-red-700">Data sensor gagal dimuat. Mencoba kembali pada pembaruan berikutnya.</p>
              : <><p className="mt-3 text-3xl font-bold tracking-tight text-[#1686b3]">{data?.moisture == null ? "—" : `${data.moisture}%`}</p>
                <p className="mt-2 text-sm text-slate-600">{condition}{data?.needsAttention ? " · Perlu Perhatian" : ""}</p>
                <p className="mt-3 text-xs leading-5 text-slate-500">{!data?.lastSeen ? "Belum ada pembacaan sensor." : data.sensorHealth === "stale" ? "Pembacaan terakhir tersimpan; sensor berstatus Stale." : "Status mengikuti pembacaan terakhir dari backend."}</p></>}
        </div>
        <div className="min-w-0 rounded-lg border border-emerald-100 bg-emerald-50/50 p-4">
          <h4 className="text-sm font-bold text-slate-900">pH Tanah — Pengukuran Global</h4><p className="mt-1 text-xs leading-5 text-slate-500">Satu pengukuran untuk seluruh bedengan, tidak mewakili titik sensor Soil Moisture yang dipilih.</p>
          {ph.loading ? <p role="status" className="mt-3 text-sm text-slate-500">Memuat pH global…</p> : ph.error ? <p role="alert" className="mt-3 text-sm text-red-700">Data pH global gagal dimuat.</p> : <><p className="mt-3 text-2xl font-bold text-emerald-600">{ph.data?.soilPh == null ? "—" : Number(ph.data.soilPh).toFixed(2)}</p><p className="mt-1 text-xs text-slate-500">{ph.data?.status === "active" ? "Aktif" : ph.data?.status === "inactive" ? "Tidak Aktif" : "Belum Ada Data"} · {formatTimestamp(ph.data?.measuredAt)}</p></>}
        </div>
      </div>
      {!loading && <RecentLogs logs={readings.logs} error={readings.logsError || unavailable} />}
    </section>
    <section className="mt-6 min-w-0 border-t border-slate-200 pt-5" aria-label="Grafik Monitoring">
      <h3 className="text-base font-bold text-slate-900">Grafik Monitoring</h3>
      <div className="mt-4 grid min-w-0 gap-6 md:grid-cols-2">
        <div className="min-w-0"><h4 className="text-sm font-semibold text-[#1686b3]">Soil Moisture — Sensor {sensor.id}</h4><p className="mt-1 text-xs text-slate-500">10 data terbaru · Kelembaban tanah (%)</p>
          {loading ? <p role="status" className="mt-4 text-sm text-slate-500">Memuat grafik sensor…</p> : failed ? <p role="alert" className="mt-4 text-sm text-red-700">Grafik sensor gagal dimuat.</p> : <ReadingChart data={data?.chart} />}
        </div>
        <div className="min-w-0"><h4 className="text-sm font-semibold text-emerald-700">Grafik pH global</h4><p className="mt-1 text-xs text-slate-500">Pengukuran global untuk seluruh bedengan</p>
          {ph.loading ? <p role="status" className="mt-4 text-sm text-slate-500">Memuat grafik pH global…</p> : ph.historyError ? <p role="alert" className="mt-4 text-sm text-red-700">Riwayat pH global gagal dimuat.</p> : <ReadingChart data={phHistory} ph />}
        </div>
      </div>
    </section>
  </>;
}
