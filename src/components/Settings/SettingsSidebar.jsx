import React from 'react';

const SettingsSidebar = ({ activeSection }) => {
  const menuItems = [
    { id: 'profile', label: 'Profile', icon: 'person' },
    { id: 'connectivity', label: 'Connectivity (ESP8266)', icon: 'wifi' },
    { id: 'api', label: 'API Management', icon: 'api' },
    { id: 'preferences', label: 'Preferences', icon: 'tune' },
    { id: 'account', label: 'Account', icon: 'manage_accounts' },
  ];

  return (
    <aside className="w-full lg:w-64 shrink-0 bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-2 sticky top-28 shadow-[0_0_20px_rgba(46,125,50,0.08)]">
      <h3 className="text-xs font-medium text-[#40493d] uppercase tracking-wider mb-2 px-3 pt-3">Settings Menu</h3>
      <nav className="flex flex-col gap-1">
        {menuItems.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
              activeSection === item.id
                ? 'text-[#0d631b] bg-[#0d631b]/10'
                : 'text-[#40493d] hover:bg-[#0d631b]/5 hover:text-[#0d631b]'
            }`}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
};

export default SettingsSidebar;
