import React from 'react';
import SectorMap from '../components/SensorMonitoring/SectorMap';
import HardwareNodeList from '../components/SensorMonitoring/HardwareNodeList';
import TelemetryChart from '../components/SensorMonitoring/TelemetryChart';

const SensorMonitoringPage = () => {
  return (
    <div className="space-y-10">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
        <div>
          <h1 className="text-3xl font-bold text-[#1a1c1c] mb-1">Sensor Fleet Status</h1>
          <p className="text-base text-[#40493d]">Real-time telemetry and hardware diagnostics across all sectors.</p>
        </div>
        <button className="bg-[#0d631b] text-white font-medium text-sm py-3 px-6 rounded-lg shadow-sm hover:bg-[#2e7d32] transition-colors flex items-center gap-2">
          <span className="material-symbols-outlined text-lg">tune</span>
          Calibrate All Sensors
        </button>
      </div>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <SectorMap />
        <HardwareNodeList />
        <TelemetryChart />
      </div>
    </div>
  );
};

export default SensorMonitoringPage;
