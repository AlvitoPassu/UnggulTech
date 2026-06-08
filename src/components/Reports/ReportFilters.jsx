import React from 'react';

const ReportFilters = () => {
  return (
    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-6 mb-10">
      <div>
        <h2 className="text-3xl font-bold text-[#1a1c1c] mb-1">Reports & Analytics</h2>
        <p className="text-base text-[#40493d]">Comprehensive historical data and performance metrics.</p>
      </div>
      
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 w-full lg:w-auto">
        <div className="flex items-center border border-[#0d631b]/20 rounded-lg p-1 bg-white/50 backdrop-blur-sm shadow-sm">
          <button className="px-4 py-1.5 rounded-md text-xs font-bold bg-[#0d631b] text-white shadow-sm">Weekly</button>
          <button className="px-4 py-1.5 rounded-md text-xs font-medium text-[#40493d] hover:bg-[#e2e2e2] transition-colors">Monthly</button>
        </div>
        
        <div className="relative w-full sm:w-auto">
          <input 
            className="w-full sm:w-auto pl-4 pr-10 py-2 rounded-lg text-xs font-medium text-[#40493d] focus:outline-none focus:ring-2 focus:ring-[#0d631b]/50 border border-[#0d631b]/20 bg-white/70 backdrop-blur-md" 
            type="date" 
            defaultValue="2023-10-01"
          />
        </div>
        
        <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-5 py-2 rounded-lg text-xs font-bold text-[#0d631b] border border-[#0d631b]/20 bg-white/70 hover:bg-[#0d631b]/5 transition-colors shadow-sm">
            <span className="material-symbols-outlined text-lg">download</span>
            CSV
          </button>
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-5 py-2 rounded-lg text-xs font-bold text-[#93000a] border border-[#ba1a1a]/20 bg-[#ffdad6]/50 hover:bg-[#ffdad6]/80 transition-colors shadow-sm">
            <span className="material-symbols-outlined text-lg">picture_as_pdf</span>
            PDF
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportFilters;
