import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

if (missingEnvironment.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(", ")}`);
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export const config = {
  port: Number(process.env.PORT || 3001),
  logsTable: process.env.SUPABASE_LOGS_TABLE || "sensor_logs",
  timestampColumn: process.env.SUPABASE_LOGS_TIMESTAMP_COLUMN || "created_at",
  statusColumn: process.env.SUPABASE_LOGS_STATUS_COLUMN || "status",
  reportTimeZone: "Asia/Makassar",
  witaOffsetHours: 8,
  allowedOrigins: (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim()),
  recentLogsLimit: Number(process.env.RECENT_LOGS_LIMIT || 10),
};
