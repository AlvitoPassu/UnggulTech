import React from 'react';
import HardwareNodeItem from './HardwareNodeItem';

const HardwareNodeList = () => {
  const nodes = [
    {
      id: 1,
      name: "Node-A1",
      location: "North Sector",
      uptime: "45d 12h",
      status: "Online",
      battery: "88%",
      signal: "-65dBm",
      temp: "32°C"
    },
    {
      id: 2,
      name: "Node-B2",
      location: "East Sector",
      uptime: "2h ago",
      status: "Offline",
      battery: "",
      signal: "",
      temp: ""
    },
    {
      id: 3,
      name: "Node-C3",
      location: "South Sector",
      uptime: "12d 4h",
      status: "Online",
      battery: "92%",
      signal: "-70dBm",
      temp: "30°C"
    }
  ];

  return (
    <div className="lg:col-span-4 bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl flex flex-col h-[500px] shadow-[0_0_20px_rgba(46,125,50,0.08)]">
      <div className="px-6 py-3 border-b border-[#0d631b]/20 bg-white/50">
        <h3 className="text-2xl font-semibold text-[#1a1c1c] flex items-center gap-3">
          <span className="material-symbols-outlined text-[#0d631b]">memory</span>
          Hardware Nodes
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {nodes.map(node => (
          <HardwareNodeItem key={node.id} {...node} />
        ))}
      </div>
    </div>
  );
};

export default HardwareNodeList;
