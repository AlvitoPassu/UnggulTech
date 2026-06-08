import React from 'react';

const NavLink = ({ href, icon, label, active, desktop, onClick }) => (
  <button 
    onClick={(e) => {
      e.preventDefault();
      onClick();
    }}
    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors duration-200 text-left ${
      active 
        ? 'text-[#0d631b] font-bold bg-[#0d631b]/5' + (desktop ? ' border-r-4 border-[#0d631b]' : '')
        : 'text-[#40493d] hover:bg-[#0d631b]/10'
    }`}
  >
    <span className="material-symbols-outlined" style={{ fontVariationSettings: active ? "'FILL' 1" : "''" }}>{icon}</span>
    <span className="text-sm font-medium">{label}</span>
  </button>
);

const Sidebar = ({ isOpen, onClose, currentPage, onPageChange, onLogout }) => {
  const navItems = [
    { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
    { id: 'sensors', icon: 'sensors', label: 'Sensor Monitoring' },
    { id: 'notifications', icon: 'notifications', label: 'Notifications' },
    { id: 'reports', icon: 'assessment', label: 'Reports' },
    { id: 'settings', icon: 'settings', label: 'Settings' },
  ];

  return (
    <>
      {/* Mobile Menu Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden" 
          onClick={onClose}
        ></div>
      )}

      {/* Mobile Navigation */}
      <nav className={`fixed top-0 left-0 h-screen w-72 max-w-[85vw] bg-[#f9f9f9]/95 backdrop-blur-md border-r border-[#0d631b]/20 shadow-[0_0_20px_rgba(46,125,50,0.16)] py-6 px-3 z-50 transition-transform duration-300 md:hidden ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between mb-10 px-3">
          <div>
            <h1 className="text-2xl font-bold text-[#0d631b] leading-none">AgriTech Pro</h1>
            <p className="text-xs text-[#40493d] mt-1 font-mono">Precision Farming</p>
          </div>
          <button 
            className="p-2 rounded-full text-[#40493d] hover:bg-[#0d631b]/10" 
            onClick={onClose}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {navItems.map((item) => (
            <NavLink 
              key={item.id}
              href="#" 
              icon={item.icon} 
              label={item.label} 
              active={currentPage === item.id} 
              onClick={() => {
                onPageChange(item.id);
                onClose();
              }}
            />
          ))}
          {/* Mobile Logout */}
          <button 
            onClick={onLogout}
            className="flex items-center gap-3 px-3 py-3 rounded-lg text-[#40493d] hover:bg-[#ba1a1a]/10 hover:text-[#ba1a1a] transition-colors duration-200"
          >
            <span className="material-symbols-outlined">logout</span>
            <span className="text-sm font-medium">Log Out</span>
          </button>
        </div>
      </nav>

      {/* SideNavBar (Desktop) */}
      <aside className="hidden md:flex h-screen w-64 fixed left-0 top-0 bg-[#f9f9f9]/70 backdrop-blur-md border-r border-[#0d631b]/20 shadow-[0_0_20px_rgba(46,125,50,0.08)] flex-col py-6 px-3 z-50">
        <div className="flex items-center gap-3 mb-10 px-3">
          <div className="w-10 h-10 rounded-full bg-[#0d631b] flex items-center justify-center text-white text-2xl font-bold shadow-sm">
            A
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#0d631b] leading-none">AgriTech Pro</h1>
            <span className="text-xs text-[#40493d]">Precision Farming</span>
          </div>
        </div>
        <nav className="flex-1 flex flex-col gap-2 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink 
              key={item.id}
              href="#" 
              icon={item.icon} 
              label={item.label} 
              active={currentPage === item.id} 
              desktop 
              onClick={() => onPageChange(item.id)}
            />
          ))}
        </nav>
        <div className="mt-auto pt-6 flex flex-col gap-3">
          <button className="w-full bg-[#ba1a1a] text-white py-3 rounded-lg text-sm font-medium hover:bg-[#ffdad6] hover:text-[#93000a] transition-colors shadow-sm flex items-center justify-center gap-1">
            <span className="material-symbols-outlined">warning</span>
            Emergency Stop
          </button>
          <div className="border-t border-[#0d631b]/20 pt-3 flex flex-col gap-2">
            <a className="flex items-center gap-3 px-3 py-1 rounded-lg hover:bg-[#0d631b]/10 transition-colors duration-200 text-[#40493d]" href="#">
              <span className="material-symbols-outlined text-sm">help</span>
              <span className="text-sm">Support</span>
            </a>
            <button 
              onClick={onLogout}
              className="flex items-center gap-3 px-3 py-1 rounded-lg hover:bg-[#ba1a1a]/10 hover:text-[#ba1a1a] transition-colors duration-200 text-[#40493d]"
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              <span className="text-sm">Log Out</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
