import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { supabase } from "../src/config/supabase.js";
import { bootstrapPlacementBase, SQL, PLACEMENT_MIGRATION, optIn, resetSql, payload, snapshotSql } from "./support/sensorPlacementDatabase.js";
import { databasePlacementApi } from "./support/sensorPlacementApiFixture.js";

let pg, db, api;
const registry = () => api.request("/api/sensors", { method: "GET", token: null });
const sensor = async (id = "126") => (await registry()).body.find((item) => item.id === id);
const writeCalls = () => api.calls.filter(({ name }) => name === "sensor_placement_save").length;
const counts = () => db.json(`select jsonb_build_array((select count(*) from public.sensor_placements),
  (select count(*) from public.audit_logs where action='SENSOR_PLACEMENT_SAVE')) as result`);
before(async () => {
  pg = new PGlite(); db = { exec: (sql) => pg.exec(sql), json: async (sql) => (await pg.query(sql)).rows[0].result };
  await bootstrapPlacementBase(db); await db.exec(optIn); await db.exec(await SQL(PLACEMENT_MIGRATION));
  api = await databasePlacementApi(db, { monitoringDatabase: pg });
});
beforeEach(async () => {
  await db.exec(resetSql);
  process.env.SENSOR_PLACEMENT_READ_SOURCE = "db"; process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "true";
  api.controls.beforeSave = null; api.controls.databaseError = null; api.calls.length = 0;
  await api.login();
});
after(async () => { await api?.close(); await pg?.close(); });

test("public GET preserves the registry array and distinguishes unconfigured sensors from configured RPC results", async () => {
  const before = await db.json(snapshotSql);
  const empty = await registry();
  assert.equal(empty.status, 200); assert.ok(Array.isArray(empty.body));
  assert.ok(empty.body.every((item) => item.placement === null && item.placementState === "unconfigured" && item.placementSource === "db"));
  const saved = await api.request(undefined, { body: payload({ row: 10, column: 100 }) });
  assert.equal(saved.status, 200);
  const placed = await sensor();
  assert.equal(placed.id, "126"); assert.equal(placed.sensor_name, "Sensor 126");
  assert.equal(placed.bedengan, "B1"); assert.equal(placed.location, "Nursery test"); assert.equal(placed.status, "Active");
  assert.equal(placed.placementState, "configured");
  assert.deepEqual(placed.placement, { sensorId: saved.body.sensorId, ...saved.body.placement,
    context: saved.body.context, version: saved.body.version, updatedAt: saved.body.updatedAt });
  assert.equal((await sensor("127")).placementState, "unconfigured");
  assert.deepEqual(await db.json(snapshotSql), before);
});

test("bigint IDs and versions round trip through RPC, SQL casts, GET and optimistic updates without Number rounding", async () => {
  const id = "9007199254740993", expectedContext = { location: "Nursery test", bedengan: 60 };
  assert.equal((await api.request(`/api/sensors/${id}/placement`, { body: payload({ expectedContext }) })).status, 200);
  await db.exec(`update public.sensor_placements set version=9007199254740993 where sensor_id=${id}`);
  const current = await sensor(id);
  assert.equal(current.placement.sensorId, id); assert.equal(current.placement.version, "9007199254740993");
  const saved = await api.request(`/api/sensors/${id}/placement`, { body: payload({ row: 10, column: 100,
    expectedContext, expectedVersion: current.placement.version }) });
  assert.equal(saved.status, 200); assert.equal(saved.body.version, "9007199254740994");
  assert.equal((await sensor(id)).placement.version, saved.body.version);
});

test("registry pagination keeps saved positions beyond the first thousand sensors readable", async () => {
  await db.exec(`insert into public.sensors(id,sensor_name,bedengan,location)
    select n,'Pagination fixture '||n,'B1','Nursery test' from generate_series(5001,6005) n`);
  try {
    const saved = await api.request("/api/sensors/6005/placement", { body: payload() });
    assert.equal(saved.status, 200);
    const response = await registry();
    assert.equal(response.status, 200); assert.equal(response.body.length, 1012);
    const placed = response.body.find((item) => item.id === "6005");
    assert.equal(placed.placementState, "configured"); assert.equal(placed.placement.sensorId, "6005");
    assert.equal(placed.placement.version, saved.body.version);
  } finally {
    await db.exec("delete from public.sensor_placements where sensor_id between 5001 and 6005; delete from public.sensors where id between 5001 and 6005");
  }
});

test("JSON remains the default and no enabled write flag or client parameter can bypass read-source readiness", async () => {
  for (const source of [undefined, "json", "", "DB", "unknown"]) {
    if (source === undefined) delete process.env.SENSOR_PLACEMENT_READ_SOURCE;
    else process.env.SENSOR_PLACEMENT_READ_SOURCE = source;
    const response = await api.request("/api/sensors/126/placement?SENSOR_PLACEMENT_READ_SOURCE=db", { body: payload() });
    assert.equal(response.status, 503); assert.equal(response.body.code, "SENSOR_PLACEMENT_READ_NOT_READY");
    if (source === undefined || source === "json") {
      const json = await registry();
      assert.equal(json.status, 200);
      assert.equal(json.body.find((item) => String(item.id) === "126").placement, null);
      assert.ok(json.body.every((item) => !Object.hasOwn(item, "placementState")), "Default JSON shape is preserved");
    }
  }
  assert.equal(writeCalls(), 0); assert.deepEqual(await counts(), [0, 0]);
  process.env.SENSOR_PLACEMENT_READ_SOURCE = "db";
  process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "false";
  assert.equal((await api.request(undefined, { body: payload() })).body.code, "SENSOR_PLACEMENT_WRITE_DISABLED");
  assert.equal(writeCalls(), 0);
});

test("missing table returns unavailable rather than unconfigured or cached/JSON positions and blocks RPC writes", async () => {
  assert.equal((await api.request(undefined, { body: payload() })).status, 200);
  assert.equal((await sensor()).placementState, "configured");
  const previousCalls = writeCalls();
  await db.exec("alter table public.sensor_placements rename to unavailable_placement_fixture");
  try {
    const response = await registry();
    assert.equal(response.status, 200);
    assert.ok(response.body.every((item) => item.placementState === "unavailable" && item.placement === null));
    assert.equal(response.body.find((item) => item.id === "126").status, "Active");
    const save = await api.request(undefined, { body: payload({ row: 2, expectedVersion: "1" }) });
    assert.equal(save.status, 503); assert.equal(save.body.code, "SENSOR_PLACEMENT_READ_NOT_READY");
    assert.equal(writeCalls(), previousCalls);
  } finally { await db.exec("alter table public.unavailable_placement_fixture rename to sensor_placements"); }
  assert.deepEqual(await counts(), [1, 1]);
  assert.equal((await sensor()).placementState, "configured");
});

test("denied placement SELECT and transport outages keep monitoring readable and never invoke the save RPC", async () => {
  await db.exec("revoke select on public.sensor_placements from service_role");
  try {
    assert.equal((await sensor()).placementState, "unavailable");
    assert.equal((await api.request(undefined, { body: payload() })).body.code, "SENSOR_PLACEMENT_READ_NOT_READY");
  } finally { await db.exec("grant select on public.sensor_placements to service_role"); }
  const from = supabase.from;
  supabase.from = (table) => table === "sensor_placements"
    ? { select: () => ({ in: async () => { throw new Error("private network failure"); } }) } : from(table);
  try {
    const response = await registry();
    assert.equal(response.status, 200); assert.ok(response.body.every((item) => item.placementState === "unavailable"));
    assert.ok(!JSON.stringify(response.body).includes("private"));
    assert.equal((await api.request(undefined, { body: payload() })).body.code, "SENSOR_PLACEMENT_READ_NOT_READY");
  } finally { supabase.from = from; }
  assert.equal(writeCalls(), 0); assert.deepEqual(await counts(), [0, 0]);
});

test("invalid coordinates remain constrained in SQL and schema drift is rejected on reads before a save can run", async () => {
  assert.equal((await api.request(undefined, { body: payload() })).status, 200);
  for (const value of [0, 11, 1.5]) {
    await assert.rejects(db.exec(`update public.sensor_placements set row_index=${value} where sensor_id=126`), (error) => error.code === "23514");
  }
  const previousCalls = writeCalls();
  // Drift exists ONLY inside this isolated test transaction, then rolls back.
  await db.exec(`begin; alter table public.sensor_placements drop constraint sensor_placements_row_check;
    update public.sensor_placements set row_index=1.00000000000000000001 where sensor_id=126`);
  try {
    const item = await sensor();
    assert.equal(item.placementState, "invalid"); assert.equal(item.placement, null);
    assert.equal((await api.request(undefined, { body: payload({ row: 2, expectedVersion: "1" }) })).body.code, "SENSOR_PLACEMENT_READ_NOT_READY");
    assert.equal(writeCalls(), previousCalls);
  } finally { await db.exec("rollback"); }
  assert.deepEqual(await counts(), [1, 1]);
});

test("changed registry location/bed hides stale coordinates without moving data; RPC still owns reconciliation", async () => {
  assert.equal((await api.request(undefined, { body: payload() })).status, 200);
  try {
    for (const assignment of ["location='Other nursery'", "location='Nursery test',bedengan='B2'"]) {
      await db.exec(`update public.sensors set ${assignment} where id=126`);
      const item = await sensor();
      assert.equal(item.placementState, "context_mismatch"); assert.equal(item.placement, null);
      const rejected = await api.request(undefined, { body: payload({ expectedVersion: "1" }) });
      assert.equal(rejected.status, 409); assert.equal(rejected.body.code, "SENSOR_CONTEXT_CHANGED");
      assert.deepEqual(await counts(), [1, 1]);
    }
    const repaired = await api.request(undefined, { body: payload({ expectedVersion: "1",
      expectedContext: { location: "Nursery test", bedengan: 2 } }) });
    assert.equal(repaired.status, 200);
    assert.equal((await sensor()).placementState, "configured");
    assert.deepEqual((await sensor()).placement.context, repaired.body.context);
  } finally { await db.exec("update public.sensors set location='Nursery test',bedengan='B1' where id=126"); }
});

test("readiness is not cached and source/flag changes during the probe cannot reach the write RPC", async () => {
  const from = supabase.from;
  for (const [key, value, code] of [["SENSOR_PLACEMENT_READ_SOURCE", "json", "SENSOR_PLACEMENT_READ_NOT_READY"],
    ["SENSOR_PLACEMENT_WRITE_ENABLED", "false", "SENSOR_PLACEMENT_WRITE_DISABLED"]]) {
    process.env.SENSOR_PLACEMENT_READ_SOURCE = "db"; process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "true";
    supabase.from = (table) => {
      const query = from(table);
      if (table !== "sensor_placements") return query;
      const select = query.select;
      query.select = (...args) => {
        const selected = select(...args), filter = selected.in;
        selected.in = async (...values) => {
          const result = await filter(...values); process.env[key] = value; return result;
        };
        return selected;
      };
      return query;
    };
    try { assert.equal((await api.request(undefined, { body: payload() })).body.code, code); }
    finally { supabase.from = from; }
  }
  assert.equal(writeCalls(), 0); assert.deepEqual(await counts(), [0, 0]);
});

test("repeated public polls preserve monitoring, status, pH and session TTL even during placement outages", async () => {
  const expiry = await db.json("select to_jsonb(expires_at) as result from public.global_operator_session");
  for (const unavailable of [false, true]) {
    if (unavailable) await db.exec("alter table public.sensor_placements rename to unavailable_poll_fixture");
    try {
      for (const [age, health] of [[0, "online"], [5, "stale"]]) {
        await db.exec(`update public.sensor_readings set created_at=clock_timestamp()-interval '${age} minutes' where sensor_id=126`);
        for (let poll = 0; poll < 2; poll++) {
          const detail = await api.request("/api/sensors/126/data", { method: "GET", token: null });
          assert.equal(detail.status, 200); assert.equal(detail.body.sensorHealth, health); assert.equal(detail.body.moisture, 55);
          const overview = await api.request("/api/sensors/overview", { method: "GET", token: null });
          assert.equal(overview.status, 200); assert.equal(overview.body.summary.soilPh, 6.4);
          const item = overview.body.sensors.find((entry) => entry.id === "126");
          assert.equal(item.moisture, 55); assert.equal(item.sensorHealth, health); assert.equal(item.status, "Active");
          assert.equal(item.placementState, unavailable ? "unavailable" : "unconfigured");
          for (const path of ["/api/sensors/126/recent-logs", "/api/sensors/ph", "/api/sensors/ph/history", "/api/sensors/moisture-trend"]) {
            assert.equal((await api.request(path, { method: "GET", token: null })).status, 200, path);
          }
        }
      }
    } finally { if (unavailable) await db.exec("alter table public.unavailable_poll_fixture rename to sensor_placements"); }
  }
  await db.exec("delete from public.sensor_readings where sensor_id=126");
  assert.equal((await api.request("/api/sensors/126/data", { method: "GET", token: null })).body.sensorHealth, "offline");
  assert.equal(await db.json("select to_jsonb(expires_at) as result from public.global_operator_session"), expiry);
  assert.equal(writeCalls(), 0);
});
