import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { bootstrapPlacementBase, SQL, PLACEMENT_MIGRATION, optIn, resetSql, payload } from "./support/sensorPlacementDatabase.js";
import { databasePlacementApi } from "./support/sensorPlacementApiFixture.js";
import { placementApiContracts } from "./support/sensorPlacementApiContracts.js";

let pg, db, api;
before(async () => {
  pg = new PGlite(); db = { exec: (sql) => pg.exec(sql), json: async (sql) => (await pg.query(sql)).rows[0].result };
  await bootstrapPlacementBase(db); await db.exec(optIn); await db.exec(await SQL(PLACEMENT_MIGRATION));
  api = await databasePlacementApi(db, { monitoringDatabase: pg });
});
after(async () => { await api?.close(); await pg?.close(); });
beforeEach(async () => {
  await db.exec(resetSql); process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "true";
  process.env.SENSOR_PLACEMENT_READ_SOURCE = "db";
  api.controls.beforeSave = null; api.controls.databaseError = null; api.calls.length = 0;
  await api.login();
});
for (const [name, run] of placementApiContracts) test(`HTTP + PGlite: ${name}`, () => run(db, api));

test("monitoring retains public sensor/pH/IoT behavior and committed placements can be read in DB mode", async () => {
  for (const flag of ["false", "true"]) {
    process.env.SENSOR_PLACEMENT_WRITE_ENABLED = flag;
    for (const path of ["/api/sensors", "/api/sensors/126/data", "/api/sensors/126/recent-logs", "/api/sensors/ph", "/api/sensors/ph/history"]) {
      const response = await api.request(path, { token: null, method: "GET" });
      assert.equal(response.status, 200, path);
    }
    const reading = await api.request("/api/sensors", { method: "POST", token: null,
      body: { sensor1: { kelembaban: 55 }, dht11: { suhu: 28, kelembaban_udara: 72, valid: true } } });
    assert.equal(reading.status, 201);
    const ph = await api.request("/api/sensors/ph", { method: "POST", token: null, body: { soil_ph: 6.4 } });
    assert.equal(ph.status, 201);
  }
  const before = await api.request("/api/sensors/126/data", { method: "GET", token: null });
  assert.equal((await api.request(undefined, { body: payload() })).status, 200);
  const after = await api.request("/api/sensors/126/data", { method: "GET", token: null });
  assert.deepEqual(after.body, before.body);
  const registry = await api.request("/api/sensors", { method: "GET", token: null });
  assert.deepEqual(registry.body.find((s) => s.id === "126").placement, {
    sensorId: "126", row: 1, column: 1, context: payload().expectedContext, version: "1",
    updatedAt: (await api.request(undefined, { body: payload({ expectedVersion: "1" }) })).body.updatedAt,
  });
  assert.equal(await db.json("select count(*)::int as result from public.sensor_placements"), 1);
});
