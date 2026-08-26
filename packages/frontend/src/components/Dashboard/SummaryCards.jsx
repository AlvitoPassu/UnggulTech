import { summaryData } from "../../data/dashboardData";

const StatusBadge = ({ isOnline }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
      isOnline
        ? "bg-green-100 text-green-700"
        : "bg-red-100 text-red-700"
    }`}
  >
    <span
      className={`h-1.5 w-1.5 rounded-full ${
        isOnline ? "bg-green-500 animate-pulse" : "bg-red-500"
      }`}
    />
    {isOnline ? "Aktif" : "Tidak Aktif"}
  </span>
);

const formatLastSeen = (date) => {
  if (!date) return null;
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMin = Math.floor(diffMs / 1000 / 60);
  if (diffMin < 1) return "Baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  return `${diffHour} jam lalu`;
};

const SummaryCards = ({ sensorData }) => {
  const isOnline = sensorData ? sensorData.isOnline : false;

  const cards = sensorData
    ? [
        {
          title: "Soil Moisture",
          value: `${sensorData.moisture}%`,
          status: sensorData.status,
          icon: summaryData[0].icon,
          badge: null,
        },
        {
          title: "Temperature",
          value: sensorData.temperature === null ? "-" : `${sensorData.temperature}°C`,
          status: "Normal",
          icon: summaryData[1].icon,
          badge: null,
        },
        {
          title: "Sensor Status",
          value: isOnline ? "Aktif" : "Tidak Aktif",
          status: sensorData.lastSeen ? `Terakhir: ${formatLastSeen(sensorData.lastSeen)}` : "Belum ada data",
          icon: summaryData[2].icon,
          badge: <StatusBadge isOnline={isOnline} />,
        },
      ]
    : summaryData.map((item) => ({ ...item, badge: null }));

  return (
    <div className="grid grid-cols-3 gap-6">
      {cards.map((item, index) => {
        const Icon = item.icon;

        return (
          <div key={index} className="bg-white rounded-xl p-6 shadow">
            <div className="flex justify-between items-center">
              <h3>{item.title}</h3>

              <Icon className="text-3xl text-green-600" />
            </div>

            <div className="flex items-center gap-3 mt-3">
              <h1 className="text-3xl font-bold">{item.value}</h1>
              {item.badge}
            </div>

            <p className="text-sm text-gray-500 mt-1">{item.status}</p>
          </div>
        );
      })}
    </div>
  );
};

export default SummaryCards;
