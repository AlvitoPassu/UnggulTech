// HTTP/service regressions with synthetic Auth, session RPC and data adapters only.
// No database is created and no SQL/migration is executed by this suite.
import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHash } from "node:crypto";
import { supabase } from "../src/config/supabase.js";
import { saveSensorPlacement } from "../src/services/sensorPlacementService.js";
import authRoutes from "../src/routes/authRoutes.js";
import sensorRoutes, { handleSensorPlacementBodyError } from "../src/routes/sensorRoutes.js";
import rainfallRoutes from "../src/routes/rainfallRoutes.js";
import reportRoutes from "../src/routes/reportRoutes.js";
import { OperatorSessionClient, SESSION_ID_KEY } from "../../frontend/src/lib/operatorSessionClient.js";
import { payload, USER_A, USER_B, AUTH_A } from "./support/sensorPlacementDatabase.js";

const secret = "a".repeat(64);
const identity = { user: { id: USER_A }, authSessionId: AUTH_A,
  sessionHash: createHash("sha256").update(secret).digest("hex") };
const denied = { code: "PLACEMENT_ACCESS_DENIED", message: "Akses penyimpanan posisi sensor tidak diizinkan." };
let server, originals, userId, sessionCode, placementCode, lease, rpcCalls, dataCalls;
const placementCalls = () => rpcCalls.filter(({ name }) => name === "sensor_placement_save");

before(async () => {
  originals = { from: supabase.from, rpc: supabase.rpc, getUser: supabase.auth.getUser, getClaims: supabase.auth.getClaims,
    flag: process.env.SENSOR_PLACEMENT_WRITE_ENABLED, readSource: process.env.SENSOR_PLACEMENT_READ_SOURCE,
    allowedUsers: process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS };
  supabase.auth.getUser = async (token) => token === "invalid"
    ? { data: {}, error: { code: "invalid_jwt", status: 401 } }
    : { data: { user: { id: userId, email: "same@fixture.invalid", user_metadata: { role: "admin", id: USER_B } } }, error: null };
  supabase.auth.getClaims = async (token) => ({ data: { claims: { sub: userId, session_id: AUTH_A,
    exp: Date.now() / 1000 + (token === "expired" ? -1 : 3600) } }, error: null });
  supabase.rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    assert.equal(args.p_user_id, userId);
    assert.equal(args.p_auth_session_id, AUTH_A);
    assert.equal(args.p_app_session_hash, identity.sessionHash);
    if (name === "operator_session_check") {
      assert.equal(args.p_operation, "validate");
      return { data: { code: sessionCode, ...lease }, error: null };
    }
    assert.equal(name, "sensor_placement_save");
    if (placementCode) return { data: { code: placementCode }, error: null };
    return { data: { code: "OK", sensorId: args.p_sensor_id,
      placement: { row: args.p_payload.row, column: args.p_payload.column }, context: args.p_payload.expectedContext,
      version: "1", updatedAt: lease.serverNow, unchanged: false }, error: null };
  };
  supabase.from = (table) => {
    dataCalls.push(table);
    if (table === "sensors") return { select: () => ({ eq: (_column, id) => ({
      maybeSingle: async () => ({ data: { id }, error: null }),
    }) }) };
    if (table === "sensor_placements") return { select: () => ({ in: async () => ({ data: [], count: 0, error: null }) }) };
    if (table === "audit_logs") return { insert: async () => ({ error: null }) };
    if (table === "rainfall_readings") {
      const result = (record) => ({ data: { id: 1, ...record }, error: null });
      return { insert: (record) => ({ select: () => ({ single: async () => result(record) }) }),
        update: (record) => ({ eq: () => ({ select: () => ({ maybeSingle: async () => result(record) }) }) }) };
    }
    assert.ok(["sensor_logs", "soil_ph_readings"].includes(table), "No profile/permission table is consulted");
    const query = { then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      maybeSingle: async () => ({ data: null, error: null }) };
    for (const method of ["select", "eq", "gte", "lt", "order", "limit"]) query[method] = () => query;
    return query;
  };
  const app = express();
  app.use(express.json());
  app.use("/api/sensors/:sensorId/placement", handleSensorPlacementBodyError);
  app.use("/api/auth", authRoutes); app.use("/api/sensors", sensorRoutes);
  app.use("/api/rainfall", rainfallRoutes); app.use("/api/reports", reportRoutes);
  app.use((_error, _req, res, _next) => res.status(500).json({ code: "TEST_INTERNAL_ERROR" }));
  server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
});
beforeEach(() => {
  process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "true";
  process.env.SENSOR_PLACEMENT_READ_SOURCE = "db";
  delete process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS;
  userId = USER_A; sessionCode = "OK"; placementCode = null; rpcCalls = []; dataCalls = [];
  const now = Date.now();
  lease = { serverNow: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString() };
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  supabase.from = originals.from; supabase.rpc = originals.rpc;
  supabase.auth.getUser = originals.getUser; supabase.auth.getClaims = originals.getClaims;
  for (const [key, value] of [["SENSOR_PLACEMENT_WRITE_ENABLED", originals.flag],
    ["SENSOR_PLACEMENT_READ_SOURCE", originals.readSource],
    ["SENSOR_PLACEMENT_ALLOWED_USER_IDS", originals.allowedUsers]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
async function request(path = "/api/sensors/126/placement", { method = "PUT", token = "A", body = payload() } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}`, "X-Session-Id": secret } : {}) },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: response.headers.get("content-type")?.includes("application/json")
    ? await response.json() : await response.text() };
}

test("valid operator sessions save without UUID configuration; obsolete allowlists have no effect", async () => {
  for (const value of [undefined, "", " \t\n ", "broken-private-configuration", `${USER_A},broken`, `${USER_A},`]) {
    if (value === undefined) delete process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS;
    else process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS = value;
    for (const id of [USER_A, USER_B]) {
      userId = id;
      const response = await request();
      assert.equal(response.status, 200); assert.equal(response.body.code, "OK");
      assert.equal(placementCalls().at(-1).args.p_user_id, id);
      assert.deepEqual(placementCalls().at(-1).args.p_payload, payload());
    }
  }
  assert.equal(placementCalls().length, 12);
  assert.ok(!dataCalls.includes("profiles"));
});

test("body/query IDs and profile-like metadata cannot replace the verified operator identity", async () => {
  process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS = USER_B;
  const response = await request(`/api/sensors/126/placement?userId=${USER_B}&p_user_id=${USER_B}&SENSOR_PLACEMENT_ALLOWED_USER_IDS=${USER_A}&SENSOR_PLACEMENT_WRITE_ENABLED=true`, {
    body: { ...payload(), userId: USER_B, operatorIdentity: { user: { id: USER_B } }, role: "admin" },
  });
  assert.equal(response.status, 400); assert.equal(response.body.code, "INVALID_PLACEMENT");
  assert.equal(placementCalls().length, 0);
  process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS = USER_A;
  assert.equal((await request(undefined, { body: { ...payload(), p_user_id: USER_B } })).status, 400);
  assert.equal(placementCalls().length, 0);
  assert.equal((await request(`/api/sensors/126/placement?userId=${USER_B}`)).status, 200);
  assert.equal(placementCalls()[0].args.p_user_id, USER_A);
});

test("direct service callers still need session identity and cannot supply it through payload", async () => {
  for (const incomplete of [undefined, {}, { ...identity, user: null }, { ...identity, authSessionId: null }, { ...identity, sessionHash: null }]) {
    await assert.rejects(saveSensorPlacement("126", payload(), incomplete), { code: "INVALID_SESSION", status: 401 });
  }
  await assert.rejects(saveSensorPlacement("126", { ...payload(), userId: USER_B }, identity), { code: "INVALID_PLACEMENT" });
  assert.deepEqual(rpcCalls, []);
  assert.equal((await saveSensorPlacement("126", payload(), identity)).sensorId, "126");
  assert.equal(placementCalls()[0].args.p_user_id, USER_A);
});

test("missing/invalid/expired authentication and logged-out or other-device sessions remain rejected", async () => {
  process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS = "broken";
  for (const [token, code] of [[null, "UNAUTHORIZED"], ["invalid", "TOKEN_EXPIRED"], ["expired", "TOKEN_EXPIRED"]]) {
    const response = await request(undefined, { token });
    assert.equal(response.status, 401); assert.equal(response.body.code, code);
  }
  for (const code of ["SESSION_TIMEOUT", "SESSION_NOT_FOUND", "SESSION_MISMATCH", "INVALID_SESSION"]) {
    sessionCode = code;
    const response = await request();
    assert.equal(response.status, 401); assert.equal(response.body.code, code);
  }
  assert.equal(placementCalls().length, 0);
});

test("session validity is checked on every save without cached admission", async () => {
  assert.equal((await request()).status, 200);
  sessionCode = "SESSION_NOT_FOUND";
  assert.equal((await request()).status, 401);
  assert.equal(placementCalls().length, 1);
});

test("RPC rechecks sessions after middleware approval and returns existing terminal errors", async () => {
  for (const code of ["SESSION_TIMEOUT", "SESSION_NOT_FOUND", "SESSION_MISMATCH", "INVALID_SESSION"]) {
    placementCode = code;
    const response = await request();
    assert.equal(response.status, 401); assert.equal(response.body.code, code);
  }
  assert.equal(placementCalls().length, 4);
});

test("database permission denial keeps the existing session client authenticated and server status valid", async () => {
  placementCode = "PLACEMENT_ACCESS_DENIED";
  let signouts = 0;
  const session = { access_token: "A", user: { id: USER_A } };
  const stored = new Map([[SESSION_ID_KEY, secret]]);
  const client = new OperatorSessionClient({
    auth: { getSession: async () => ({ data: { session }, error: null }), signOut: async () => { signouts++; } },
    api: { get: async (path) => ({ data: (await request(path, { method: "GET" })).body }) },
    storage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
  });
  await client.restore();
  assert.equal(client.status, "authenticated");
  const before = client.snapshot();
  const response = await request();
  assert.equal(response.status, 403); assert.deepEqual(response.body, denied);
  assert.equal(await client.rejectSession({ response: { status: response.status, data: response.body } }), false);
  assert.deepEqual(client.snapshot(), before);
  assert.equal(stored.get(SESSION_ID_KEY), secret); assert.equal(signouts, 0);
  assert.equal(await client.checkStatus(), true);
  assert.equal(placementCalls().length, 1);
});

test("existing rainfall create/edit and report download remain protected independently of the placement flag", async () => {
  const rainfall = { rainfall_value: 20, unit: "mm", measured_at: "2026-10-28T00:00:00.000Z" };
  const operations = [["/api/rainfall", "POST", rainfall, 201], ["/api/rainfall/1", "PATCH", rainfall, 200],
    ["/api/reports/download", "POST", { sensorId: 126, startDate: "2026-10-28", endDate: "2026-10-28", format: "csv" }, 200]];
  for (const value of [undefined, "", "broken", USER_B]) {
    if (value === undefined) delete process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS;
    else process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS = value;
    for (const flag of ["false", "true"]) {
      process.env.SENSOR_PLACEMENT_WRITE_ENABLED = flag;
      for (const [path, method, body, status] of operations) {
        const response = await request(path, { method, body });
        assert.equal(response.status, status, path);
        if (path.endsWith("download")) assert.match(response.body, /Sensor/);
        assert.equal((await request(path, { method, body, token: null })).status, 401);
      }
    }
  }
  assert.equal(placementCalls().length, 0);
  assert.ok(!dataCalls.includes("profiles"));
});

test("disabled feature flag rejects all operators before auth or any RPC", async () => {
  process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "false";
  for (const value of [USER_A, USER_B, "broken", ""]) {
    process.env.SENSOR_PLACEMENT_ALLOWED_USER_IDS = value;
    const response = await request();
    assert.equal(response.status, 503); assert.equal(response.body.code, "SENSOR_PLACEMENT_WRITE_DISABLED");
    await assert.rejects(saveSensorPlacement("126", payload(), identity), { code: "SENSOR_PLACEMENT_WRITE_DISABLED" });
  }
  assert.deepEqual(rpcCalls, []); assert.deepEqual(dataCalls, []);
});
