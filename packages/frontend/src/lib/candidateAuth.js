import { createClient } from "@supabase/supabase-js";

// Each attempt uses SDK-owned memory only. No local/session storage, URL login,
// refresh worker or BroadcastChannel can affect the admitted operator client.
export const createCandidateAuth = (url, key, options = {}) => createClient(url, key, {
  ...options,
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: `unggul-candidate-${globalThis.crypto.randomUUID()}`,
  },
}).auth;

// Coordinate promotion/cleanup across tabs using a separate Web Lock. The SDK
// takes its own auth-storage lock inside these operations (different key).
// Unsupported/insecure browsers fail closed instead of racing shared storage.
export const withOperatorAuthLock = async (action) => {
  if (!globalThis.navigator?.locks?.request) throw Object.assign(
    new Error("Browser tidak mendukung sinkronisasi sesi yang aman. Gunakan browser terbaru melalui HTTPS."),
    { code: "AUTH_COORDINATION_UNAVAILABLE" });
  return globalThis.navigator.locks.request("unggul-operator-auth-mutation", action);
};
