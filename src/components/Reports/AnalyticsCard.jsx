import React from 'react';

const AnalyticsCard = ({ title, value, unit, trend, trendValue, icon, iconColor, bgColor }) => {
  const isPositive = trend === 'up';
  const trendColor = isPositive ? 'text-[#0d631b]' : 'text-[#ba1a1a]';
  const trendIcon = isPositive ? 'trending_up' : trend === 'down' ? 'trending_down' : 'horizontal_rule';

  return (
    <div className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 p-6 rounded-xl relative overflow-hidden group shadow-[0_0_20px_rgba(46,125,50,0.08)] hover:border-[#2e7d32] transition-all duration-300">
      <div className={`absolute -right-4 -top-4 w-24 h-24 ${bgColor} rounded-full blur-2xl group-hover:opacity-80 transition-opacity`}></div>
      <div className="flex justify-between items-start mb-3 relative z-10">
        <span className="text-xs font-medium text-[#40493d] uppercase tracking-wider">{title}</span>
        <span className={`material-symbols-outlined ${iconColor}`}>{icon}</span>
      </div>
      <div className="flex items-end gap-1 relative z-10">
        <span className="text-5xl font-bold text-[#1a1c1c]">{value}</span>
        {unit && <span className="text-2xl text-[#40493d] font-semibold mb-1">{unit}</span>}
      </div>
      {trendValue && (
        <div className={`mt-3 flex items-center gap-1 ${trendColor} relative z-10`}>
          <span className="material-symbols-outlined text-base">{trendIcon}</span>
          <span className="text-xs font-medium">{trendValue}</span>
        </div>
      )}
    </div>
  );
};

export default AnalyticsCard;
