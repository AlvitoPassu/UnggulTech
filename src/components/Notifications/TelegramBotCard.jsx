import React from 'react';

const TelegramBotCard = () => {
  return (
    <div className="bg-white/70 backdrop-blur-md border border-[#88d982]/20 rounded-xl p-6 shadow-[0_8px_32px_rgba(46,125,50,0.04)] hover:border-[#2e7d32] transition-colors duration-300">
      <div className="flex justify-between items-start mb-6">
        <h2 className="text-2xl font-semibold text-[#1a1c1c] flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0054a7]">send</span>
          Telegram Bot
        </h2>
        <div className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-1 rounded-full border border-[#cbffc2]/30 bg-[#cbffc2]/10 text-[#005312]">
          <div className="w-2 h-2 rounded-full bg-[#0d631b] animate-pulse"></div>
          CONNECTED
        </div>
      </div>
      <p className="text-sm text-[#40493d] mb-6">Receive instant critical alerts directly to your mobile device via Telegram.</p>
      
      <div className="space-y-3 mb-6">
        <label className="block text-xs font-medium text-[#1a1c1c]">Bot Token</label>
        <input 
          className="w-full bg-[#f9f9f9] border border-[#bfcaba] rounded-lg p-3 text-xs text-[#1a1c1c] focus:ring-2 focus:ring-[#0d631b]/50 focus:border-[#0d631b] outline-none transition-shadow" 
          readOnly 
          type="password" 
          value="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
        />
      </div>
      
      <div className="space-y-3 mb-8">
        <label className="block text-xs font-medium text-[#1a1c1c]">Chat ID</label>
        <input 
          className="w-full bg-[#f9f9f9] border border-[#bfcaba] rounded-lg p-3 text-xs text-[#1a1c1c] focus:ring-2 focus:ring-[#0d631b]/50 focus:border-[#0d631b] outline-none transition-shadow" 
          readOnly 
          type="text" 
          value="-100987654321"
        />
      </div>
      
      <button className="w-full bg-[#f3f3f3] border border-[#bfcaba] text-[#1a1c1c] text-sm font-medium py-3 rounded-lg hover:bg-[#e2e2e2] transition-colors flex justify-center items-center gap-2">
        <span className="material-symbols-outlined text-lg">edit</span>
        Edit Configuration
      </button>
    </div>
  );
};

export default TelegramBotCard;
