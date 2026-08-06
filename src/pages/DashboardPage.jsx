import { useEffect, useState } from "react";
import SummaryCards from "../components/Dashboard/SummaryCards";
import AnalyticsChart from "../components/Dashboard/AnalyticsChart";
import ConditionStatus from "../components/Dashboard/ConditionStatus";
import RecentLogs from "../components/Dashboard/RecentLogs";
import { getSensorData, getSensors } from "../api/sensorApi";

const DashboardPage = () => {
  const [sensors, setSensors] = useState([]);
  const [selectedSensorId, setSelectedSensorId] = useState("");
  const [sensorData, setSensorData] = useState(null);

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

    getSensorData(selectedSensorId).then((data) => {
      setSensorData(data);
    });
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
            {sensors.map((sensor) => (
              <option key={sensor.id} value={sensor.id}>
                Bedengan {sensor.bedengan} - {sensor.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SummaryCards sensorData={sensorData} />

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2">
          <AnalyticsChart data={sensorData?.chart || []} />
        </div>

        <ConditionStatus sensorData={sensorData} />
      </div>

      <div className="mt-6">
        <RecentLogs logs={sensorData?.logs || []} />
      </div>
    </div>
  );
};

export default DashboardPage;
