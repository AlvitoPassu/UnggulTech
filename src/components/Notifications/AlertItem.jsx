import React from 'react';

const AlertItem = ({ title, time, message, type, icon, iconBg, badgeColor }) => {
  return (
    <div className="flex items-start gap-4 p-3 rounded-lg hover:bg-[#f3f3f3]/50 transition-colors border border-transparent hover:border-[#bfcaba]/30">
      <div className={`${iconBg} p-2 rounded-full flex-shrink-0`}>
        <span className={`material-symbols-outlined ${type === 'critical' ? 'text-[#ba1a1a]' : type === 'resolved' ? 'text-[#0d631b]' : 'text-[#40493d]'}`}>
          {icon}
        </span>
      </div>
      <div className="flex-1">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-bold text-[#1a1c1c]">{title}</span>
          <span className="text-xs text-[#40493d]">{time}</span>
        </div>
        <p className="text-sm text-[#40493d]">{message}</p>
      </div>
      <span className={`text-[10px] font-bold px-3 py-1 rounded-full flex-shrink-0 ${badgeColor}`}>
        {type.toUpperCase()}
      </span>
    </div>
  );
};

export default AlertItem;
