import React from 'react';

const HardwareNodeItem = ({ name, location, uptime, status, battery, signal, temp }) => {
  const isOnline = status === 'Online';
  return (
    <div className={`p-4 rounded-lg border ${isOnline ? 'border-[#0d631b]/10' : 'border-[#ba1a1a]/20'} bg-white hover:border-${isOnline ? '[#0d631b]/50' : '[#ba1a1a]/50'} transition-colors cursor-pointer group`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h4 className={`text-sm font-bold ${isOnline ? 'text-[#1a1c1c]' : 'text-[#ba1a1a]'}`}>{name} ({location})</h4>
          <p className="text-xs text-[#40493d]">{isOnline ? `Uptime: ${uptime}` : `Last seen: ${uptime}`}</p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${isOnline ? 'bg-[#0d631b]/10 text-[#0d631b]' : 'bg-[#ba1a1a]/10 text-[#ba1a1a]'}`}>
          {status}
        </span>
      </div>
      <div className={`grid grid-cols-3 gap-2 text-center ${isOnline ? '' : 'opacity-50'}`}>
        <div className="bg-[#f3f3f3] p-2 rounded">
          <p className="text-[10px] text-[#40493d] mb-1">BATTERY</p>
          <p className="text-sm font-bold text-[#1a1c1c]">{battery || '--'}</p>
        </div>
        <div className="bg-[#f3f3f3] p-2 rounded">
          <p className="text-[10px] text-[#40493d] mb-1">SIGNAL</p>
          <p className="text-sm font-bold text-[#1a1c1c]">{signal || '--'}</p>
        </div>
        <div className="bg-[#f3f3f3] p-2 rounded">
          <p className="text-[10px] text-[#40493d] mb-1">TEMP</p>
          <p className="text-sm font-bold text-[#1a1c1c]">{temp || '--'}</p>
        </div>
      </div>
    </div>
  );
};

export default HardwareNodeItem;
