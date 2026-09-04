import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { FiActivity, FiBarChart2, FiChevronLeft, FiChevronRight, FiFileText } from "react-icons/fi";

const navigationItems = [
  { label: "Dashboard", to: "/", icon: FiBarChart2, end: true },
  { label: "Sensor", to: "/sensor", icon: FiActivity },
  { label: "Data Historis", to: "/data-historis", icon: FiFileText },
];

const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
  <div className="min-h-screen bg-white">
    <aside className={`fixed inset-y-0 left-0 z-20 hidden border-r border-[#1686b3] bg-[#1DAADF] transition-[width] duration-200 max-lg:bottom-0 max-lg:top-auto max-lg:flex max-lg:h-16 max-lg:w-full max-lg:flex-row max-lg:border-r-0 max-lg:border-t max-lg:shadow-[0_-2px_12px_rgba(15,23,42,0.06)] lg:flex lg:flex-col ${isSidebarOpen ? "w-60" : "w-0 overflow-hidden"}`}>
      <div className="flex h-[73px] items-center gap-3 border-b border-white/20 px-5 max-lg:hidden">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1DAADF] text-white">
          <img src="/apple-touch-icon.png" alt="Smart Soil" className="h-full w-full rounded-lg object-contain" />
        </div>
        <div>
          <p className="text-sm font-bold leading-tight text-white">Unggul Monitoring</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-6 max-lg:flex max-lg:items-center max-lg:justify-around max-lg:px-2 max-lg:py-2" aria-label="Navigasi utama">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/70 max-lg:hidden">Menu utama</p>
        <div className="space-y-1 max-lg:flex max-lg:w-full max-lg:justify-around max-lg:gap-1">
          {navigationItems.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={label}
              to={to}
              end={end}
              className={({ isActive }) => `relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white transition ${isActive ? "bg-[#1686b3]" : "hover:bg-[#1686b3]"}`}
            >
              {({ isActive }) => <><span className={`absolute inset-y-2 left-0 w-0.5 rounded-r-full ${isActive ? "bg-white" : "bg-transparent"}`} /><Icon className="text-lg" aria-hidden="true" /><span>{label}</span></>}
            </NavLink>
          ))}
        </div>

      </nav>

      <div className="border-t border-white/20 px-5 py-4 max-lg:hidden">
        <p className="text-xs font-semibold text-white">Smart Agriculture</p>
        <p className="mt-1 text-[11px] text-white/70">v1.0.0</p>
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

    <div className={`pb-16 transition-[padding] duration-200 lg:pb-0 ${isSidebarOpen ? "lg:pl-60" : "lg:pl-0"}`}>
      <Outlet />
    </div>
  </div>
  );
};

export default AppLayout;
