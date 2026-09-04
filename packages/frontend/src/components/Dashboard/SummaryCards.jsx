import { summaryData } from "../../data/dashboardData";

const StatusBadge = ({ isOnline }) => (
  <span
  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
      isOnline
        ? "bg-[#d1f0fa] text-[#1DAADF]"
        : "bg-red-100 text-red-700"
    }`}
  >
    <span
      className={`h-1.5 w-1.5 rounded-full ${
        isOnline ? "bg-[#1DAADF] animate-pulse" : "bg-red-500"
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
          title: "Air Humidity",
          value: sensorData.humidity === null ? "-" : `${sensorData.humidity}%`,
          status: sensorData.humidityStatus ?? "Tidak tersedia",
          icon: summaryData[2].icon,
          badge: null,
        },
        {
          title: "Sensor Status",
          value: isOnline ? "Aktif" : "Tidak Aktif",
          status: sensorData.lastSeen ? `Terakhir: ${formatLastSeen(sensorData.lastSeen)}` : "Belum ada data",
          icon: summaryData[3].icon,
          badge: <StatusBadge isOnline={isOnline} />,
        },
      ]
    : [];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
      {cards.map((item, index) => {
        const Icon = item.icon;

        return (
              <div key={index} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-600">{item.title}</h3>

                  <Icon className="text-2xl text-[#1DAADF]" aria-hidden="true" />
            </div>

                <div className="mt-4 flex min-h-10 items-center gap-3">
                  <p className="text-2xl font-bold tracking-tight text-slate-900">{item.value}</p>
              {item.badge}
            </div>

                <p className="mt-2 text-xs text-slate-500">{item.status}</p>
          </div>
        );
      })}
    </div>
  );
};

export default SummaryCards;

