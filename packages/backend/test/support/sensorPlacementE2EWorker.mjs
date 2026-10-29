// Test-only adapter around the ACTUAL server entry point. Never imports .env.
import "./localOnly.js";
import { localSupabaseDatabase } from "./localSupabaseDatabase.js";
import { quote, USER_A, AUTH_A } from "./sensorPlacementDatabase.js";

process.env.PORT = process.argv[2];
process.env.SENSOR_PLACEMENT_READ_SOURCE = "db";
process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "true";
const { supabase } = await import("../../src/config/supabase.js");
let issuedTokens = new Set(JSON.parse(process.env.E2E_ISSUED_TOKENS));
const pending = new Map(); let sequence = 0;
process.on("message", message => {
  if (message.configure) {
    issuedTokens = new Set(message.configure.tokens);
    process.env.SENSOR_PLACEMENT_READ_SOURCE = message.configure.source ?? process.env.SENSOR_PLACEMENT_READ_SOURCE;
    process.env.SENSOR_PLACEMENT_WRITE_ENABLED = message.configure.flag ?? process.env.SENSOR_PLACEMENT_WRITE_ENABLED;
    process.send({ configured: message.id }); return;
  }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
  else request.resolve(message.rows);
});
const sql = (query) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); process.send({ id, query });
});
// SDK query builder compatibility only; every statement is executed by native PG
// on a fresh service_role connection in the parent. No position/session is faked.
const transport = {
  async exec(query) {
    if (!["set role service_role", "reset role"].includes(query)) throw new Error("Unexpected transport role operation");
  },
  async query(query, params) {
    const bound = query.replace(/\$(\d+)/g, (_match, index) => {
      const value = params[Number(index) - 1];
      return value === null ? "null" : quote(typeof value === "object" ? JSON.stringify(value) : value);
    });
    return { rows: await sql(bound) };
  },
};
const adapter = localSupabaseDatabase(transport);
supabase.from = adapter.from;
supabase.rpc = async (name, args) => {
  if (!["operator_session_acquire", "operator_session_check", "operator_session_extend", "sensor_placement_save"].includes(name)) throw new Error("Unexpected E2E RPC");
  const values = [args.p_user_id, args.p_auth_session_id, args.p_app_session_hash].map(quote);
  if (name === "sensor_placement_save") values.push(quote(args.p_sensor_id), `${quote(JSON.stringify(args.p_payload))}::jsonb`);
  else if (name === "operator_session_check") values.push(quote(args.p_operation));
  else if (name === "operator_session_extend") values.push(String(args.p_activity_revision), quote(args.p_activity_at));
  try { return { data: (await sql(`select public.${name}(${values.join(",")}) as result`))[0].result, error: null }; }
  catch (error) { return { data: null, error }; }
};
const claims = token => {
  try {
    const result = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    if (!issuedTokens.has(token)) return null;
    return result;
  } catch { return null; }
};
supabase.auth.getUser = async token => claims(token)
  ? { data: { user: { id: USER_A, email: "operator@fixture.invalid" } }, error: null }
  : { data: {}, error: { code: "invalid_jwt", status: 401 } };
supabase.auth.getClaims = async token => ({ data: { claims: claims(token) }, error: null });
// USER_A / AUTH_A are fixture constants, never permission criteria in app code.
if (!USER_A || !AUTH_A) throw new Error("Missing synthetic auth identity");
await import("../../src/server.js");
process.send({ ready: true, pid: process.pid });
