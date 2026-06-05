import React from 'react';

const SummaryCard = ({ title, value, subtitle, icon, iconColor }) => (
  <div className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-6 flex flex-col justify-between shadow-[0_0_20px_rgba(46,125,50,0.08)] hover:border-[#2E7D32] transition-all duration-300">
    <div className="flex justify-between items-start mb-3">
      <div className="flex items-center gap-1 text-[#40493d]">
        <span className={`material-symbols-outlined ${iconColor}`}>{icon}</span>
        <span className="text-sm font-medium uppercase tracking-wider">{title}</span>
      </div>
      <span className="bg-[#0d631b]/10 text-[#0d631b] px-2 py-1 rounded-full text-xs font-medium border border-[#0d631b]/20 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[#0d631b]"></span> Normal
      </span>
    </div>
    <div className="text-5xl text-[#1a1c1c] font-bold">{value}</div>
    <div className="text-base text-[#40493d] mt-1">{subtitle}</div>
  </div>
);

export default SummaryCard;
