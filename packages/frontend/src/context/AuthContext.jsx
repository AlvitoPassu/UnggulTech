import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { supabase, createLoginCandidate } from "../lib/supabase";
import { OperatorSessionClient, shouldAttachOperatorCredentials } from "../lib/operatorSessionClient";
import { withOperatorAuthLock } from "../lib/candidateAuth";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [client] = useState(() => new OperatorSessionClient({
    auth: supabase.auth,
    createCandidate: createLoginCandidate,
    withAuthLock: withOperatorAuthLock,
    // Authentication requests use explicit credentials, never stale interceptors.
    api: axios.create({ timeout: 10_000 }),
    storage: sessionStorage,
  }));
  const [view, setView] = useState(() => client.snapshot());
  const [now, setNow] = useState(() => client.now());
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const pendingActionRef = useRef(null);

  useEffect(() => {
    const unsubscribe = client.subscribe(setView);
    const requestInterceptor = axios.interceptors.request.use((config) => {
      if (client.session && client.sessionId && client.status === "authenticated"
        && shouldAttachOperatorCredentials(config.url, config.baseURL, window.location.origin)) {
        config.headers.Authorization = client.headers().Authorization;
        config.headers["X-Session-Id"] = client.sessionId;
        config.operatorGeneration = client.generation;
        config.operatorAccessToken = client.session.access_token;
      }
      return config;
    });
    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.config?.operatorGeneration !== undefined) {
          await client.rejectSession(error, error.config.operatorGeneration, error.config.operatorAccessToken);
        }
        return Promise.reject(error);
      }
    );
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      client.onAuthStateChange(event, newSession);
    });
    void client.restore();
    return () => {
      unsubscribe();
      subscription.unsubscribe();
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [client]);

  useEffect(() => {
    const onInteraction = (event) => {
      if (event.isTrusted && document.visibilityState === "visible") client.recordInteraction();
    };
    const events = ["click", "keydown", "input", "change", "submit"];
    for (const event of events) window.addEventListener(event, onInteraction, { passive: true });
    const timer = window.setInterval(() => {
      setNow(client.now());
      // No interaction pending means no activity request, regardless of polling.
      void client.flushActivity();
      if (client.session && client.deadline && client.now() >= client.deadline) void client.expire();
    }, 1000);
    const statusTimer = window.setInterval(() => { void client.checkStatus(); }, 60_000);
    return () => {
      for (const event of events) window.removeEventListener(event, onInteraction);
      window.clearInterval(timer);
      window.clearInterval(statusTimer);
    };
  }, [client]);

  const login = useCallback(async (identifier, password) => {
    const result = await client.login(identifier, password);
    setIsLoginModalOpen(false);
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    // Client identity is synchronous before queued protected requests are issued.
    if (typeof pending === "function") {
      try { await pending(); } catch { client.setNotice("Aksi belum berhasil. Periksa pesan pada fitur dan coba kembali."); }
    }
    return result;
  }, [client]);

  const openLoginModal = useCallback((onSuccess = null) => {
    pendingActionRef.current = onSuccess;
    setIsLoginModalOpen(true);
  }, []);
  const closeLoginModal = useCallback(() => {
    pendingActionRef.current = null;
    setIsLoginModalOpen(false);
  }, []);
  const executeProtectedAction = useCallback((action) => {
    if (client.status === "authenticated" && client.now() < client.deadline) return action();
    if (client.status === "unavailable" && client.sessionId) {
      return client.checkStatus().then((valid) => valid ? action() : null);
    }
    pendingActionRef.current = action;
    setIsLoginModalOpen(true);
    return null;
  }, [client]);
  const secondsRemaining = Math.max(0, Math.ceil((view.deadline - now) / 1000));
  const value = {
    ...view,
    isAuthenticated: view.authStatus === "authenticated",
    login,
    logout: () => client.logout(),
    executeProtectedAction,
    openLoginModal,
    closeLoginModal,
    isLoginModalOpen,
    isWarningOpen: view.authStatus === "authenticated" && secondsRemaining <= 60,
    secondsRemaining,
    extendSession: (event) => {
      if (!event?.isTrusted || document.visibilityState !== "visible") return false;
      client.recordInteraction(false);
      return client.flushActivity(true);
    },
    revalidateSession: () => client.sessionId ? client.checkStatus() : client.restore(),
    setSessionNotice: (notice) => client.setNotice(notice),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components -- Preserve the existing provider/hook API.
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
