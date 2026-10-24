// All automated tests are local: accidental calls to Supabase/AI are rejected.
import dotenv from "dotenv";

// Application imports call config({ override: true }). Keep real .env credentials
// out of test processes, including tests that only inspect route definitions.
dotenv.config = () => ({ parsed: {} });
Object.assign(process.env, {
  SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "local-only-test-key",
  GEMINI_API_KEY: "", FRONTEND_ORIGIN: "http://localhost:5173", SENSOR_ID_MAP: "{}",
  SUPABASE_LOGS_TABLE: "sensor_logs", SUPABASE_LOGS_TIMESTAMP_COLUMN: "created_at",
  SUPABASE_LOGS_STATUS_COLUMN: "status", RECENT_LOGS_LIMIT: "10", PH_ACTIVE_THRESHOLD_SECONDS: "180",
});
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("External network access is disabled in automated tests");
  }
  return nativeFetch(input, options);
};
