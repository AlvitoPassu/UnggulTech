import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const data = [
  { time: "06:00", moisture: 40 },
  { time: "09:00", moisture: 50 },
  { time: "12:00", moisture: 45 },
  { time: "15:00", moisture: 55 },
  { time: "18:00", moisture: 60 },
];

const AnalyticsChart = () => {
  return (
    <div className="bg-white rounded-xl p-6 shadow-md h-[400px]">
      <h3 className="text-xl font-semibold mb-4">
        Moisture Trend
      </h3>

      <ResponsiveContainer width="100%" height="90%">
        <LineChart data={data}>
          <XAxis dataKey="time" />
          <YAxis />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="moisture"
            stroke="#16a34a"
            strokeWidth={3}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AnalyticsChart;