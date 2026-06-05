import React from 'react';

const StatusItem = ({ label, status, percentage, color, textColor }) => (
  <div>
    <div className="flex justify-between items-end mb-1">
      <span className="text-sm font-medium text-[#40493d] uppercase">{label}</span>
      <span className={`text-base font-medium ${textColor}`}>{status}</span>
    </div>
    <div className="w-full bg-[#e2e2e2] rounded-full h-2.5 overflow-hidden">
      <div className={`${color} h-2.5 rounded-full`} style={{ width: `${percentage}%` }}></div>
    </div>
  </div>
);

export default StatusItem;
