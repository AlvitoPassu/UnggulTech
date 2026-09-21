import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const categories = [
  { key: "dry",    label: "Kering", description: "0% - 30%",     color: "#ef4444" },
  { key: "normal", label: "Normal", description: "> 30% - 70%",  color: "#22c55e" },
  { key: "wet",    label: "Basah",  description: "> 70% - 100%", color: "#1DAADF" },
];

const SoilMoistureCondition = ({ conditions }) => {
  const data = categories.map((category) => ({ ...category, value: conditions ? conditions[category.key] : 0 }));
  const total = data.reduce((sum, entry) => sum + entry.value, 0);
  return <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-base font-bold text-slate-900">Kondisi Soil Moisture Nursery</h2><p className="mt-1 text-xs text-slate-500">Distribusi pembacaan sensor online terkini</p><div className="mt-5 grid items-center gap-5 sm:grid-cols-[minmax(150px,0.9fr)_1fr]"><div className="relative mx-auto h-44 w-44"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="label" innerRadius={50} outerRadius={75} paddingAngle={2} stroke="none">{data.map((entry) => <Cell key={entry.key} fill={entry.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-xs text-slate-500">Total</span><strong className="text-xl text-slate-900">{conditions ? total : "-"}</strong><span className="text-xs text-slate-500">Sensor</span></div></div><div className="space-y-3">{data.map((entry) => { const percentage = total ? Math.round((entry.value / total) * 100) : "-"; const displayValue = conditions ? entry.value : "-"; return <div key={entry.key} className="flex items-start justify-between gap-3 text-sm"><div className="flex min-w-0 items-start gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} /><div><p className="font-medium text-slate-700">{entry.label}</p><p className="text-xs text-slate-500">{displayValue} sensor · {entry.description}</p></div></div><span className="font-semibold text-slate-700">{percentage}{percentage === "-" ? "" : "%"}</span></div>; })}</div></div></section>;
};

export default SoilMoistureCondition;
