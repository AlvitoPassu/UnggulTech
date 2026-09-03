import { FiActivity, FiDroplet, FiGrid, FiWifi } from "react-icons/fi";

const NurserySummaryCards = ({ summary }) => {
  const cards = [
    { label: "Total Bedengan", value: summary?.totalBedengan, detail: "Nursery", icon: FiGrid, color: "text-green-700", bg: "bg-green-50" },
    { label: "Sensor Terpasang", value: summary?.totalSensors, detail: `${summary?.totalSensors ?? "-"} sensor terdaftar`, icon: FiActivity, color: "text-emerald-700", bg: "bg-emerald-50" },
    { label: "Sensor Aktif", value: summary?.activeSensors, detail: "Terhubung", icon: FiWifi, color: "text-sky-700", bg: "bg-sky-50" },
    { label: "Rata-rata Soil Moisture", value: summary?.averageMoisture == null ? "-" : `${Math.round(summary.averageMoisture)}%`, detail: "Seluruh sensor", icon: FiDroplet, color: "text-blue-700", bg: "bg-blue-50" },
  ];

  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, detail, icon: Icon, color, bg }) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">{label}</p><p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{value ?? "-"}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><span className={`flex h-10 w-10 items-center justify-center rounded-md ${bg} ${color}`}><Icon className="text-xl" aria-hidden="true" /></span></div></div>)}</div>;
};

export default NurserySummaryCards;
