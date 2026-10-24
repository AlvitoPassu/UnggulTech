import { createHash } from "node:crypto";
import { supabase } from "../config/supabase.js";
import { logAudit } from "../services/auditService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[0-9a-f]{64}$/;
const ERRORS = {
  UNAUTHORIZED: [401, "Token otentikasi tidak ditemukan atau tidak valid."],
  TOKEN_EXPIRED: [401, "Sesi otentikasi tidak valid atau telah kedaluwarsa."],
  MISSING_SESSION_ID: [401, "Identitas sesi aplikasi wajib disertakan."],
  INVALID_SESSION: [401, "Identitas sesi aplikasi tidak valid."],
  SESSION_NOT_FOUND: [401, "Sesi Anda telah berakhir. Silakan login kembali."],
  SESSION_MISMATCH: [401, "Sesi ini bukan sesi operator aktif. Silakan login kembali."],
  SESSION_TIMEOUT: [401, "Sesi telah berakhir karena tidak ada aktivitas selama 10 menit."],
  GLOBAL_SESSION_BUSY: [409, "Saat ini terdapat pengguna lain yang sedang login ke sistem Unggul Monitoring. Silakan mencoba kembali setelah pengguna tersebut logout atau sesi berakhir."],
  SESSION_STILL_ACTIVE: [409, "Sesi masih aktif; logout otomatis belum dilakukan."],
  INVALID_ACTIVITY: [400, "Identitas atau waktu aktivitas tidak valid."],
  ACTIVITY_STALE: [409, "Aktivitas terlalu lama. Lakukan interaksi baru sebelum sesi berakhir."],
  AUTH_UNAVAILABLE: [503, "Layanan autentikasi belum tersedia. Silakan mencoba kembali."],
  SESSION_DATABASE_UNAVAILABLE: [503, "Pengelolaan sesi belum tersedia. Silakan mencoba kembali."],
};

export class SessionError extends Error {
  constructor(code) {
    super(ERRORS[code]?.[1] || ERRORS.SESSION_DATABASE_UNAVAILABLE[1]);
    this.code = code;
    this.status = ERRORS[code]?.[0] || 503;
  }
}
const providerError = (error) => new SessionError(
  ["invalid_jwt", "bad_jwt", "session_not_found"].includes(error?.code) ? "TOKEN_EXPIRED"
    : !error?.status || error.status >= 500 || error.status === 429 ? "AUTH_UNAVAILABLE" : "TOKEN_EXPIRED"
);

// Tests inject local clients. Production always uses the trusted Supabase client.
export const createAuthMiddleware = ({ client = supabase, audit = logAudit } = {}) => {
  const identify = async (req) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || "");
    if (!match) throw new SessionError("UNAUTHORIZED");
    const token = match[1];
    let userResult;
    let claimsResult;
    try {
      userResult = await client.auth.getUser(token);
      if (userResult.error) throw providerError(userResult.error);
      claimsResult = await client.auth.getClaims(token);
      if (claimsResult.error) throw providerError(claimsResult.error);
    } catch (error) {
      if (error instanceof SessionError) throw error;
      throw new SessionError("AUTH_UNAVAILABLE");
    }
    const user = userResult.data?.user;
    const claims = claimsResult.data?.claims;
    // getClaims verifies signatures or delegates to Auth for symmetric keys.
    // Never establish identity by decoding an unverified JWT.
    if (!user || !UUID.test(user.id) || claims?.sub !== user.id || !UUID.test(claims?.session_id || "")
      || !Number.isFinite(claims?.exp) || claims.exp * 1000 <= Date.now()) {
      throw new SessionError("TOKEN_EXPIRED");
    }
    const sessionId = req.headers["x-session-id"];
    if (!sessionId) throw new SessionError("MISSING_SESSION_ID");
    if (typeof sessionId !== "string" || !SECRET.test(sessionId)) throw new SessionError("INVALID_SESSION");
    if (req.body?.sessionId !== undefined && req.body.sessionId !== sessionId) throw new SessionError("INVALID_SESSION");
    return { user, authSessionId: claims.session_id,
      sessionHash: createHash("sha256").update(sessionId).digest("hex") };
  };

  const operate = async (identity, operation = "validate", activity = {}) => {
    if (operation === "extend" && (!Number.isSafeInteger(activity.activityRevision) || activity.activityRevision < 1
      || typeof activity.activityAt !== "string" || !Number.isFinite(Date.parse(activity.activityAt)))) {
      throw new SessionError("INVALID_ACTIVITY");
    }
    let result;
    try {
      result = await client.rpc(operation === "acquire" ? "operator_session_acquire"
        : operation === "extend" ? "operator_session_extend" : "operator_session_check", {
        p_user_id: identity.user.id,
        p_auth_session_id: identity.authSessionId,
        p_app_session_hash: identity.sessionHash,
        ...(operation === "extend" ? { p_activity_revision: activity.activityRevision, p_activity_at: activity.activityAt }
          : operation === "acquire" ? {} : { p_operation: operation }),
      });
    } catch {
      throw new SessionError("SESSION_DATABASE_UNAVAILABLE");
    }
    if (result.error || !result.data?.code) throw new SessionError("SESSION_DATABASE_UNAVAILABLE");
    if (result.data.code !== "OK") {
      if (!ERRORS[result.data.code]) throw new SessionError("SESSION_DATABASE_UNAVAILABLE");
      const error = new SessionError(result.data.code);
      if (error.code === "SESSION_STILL_ACTIVE") error.lease = result.data;
      throw error;
    }
    return result.data;
  };

  const reject = async (req, res, error) => {
    const safeError = error instanceof SessionError ? error : new SessionError("SESSION_DATABASE_UNAVAILABLE");
    // Session status polling is observational and does not generate audit spam.
    if (req.path !== "/session-status") {
      await audit({ userId: req.operatorIdentity?.user.id || null,
        action: safeError.status === 503 ? "SESSION_BACKEND_ERROR"
          : safeError.code === "GLOBAL_SESSION_BUSY" ? "LOGIN_REJECTED_BUSY" : "SESSION_INVALID",
        resource: "auth", metadata: { code: safeError.code }, req });
    }
    return res.status(safeError.status).json({ code: safeError.code, message: safeError.message,
      ...(safeError.lease ? { lease: safeError.lease } : {}) });
  };

  const requireAuth = async (req, res, next) => {
    try {
      req.operatorIdentity = await identify(req);
      req.operatorLease = await operate(req.operatorIdentity);
      req.user = req.operatorIdentity.user;
      // Neither public polling nor protected validation counts as user activity.
      return next();
    } catch (error) {
      return reject(req, res, error);
    }
  };
  return { identify, operate, reject, requireAuth };
};

export const operatorAuth = createAuthMiddleware();
export const requireAuth = operatorAuth.requireAuth;
