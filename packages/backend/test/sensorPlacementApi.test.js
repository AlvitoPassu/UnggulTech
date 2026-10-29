import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { supabase } from "../src/config/supabase.js";
import { isSensorPlacementWriteEnabled } from "../src/config/sensorPlacementWrite.js";
import { validateSensorPlacementRequest, saveSensorPlacement } from "../src/services/sensorPlacementService.js";
import { servePlacementApi, sessionHash } from "./support/sensorPlacementApiFixture.js";
import { payload, USER_A, AUTH_A } from "./support/sensorPlacementDatabase.js";

let http, originals, handler, sessionCode, authCalls, rpcCalls;
const success = (args) => ({ data: { code: "OK", sensorId: args.p_sensor_id,
  placement: { row: args.p_payload.row, column: args.p_payload.column }, context: args.p_payload.expectedContext,
  version: args.p_payload.expectedVersion === null ? "1" : String(BigInt(args.p_payload.expectedVersion) + 1n),
  updatedAt: "2026-10-28T00:00:00.123456+00:00", unchanged: false }, error: null });
before(async () => {
  originals = { from: supabase.from, rpc: supabase.rpc, user: supabase.auth.getUser, claims: supabase.auth.getClaims,
    flag: process.env.SENSOR_PLACEMENT_WRITE_ENABLED, readSource: process.env.SENSOR_PLACEMENT_READ_SOURCE };
  supabase.from = (table) => {
    if (table === "sensors") return { select: () => ({ eq: (_column, id) => ({
      maybeSingle: async () => ({ data: { id }, error: null }),
    }) }) };
    if (table === "sensor_placements") return { select: () => ({ in: async () => ({ data: [], count: 0, error: null }) }) };
    assert.equal(table, "audit_logs"); return { insert: async () => ({ error: null }) };
  };
  supabase.auth.getUser = async (token) => {
    authCalls++;
    return token === "invalid" ? { data: {}, error: { code: "invalid_jwt", status: 401 } }
      : { data: { user: { id: USER_A } }, error: null };
  };
  supabase.auth.getClaims = async (token) => ({ data: { claims: { sub: USER_A, session_id: AUTH_A,
    exp: Date.now() / 1000 + (token === "expired" ? -1 : 3600) } }, error: null });
  supabase.rpc = async (name, args) => {
    if (name === "operator_session_check") return { data: { code: sessionCode }, error: null };
    assert.equal(name, "sensor_placement_save"); rpcCalls.push(args);
    return handler(args);
  };
  http = await servePlacementApi();
});
beforeEach(() => {
  process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "true";
  process.env.SENSOR_PLACEMENT_READ_SOURCE = "db";
  handler = success; sessionCode = "OK"; authCalls = 0; rpcCalls = [];
});
after(async () => {
  await http?.close(); supabase.from = originals.from; supabase.rpc = originals.rpc;
  supabase.auth.getUser = originals.user; supabase.auth.getClaims = originals.claims;
  if (originals.flag === undefined) delete process.env.SENSOR_PLACEMENT_WRITE_ENABLED;
  else process.env.SENSOR_PLACEMENT_WRITE_ENABLED = originals.flag;
  if (originals.readSource === undefined) delete process.env.SENSOR_PLACEMENT_READ_SOURCE;
  else process.env.SENSOR_PLACEMENT_READ_SOURCE = originals.readSource;
});

test("feature flag is disabled unless the backend environment is exactly true, before auth or RPC", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1", "yes", " true ", "unknown"]) {
    if (value === undefined) delete process.env.SENSOR_PLACEMENT_WRITE_ENABLED;
    else process.env.SENSOR_PLACEMENT_WRITE_ENABLED = value;
    assert.equal(isSensorPlacementWriteEnabled(), false);
    const response = await http.request("/api/sensors/126/placement?SENSOR_PLACEMENT_WRITE_ENABLED=true", {
      body: { ...payload(), SENSOR_PLACEMENT_WRITE_ENABLED: true } });
    assert.equal(response.status, 503); assert.equal(response.body.code, "SENSOR_PLACEMENT_WRITE_DISABLED");
    await assert.rejects(saveSensorPlacement("126", payload(), {}), { code: "SENSOR_PLACEMENT_WRITE_DISABLED" });
  }
  assert.equal(authCalls, 0); assert.equal(rpcCalls.length, 0);
});

test("existing middleware rejects missing, invalid, expired, logged-out and other-device sessions", async () => {
  for (const token of [null, "invalid", "expired"]) {
    assert.equal((await http.request(undefined, { token, body: payload() })).status, 401);
  }
  for (const code of ["SESSION_NOT_FOUND", "SESSION_TIMEOUT", "SESSION_MISMATCH", "INVALID_SESSION"]) {
    sessionCode = code;
    const response = await http.request(undefined, { body: payload() });
    assert.equal(response.status, 401); assert.equal(response.body.code, code);
  }
  assert.equal(rpcCalls.length, 0);
});

test("all 1000 integer request pairs validate and invalid IDs/body values are rejected before write RPC", async () => {
  for (let row = 1; row <= 10; row++) for (let column = 1; column <= 100; column++) {
    assert.deepEqual(validateSensorPlacementRequest("126", payload({ row, column })), payload({ row, column }));
  }
  for (const id of ["0", "-1", "1.0", "1e0", "126x", "0126", "126%20", "9223372036854775808"]) {
    const response = await http.request(`/api/sensors/${id}/placement`, { body: payload() });
    assert.equal(response.status, 400, id);
  }
  for (const [field, maximum] of [["row", 10], ["column", 100]]) {
    for (const value of [0, -1, maximum + 1, 1.5, true, false, null, "1", "", "abc", [], {}]) {
      assert.equal((await http.request(undefined, { body: payload({ [field]: value }) })).status, 400, `${field}=${String(value)}`);
    }
    for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => validateSensorPlacementRequest("126", payload({ [field]: value })), { code: "INVALID_PLACEMENT" });
    const missing = payload(); delete missing[field];
    assert.equal((await http.request(undefined, { body: missing })).status, 400);
  }
  for (const body of [null, [], {}, true, payload({ expectedContext: null }), payload({ expectedContext: { location: " ", bedengan: 1 } }),
    payload({ expectedContext: { location: "Nursery test", bedengan: "1" } }), payload({ p_user_id: USER_A }), payload({ session_secret: "spoof" })]) {
    assert.equal((await http.request(undefined, { body })).status, 400);
  }
  for (const expectedVersion of [0, 1, true, "0", "1.0", "1e0", "9223372036854775808"]) {
    assert.equal((await http.request(undefined, { body: payload({ expectedVersion }) })).status, 400);
  }
  const missing = payload(); delete missing.expectedVersion;
  assert.equal((await http.request(undefined, { body: missing })).status, 400);
  assert.equal(rpcCalls.length, 0);
});

test("malformed/oversized JSON on placement PUT returns explicit safe request errors", async () => {
  assert.equal((await http.request(undefined, { raw: '{"row":' })).status, 400);
  assert.equal((await http.request(undefined, { raw: JSON.stringify({ text: "x".repeat(110_000) }) })).status, 413);
  assert.equal(rpcCalls.length, 0);
});

test("RPC receives verified identity and bigint string; success is allowlisted and timestamp normalized", async () => {
  handler = (args) => { const response = success(args); response.data.secret = "NEVER_RETURN"; response.data.lease = { session: "NEVER_RETURN" }; return response; };
  const response = await http.request("/api/sensors/9007199254740993/placement", { body: payload() });
  assert.equal(response.status, 200); assert.equal(response.body.sensorId, "9007199254740993");
  assert.equal(response.body.version, "1"); assert.equal(response.body.updatedAt, "2026-10-28T00:00:00.123Z");
  assert.equal(rpcCalls[0].p_user_id, USER_A); assert.equal(rpcCalls[0].p_auth_session_id, AUTH_A);
  assert.equal(rpcCalls[0].p_app_session_hash, sessionHash());
  assert.equal(rpcCalls[0].p_sensor_id, "9007199254740993");
  assert.deepEqual(rpcCalls[0].p_payload, payload());
  assert.ok(!JSON.stringify(response.body).includes("NEVER_RETURN"));
});

test("domain codes are mapped explicitly, including transactional session rejection", async () => {
  for (const [code, status] of [["INVALID_SENSOR_ID", 400], ["INVALID_PLACEMENT", 400], ["INVALID_EXPECTED_VERSION", 400],
    ["SENSOR_NOT_FOUND", 404], ["SENSOR_CONTEXT_INCOMPLETE", 409], ["SENSOR_CONTEXT_CHANGED", 409],
    ["PLACEMENT_OCCUPIED", 409], ["PLACEMENT_VERSION_CONFLICT", 409], ["PLACEMENT_VERSION_EXHAUSTED", 409],
    ["SESSION_TIMEOUT", 401], ["SESSION_NOT_FOUND", 401], ["SESSION_MISMATCH", 401], ["INVALID_SESSION", 401]]) {
    handler = () => ({ data: { code, privateField: "NEVER_RETURN" }, error: null });
    const response = await http.request(undefined, { body: payload() });
    assert.equal(response.status, status); assert.equal(response.body.code, code);
    assert.ok(!JSON.stringify(response.body).includes("NEVER_RETURN"));
  }
});

test("missing RPC/schema, permission, constraint and SQLSTATE errors never use raw messages or return success", async () => {
  for (const [code, constraint, status] of [["PGRST202", null, 503], ["42883", null, 503], ["42P01", null, 503],
    ["08006", null, 503], ["55P03", null, 503], ["55000", null, 503], ["57014", null, 503],
    ["42501", null, 403], ["23514", null, 503], ["23505", "some_audit_unique", 503],
    ["23505", "sensor_placements_point_key", 409], ["23505", "sensor_placements_null_point_key", 409], ["P0001", null, 500], ["XX000", null, 500]]) {
    handler = () => ({ data: null, error: { code, constraint, message: "NEVER_RETURN password token SQL", details: "NEVER_RETURN" } });
    const response = await http.request(undefined, { body: payload() });
    assert.equal(response.status, status, code); assert.ok(!JSON.stringify(response.body).includes("NEVER_RETURN"));
  }
  handler = () => { throw new Error("NEVER_RETURN network error"); };
  assert.equal((await http.request(undefined, { body: payload() })).status, 503);
});

test("malformed success responses and unknown codes cannot create a false success", async () => {
  for (const data of [null, [], {}, { code: "OK" }, { code: "UNKNOWN" },
    { ...success({ p_sensor_id: "126", p_payload: payload() }).data, sensorId: "127" },
    { ...success({ p_sensor_id: "126", p_payload: payload() }).data, version: "9007199254740993" },
    { ...success({ p_sensor_id: "126", p_payload: payload() }).data, updatedAt: "invalid" }]) {
    handler = () => ({ data, error: null });
    assert.equal((await http.request(undefined, { body: payload() })).status, 503);
  }
});

test("turning the environment flag off during authentication still prevents write RPC", async () => {
  const original = supabase.auth.getClaims;
  supabase.auth.getClaims = async (...args) => { const claims = await original(...args); process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "false"; return claims; };
  try { assert.equal((await http.request(undefined, { body: payload() })).status, 503); }
  finally { supabase.auth.getClaims = original; }
  assert.equal(rpcCalls.length, 0);
});
