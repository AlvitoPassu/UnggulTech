import React, { useState } from 'react';
import SoftInput from './SoftInput';

const ConnectivitySettings = () => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <section className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-6 md:p-8 transition-colors duration-300 shadow-[0_0_20px_rgba(46,125,50,0.08)]" id="connectivity">
      <div className="flex items-center justify-between border-b border-[#0d631b]/10 pb-3 mb-6">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[#0d631b]">wifi</span>
          <h2 className="text-2xl font-semibold text-[#1a1c1c]">ESP8266 Connectivity</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0d631b]/10 text-[#0d631b] text-[10px] font-bold border border-[#0d631b]/10">
          <span className="w-2 h-2 rounded-full bg-[#0d631b] animate-pulse"></span>
          CONNECTED
        </span>
      </div>
      
      <p className="text-sm text-[#40493d] mb-6">Configure the primary WiFi network credentials for the master ESP8266 sensor node.</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SoftInput label="SSID (Network Name)" value="AgriTech_Field_Net_5G" />
        <SoftInput 
          label="Password" 
          type={showPassword ? 'text' : 'password'} 
          value="supersecretpassword123" 
          icon={showPassword ? 'visibility_off' : 'visibility'}
          onIconClick={() => setShowPassword(!showPassword)}
        />
        <SoftInput label="Static IP (Optional)" placeholder="192.168.1.100" />
        <SoftInput label="Gateway" placeholder="192.168.1.1" />
      </div>
      
      <div className="mt-8 flex flex-col sm:flex-row justify-between items-center bg-[#f3f3f3] p-4 rounded-lg border border-[#0d631b]/5 gap-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#40493d]">sync</span>
          <span className="text-sm text-[#40493d]">Last sync: 2 mins ago</span>
        </div>
        <button className="w-full sm:w-auto border border-[#707a6c] text-[#1a1c1c] px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#eeeeee] transition-colors">
          Push Config to Node
        </button>
      </div>
    </section>
  );
};

export default ConnectivitySettings;
