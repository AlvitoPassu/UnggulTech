import { FiArrowRight } from "react-icons/fi";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Link } from "react-router-dom";

const SensorStatusOverview = ({ summary }) => {
  const data = [
    { label: "Aktif", value: summary ? summary.activeSensors : 0, color: "#1DAADF" },
    { label: "Offline", value: summary ? summary.offlineSensors : 0, color: "#dc3d3d" },
    { label: "Nonaktif", value: summary ? summary.nonactiveSensors : 0, color: "#94a3b8" },
  ];
  const total = summary?.totalSensors;
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-base font-bold text-slate-900">Status Sensor</h2><div className="mt-4 flex items-center gap-4"><div className="relative h-28 w-28 shrink-0"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius={34} outerRadius={52} paddingAngle={2} stroke="none">{data.map((entry) => <Cell key={entry.label} fill={entry.color} />)}</Pie></PieChart></ResponsiveContainer><div className="absolute inset-0 flex flex-col items-center justify-center"><strong className="text-lg text-slate-900">{total ?? "-"}</strong><span className="text-[10px] text-slate-500">Total</span></div></div><div className="flex-1 space-y-2 text-xs">{data.map((entry) => <div key={entry.label} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-slate-600"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />{entry.label}</span><span className="font-semibold text-slate-700">{summary ? entry.value : "-"}</span></div>)}</div></div><Link to="/sensor" className="mt-4 flex items-center justify-end gap-1 border-t border-slate-100 pt-3 text-xs font-semibold text-[#1DAADF] hover:text-[#1686b3]">Lihat semua sensor <FiArrowRight aria-hidden="true" /></Link></section>;
};

export default SensorStatusOverview;
