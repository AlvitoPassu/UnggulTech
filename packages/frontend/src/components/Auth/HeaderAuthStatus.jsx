import React from "react";
import { FiLogOut, FiUser } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";

const HeaderAuthStatus = () => {
  const { isAuthenticated, user, logout } = useAuth();

  if (!isAuthenticated) return null;

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Operator";

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-l border-white/30 pl-3 sm:pl-4">
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-white/85">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white">
          <FiUser size={13} aria-hidden="true" />
        </span>
        <span className="max-w-28 truncate font-medium text-white" title={user?.email}>
          {displayName}
        </span>
      </div>

      <button
        type="button"
        onClick={logout}
        className="flex items-center gap-1.5 rounded-md border border-white/35 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:border-white/60 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/40"
        title="Keluar dari sesi operator"
        aria-label="Logout"
      >
        <FiLogOut size={13} aria-hidden="true" />
        <span className="hidden sm:inline">Keluar</span>
      </button>
    </div>
  );
};

export default HeaderAuthStatus;
