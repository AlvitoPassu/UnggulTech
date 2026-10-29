import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { supabase } from "../src/config/supabase.js";
import { getSensorPlacementReadSource } from "../src/config/sensorPlacementRead.js";
import { readSensorPlacements, readPlacementSensorRegistry } from "../src/services/sensorPlacementReadService.js";

const original = { from: supabase.from, source: process.env.SENSOR_PLACEMENT_READ_SOURCE };
const sensor = { id: "126", sensor_name: "Sensor asli", location: "Nursery test", bedengan: "B1", status: "Active" };
const row = { sensor_id: "126", location_key: "Nursery test", bed_number: 1, row_index: "10.00", column_index: "100",
  version: "9007199254740993", updated_at: "2026-10-29T00:00:00.123456+00:00" };
let data, count, calls;
beforeEach(() => {
  process.env.SENSOR_PLACEMENT_READ_SOURCE = "db";
  data = [row]; count = undefined; calls = [];
  supabase.from = (table) => {
    calls.push(table); assert.equal(table, "sensor_placements");
    return { select: (columns, options) => {
      assert.match(columns, /sensor_id::text/); assert.match(columns, /version::text/);
      assert.match(columns, /row_index::text/); assert.equal(options.count, "exact");
      return { in: async (_key, ids) => {
        const selected = data.filter((item) => ids.includes(item.sensor_id));
        return { data: selected, count: count ?? selected.length, error: null };
      } };
    } };
  };
});
after(() => {
  supabase.from = original.from;
  if (original.source === undefined) delete process.env.SENSOR_PLACEMENT_READ_SOURCE;
  else process.env.SENSOR_PLACEMENT_READ_SOURCE = original.source;
});

test("read source defaults to JSON; unknown configuration never selects a fallback", async () => {
  delete process.env.SENSOR_PLACEMENT_READ_SOURCE;
  assert.equal(getSensorPlacementReadSource(), "json");
  assert.deepEqual(await readSensorPlacements([sensor]), [{ ...sensor, placement: null }]);
  assert.deepEqual(calls, []);
  for (const source of ["", "DB", "database", " db ", "unknown"]) {
    process.env.SENSOR_PLACEMENT_READ_SOURCE = source;
    assert.equal(getSensorPlacementReadSource(), "invalid");
    const [result] = await readSensorPlacements([sensor]);
    assert.equal(result.placementState, "unavailable"); assert.equal(result.placement, null);
  }
  assert.deepEqual(calls, []);
});

test("DB positions preserve exact bigint identity/version and only expose public placement fields", async () => {
  data = [{ ...row, updated_by: "private", app_session_hash: "private" }];
  const [result] = await readSensorPlacements([sensor]);
  assert.deepEqual(result, { ...sensor, placementSource: "db", placementState: "configured", placement: {
    sensorId: "126", row: 10, column: 100, context: { location: "Nursery test", bedengan: 1 },
    version: "9007199254740993", updatedAt: "2026-10-29T00:00:00.123Z",
  } });
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("invalid database coordinates, versions, timestamps and context are never rendered as a marker", async () => {
  for (const override of [
    ...["0", "-1", "11", "1.5", "1.00000000000000000001", "NaN", "Infinity", "abc", "", null, true, 1].map((row_index) => ({ row_index })),
    ...["0", "101", "1.5"].map((column_index) => ({ column_index })),
    { version: 1 }, { version: "0" }, { version: "9223372036854775808" }, { updated_at: "broken" },
    { location_key: " " }, { location_key: " Nursery test" }, { bed_number: 61 },
  ]) {
    data = [{ ...row, ...override }];
    const [result] = await readSensorPlacements([sensor]);
    assert.equal(result.placement, null, JSON.stringify(override)); assert.equal(result.placementState, "invalid");
  }
});

test("context normalization matches registry without merging distinct locations or guessing beds", async () => {
  for (const bedengan of ["1", "B1", "Bedengan 1", "\u00a0B1\ufeff"]) {
    const [result] = await readSensorPlacements([{ ...sensor, bedengan, location: "\u00a0Nursery test\ufeff" }]);
    assert.equal(result.placementState, "configured");
  }
  for (const override of [{ location: "nursery test" }, { location: "Other" }, { location: null }, { bedengan: "B2" }, { bedengan: "1x" }]) {
    const [result] = await readSensorPlacements([{ ...sensor, ...override }]);
    assert.equal(result.placementState, "context_mismatch"); assert.equal(result.placement, null);
  }
});

test("NULL database context survives reads, detects transitions and rejects missing or colliding NULL contexts", async () => {
  data = [{ ...row, location_key: null }];
  const nullable = { ...sensor, location: null };
  const [result] = await readSensorPlacements([nullable]);
  assert.equal(result.placementState, "configured");
  assert.equal(result.location, null); assert.equal(result.placement.context.location, null);
  for (const location of [undefined, "", " ", "null", "Nursery test", false, 0, [], {}]) {
    assert.equal((await readSensorPlacements([{ ...sensor, location }]))[0].placementState, "context_mismatch");
  }
  data = [{ ...row, location_key: undefined }];
  assert.equal((await readSensorPlacements([nullable]))[0].placementState, "invalid");
  data = [{ ...row, location_key: null }, { ...row, sensor_id: "127", location_key: null }];
  assert.ok((await readSensorPlacements([nullable, { ...nullable, id: "127" }])).every(s => s.placementState === "invalid"));
  data[1] = { ...data[1], bed_number: 2 };
  assert.ok((await readSensorPlacements([nullable, { ...nullable, id: "127", bedengan: "B2" }])).every(s => s.placementState === "configured"));
});

test("duplicate identities and occupied points fail closed even with a malformed DB response", async () => {
  for (const rows of [[row, row], [row, { ...row, sensor_id: "127" }]]) {
    data = rows;
    const results = await readSensorPlacements([sensor, { ...sensor, id: "127" }]);
    assert.equal(results[0].placementState, "invalid"); assert.equal(results[0].placement, null);
  }
});

test("truncated, malformed, rejected and thrown database responses stay unavailable with no cached coordinates", async () => {
  assert.equal((await readSensorPlacements([sensor]))[0].placementState, "configured");
  for (const response of [{ data: [], count: 1 }, { data: [row] }, { data: null, count: 0 },
    { data: [{ ...row, sensor_id: "999" }], count: 1 }, { error: { message: "private", code: "42501" } }]) {
    supabase.from = () => ({ select: () => ({ in: async () => response }) });
    const [result] = await readSensorPlacements([sensor]);
    assert.equal(result.placementState, "unavailable"); assert.equal(result.placement, null);
    assert.ok(!JSON.stringify(result).includes("private"));
  }
  supabase.from = () => { throw new Error("private"); };
  assert.equal((await readSensorPlacements([sensor]))[0].placementState, "unavailable");
});

test("DB batching reads every actual identity without manufacturing positions or accepting rounded bigint IDs", async () => {
  data = [];
  const sensors = Array.from({ length: 205 }, (_, index) => ({ ...sensor, id: String(index + 1) }));
  const results = await readSensorPlacements(sensors);
  assert.equal(calls.length, 3);
  assert.ok(results.every((result) => result.placementState === "unconfigured" && result.placement === null));
  const [unsafe] = await readSensorPlacements([{ ...sensor, id: 9007199254740993 }]);
  assert.equal(unsafe.placementState, "unavailable");
});

test("registry pagination handles server row caps and rejects incomplete or overlapping pages", async () => {
  const sensors = Array.from({ length: 1005 }, (_, index) => ({ ...sensor, id: String(index + 1) }));
  let reads = 0;
  supabase.from = () => ({ select: () => ({ order: () => ({ range: async (start) => {
    reads++; return { data: sensors.slice(start, start + 100), count: sensors.length, error: null };
  } }) }) });
  assert.deepEqual(await readPlacementSensorRegistry(), sensors);
  assert.equal(reads, 11);
  for (const data of [[], [sensors[0]]]) {
    supabase.from = () => ({ select: () => ({ order: () => ({ range: async () => ({ data, count: 1005, error: null }) }) }) });
    await assert.rejects(readPlacementSensorRegistry());
  }
});
