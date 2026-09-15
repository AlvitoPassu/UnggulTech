import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { logAudit } from "../services/auditService.js";
import {
  registerActiveSession,
  revokeActiveSession,
  getActiveSession,
  requireAuth,
} from "../middleware/authMiddleware.js";

const router = Router();

/**
 * POST /api/auth/session
 * Mendaftarkan sesi perangkat aktif baru setelah login Supabase Auth berhasil.
 * Secara otomatis membatalkan sesi di perangkat sebelumnya (Single Device Session).
 */
router.post("/session", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Token otentikasi tidak ditemukan." });
    }

    const token = authHeader.split(" ")[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ message: "Token otentikasi tidak valid." });
    }

    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: "Session ID wajib disertakan." });
    }

    const ipAddress = req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() ||
      req.socket.remoteAddress;
    const userAgent = req.headers["user-agent"] || null;

    // Daftarkan sesi baru (akan menimpa sesi lama untuk user ini)
    await registerActiveSession(user.id, sessionId, { userAgent, ipAddress });

    // Catat Audit Log LOGIN_SUCCESS
    await logAudit({
      userId: user.id,
      action: "LOGIN_SUCCESS",
      resource: "auth",
      resourceId: user.id,
      metadata: {
        email: user.email,
        session_id: sessionId,
      },
      req,
    });

    return res.status(200).json({
      message: "Sesi berhasil didaftarkan.",
      user: {
        id: user.id,
        email: user.email,
        role: user.user_metadata?.role || "operator",
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/login-failed
 * Mencatat percobaan login yang gagal ke audit log tanpa menyimpan password.
 */
router.post("/login-failed", async (req, res, next) => {
  try {
    const { identifier, reason } = req.body || {};

    await logAudit({
      action: "LOGIN_FAILED",
      resource: "auth",
      metadata: {
        identifier: identifier ? String(identifier).slice(0, 100) : "unknown",
        reason: reason ? String(reason).slice(0, 200) : "Authentication failed",
      },
      req,
    });

    return res.json({ status: "logged" });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout
 * Logout manual oleh operator melalui Header tombol Keluar.
 */
router.post("/logout", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let userId = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const { data } = await supabase.auth.getUser(token);
      userId = data?.user?.id || null;
    }

    const { sessionId } = req.body || {};
    if (userId) {
      await revokeActiveSession(userId, sessionId);
      await logAudit({
        userId,
        action: "LOGOUT_MANUAL",
        resource: "auth",
        resourceId: userId,
        metadata: { session_id: sessionId },
        req,
      });
    }

    return res.json({ message: "Logout berhasil dicatat." });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout-timeout
 * Logout otomatis karena inaktivitas 10 menit.
 */
router.post("/logout-timeout", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let userId = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const { data } = await supabase.auth.getUser(token);
      userId = data?.user?.id || null;
    }

    const { sessionId } = req.body || {};
    if (userId) {
      await revokeActiveSession(userId, sessionId);
      await logAudit({
        userId,
        action: "LOGOUT_TIMEOUT",
        resource: "auth",
        resourceId: userId,
        metadata: {
          session_id: sessionId,
          reason: "10-minute inactivity timeout reached on client",
        },
        req,
      });
    }

    return res.json({ message: "Logout timeout berhasil dicatat." });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/session-status
 * Memeriksa status keaktifan sesi perangkat saat ini.
 */
router.get("/session-status", requireAuth, (req, res) => {
  return res.json({
    active: true,
    user: {
      id: req.user.id,
      email: req.user.email,
    },
    sessionId: req.sessionId,
  });
});

export default router;
