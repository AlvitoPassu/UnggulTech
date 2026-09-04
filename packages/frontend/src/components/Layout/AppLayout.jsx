import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { FiActivity, FiBarChart2, FiBell, FiChevronLeft, FiChevronRight, FiFileText, FiSettings } from "react-icons/fi";

const navigationItems = [
  { label: "Dashboard", to: "/", icon: FiBarChart2, end: true },
  { label: "Sensor", to: "/sensor", icon: FiActivity },
  { label: "Data Historis", to: "/data-historis", icon: FiFileText },
];

const secondaryItems = [
  { label: "Peringatan", icon: FiBell },
  { label: "Laporan", icon: FiFileText },
  { label: "Pengaturan", icon: FiSettings },
];

const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
  <div className="min-h-screen bg-white">
    <aside className={`fixed inset-y-0 left-0 z-20 hidden border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex lg:flex-col ${isSidebarOpen ? "w-60" : "w-0 overflow-hidden"}`}>
      <div className="flex h-[73px] items-center gap-3 border-b border-slate-100 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1DAADF] text-white">
          <img src="/apple-touch-icon.png" alt="Smart Soil" className="h-full w-full rounded-lg object-contain" />
        </div>
        <div>
          <p className="text-sm font-bold leading-tight text-slate-900">Smart Soil</p>
          <p className="text-xs text-slate-500">Monitoring System</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-6" aria-label="Navigasi utama">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Menu utama</p>
        <div className="space-y-1">
          {navigationItems.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={label}
              to={to}
              end={end}
              className={({ isActive }) => `relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-[#e8f7fc] text-[#1DAADF]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
            >
              {({ isActive }) => <><span className={`absolute inset-y-2 left-0 w-0.5 rounded-r-full ${isActive ? "bg-[#1DAADF]" : "bg-transparent"}`} /><Icon className="text-lg" aria-hidden="true" /><span>{label}</span></>}
            </NavLink>
          ))}
        </div>

        <p className="mb-2 mt-8 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Lainnya</p>
        <div className="space-y-1">
          {secondaryItems.map(({ label, icon: Icon }) => (
            <div key={label} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-400" aria-disabled="true">
              <Icon className="text-lg" aria-hidden="true" />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-slate-100 px-5 py-4">
        <p className="text-xs font-semibold text-[#1DAADF]">Smart Agriculture</p>
        <p className="mt-1 text-[11px] text-slate-400">v1.0.0</p>
      </div>
    </aside>

    <button
      type="button"
      onClick={() => setIsSidebarOpen((isOpen) => !isOpen)}
      className={`fixed top-1/2 z-30 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-r-md border border-slate-200 bg-white text-slate-500 shadow-sm transition-[left] duration-200 hover:text-[#1DAADF] lg:flex ${isSidebarOpen ? "left-[236px]" : "left-0"}`}
      aria-label={isSidebarOpen ? "Tutup sidebar" : "Buka sidebar"}
      aria-expanded={isSidebarOpen}
      title={isSidebarOpen ? "Tutup sidebar" : "Buka sidebar"}
    >
      {isSidebarOpen ? <FiChevronLeft aria-hidden="true" /> : <FiChevronRight aria-hidden="true" />}
    </button>

    <div className={`transition-[padding] duration-200 ${isSidebarOpen ? "lg:pl-60" : "lg:pl-0"}`}>
      <Outlet />
    </div>
  </div>
  );
};

export default AppLayout;
