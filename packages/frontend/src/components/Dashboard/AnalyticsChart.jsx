import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const AnalyticsChart = ({ data }) => {
  return (
    <section className="h-[380px] rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:h-[400px] sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900">Moisture Trend</h3>
          <p className="mt-1 text-xs text-slate-500">Perubahan kelembapan tanah</p>
        </div>
        <span className="rounded-md bg-[#e8f7fc] px-2.5 py-1 text-xs font-medium text-[#1DAADF]">10 menit terakhir</span>
      </div>

      <ResponsiveContainer width="100%" height="82%">
        <LineChart data={data}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={30} />
          <Tooltip contentStyle={{ border: "1px solid #e2e8f0", borderRadius: "6px", boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)" }} />
          <Line
            type="monotone"
            dataKey="moisture"
            stroke="#1DAADF"
            strokeWidth={2.5}
            dot={{ r: 2.5, fill: "#1DAADF", strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
};

export default AnalyticsChart;
