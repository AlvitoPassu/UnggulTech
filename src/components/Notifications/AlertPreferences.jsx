import React, { useState } from 'react';
import ToggleSwitch from './ToggleSwitch';

const AlertPreferences = () => {
  const [preferences, setPreferences] = useState({
    criticalTemp: true,
    lowMoisture: true,
    systemOffline: true,
    dailySummary: false,
  });

  const handleToggle = (key) => {
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="bg-white/70 backdrop-blur-md border border-[#88d982]/20 rounded-xl p-6 flex-1 shadow-[0_8px_32px_rgba(46,125,50,0.04)] hover:border-[#2e7d32] transition-colors duration-300">
      <h2 className="text-2xl font-semibold text-[#1a1c1c] mb-6 flex items-center gap-2">
        <span className="material-symbols-outlined text-[#40493d]">tune</span>
        Alert Preferences
      </h2>
      <div className="space-y-6">
        <ToggleSwitch 
          id="criticalTemp"
          label="Critical Temperature"
          description="Send when > 30°C"
          checked={preferences.criticalTemp}
          onChange={() => handleToggle('criticalTemp')}
        />
        <ToggleSwitch 
          id="lowMoisture"
          label="Low Moisture Warning"
          description="Send when < 25%"
          checked={preferences.lowMoisture}
          onChange={() => handleToggle('lowMoisture')}
        />
        <ToggleSwitch 
          id="systemOffline"
          label="System Offline"
          description="Gateway connection lost"
          checked={preferences.systemOffline}
          onChange={() => handleToggle('systemOffline')}
        />
        <ToggleSwitch 
          id="dailySummary"
          label="Daily Summary"
          description="Sent at 08:00 AM"
          checked={preferences.dailySummary}
          onChange={() => handleToggle('dailySummary')}
        />
      </div>
    </div>
  );
};

export default AlertPreferences;
