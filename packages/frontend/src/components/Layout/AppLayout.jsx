import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { FiActivity, FiBarChart2, FiChevronLeft, FiChevronRight, FiCpu, FiFileText, FiLogIn, FiLogOut } from "react-icons/fi";
import ChatbotAssistant from "../Chatbot/ChatbotAssistant";
import { useAuth } from "../../context/AuthContext";

const navigationItems = [
  { label: "Dashboard", to: "/", icon: FiBarChart2, end: true },
  { label: "Sensor", to: "/sensor", icon: FiActivity },
  { label: "Data Historis", to: "/data-historis", icon: FiFileText },
  { label: "Rekomendasi AI", to: "/rekomendasi-ai", icon: FiCpu },
];

const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLogoutConfirmationOpen, setIsLogoutConfirmationOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const { isAuthenticated, openLoginModal, logout } = useAuth();
  const AuthIcon = isAuthenticated ? FiLogOut : FiLogIn;

  const handleAuthenticationAction = () => {
    if (isAuthenticated) {
      setLogoutError("");
      setIsLogoutConfirmationOpen(true);
      return;
    }

    openLoginModal();
  };

  const closeLogoutConfirmation = () => {
    if (isLoggingOut) return;
    setLogoutError("");
    setIsLogoutConfirmationOpen(false);
  };

  const handleLogoutConfirmation = async () => {
    setIsLoggingOut(true);
    setLogoutError("");

    try {
      const didLogout = await logout();
      if (!didLogout) {
        setLogoutError("Logout gagal. Silakan coba kembali.");
        return;
      }
      setIsLogoutConfirmationOpen(false);
    } catch {
      setLogoutError("Logout gagal. Silakan coba kembali.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
  <div className="min-h-screen bg-[#F5F6F8]">
    {/* Sidebar desktop */}
    <aside className={`fixed inset-y-0 left-0 z-20 hidden border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex lg:flex-col ${isSidebarOpen ? "w-60" : "w-0 overflow-hidden"}`}>
      <div className="flex h-[73px] items-center gap-3 border-b border-slate-100 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1DAADF] text-white">
          <img src="/apple-touch-icon.png" alt="Smart Soil" className="h-full w-full rounded-lg object-contain" />
        </div>
        <div>
          <p className="text-sm font-bold leading-tight text-[#1F2937]">Unggul Monitoring</p>
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
              className={({ isActive }) =>
                `relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-[#e8f7fc] text-[#1DAADF]" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`
              }
            >
               {({ isActive }) => (
                <>
                  <span className={`absolute inset-y-2 left-0 w-0.5 rounded-r-full ${isActive ? "bg-[#1DAADF]" : "bg-transparent"}`} />
                  <Icon className="text-lg" aria-hidden="true" />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={handleAuthenticationAction}
            className="relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-[#6B7280] transition hover:bg-[#EAF7FC] hover:text-[#1DAADF]"
          >
            <AuthIcon className="text-lg" aria-hidden="true" />
            <span>{isAuthenticated ? "Logout" : "Login"}</span>
          </button>
        </div>

      </nav>

      <div className="border-t border-slate-100 px-5 py-4">
        <p className="text-xs font-medium text-[#6B7280]">© Universitas Klabat</p>
        <p className="mt-1 text-[11px] text-[#6B7280]">v1.0.0</p>
      </div>
    </aside>

<<<<<<< HEAD
    {/* Toggle button desktop */}
=======
    {isLogoutConfirmationOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="logout-confirmation-title"
        aria-describedby="logout-confirmation-description"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeLogoutConfirmation();
        }}
      >
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e8f7fc] text-[#1DAADF]">
              <FiLogOut className="text-xl" aria-hidden="true" />
            </div>
            <div>
              <h2 id="logout-confirmation-title" className="text-xl font-bold tracking-tight text-slate-900">
                Logout
              </h2>
              <p id="logout-confirmation-description" className="mt-1 text-sm leading-relaxed text-slate-500">
                Apakah Anda ingin keluar?
              </p>
            </div>
          </div>

          {logoutError && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">
              {logoutError}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeLogoutConfirmation}
              disabled={isLoggingOut}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Tidak
            </button>
            <button
              type="button"
              onClick={handleLogoutConfirmation}
              disabled={isLoggingOut}
              className="inline-flex items-center justify-center rounded-lg bg-[#1DAADF] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#1686b3] focus:outline-none focus:ring-2 focus:ring-[#a3e1f5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoggingOut ? "Memproses..." : "Iya"}
            </button>
          </div>
        </div>
      </div>
    )}

>>>>>>> 7a2f064e (feat: menambahkan button login dan logout)
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

    {/* Bottom tab bar mobile */}
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 flex h-16 w-full items-stretch border-t border-slate-200 bg-white shadow-[0_-2px_12px_rgba(15,23,42,0.08)] lg:hidden"
      aria-label="Navigasi utama"
    >
      {navigationItems.map(({ label, to, icon: Icon, end }) => (
        <NavLink
          key={label}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 transition ${isActive ? "bg-[#e8f7fc] text-[#1DAADF]" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="text-xl" aria-hidden="true" />
              <span className="text-center text-[10px] font-semibold leading-tight">
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>

    {/* Main content */}
    <div className={`pb-16 transition-[padding] duration-200 lg:pb-0 ${isSidebarOpen ? "lg:pl-60" : "lg:pl-0"}`}>
      <Outlet />
    </div>
    <ChatbotAssistant />
  </div>
  );
};

export default AppLayout;
