import React from 'react';

const Header = ({ onMenuClick }) => {
  return (
    <header className="bg-[#f9f9f9]/70 backdrop-blur-md border-b border-[#0d631b]/20 shadow-sm sticky top-0 z-40 flex justify-between items-center w-full px-4 md:px-12 h-20 shrink-0">
      <div className="flex items-center gap-6">
        <button 
          className="md:hidden p-2 -ml-2 rounded-full text-[#0d631b] hover:bg-[#0d631b]/10" 
          onClick={onMenuClick}
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <h2 className="text-2xl md:text-3xl font-semibold text-[#1a1c1c]">Smart Soil Monitoring System</h2>
      </div>
      <div className="flex items-center gap-6">
        <div className="relative hidden md:block focus-within:ring-2 focus-within:ring-[#0d631b]/50 rounded-full transition-all">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#40493d]">search</span>
          <input className="pl-10 pr-4 py-2 bg-[#f3f3f3] border border-[#bfcaba] rounded-full text-[#1a1c1c] placeholder:text-[#40493d] focus:outline-none focus:border-[#0d631b]/50 text-base w-64" placeholder="Search sensors..." type="text"/>
        </div>
        <button className="text-[#40493d] hover:text-[#0d631b] transition-all p-2 rounded-full hover:bg-[#0d631b]/10">
          <span className="material-symbols-outlined">dark_mode</span>
        </button>
        <button className="text-[#40493d] hover:text-[#0d631b] transition-all p-2 rounded-full hover:bg-[#0d631b]/10">
          <span className="material-symbols-outlined">schedule</span>
        </button>
        <button className="text-[#40493d] hover:text-[#0d631b] transition-all p-2 rounded-full hover:bg-[#0d631b]/10 relative">
          <span className="material-symbols-outlined">notifications_active</span>
          <span className="absolute top-1 right-1 w-2 h-2 bg-[#ba1a1a] rounded-full"></span>
        </button>
        <div className="w-10 h-10 rounded-full border border-[#0d631b]/20 overflow-hidden shadow-sm ml-2 cursor-pointer hover:ring-2 hover:ring-[#0d631b]/50 transition-all">
          <img alt="Manager Profile" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAd2KBnPUGUc3shvHNyb6uP9sMUvKFEvFH8-M32mvukiI3ZxGjUR_n1KxBijkqhmhC63ETTsElJD44fpXcfzDtJ1ndzr_QhmXMLDxaYQLpAETC-kwCJSlRSAMjtlSTU2T-YtNCWkDNI_EsVFy8zACZWlef6ONall67IlVxi9gIwHsdtlCqpRpsWByE8eJtj1eF5IX9e6DjOQdvhkljh1Wx1DUsibIymqYOSyFyRvTmOOp-DO298aLlVBKfPScYHvKQGJMlgx92clLSR"/>
        </div>
      </div>
    </header>
  );
};

export default Header;
