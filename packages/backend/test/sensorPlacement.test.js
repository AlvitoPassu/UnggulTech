import assert from "node:assert/strict";
import test from "node:test";
import { attachSensorPlacements } from "../src/domain/sensorPlacement.js";
import { getSensors, getSensorData } from "../src/services/sensorService.js";
import { supabase } from "../src/config/supabase.js";
import express from "express";
import sensorRoutes from "../src/routes/sensorRoutes.js";

const sensor = { id: 126, sensor_name: "Sensor terdaftar", location: "Nursery uji", bedengan: "B26", status: "Active" };
const position = { sensorId: 126, location: "Nursery uji", bedengan: 26, row: 10, column: 100 };

test("positions require a real registry identity, matching nursery and bed", () => {
  const result = attachSensorPlacements([sensor, { ...sensor, id: 127 }], [position]);
  assert.deepEqual(result[0].placement, { row: 10, column: 100 });
  assert.equal(result[1].placement, null);
  assert.equal(result[0].id, sensor.id);
  assert.equal(sensor.placement, undefined);
  for (const override of [{ location: "Other nursery" }, { bedengan: 27 }, { location: null }]) {
    assert.equal(attachSensorPlacements([{ ...sensor, ...override }], [position])[0].placement, null);
  }
});

test("invalid, duplicated and colliding positions fail closed", () => {
  for (const override of [{ row: 0 }, { row: 11 }, { column: 101 }, { column: "20" }, { row: 1.2 }, { bedengan: 61 }]) {
    assert.equal(attachSensorPlacements([sensor], [{ ...position, ...override }])[0].placement, null);
  }
  for (const config of [null, {}, [null], [position, position], [position, { ...position, row: 9 }], [position, { ...position, sensorId: 127 }]]) {
    assert.equal(attachSensorPlacements([sensor], config)[0].placement, null);
  }
});

test("all 1000 integer coordinates and corner positions are accepted without changing registry or config", () => {
  for (let row = 1; row <= 10; row++) {
    for (let column = 1; column <= 100; column++) {
      const entry = Object.freeze({ ...position, row, column });
      const result = attachSensorPlacements([Object.freeze({ ...sensor })], Object.freeze([entry]))[0];
      assert.deepEqual(result, { ...sensor, placement: { row, column } });
      assert.deepEqual(entry, { ...position, row, column });
    }
  }
});

test("zero, negative, out-of-range, fractional and nonnumeric coordinates never produce placements", () => {
  for (const field of ["row", "column"]) {
    for (const value of [0, -1, field === "row" ? 11 : 101, 1.5, NaN, Infinity, -Infinity, "1", "1.0", "abc", "1a", "", " ", null, undefined, true, false, [], {}]) {
      assert.equal(attachSensorPlacements([sensor], [{ ...position, [field]: value }])[0].placement, null, `${field}=${String(value)}`);
    }
  }
  const legacy = Object.freeze({ ...position, row: 25, column: 40 });
  assert.equal(attachSensorPlacements([sensor], [legacy])[0].placement, null);
  assert.deepEqual(legacy, { ...position, row: 25, column: 40 });
});

test("same coordinates are permitted in separate beds and nurseries", () => {
  const config = [position, { ...position, sensorId: 127, bedengan: 27 }, { ...position, sensorId: 128, location: "Nursery kedua" }];
  const registry = [sensor, { ...sensor, id: 127, bedengan: 27 }, { ...sensor, id: 128, location: "Nursery kedua" }];
  assert.ok(attachSensorPlacements(registry, config).every((item) => item.placement));
});

test("registry reads preserve old fields and do not fabricate placements or write data", async () => {
  const original = supabase.from;
  supabase.from = (table) => {
    assert.equal(table, "sensors");
    return { select: () => ({ order: async () => ({ data: [sensor], error: null }) }) };
  };
  try { assert.deepEqual(await getSensors(), [{ ...sensor, placement: null }]); }
  finally { supabase.from = original; }
});

test("existing detail API retains Online/Stale/Offline and global pH separation", async () => {
  const original = supabase.from;
  let latest;
  supabase.from = (table) => ({ select: () => {
    if (table === "sensors") return { eq: () => ({ single: async () => ({ data: sensor, error: null }) }) };
    return { eq: () => ({ order: () => ({ limit: () => ({
      maybeSingle: async () => ({ data: latest, error: null }),
      then: (resolve) => resolve({ data: latest ? [latest] : [], error: null }),
    }) }) }) };
  } });
  try {
    for (const [age, health] of [[0, "online"], [4 * 60_000, "stale"], [null, "offline"]]) {
      latest = age === null ? null : { id: 1, moisture: 55, temperature: null, humidity: null, created_at: new Date(Date.now() - age).toISOString() };
      const result = await getSensorData(sensor.id);
      assert.equal(result.sensorHealth, health);
      assert.equal(result.isOnline, health === "online");
      assert.equal(result.moisture, latest ? 55 : null);
      assert.equal(result.lastSeen, latest?.created_at ?? null);
      assert.equal(result.soilPh, undefined);
    }
  } finally { supabase.from = original; }
});

test("public callers cannot modify placement configuration; only gated PUT exists", async () => {
  const originalFlag = process.env.SENSOR_PLACEMENT_WRITE_ENABLED;
  delete process.env.SENSOR_PLACEMENT_WRITE_ENABLED;
  const app = express();
  app.use("/api/sensors", sensorRoutes);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    for (const method of ["PATCH", "PUT", "POST"]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sensors/701/placement`, { method });
      assert.equal(response.status, method === "PUT" ? 503 : 404);
      await response.text();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (originalFlag === undefined) delete process.env.SENSOR_PLACEMENT_WRITE_ENABLED;
    else process.env.SENSOR_PLACEMENT_WRITE_ENABLED = originalFlag;
  }
});
