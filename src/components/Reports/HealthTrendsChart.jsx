import React from 'react';

const HealthTrendsChart = () => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const data = [60, 65, 55, 80, 75, 85, 90];

  return (
    <div className="lg:col-span-2 bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-8 flex flex-col shadow-[0_0_20px_rgba(46,125,50,0.08)] hover:border-[#2e7d32] transition-colors duration-300">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h3 className="text-2xl font-semibold text-[#1a1c1c]">Soil Health Trends</h3>
          <p className="text-xs text-[#40493d] mt-1">NPK levels and overall health index over time.</p>
        </div>
        <button className="p-2 rounded-full hover:bg-[#e2e2e2] transition-colors text-[#40493d]">
          <span className="material-symbols-outlined">more_vert</span>
        </button>
      </div>
      
      <div className="flex-1 relative min-h-[300px] flex items-end gap-2 pb-8 pt-4 border-b border-l border-[#0d631b]/20 px-2">
        <div className="absolute top-0 left-0 w-full h-full flex flex-col justify-between pointer-events-none opacity-20">
          <div className="border-t border-[#bfcaba] w-full"></div>
          <div className="border-t border-[#bfcaba] w-full"></div>
          <div className="border-t border-[#bfcaba] w-full"></div>
          <div className="border-t border-[#bfcaba] w-full"></div>
        </div>
        
        {data.map((val, i) => (
          <div key={days[i]} className="flex-1 flex flex-col justify-end items-center group relative">
            <div 
              className="w-full max-w-[40px] bg-[#2e7d32]/80 rounded-t-sm relative hover:bg-[#0d631b] transition-all duration-1000 cursor-pointer" 
              style={{ height: `${val}%` }}
            >
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-white text-[#1a1c1c] text-xs font-bold py-1.5 px-3 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 border border-[#0d631b]/20">
                {val} Index
              </div>
            </div>
            <span className="absolute bottom-1 translate-y-full text-xs font-medium text-[#40493d] mt-2">
              {days[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HealthTrendsChart;
