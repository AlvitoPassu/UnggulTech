import React from "react";
import { FiAlertTriangle } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";

const SessionTimeoutWarningModal = () => {
  const { isWarningOpen, secondsRemaining, extendSession } = useAuth();

  if (!isWarningOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="warning-modal-title"
      aria-describedby="warning-modal-desc"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center sm:p-7">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          <FiAlertTriangle className="text-2xl" aria-hidden="true" />
        </div>

        <h2 id="warning-modal-title" className="text-lg font-bold text-slate-900">
          Sesi Akan Berakhir
        </h2>

        <p id="warning-modal-desc" className="mt-2 text-xs leading-relaxed text-slate-500">
          Tidak ada aktivitas selama beberapa menit. Sesi akan berakhir dalam{" "}
          <strong className="text-amber-600 font-semibold">{secondsRemaining} detik</strong>.
        </p>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={extendSession}
            className="w-full rounded-lg bg-[#1DAADF] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#1686b3] focus:outline-none focus:ring-2 focus:ring-[#a3e1f5]"
          >
            Tetap Login
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionTimeoutWarningModal;
