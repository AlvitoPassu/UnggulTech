import assert from "node:assert/strict";
import { payload, snapshotSql } from "./sensorPlacementDatabase.js";

const save = (api, body = payload(), id = "126", options = {}) => api.request(`/api/sensors/${id}/placement`, { body, ...options });
const positionCount = (db) => db.json("select count(*)::int as result from public.sensor_placements");
const auditCount = (db) => db.json("select count(*)::int as result from public.audit_logs where action='SENSOR_PLACEMENT_SAVE'");
const position = (db) => db.json("select to_jsonb(p) as result from public.sensor_placements p where sensor_id=126");

export const placementApiContracts = [
  ["disabled flag cannot be overridden by HTTP body/query and makes no auth or write RPC calls", async (db, api) => {
    process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "false";
    const before = api.calls.length;
    const response = await api.request("/api/sensors/126/placement?SENSOR_PLACEMENT_WRITE_ENABLED=true", { body: { ...payload(), SENSOR_PLACEMENT_WRITE_ENABLED: true } });
    assert.equal(response.status, 503); assert.equal(response.body.code, "SENSOR_PLACEMENT_WRITE_DISABLED");
    assert.equal(api.calls.length, before); assert.equal(await positionCount(db), 0);
  }],
  ["actual RPC commits first placement/update/no-op and handles bigint ID without changing monitoring data", async (db, api) => {
    const before = await db.json(snapshotSql);
    const first = await save(api); assert.equal(first.status, 200); assert.equal(first.body.version, "1");
    assert.equal(first.body.sensorId, "126"); assert.deepEqual(first.body.placement, { row: 1, column: 1 });
    const update = payload({ row: 10, column: 100, expectedVersion: "1" });
    const second = await save(api, update); assert.equal(second.status, 200); assert.equal(second.body.version, "2");
    const noop = await save(api, { ...update, expectedVersion: "2" });
    assert.equal(noop.status, 200); assert.equal(noop.body.unchanged, true); assert.equal(noop.body.version, "2");
    assert.equal(await auditCount(db), 2);
    assert.deepEqual(await db.json(snapshotSql), before);
    const big = await save(api, payload({ expectedContext: { location: "Nursery test", bedengan: 60 } }), "9007199254740993");
    assert.equal(big.status, 200); assert.equal(big.body.sensorId, "9007199254740993");
    assert.equal(typeof big.body.updatedAt, "string");
    assert.ok(!JSON.stringify(big.body).includes("session"));
    const registry = await api.request("/api/sensors", { method: "GET", token: null });
    assert.equal(registry.status, 200);
    for (const saved of [second, big]) {
      const sensor = registry.body.find((item) => item.id === saved.body.sensorId);
      assert.equal(sensor.placementState, "configured");
      assert.deepEqual(sensor.placement, { sensorId: saved.body.sensorId, ...saved.body.placement,
        context: saved.body.context, version: saved.body.version, updatedAt: saved.body.updatedAt });
    }
  }],
  ["missing sensor/incomplete metadata/context mismatch and occupied point return explicit domain errors", async (db, api) => {
    assert.equal((await save(api, payload(), "999")).status, 404);
    for (const id of ["131"]) {
      const response = await save(api, payload(), id);
      assert.equal(response.status, 409); assert.equal(response.body.code, "SENSOR_CONTEXT_INCOMPLETE");
    }
    const changed = await save(api, payload({ expectedContext: { location: "Other nursery", bedengan: 1 } }));
    assert.equal(changed.status, 409); assert.equal(changed.body.code, "SENSOR_CONTEXT_CHANGED");
    assert.equal((await save(api)).status, 200);
    const collision = await save(api, payload(), "127");
    assert.equal(collision.status, 409); assert.equal(collision.body.code, "PLACEMENT_OCCUPIED");
    assert.equal((await save(api, payload({ expectedContext: { location: "Nursery test", bedengan: 2 } }), "128")).status, 200);
    assert.equal(await positionCount(db), 2);
    await db.exec("update public.sensors set bedengan='2' where id=126");
    try {
      const stale = await save(api, payload({ expectedVersion: "1" }));
      assert.equal(stale.status, 409); assert.equal(stale.body.code, "SENSOR_CONTEXT_CHANGED");
    } finally { await db.exec("update public.sensors set bedengan='B1' where id=126"); }
  }],
  ["NULL HTTP placement/update/no-op round-trip through RPC and repeated GET; malformed locations never invoke RPC", async (db, api) => {
    const before = await db.json(snapshotSql);
    const body = payload({ expectedContext: { location: null, bedengan: 1 } });
    const first = await save(api, body, "130");
    assert.equal(first.status, 200); assert.equal(first.body.context.location, null); assert.equal(first.body.version, "1");
    const update = { ...body, row: 10, column: 100, expectedVersion: "1" };
    const second = await save(api, update, "130");
    assert.equal(second.status, 200); assert.equal(second.body.version, "2");
    const noop = await save(api, { ...update, expectedVersion: "2" }, "130");
    assert.equal(noop.status, 200); assert.equal(noop.body.unchanged, true); assert.equal(noop.body.updatedAt, second.body.updatedAt);
    for (let refresh = 0; refresh < 2; refresh++) {
      const registry = await api.request("/api/sensors", { method: "GET", token: null });
      const sensor = registry.body.find(s => s.id === "130");
      assert.equal(sensor.location, null); assert.equal(sensor.placementState, "configured");
      assert.deepEqual(sensor.placement, { sensorId: "130", ...second.body.placement, context: second.body.context,
        version: "2", updatedAt: second.body.updatedAt });
    }
    const writes = () => api.calls.filter(c => c.name === "sensor_placement_save").length;
    const previous = writes();
    for (const expectedContext of [{ bedengan: 1 }, { wrong: null, bedengan: 1 },
      ...["", " \t\ufeff", 0, true, [], {}].map(location => ({ location, bedengan: 1 }))]) {
      const rejected = await save(api, { ...update, expectedVersion: "2", expectedContext }, "130");
      assert.equal(rejected.status, 400); assert.equal(rejected.body.code, "INVALID_PLACEMENT");
    }
    assert.equal(writes(), previous); assert.equal(await auditCount(db), 2);
    assert.deepEqual(await db.json(snapshotSql), before);
  }],
  ["NULL-to-string and string-to-NULL registry drift hide stale markers and reject stale expectedContext", async (db, api) => {
    const body = payload({ expectedContext: { location: null, bedengan: 1 } });
    assert.equal((await save(api, body, "130")).status, 200);
    const read = async () => (await api.request("/api/sensors", { method: "GET", token: null })).body.find(s => s.id === "130");
    try {
      await db.exec("update public.sensors set location='Nursery test' where id=130");
      assert.equal((await read()).placementState, "context_mismatch"); assert.equal((await read()).placement, null);
      const staleNull = await save(api, { ...body, expectedVersion: "1" }, "130");
      assert.equal(staleNull.status, 409); assert.equal(staleNull.body.code, "SENSOR_CONTEXT_CHANGED");
      assert.equal((await save(api, payload({ expectedVersion: "1" }), "130")).body.version, "2");
      await db.exec("update public.sensors set location=null where id=130");
      assert.equal((await read()).placementState, "context_mismatch");
      const staleString = await save(api, payload({ expectedVersion: "2" }), "130");
      assert.equal(staleString.status, 409); assert.equal(staleString.body.code, "SENSOR_CONTEXT_CHANGED");
      const repaired = await save(api, { ...body, expectedVersion: "2" }, "130");
      assert.equal(repaired.status, 200); assert.equal(repaired.body.version, "3");
      assert.equal((await read()).placementState, "configured"); assert.equal((await read()).placement.context.location, null);
      assert.equal(await auditCount(db), 3);
    } finally { await db.exec("update public.sensors set location=null where id=130"); }
  }],
  ["two concurrent HTTP creates/updates cannot overwrite with stale expected version", async (db, api) => {
    const created = await Promise.all([save(api), save(api)]);
    assert.deepEqual(created.map((r) => r.status).sort(), [200, 409]);
    assert.equal(created.find((r) => r.status === 409).body.code, "PLACEMENT_VERSION_CONFLICT");
    const updated = await Promise.all([save(api, payload({ row: 2, expectedVersion: "1" })), save(api, payload({ row: 3, expectedVersion: "1" }))]);
    assert.deepEqual(updated.map((r) => r.status).sort(), [200, 409]);
    assert.equal(updated.find((r) => r.status === 409).body.code, "PLACEMENT_VERSION_CONFLICT");
    assert.equal((await position(db)).version, 2);
    assert.equal(await auditCount(db), 2);
    const winner = updated.find((r) => r.status === 200);
    assert.equal((await position(db)).row_index, winner.body.placement.row);
  }],
  ["audit failure returns non-success and rolls back first placement and later update", async (db, api) => {
    await db.exec("alter table public.audit_logs add constraint placement_api_audit_failure check(action<>'SENSOR_PLACEMENT_SAVE')");
    try { assert.equal((await save(api)).status, 503); }
    finally { await db.exec("alter table public.audit_logs drop constraint placement_api_audit_failure"); }
    assert.equal(await positionCount(db), 0); assert.equal(await auditCount(db), 0);
    assert.equal((await save(api)).status, 200);
    const before = await position(db);
    await db.exec(`create function public.placement_api_audit_failure() returns trigger language plpgsql as $$ begin
      if new.action='SENSOR_PLACEMENT_SAVE' then raise exception 'private injected audit failure'; end if; return new; end $$;
      create trigger placement_api_audit_failure before insert on public.audit_logs for each row execute function public.placement_api_audit_failure()`);
    try {
      const response = await save(api, payload({ row: 4, expectedVersion: "1" }));
      assert.equal(response.status, 500); assert.ok(!JSON.stringify(response.body).includes("private injected"));
    } finally { await db.exec("drop trigger placement_api_audit_failure on public.audit_logs; drop function public.placement_api_audit_failure()"); }
    assert.deepEqual(await position(db), before); assert.equal(await auditCount(db), 1);
  }],
  ["missing RPC/table fails safely; no SQL migration or alternate write is attempted by the API", async (db, api) => {
    await db.exec("alter function public.sensor_placement_save(uuid,uuid,text,text,jsonb) rename to placement_api_unavailable");
    try { assert.equal((await save(api)).status, 503); }
    finally { await db.exec("alter function public.placement_api_unavailable(uuid,uuid,text,text,jsonb) rename to sensor_placement_save"); }
    await db.exec("alter table public.sensor_placements rename to placement_api_unavailable");
    try { assert.equal((await save(api)).status, 503); }
    finally { await db.exec("alter table public.placement_api_unavailable rename to sensor_placements"); }
    assert.equal(await positionCount(db), 0); assert.equal(await auditCount(db), 0);
  }],
  ["existing auth rejects missing/invalid/expired tokens and device B without disturbing device A", async (db, api) => {
    for (const token of [null, "invalid", "expired", "B"]) {
      assert.equal((await save(api, payload(), "126", { token })).status, 401);
    }
    const busy = await api.request("/api/auth/session", { method: "POST", token: "B", body: {} });
    assert.equal(busy.status, 409); assert.equal(busy.body.code, "GLOBAL_SESSION_BUSY");
    assert.equal((await save(api)).status, 200);
    await api.request("/api/auth/logout", { method: "POST", body: {} });
    const after = await save(api, payload({ row: 2, expectedVersion: "1" }));
    assert.equal(after.status, 401); assert.equal(after.body.code, "SESSION_NOT_FOUND");
    assert.equal((await position(db)).version, 1);
  }],
  ["transactional session check still rejects expiry after middleware approved the request", async (db, api) => {
    api.controls.beforeSave = async () => {
      api.controls.beforeSave = null;
      await db.exec("update public.global_operator_session set created_at=clock_timestamp()-interval '12 minutes',last_active_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '1 minute'");
    };
    const response = await save(api);
    assert.equal(response.status, 401); assert.equal(response.body.code, "SESSION_TIMEOUT");
    assert.equal(await positionCount(db), 0); assert.equal(await auditCount(db), 0);
  }],
];
