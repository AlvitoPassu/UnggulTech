// Actual Express routers and existing auth middleware; all dependencies are local fixtures.
import express from "express";
import { createHash } from "node:crypto";
import { supabase } from "../../src/config/supabase.js";
import sensorRoutes, { handleSensorPlacementBodyError } from "../../src/routes/sensorRoutes.js";
import authRoutes from "../../src/routes/authRoutes.js";
import { localSupabaseDatabase } from "./localSupabaseDatabase.js";
import { quote, USER_A, AUTH_A } from "./sensorPlacementDatabase.js";

export const SECRET_A = "a".repeat(64);
export const SECRET_B = "b".repeat(64);
export const AUTH_B = "10000000-0000-4000-8000-000000000003";
export const sessionHash = (secret = SECRET_A) => createHash("sha256").update(secret).digest("hex");

export async function servePlacementApi() {
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use("/api/sensors/:sensorId/placement", handleSensorPlacementBodyError);
  app.use("/api/sensors", sensorRoutes); app.use("/api/auth", authRoutes);
  app.use((_error, _req, res, _next) => res.status(500).json({ code: "TEST_INTERNAL_ERROR" }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  return {
    async request(path = "/api/sensors/126/placement", options = {}) {
      const token = options.token === undefined ? "A" : options.token;
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: options.method || "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}`,
          "X-Session-Id": options.secret ?? (token === "B" ? SECRET_B : SECRET_A) } : {}) },
        ...(Object.hasOwn(options, "raw") ? { body: options.raw }
          : Object.hasOwn(options, "body") ? { body: JSON.stringify(options.body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function databasePlacementApi(db, { connectForRpc, monitoringDatabase } = {}) {
  const saved = { from: supabase.from, rpc: supabase.rpc, getUser: supabase.auth.getUser, getClaims: supabase.auth.getClaims,
    flag: process.env.SENSOR_PLACEMENT_WRITE_ENABLED, readSource: process.env.SENSOR_PLACEMENT_READ_SOURCE };
  const calls = [];
  const controls = { beforeSave: null, databaseError: null };
  let pending = Promise.resolve();
  const serialize = (action) => {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  };
  const sqlCall = async (connection, name, args) => {
    let values = [quote(args.p_user_id), quote(args.p_auth_session_id), quote(args.p_app_session_hash)];
    if (name === "sensor_placement_save") values.push(quote(args.p_sensor_id), `${quote(JSON.stringify(args.p_payload))}::jsonb`);
    else if (name === "operator_session_check") values.push(quote(args.p_operation));
    else if (name !== "operator_session_acquire") throw new Error("Unexpected local RPC");
    if (name === "sensor_placement_save" && controls.beforeSave) await controls.beforeSave();
    await connection.exec("set role service_role");
    try {
      if (connectForRpc) calls.push({ name, pid: await connection.json("select pg_backend_pid() as result") });
      else calls.push({ name });
      if (name === "sensor_placement_save" && controls.databaseError) return { data: null, error: controls.databaseError };
      return { data: await connection.json(`select public.${name}(${values.join(",")}) as result`), error: null };
    } catch (error) { return { data: null, error: { code: error.code, constraint: error.constraint } }; }
    finally { await connection.exec("reset role"); }
  };
  supabase.rpc = (name, args) => {
    if (connectForRpc) return (async () => {
      const connection = await connectForRpc();
      try { return await sqlCall(connection, name, args); } finally { await connection.close(); }
    })();
    // PGlite is a single connection: never interleave SET ROLE or statements.
    return serialize(() => sqlCall(db, name, args));
  };
  // Preserve int8 values across this fixture's simulated JSON transport.
  const monitoringTransport = monitoringDatabase ? {
    exec: (sql) => monitoringDatabase.exec(sql),
    async query(sql, params) {
      const result = await monitoringDatabase.query(sql, params);
      return { ...result, rows: JSON.parse(JSON.stringify(result.rows,
        (_key, value) => typeof value === "bigint" ? value.toString() : value)) };
    },
  } : {
    exec: (sql) => db.exec(sql),
    async query(sql, params) {
      const query = sql.replace(/\$(\d+)/g, (_match, index) => quote(params[Number(index) - 1]));
      return { rows: await db.json(`select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) as result from (${query}) t`) };
    },
  };
  const localFrom = localSupabaseDatabase(monitoringTransport, { serialize }).from;
  supabase.from = (table) => !monitoringDatabase && table === "audit_logs"
    ? { insert: async () => ({ data: null, error: null }) } : localFrom(table);
  supabase.auth.getUser = async (token) => token === "invalid"
    ? { data: {}, error: { code: "invalid_jwt", status: 401 } }
    : { data: { user: { id: USER_A, email: "operator@fixture.invalid" } }, error: null };
  supabase.auth.getClaims = async (token) => ({ data: { claims: { sub: USER_A,
    session_id: token === "B" ? AUTH_B : AUTH_A, exp: Date.now() / 1000 + (token === "expired" ? -1 : 3600) } }, error: null });
  process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "true";
  process.env.SENSOR_PLACEMENT_READ_SOURCE = "db";
  const http = await servePlacementApi();
  return { ...http, controls, calls,
    async login() {
      const result = await http.request("/api/auth/session", { method: "POST", body: {} });
      if (result.status !== 200) throw new Error(`Local admission failed: ${result.body.code}`);
    },
    async close() {
      await http.close(); await pending;
      supabase.from = saved.from; supabase.rpc = saved.rpc;
      supabase.auth.getUser = saved.getUser; supabase.auth.getClaims = saved.getClaims;
      if (saved.flag === undefined) delete process.env.SENSOR_PLACEMENT_WRITE_ENABLED;
      else process.env.SENSOR_PLACEMENT_WRITE_ENABLED = saved.flag;
      if (saved.readSource === undefined) delete process.env.SENSOR_PLACEMENT_READ_SOURCE;
      else process.env.SENSOR_PLACEMENT_READ_SOURCE = saved.readSource;
    },
  };
}
