import { useState } from "react";
import { FiEye, FiEyeOff, FiLock, FiAlertCircle } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";

const LoginModal = () => {
  const { isLoginModalOpen, closeLoginModal, login } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (!isLoginModalOpen) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      setErrorMessage("Silakan isi username dan password.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    try {
      await login(identifier, password);
      // Reset form credentials on success
      setIdentifier("");
      setPassword("");
      setErrorMessage("");
    } catch {
      setErrorMessage("Username atau password tidak valid.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setIdentifier("");
    setPassword("");
    setShowPassword(false);
    setErrorMessage("");
    closeLoginModal();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) handleClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl transition-all sm:p-7">
        <div className="mb-5 flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e8f7fc] text-[#1DAADF]">
            <FiLock className="text-xl" aria-hidden="true" />
          </div>
          <div>
            <h2 id="login-modal-title" className="text-xl font-bold tracking-tight text-slate-900">
              Login
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Masuk menggunakan akun operator Anda.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <FiAlertCircle className="mt-0.5 shrink-0 text-sm" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="operator-identifier"
              className="mb-1.5 block text-xs font-semibold text-slate-700"
            >
              Username
            </label>
            <input
              id="operator-identifier"
              type="text"
              required
              autoFocus
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Masukkan username"
              disabled={isLoading}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-[#1DAADF] focus:ring-2 focus:ring-[#a3e1f5] disabled:cursor-not-allowed disabled:bg-slate-50"
            />
          </div>

          <div>
            <label
              htmlFor="operator-password"
              className="mb-1.5 block text-xs font-semibold text-slate-700"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="operator-password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password"
                disabled={isLoading}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 pr-10 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-[#1DAADF] focus:ring-2 focus:ring-[#a3e1f5] disabled:cursor-not-allowed disabled:bg-slate-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 focus:outline-none"
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              >
                {showPassword ? <FiEyeOff size={18} /> : <FiEye size={18} />}
              </button>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center justify-center rounded-lg bg-[#1DAADF] px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#1686b3] focus:ring-2 focus:ring-[#a3e1f5] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Memproses..." : "Login"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginModal;
