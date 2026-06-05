import React from 'react';

const LogRow = ({ time, ph, moisture, temp, status, statusColor, isAlert }) => (
  <tr className="border-b border-[#bfcaba]/10 hover:bg-[#f3f3f3]/50 transition-colors">
    <td className="p-3 pl-6 text-[#40493d]">{time}</td>
    <td className={`p-3 ${isAlert ? 'text-[#ba1a1a] font-medium' : ''}`}>{ph}</td>
    <td className={`p-3 ${isAlert ? 'text-[#ba1a1a] font-medium' : ''}`}>{moisture}</td>
    <td className="p-3">{temp}</td>
    <td className="p-3 pr-6">
      {statusColor ? (
        <span className={`${statusColor} px-2 py-0.5 rounded text-xs font-medium`}>{status}</span>
      ) : (
        <span className="text-[#40493d]">{status}</span>
      )}
    </td>
  </tr>
);

export default LogRow;
