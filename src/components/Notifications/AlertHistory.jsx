import React from 'react';
import AlertItem from './AlertItem';

const AlertHistory = () => {
  const alerts = [
    {
      id: 1,
      title: "Zone B High Temperature",
      time: "Just now",
      message: "Soil temperature exceeded 32°C threshold (Currently: 34.2°C).",
      type: "critical",
      icon: "thermostat",
      iconBg: "bg-[#ffdad6]/30",
      badgeColor: "bg-[#ffdad6] text-[#93000a]"
    },
    {
      id: 2,
      title: "Sector 4 Low Moisture",
      time: "12 mins ago",
      message: "Moisture levels dropped below 20%. Automated irrigation engaged.",
      type: "resolved",
      icon: "water_drop",
      iconBg: "bg-[#cbffc2]/30",
      badgeColor: "bg-[#cbffc2] text-[#005312]"
    },
    {
      id: 3,
      title: "Gateway Sync Delayed",
      time: "2 hrs ago",
      message: "Main sensor gateway experienced a 45-second latency spike.",
      type: "info",
      icon: "router",
      iconBg: "bg-[#e2e2e2]/50",
      badgeColor: "bg-[#e2e2e2] text-[#40493d]"
    }
  ];

  return (
    <div className="col-span-12 lg:col-span-8 bg-white/70 backdrop-blur-md border border-[#88d982]/20 rounded-xl p-6 flex flex-col h-[600px] shadow-[0_8px_32px_rgba(46,125,50,0.04)] hover:border-[#2e7d32] transition-colors duration-300">
      <div className="flex justify-between items-center mb-6 border-b border-[#bfcaba]/20 pb-3">
        <h2 className="text-2xl font-semibold text-[#1a1c1c] flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0d631b]">history</span>
          Recent Alerts
        </h2>
        <button className="text-xs font-bold text-[#0d631b] hover:bg-[#0d631b]/10 px-3 py-1 rounded transition-colors">Clear All</button>
      </div>
      <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
        {alerts.map(alert => (
          <AlertItem key={alert.id} {...alert} />
        ))}
      </div>
    </div>
  );
};

export default AlertHistory;
