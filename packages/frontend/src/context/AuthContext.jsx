import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit
const WARNING_THRESHOLD_MS = 9 * 60 * 1000; // 9 menit (1 menit sebelum timeout)
const SESSION_ID_KEY = "unggultech_operator_session_id";
const LAST_ACTIVE_KEY = "unggultech_operator_last_active";

export const AuthProvider = ({ children }) => {
  const [authStatus, setAuthStatus] = useState("loading"); // loading, authenticated, unauthenticated, session_expired
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  // Login Modal State
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const pendingActionRef = useRef(null);

  // Warning Modal State
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [sessionNotice, setSessionNotice] = useState("");

  const lastActivityRef = useRef(Date.now());

  // Generate or get device Session ID
  const getOrCreateSessionId = useCallback(() => {
    let currentId = sessionStorage.getItem(SESSION_ID_KEY);
    if (!currentId) {
      currentId = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(SESSION_ID_KEY, currentId);
    }
    setSessionId(currentId);
    return currentId;
  }, []);

  // Update last activity timestamp
  const recordActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    localStorage.setItem(LAST_ACTIVE_KEY, String(now));
  }, []);

  // Extend session (e.g. from "Tetap Login" button)
  const extendSession = useCallback(() => {
    recordActivity();
    setIsWarningOpen(false);
    setSecondsRemaining(60);
  }, [recordActivity]);

  // Clean local session state without redirecting
  const clearSessionState = useCallback((newStatus = "unauthenticated") => {
    setUser(null);
    setSession(null);
    setAuthStatus(newStatus);
    setIsWarningOpen(false);
  }, []);

  // Auto logout on timeout
  const handleTimeoutLogout = useCallback(async () => {
    const currentSession = session;
    const currentSessionId = sessionId;

    clearSessionState("session_expired");
    setSessionNotice("Sesi Anda telah berakhir karena tidak ada aktivitas selama 10 menit.");

    try {
      if (currentSession?.access_token) {
        await axios.post(
          "/api/auth/logout-timeout",
          { sessionId: currentSessionId },
          {
            headers: {
              Authorization: `Bearer ${currentSession.access_token}`,
              "X-Session-Id": currentSessionId,
            },
          }
        );
      }
    } catch {
      // ignore
    }

    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  }, [clearSessionState, session, sessionId]);

  // Register session with backend
  const registerBackendSession = useCallback(async (token, activeSessionId) => {
    const response = await axios.post(
      "/api/auth/session",
      {
        sessionId: activeSessionId,
        userAgent: navigator.userAgent,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Session-Id": activeSessionId,
        },
      }
    );
    return response.data;
  }, []);

  // Login handler
  const login = useCallback(
    async (identifier, password) => {
      setSessionNotice("");
      const cleanIdentifier = identifier.trim();

      // Jika user memasukkan username tanpa @, cek apakah perlu domain fallback
      const emailToUse = cleanIdentifier.includes("@")
        ? cleanIdentifier
        : `${cleanIdentifier}@unggultech.com`;

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: emailToUse,
          password,
        });

        if (error) {
          // Log kegagalan login ke backend audit log (tanpa password)
          try {
            await axios.post("/api/auth/login-failed", {
              identifier: cleanIdentifier,
              reason: error.message,
            });
          } catch {
            // ignore
          }
          throw new Error(error.message === "Invalid login credentials"
            ? "Username/email atau password salah. Pastikan kredensial benar."
            : error.message);
        }

        const newSession = data.session;
        const newUser = data.user;
        const newSessionId = getOrCreateSessionId();

        // Daftarkan sesi ke backend Express
        await registerBackendSession(newSession.access_token, newSessionId);

        setSession(newSession);
        setUser(newUser);
        setAuthStatus("authenticated");
        recordActivity();
        setIsLoginModalOpen(false);

        // Jika ada callback aksi yang tertunda, jalankan sekarang
        if (typeof pendingActionRef.current === "function") {
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          try {
            await action();
          } catch (actionErr) {
            console.error("[AUTH] Error running pending protected action:", actionErr);
          }
        }

        return { user: newUser, session: newSession };
      } catch (err) {
        throw err;
      }
    },
    [getOrCreateSessionId, recordActivity, registerBackendSession]
  );

  // Manual logout handler
  const logout = useCallback(async () => {
    const currentToken = session?.access_token;
    const currentSessionId = sessionId;

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        return false;
      }
    } catch {
      return false;
    }

    clearSessionState("unauthenticated");
    setSessionNotice("");

    try {
      if (currentToken) {
        await axios.post(
          "/api/auth/logout",
          { sessionId: currentSessionId },
          {
            headers: {
              Authorization: `Bearer ${currentToken}`,
              "X-Session-Id": currentSessionId,
            },
          }
        );
      }
    } catch {
      // Pencatatan logout tidak boleh membatalkan logout Supabase yang sudah berhasil.
    }

    return true;
  }, [clearSessionState, session, sessionId]);

  // Protected Action Wrapper: Checks login; if unauthenticated, opens modal and queues action
  const executeProtectedAction = useCallback(
    (actionFn) => {
      if (authStatus === "authenticated") {
        return actionFn();
      }
      pendingActionRef.current = actionFn;
      setIsLoginModalOpen(true);
      return null;
    },
    [authStatus]
  );

  const openLoginModal = useCallback((onSuccessCallback = null) => {
    pendingActionRef.current = onSuccessCallback;
    setIsLoginModalOpen(true);
  }, []);

  const closeLoginModal = useCallback(() => {
    pendingActionRef.current = null;
    setIsLoginModalOpen(false);
  }, []);

  // Axios Interceptors for Bearer Token and 401 Session Handling
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use((config) => {
      if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
      if (sessionId) {
        config.headers["X-Session-Id"] = sessionId;
      }
      return config;
    });

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          const code = error.response?.data?.code;
          if (code === "SESSION_SUPERSEDED") {
            clearSessionState("unauthenticated");
            setSessionNotice("Sesi Anda telah berakhir karena akun digunakan di perangkat lain.");
            supabase.auth.signOut().catch(() => {});
          } else if (code === "SESSION_TIMEOUT" || code === "TOKEN_EXPIRED") {
            clearSessionState("session_expired");
            setSessionNotice("Sesi Anda telah kedaluwarsa. Silakan login kembali untuk melanjutkan.");
            supabase.auth.signOut().catch(() => {});
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [session, sessionId, clearSessionState]);

  // Initial session restoration from Supabase
  useEffect(() => {
    let isMounted = true;
    const activeSessionId = getOrCreateSessionId();

    const initAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (!isMounted) return;

        if (initialSession && initialSession.user) {
          // Periksa waktu inaktivitas yang tersimpan
          const storedLastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || Date.now());
          const now = Date.now();
          if (now - storedLastActive > INACTIVITY_TIMEOUT_MS) {
            clearSessionState("session_expired");
            await supabase.auth.signOut().catch(() => {});
            return;
          }

          // Cek validitas sesi ke backend
          try {
            await registerBackendSession(initialSession.access_token, activeSessionId);
            if (isMounted) {
              setSession(initialSession);
              setUser(initialSession.user);
              setAuthStatus("authenticated");
              lastActivityRef.current = now;
            }
          } catch {
            // Sesi ditolak backend (misal sudah aktif di device lain atau expired)
            if (isMounted) {
              clearSessionState("unauthenticated");
              await supabase.auth.signOut().catch(() => {});
            }
          }
        } else {
          setAuthStatus("unauthenticated");
        }
      } catch (err) {
        console.error("[AUTH] Error initializing session:", err);
        if (isMounted) setAuthStatus("unauthenticated");
      }
    };

    initAuth();

    // Supabase auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!isMounted) return;
        if (event === "SIGNED_OUT" || !newSession) {
          clearSessionState("unauthenticated");
        } else if (event === "TOKEN_REFRESHED" && newSession) {
          setSession(newSession);
        }
      }
    );

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [getOrCreateSessionId, registerBackendSession, clearSessionState]);

  // Activity Detector (Interaksi aplikasi: click, keydown, input, change, submit)
  useEffect(() => {
    if (authStatus !== "authenticated") return;

    const handleUserInteraction = () => {
      recordActivity();
    };

    const events = ["click", "keydown", "input", "change", "submit"];
    events.forEach((eventName) => {
      window.addEventListener(eventName, handleUserInteraction, { passive: true });
    });

    return () => {
      events.forEach((eventName) => {
        window.removeEventListener(eventName, handleUserInteraction);
      });
    };
  }, [authStatus, recordActivity]);

  // Inactivity Interval Monitor (Checks every second)
  useEffect(() => {
    if (authStatus !== "authenticated") {
      setIsWarningOpen(false);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastActivityRef.current;

      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        clearInterval(interval);
        handleTimeoutLogout();
      } else if (elapsed >= WARNING_THRESHOLD_MS) {
        const remainingMs = INACTIVITY_TIMEOUT_MS - elapsed;
        const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
        setSecondsRemaining(remainingSec);
        setIsWarningOpen(true);
      } else {
        if (isWarningOpen) {
          setIsWarningOpen(false);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [authStatus, handleTimeoutLogout, isWarningOpen]);

  const value = {
    authStatus,
    isAuthenticated: authStatus === "authenticated",
    user,
    session,
    sessionId,
    login,
    logout,
    executeProtectedAction,
    openLoginModal,
    closeLoginModal,
    isLoginModalOpen,
    isWarningOpen,
    secondsRemaining,
    extendSession,
    sessionNotice,
    setSessionNotice,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
