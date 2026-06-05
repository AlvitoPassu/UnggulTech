import React from 'react';

const SoftInput = ({ label, type = 'text', value, onChange, disabled = false, placeholder, icon, onIconClick }) => {
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && <label className="text-xs font-medium text-[#40493d]">{label}</label>}
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full bg-white/50 border border-[#0d631b]/20 rounded-lg px-3 py-2 text-sm text-[#1a1c1c] transition-all focus:outline-none focus:border-[#2e7d32] focus:ring-2 focus:ring-[#2e7d32]/20 ${disabled ? 'bg-[#eeeeee] text-[#40493d] cursor-not-allowed' : ''}`}
        />
        {icon && (
          <button 
            type="button"
            onClick={onIconClick}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#40493d] hover:text-[#0d631b] transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">{icon}</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default SoftInput;
