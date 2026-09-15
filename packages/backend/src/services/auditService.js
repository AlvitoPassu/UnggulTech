import { supabase } from "../config/supabase.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "service_role_key",
  "authorization",
]);

/**
 * Membersihkan objek metadata dari kunci-kunci kredensial sensitif.
 */
export const sanitizeMetadata = (data) => {
  if (!data || typeof data !== "object") return data ?? {};
  if (Array.isArray(data)) return data.map(sanitizeMetadata);

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      continue;
    }
    if (value && typeof value === "object") {
      clean[key] = sanitizeMetadata(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
};

/**
 * Mencatat aktivitas operator ke tabel audit_logs.
 *
 * @param {Object} params
 * @param {string|null} params.userId - UUID user Supabase Auth
 * @param {string} params.action - Nama aksi (LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT_MANUAL, LOGOUT_TIMEOUT, DOWNLOAD_HISTORICAL_DATA, RAINFALL_CREATE, RAINFALL_UPDATE)
 * @param {string} [params.resource] - Nama tabel/entitas yang dimanipulasi
 * @param {string|number} [params.resourceId] - ID entitas terkait
 * @param {Object} [params.metadata] - Data pendukung non-sensitif
 * @param {import('express').Request} [params.req] - Request Express untuk ekstraksi IP & User-Agent
 */
export const logAudit = async ({
  userId = null,
  action,
  resource = null,
  resourceId = null,
  metadata = {},
  req = null,
}) => {
  const ipAddress = req?.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() ||
    req?.socket?.remoteAddress ||
    null;
  const userAgent = req?.headers["user-agent"] || null;

  const payload = {
    user_id: userId,
    action,
    resource: resource ? String(resource) : null,
    resource_id: resourceId !== null && resourceId !== undefined ? String(resourceId) : null,
    metadata: sanitizeMetadata(metadata),
    ip_address: ipAddress,
    user_agent: userAgent,
    created_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase.from("audit_logs").insert([payload]);
    if (error) {
      // Jika tabel belum dibuat di Supabase, fallback cetak ke server log tanpa melempar exception
      console.warn("[AUDIT LOG] Database insert warning:", error.message, payload);
    }
  } catch (err) {
    console.warn("[AUDIT LOG] Failed to persist audit log:", err.message || err);
  }

  return payload;
};
