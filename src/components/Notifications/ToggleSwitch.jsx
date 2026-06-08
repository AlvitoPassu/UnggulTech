import React from 'react';

const ToggleSwitch = ({ id, label, description, checked, onChange }) => {
  return (
    <div className="flex justify-between items-center">
      <div>
        <div className="text-sm font-bold text-[#1a1c1c]">{label}</div>
        <div className="text-xs text-[#40493d]">{description}</div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input 
          type="checkbox" 
          id={id}
          className="sr-only peer" 
          checked={checked}
          onChange={onChange}
        />
        <div className="w-11 h-6 bg-[#e2e2e2] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0d631b]"></div>
      </label>
    </div>
  );
};

export default ToggleSwitch;
