import React from 'react';

const TelemetryChart = () => {
  return (
    <div className="lg:col-span-12 bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl overflow-hidden shadow-[0_0_20px_rgba(46,125,50,0.08)]">
      <div className="px-6 py-3 border-b border-[#0d631b]/20 bg-white/50 flex justify-between items-center">
        <h3 className="text-2xl font-semibold text-[#1a1c1c] flex items-center gap-3">
          <span className="material-symbols-outlined text-[#0d631b]">monitoring</span>
          Aggregated Telemetry (Last 24h)
        </h3>
        <div className="flex gap-2">
          <button className="text-xs font-medium px-4 py-1.5 rounded border border-[#0d631b]/20 hover:bg-[#0d631b]/10 transition-colors">pH</button>
          <button className="text-xs font-bold px-4 py-1.5 rounded border border-[#0d631b] bg-[#0d631b]/10 text-[#0d631b]">Moisture</button>
          <button className="text-xs font-medium px-4 py-1.5 rounded border border-[#0d631b]/20 hover:bg-[#0d631b]/10 transition-colors">Temp</button>
        </div>
      </div>
      <div className="p-6 h-[300px] flex items-center justify-center bg-white">
        {/* Chart Visualization */}
        <div className="w-full h-full border-l border-b border-[#bfcaba] relative flex items-end justify-between px-6 pt-10 pb-2">
          <div className="absolute left-[-35px] top-0 h-full flex flex-col justify-between text-[10px] text-[#40493d]">
            <span>100%</span>
            <span>50%</span>
            <span>0%</span>
          </div>
          
          {/* Mock Bars */}
          <div className="w-[8%] h-[40%] bg-[#0d631b]/40 rounded-t-sm hover:bg-[#0d631b]/60 transition-colors"></div>
          <div className="w-[8%] h-[45%] bg-[#0d631b]/40 rounded-t-sm hover:bg-[#0d631b]/60 transition-colors"></div>
          <div className="w-[8%] h-[38%] bg-[#0d631b]/40 rounded-t-sm hover:bg-[#0d631b]/60 transition-colors"></div>
          <div className="w-[8%] h-[50%] bg-[#0d631b]/40 rounded-t-sm hover:bg-[#0d631b]/60 transition-colors"></div>
          <div className="w-[8%] h-[48%] bg-[#0d631b]/40 rounded-t-sm hover:bg-[#0d631b]/60 transition-colors"></div>
          <div className="w-[8%] h-[60%] bg-[#0d631b]/60 rounded-t-sm hover:bg-[#0d631b]/80 transition-colors relative group">
            <div className="hidden group-hover:block absolute -top-8 left-1/2 -translate-x-1/2 bg-white p-1 rounded border border-[#0d631b]/20 text-[10px] shadow-sm z-10 whitespace-nowrap">Irrigation Started</div>
          </div>
          <div className="w-[8%] h-[75%] bg-[#0d631b]/80 rounded-t-sm hover:bg-[#0d631b] transition-colors"></div>
          <div className="w-[8%] h-[70%] bg-[#0d631b]/80 rounded-t-sm hover:bg-[#0d631b] transition-colors"></div>
          
          <div className="absolute bottom-[-25px] w-full flex justify-between text-[10px] text-[#40493d] pr-6">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>Now</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TelemetryChart;
