import React from 'react';
import SummaryCard from '../components/Dashboard/SummaryCard';
import StatusItem from '../components/Dashboard/StatusItem';
import LogRow from '../components/Dashboard/LogRow';

const DashboardPage = () => {
  return (
    <>
      {/* 1. Summary Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <SummaryCard title="Soil pH" value="6.8" subtitle="Slightly acidic, optimal." icon="science" iconColor="text-[#77574d]" />
        <SummaryCard title="Moisture" value="42%" subtitle="Zone 3 holding well." icon="water_drop" iconColor="text-[#0054a7]" />
        <SummaryCard title="Temperature" value="24°C" subtitle="Stable ambient." icon="thermostat" iconColor="text-[#ba1a1a]" />
      </section>

      {/* 2. Real-Time Analytics */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
        <div className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-6 lg:col-span-2 flex flex-col h-96 shadow-[0_0_20px_rgba(46,125,50,0.08)] hover:border-[#2E7D32] transition-all duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-semibold text-[#1a1c1c]">Moisture & pH Trends</h3>
            <div className="flex gap-3">
              <span className="flex items-center gap-1 text-xs text-[#40493d]"><span className="w-3 h-3 rounded bg-[#0054a7]"></span> Moisture</span>
              <span className="flex items-center gap-1 text-xs text-[#40493d]"><span className="w-3 h-3 rounded bg-[#77574d]"></span> pH</span>
            </div>
          </div>
          <div className="flex-1 relative w-full h-full">
            <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 800 300">
              <g className="text-[#bfcaba] stroke-current" strokeDasharray="4 4" strokeWidth="1">
                <line x1="0" x2="800" y1="50" y2="50"></line>
                <line x1="0" x2="800" y1="150" y2="150"></line>
                <line x1="0" x2="800" y1="250" y2="250"></line>
              </g>
              <path className="stroke-[#0054a7] fill-none" d="M0,200 Q100,150 200,180 T400,120 T600,160 T800,100" strokeWidth="3"></path>
              <path className="stroke-[#77574d] fill-none" d="M0,150 Q150,160 300,140 T500,150 T700,130 T800,140" strokeWidth="3"></path>
              <g className="text-xs fill-[#40493d]">
                <text x="0" y="290">06:00</text>
                <text x="190" y="290">09:00</text>
                <text x="390" y="290">12:00</text>
                <text x="590" y="290">15:00</text>
                <text x="760" y="290">18:00</text>
              </g>
            </svg>
          </div>
        </div>
        
        <div className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-6 flex flex-col h-96 shadow-[0_0_20px_rgba(46,125,50,0.08)] hover:border-[#2E7D32] transition-all duration-300">
          <h3 className="text-2xl font-semibold text-[#1a1c1c] mb-6">Condition Status</h3>
          <div className="flex-1 flex flex-col gap-6 justify-center">
            <StatusItem label="pH Level" status="Normal (6.8)" percentage={68} color="bg-[#0d631b]" textColor="text-[#0d631b]" />
            <StatusItem label="Moisture" status="Wet (65%)" percentage={65} color="bg-[#0054a7]" textColor="text-[#0054a7]" />
            <StatusItem label="Temperature" status="Normal (24°C)" percentage={50} color="bg-[#0d631b]" textColor="text-[#0d631b]" />
          </div>
          <button className="mt-auto w-full py-2 border border-[#707a6c] rounded-lg text-[#1a1c1c] hover:bg-[#eeeeee] transition-colors text-sm font-medium">
            Calibrate Sensors
          </button>
        </div>
      </section>

      {/* 3. Control & Table */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 flex flex-col gap-6">
          <div className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-6 shadow-[0_0_20px_rgba(46,125,50,0.08)] hover:border-[#2E7D32] transition-all duration-300">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[#0054a7] p-2 bg-[#0054a7]/10 rounded-lg">send</span>
                <h3 className="text-2xl font-semibold text-[#1a1c1c]">Alerts</h3>
              </div>
              <span className="bg-[#0d631b]/10 text-[#0d631b] px-2 py-1 rounded-full text-xs font-medium border border-[#0d631b]/20 flex items-center gap-1">
                Connected
              </span>
            </div>
            <div className="p-3 bg-[#ffdad6]/50 border border-[#ba1a1a]/20 rounded-lg mb-6 flex items-start gap-3">
              <span className="material-symbols-outlined text-[#ba1a1a] text-sm mt-0.5">warning</span>
              <div>
                <p className="text-sm font-medium text-[#1a1c1c]">Low Moisture Alert</p>
                <p className="text-xs text-[#40493d]">Zone 2 @ 08:30 AM</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="xl:col-span-2 bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl flex flex-col overflow-hidden shadow-[0_0_20px_rgba(46,125,50,0.08)] hover:border-[#2E7D32] transition-all duration-300">
          <div className="p-6 border-b border-[#bfcaba]/30 flex justify-between items-center bg-[#f9f9f9]/50">
            <h3 className="text-2xl font-semibold text-[#1a1c1c]">Recent Logs</h3>
            <a className="text-sm font-medium text-[#0d631b] hover:underline" href="#">View All</a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f3f3f3] border-b border-[#bfcaba]/30">
                  <th className="p-3 text-xs font-medium text-[#40493d] uppercase tracking-wider pl-6">Timestamp</th>
                  <th className="p-3 text-xs font-medium text-[#40493d] uppercase tracking-wider">pH</th>
                  <th className="p-3 text-xs font-medium text-[#40493d] uppercase tracking-wider">Moisture</th>
                  <th className="p-3 text-xs font-medium text-[#40493d] uppercase tracking-wider">Temp</th>
                  <th className="p-3 text-xs font-medium text-[#40493d] uppercase tracking-wider pr-6">Status</th>
                </tr>
              </thead>
              <tbody className="text-base text-[#1a1c1c]">
                <LogRow time="11:00 AM" ph="6.8" moisture="42%" temp="24°C" status="OK" />
                <LogRow time="10:45 AM" ph="6.8" moisture="38%" temp="23°C" status="OK" />
                <LogRow time="10:00 AM" ph="6.7" moisture="40%" temp="23°C" status="IDLE" />
                <LogRow time="09:00 AM" ph="6.7" moisture="45%" temp="22°C" status="IDLE" />
                <LogRow time="08:30 AM" ph="6.4" moisture="28%" temp="21°C" status="ALERT" statusColor="bg-[#ba1a1a]/10 text-[#ba1a1a]" isAlert />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
};

export default DashboardPage;
