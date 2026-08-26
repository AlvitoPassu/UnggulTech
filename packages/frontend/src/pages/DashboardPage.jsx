import { useEffect, useState } from "react";
import SummaryCards from "../components/Dashboard/SummaryCards";
import AnalyticsChart from "../components/Dashboard/AnalyticsChart";
import ConditionStatus from "../components/Dashboard/ConditionStatus";
import RecentLogs from "../components/Dashboard/RecentLogs";
import DownloadDataModal from "../components/Dashboard/DownloadDataModal";
import WeatherCard from "../components/Dashboard/WeatherCard";
import { getRecentLogs, getSensorData, getSensors, getSensorDisplayName } from "../api/sensorApi";

const DashboardPage = () => {
  const [sensors, setSensors] = useState([]);
  const [selectedSensorId, setSelectedSensorId] = useState("");
  const [sensorData, setSensorData] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  useEffect(() => {
    getSensors().then((data) => {
      setSensors(data);
      setSelectedSensorId(data[0]?.id || "");
    });
  }, []);

  useEffect(() => {
    if (!selectedSensorId) {
      return;
    }

    // Fetch data pertama kali
    const fetchData = () => {
      getSensorData(selectedSensorId).then((data) => {
        setSensorData(data);
      });

      getRecentLogs(selectedSensorId).then((data) => {
        setRecentLogs(data);
      });
    };

    fetchData();

    // Auto-refresh setiap 30 detik untuk update status Aktif/Tidak Aktif
    const interval = setInterval(fetchData, 30_000);

    return () => clearInterval(interval);
  }, [selectedSensorId]);

  return (
    <div className="p-6 bg-gray-100 min-h-screen">

      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold">
          Smart Soil Monitoring System
        </h1>

        <div className="flex items-center gap-3">
          <label htmlFor="sensor" className="font-medium">
            Pilih Bedengan
          </label>

          <select
            id="sensor"
            value={selectedSensorId}
            onChange={(event) => setSelectedSensorId(event.target.value)}
            className="bg-white border border-gray-300 rounded-lg px-3 py-2"
          >
            {sensors.length === 0 ? (
              <option value="">Belum ada bedengan aktif</option>
            ) : (
              sensors.map((sensor) => (
                <option key={sensor.id} value={sensor.id}>
                  {getSensorDisplayName(sensor)}
                </option>
              ))
            )}
          </select>

          <button
            type="button"
            onClick={() => setIsDownloadModalOpen(true)}
            className="bg-green-600 text-white font-medium rounded-lg px-4 py-2 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            Download Data
          </button>
        </div>
      </div>

      <SummaryCards sensorData={sensorData} />

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2">
          <AnalyticsChart data={sensorData?.chart || []} />
        </div>

        <div className="flex flex-col gap-6">
          <ConditionStatus sensorData={sensorData} />
          <WeatherCard />
        </div>
      </div>

      <div className="mt-6">
        <RecentLogs logs={recentLogs} />
      </div>

      {isDownloadModalOpen && (
        <DownloadDataModal
          sensors={sensors}
          selectedSensorId={selectedSensorId}
          onClose={() => setIsDownloadModalOpen(false)}
        />
      )}
    </div>
  );
};

export default DashboardPage;
