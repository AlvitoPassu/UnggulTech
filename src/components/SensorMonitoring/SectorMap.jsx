import React from 'react';

const SectorMap = () => {
  return (
    <div className="lg:col-span-8 bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl overflow-hidden flex flex-col h-[500px] shadow-[0_0_20px_rgba(46,125,50,0.08)] hover:border-[#2e7d32] transition-colors duration-300">
      <div className="px-6 py-3 border-b border-[#0d631b]/20 flex justify-between items-center bg-white/50">
        <h3 className="text-2xl font-semibold text-[#1a1c1c] flex items-center gap-3">
          <span className="material-symbols-outlined text-[#0d631b]">map</span>
          Sector Map
        </h3>
        <div className="flex gap-4">
          <span className="flex items-center gap-2 text-xs font-medium"><span className="w-2 h-2 rounded-full bg-[#0d631b] animate-pulse"></span> Active</span>
          <span className="flex items-center gap-2 text-xs font-medium"><span className="w-2 h-2 rounded-full bg-[#ba1a1a] animate-pulse"></span> Offline</span>
        </div>
      </div>
      <div className="flex-1 relative bg-[#f3f3f3] overflow-hidden">
        {/* Placeholder for Map image or rendering */}
        <div className="absolute inset-0 bg-[#eeeeee] flex items-center justify-center">
          <span className="text-lg text-[#40493d]">Farm Map Rendering (Interactive)</span>
        </div>
        
        {/* Sensor Map Markers */}
        <div className="absolute top-1/4 left-1/4 group cursor-pointer">
          <div className="w-4 h-4 rounded-full bg-[#0d631b] border-2 border-white shadow-[0_0_10px_rgba(13,99,27,0.7)] animate-pulse"></div>
          <div className="hidden group-hover:block absolute top-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md border border-[#0d631b]/20 p-3 rounded-lg whitespace-nowrap z-10 w-48 shadow-lg">
            <p className="text-sm font-bold text-[#1a1c1c] mb-1">Node MCU #Alpha</p>
            <p className="text-xs text-[#40493d]">Moisture: 42% | pH: 6.8</p>
          </div>
        </div>
        
        <div className="absolute top-1/2 right-1/3 group cursor-pointer">
          <div className="w-4 h-4 rounded-full bg-[#ba1a1a] border-2 border-white shadow-[0_0_10px_rgba(186,26,26,0.7)] animate-pulse"></div>
          <div className="hidden group-hover:block absolute top-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md border border-[#ba1a1a]/30 p-3 rounded-lg whitespace-nowrap z-10 w-48 shadow-lg">
            <p className="text-sm font-bold text-[#ba1a1a] mb-1">Node MCU #Beta</p>
            <p className="text-xs text-[#40493d]">CONNECTION LOST</p>
          </div>
        </div>
        
        <div className="absolute bottom-1/3 left-1/2 group cursor-pointer">
          <div className="w-4 h-4 rounded-full bg-[#0d631b] border-2 border-white shadow-[0_0_10px_rgba(13,99,27,0.7)] animate-pulse"></div>
          <div className="hidden group-hover:block absolute top-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md border border-[#0d631b]/20 p-3 rounded-lg whitespace-nowrap z-10 w-48 shadow-lg">
            <p className="text-sm font-bold text-[#1a1c1c] mb-1">Node MCU #Gamma</p>
            <p className="text-xs text-[#40493d]">Moisture: 38% | Temp: 24°C</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SectorMap;
