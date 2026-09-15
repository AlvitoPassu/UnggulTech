import React from "react";
import { FiLogOut, FiUser } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";

const HeaderAuthStatus = () => {
  const { isAuthenticated, user, logout } = useAuth();

  if (!isAuthenticated) return null;

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Operator";

  return (
    <div className="flex items-center gap-2.5 border-l border-slate-200 pl-3 sm:pl-4">
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-600">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f7fc] text-[#1DAADF]">
          <FiUser size={13} aria-hidden="true" />
        </span>
        <span className="max-w-28 truncate font-medium text-slate-700" title={user?.email}>
          {displayName}
        </span>
      </div>

      <button
        type="button"
        onClick={logout}
        className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
        title="Keluar dari sesi operator"
        aria-label="Logout"
      >
        <FiLogOut size={13} aria-hidden="true" />
        <span>Keluar</span>
      </button>
    </div>
  );
};

export default HeaderAuthStatus;
