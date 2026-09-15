import { supabase } from "../config/supabase.js";
import { logAudit } from "../services/auditService.js";

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit

// In-memory fallback untuk single-device session tracking jika tabel database belum dibuat
const memorySessionRegistry = new Map();

/**
 * Mendaftarkan atau memperbarui sesi aktif untuk seorang operator (Single Device Session).
 * Membatalkan sesi sebelumnya jika ada.
 */
export const registerActiveSession = async (userId, sessionId, { userAgent = null, ipAddress = null } = {}) => {
  const now = new Date();
  const sessionData = {
    user_id: userId,
    session_id: sessionId,
    last_active_at: now.toISOString(),
    user_agent: userAgent,
    ip_address: ipAddress,
    updated_at: now.toISOString(),
  };

  // Simpan di memory registry
  memorySessionRegistry.set(userId, {
    sessionId,
    lastActiveAt: now.getTime(),
    userAgent,
    ipAddress,
  });

  // Simpan ke Supabase database jika tabel tersedia
  try {
    const { error } = await supabase.from("user_sessions").upsert(sessionData, { onConflict: "user_id" });
    if (error) {
      console.warn("[SESSION] Database upsert warning (using memory registry):", error.message);
    }
  } catch (err) {
    console.warn("[SESSION] Error updating user_sessions:", err.message || err);
  }

  return sessionData;
};

/**
 * Menghapus/mencabut sesi aktif operator.
 */
export const revokeActiveSession = async (userId, sessionId = null) => {
  const existing = memorySessionRegistry.get(userId);
  if (!sessionId || (existing && existing.sessionId === sessionId)) {
    memorySessionRegistry.delete(userId);
  }

  try {
    let query = supabase.from("user_sessions").delete().eq("user_id", userId);
    if (sessionId) {
      query = query.eq("session_id", sessionId);
    }
    await query;
  } catch (err) {
    console.warn("[SESSION] Error deleting user_sessions:", err.message || err);
  }
};

/**
 * Mengambil informasi sesi aktif operator.
 */
export const getActiveSession = async (userId) => {
  // Coba ambil dari database
  try {
    const { data, error } = await supabase
      .from("user_sessions")
      .select("session_id, last_active_at, user_agent, ip_address")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data) {
      return {
        sessionId: data.session_id,
        lastActiveAt: new Date(data.last_active_at).getTime(),
        userAgent: data.user_agent,
        ipAddress: data.ip_address,
      };
    }
  } catch {
    // ignore
  }

  // Fallback ke memory registry
  return memorySessionRegistry.get(userId) || null;
};

/**
 * Memperbarui timestamp aktivitas terakhir sesi operator.
 */
export const touchActiveSession = async (userId, sessionId) => {
  const now = new Date();
  const existing = memorySessionRegistry.get(userId);
  if (existing && existing.sessionId === sessionId) {
    existing.lastActiveAt = now.getTime();
  }

  try {
    await supabase
      .from("user_sessions")
      .update({ last_active_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("user_id", userId)
      .eq("session_id", sessionId);
  } catch {
    // ignore
  }
};

/**
 * Middleware untuk memvalidasi otentikasi Supabase, Single Active Session, dan timeout 10 menit.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Akses ditolak. Token otentikasi tidak ditemukan.",
        code: "UNAUTHORIZED",
      });
    }

    const token = authHeader.split(" ")[1]?.trim();
    if (!token) {
      return res.status(401).json({
        message: "Akses ditolak. Format token tidak valid.",
        code: "UNAUTHORIZED",
      });
    }

    // 1. Validasi Supabase JWT Token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({
        message: "Sesi otentikasi tidak valid atau telah kedaluwarsa.",
        code: "TOKEN_EXPIRED",
      });
    }

    // 2. Validasi Sesi Perangkat (Single Active Session)
    const clientSessionId = req.headers["x-session-id"]?.toString()?.trim();
    if (!clientSessionId) {
      return res.status(401).json({
        message: "Sesi perangkat tidak valid. Silakan login kembali.",
        code: "MISSING_SESSION_ID",
      });
    }

    const activeSession = await getActiveSession(user.id);
    if (!activeSession) {
      // Belum ada sesi terdaftar di server untuk user ini
      return res.status(401).json({
        message: "Sesi Anda telah berakhir. Silakan login kembali.",
        code: "SESSION_NOT_FOUND",
      });
    }

    // Cek apakah ada perangkat lain yang sudah login (Single Active Session enforcement)
    if (activeSession.sessionId !== clientSessionId) {
      return res.status(401).json({
        message: "Sesi telah berakhir karena akun Anda telah masuk dari perangkat lain.",
        code: "SESSION_SUPERSEDED",
      });
    }

    // 3. Validasi Inaktivitas 10 Menit (Backend Timeout Check)
    const now = Date.now();
    const elapsed = now - activeSession.lastActiveAt;
    if (elapsed > INACTIVITY_TIMEOUT_MS) {
      await revokeActiveSession(user.id, clientSessionId);
      await logAudit({
        userId: user.id,
        action: "LOGOUT_TIMEOUT",
        metadata: { reason: "10-minute inactivity timeout detected on protected request" },
        req,
      });

      return res.status(401).json({
        message: "Sesi telah berakhir karena tidak ada aktivitas selama 10 menit.",
        code: "SESSION_TIMEOUT",
      });
    }

    // Perbarui waktu aktivitas terakhir
    await touchActiveSession(user.id, clientSessionId);

    // Lampirkan informasi pengguna dan sesi ke request Express
    req.user = user;
    req.sessionId = clientSessionId;

    return next();
  } catch (error) {
    console.error("[AUTH MIDDLEWARE] Error:", error.message || error);
    return res.status(500).json({
      message: "Terjadi kesalahan pada verifikasi otentikasi.",
    });
  }
};
