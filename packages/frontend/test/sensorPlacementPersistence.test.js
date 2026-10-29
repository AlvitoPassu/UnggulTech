import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { saveSensorPlacement } from "../src/api/sensorApi.js";
import { placementPayload, placementWriteBasis, validatePlacementResult, SensorPlacementRegistry } from "../src/components/Sensor/sensorPlacementPersistence.js";

const sensor = { id: "9007199254740993", sensor_name: "Sensor asli", location: "Lokasi uji", bedengan: "B6",
  placementSource: "db", placementState: "unconfigured", placement: null };
const values = { row: "5", column: "75" };
const resultFor = (payload, overrides = {}) => ({ code: "OK", sensorId: sensor.id, placement: { row: payload.row, column: payload.column },
  context: payload.expectedContext, version: payload.expectedVersion === null ? "1" : String(BigInt(payload.expectedVersion) + 1n),
  updatedAt: "2026-10-29T00:00:00.123Z", unchanged: false, ...overrides });
const placed = (result) => ({ ...sensor, placementState: "configured", placement: { sensorId: sensor.id, ...result.placement,
  context: result.context, version: result.version, updatedAt: result.updatedAt } });
const rejection = (status, code) => Object.assign(new Error("Synthetic error"), { response: { status, data: { code } } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const setup = async (options = {}) => {
  let server = [sensor], writes = 0, reads = 0;
  const registry = new SensorPlacementRegistry({ read: async () => { reads++; return server; }, write: async (id, payload) => {
    writes++; assert.equal(id, sensor.id); const result = resultFor(payload); server = [placed(result)]; return result;
  }, ...options });
  registry.activate(); await registry.refresh();
  return { registry, get writes() { return writes; }, get reads() { return reads; }, setServer: (value) => { server = value; } };
};

test("first placement uses null version and verified metadata; updates preserve bigint versions as strings", () => {
  assert.deepEqual(placementPayload(sensor, values), { row: 5, column: 75, expectedVersion: null,
    expectedContext: { location: "Lokasi uji", bedengan: 6 } });
  const result = resultFor(placementPayload(sensor, values), { version: "9007199254740993" });
  assert.equal(placementPayload(placed(result), values).expectedVersion, "9007199254740993");
});

test("NULL payload, confirmed result, refresh and no-op preserve explicit context and version", async () => {
  let current = { ...sensor, location: null };
  const registry = new SensorPlacementRegistry({ read: async () => [current], write: async (id, payload) => {
    assert.equal(payload.expectedContext.location, null);
    const result = validatePlacementResult(resultFor(payload), id, payload);
    current = { ...placed(result), location: null };
    return result;
  } });
  registry.activate(); await registry.refresh();
  const payload = placementPayload(current, values);
  assert.deepEqual(payload.expectedContext, { location: null, bedengan: 6 });
  assert.match(JSON.stringify(payload), /"location":null/);
  await registry.save(current.id, payload);
  assert.equal(registry.view.operations[current.id].state, "success");
  await registry.refresh();
  assert.equal(placementWriteBasis(registry.view.sensors[0]).expectedVersion, "1");
  const noopPayload = placementPayload(current, values);
  assert.equal(validatePlacementResult(resultFor(noopPayload, { version: "1", unchanged: true }), current.id, noopPayload).context.location, null);
  for (const location of [undefined, "", " \t", 1, true, [], {}]) assert.equal(placementPayload({ ...sensor, location }, values), null);
  for (const location of [undefined, "", "null", "Other"]) {
    assert.equal(placementWriteBasis({ ...current, placement: { ...current.placement, context: { location, bedengan: 6 } } }), null);
    assert.throws(() => validatePlacementResult(resultFor(payload, { context: { location, bedengan: 6 } }), current.id, payload));
  }
  assert.equal(placementPayload({ ...sensor, location: "null" }, values).expectedContext.location, "null");
});

test("JSON, invalid/unavailable/context mismatch, fake IDs and mismatched metadata cannot construct a save", () => {
  const valid = placed(resultFor(placementPayload(sensor, values)));
  for (const override of [{ placementSource: "json" }, { placementSource: undefined }, { placementState: "invalid" },
    { placementState: "unavailable" }, { placementState: "context_mismatch" }, { location: "Other" }, { bedengan: "6x" },
    { id: Number("9007199254740993") }, { id: "0" }, { placement: { ...valid.placement, sensorId: "1" } },
    { placement: { ...valid.placement, version: 1 } }]) {
    assert.equal(placementWriteBasis({ ...valid, ...override }), null, JSON.stringify(override));
  }
});

test("all valid coordinates construct number payloads; invalid drafts never construct a save", () => {
  for (let row = 1; row <= 10; row++) for (let column = 1; column <= 100; column++) {
    assert.equal(placementPayload(sensor, { row: String(row), column: String(column) }).row, row);
  }
  for (const value of ["", "0", "-1", "11", "1.5", "1.0", "1e0", "abc", true, 1, null]) {
    assert.equal(placementPayload(sensor, { ...values, row: value }), null);
  }
});

test("success validation requires matching identity/coordinates/context/version and never accepts malformed success", () => {
  const payload = placementPayload(sensor, values), result = resultFor(payload);
  assert.equal(validatePlacementResult(result, sensor.id, payload).version, "1");
  for (const override of [{ code: "OTHER" }, { sensorId: "1" }, { placement: { row: "5", column: 75 } },
    { placement: { row: 6, column: 75 } }, { context: { location: "Other", bedengan: 6 } }, { version: 1 },
    { version: "2" }, { updatedAt: "broken" }, { unchanged: true }]) {
    assert.throws(() => validatePlacementResult({ ...result, ...override }, sensor.id, payload), { code: "PLACEMENT_RESULT_UNCERTAIN" });
  }
  const update = { ...payload, expectedVersion: "9007199254740993" };
  assert.equal(validatePlacementResult(resultFor(update), sensor.id, update).version, "9007199254740994");
  assert.equal(validatePlacementResult(resultFor(update, { version: update.expectedVersion, unchanged: true }), sensor.id, update).version, update.expectedVersion);
});

test("API uses the existing PUT with timeout and returns only a validated HTTP 200 result", async () => {
  const adapter = axios.defaults.adapter, payload = placementPayload(sensor, values);
  try {
    axios.defaults.adapter = async (config) => {
      assert.equal(config.method, "put"); assert.equal(config.url, `/api/sensors/${sensor.id}/placement`);
      assert.equal(config.timeout, 10_000); assert.deepEqual(JSON.parse(config.data), payload);
      return { status: 200, data: resultFor(payload), config, headers: {} };
    };
    assert.equal((await saveSensorPlacement(sensor.id, payload)).version, "1");
    axios.defaults.adapter = async () => ({ status: 200, data: { code: "OK" } });
    await assert.rejects(saveSensorPlacement(sensor.id, payload), { code: "PLACEMENT_RESULT_UNCERTAIN" });
  } finally { axios.defaults.adapter = adapter; }
});

test("confirmed writes update the marker immediately, refresh GET, and survive simulated page reload", async () => {
  const fixture = await setup(), payload = placementPayload(sensor, values);
  await fixture.registry.save(sensor.id, payload);
  assert.equal(fixture.writes, 1); assert.equal(fixture.reads, 2);
  assert.equal(fixture.registry.view.sensors[0].placement.row, 5);
  assert.equal(fixture.registry.view.operations[sensor.id].state, "success");
  const reloaded = await setup({ read: async () => fixture.registry.view.sensors });
  assert.equal(reloaded.registry.view.sensors[0].placement.version, "1");
});

test("duplicate clicks are locked synchronously and old GET responses cannot undo a committed position", async () => {
  const write = deferred(), oldRead = deferred();
  const fixture = await setup({ write: async () => write.promise });
  fixture.registry.read = () => oldRead.promise;
  const poll = fixture.registry.refresh(), payload = placementPayload(sensor, values);
  const saving = fixture.registry.save(sensor.id, payload);
  await assert.rejects(fixture.registry.save(sensor.id, payload));
  const result = resultFor(payload);
  fixture.registry.read = async () => [placed(result)];
  write.resolve(result); await saving;
  oldRead.resolve([sensor]); await poll;
  assert.equal(fixture.registry.view.sensors[0].placement.version, "1");
  assert.equal(fixture.registry.view.sensors[0].placement.row, 5);
});

test("older-version reads retain the latest confirmed marker and block saves until reads catch up", async () => {
  const fixture = await setup(), payload = placementPayload(sensor, values);
  await fixture.registry.save(sensor.id, payload);
  const newerPayload = { ...payload, row: 6, expectedVersion: "1" };
  await fixture.registry.save(sensor.id, newerPayload);
  fixture.setServer([placed(resultFor(payload))]); await fixture.registry.refresh();
  assert.equal(fixture.registry.view.sensors[0].placement.version, "2");
  assert.equal(fixture.registry.view.sensors[0].placement.row, 6);
  assert.equal(fixture.registry.view.sensors[0].placementState, "unavailable");
  await assert.rejects(fixture.registry.save(sensor.id, newerPayload));
});

test("a delayed PUT response cannot regress a newer version already observed through GET", async () => {
  const payload = placementPayload(sensor, values), write = deferred();
  let server = [placed(resultFor(payload))];
  const fixture = await setup({ read: async () => server, write: async () => write.promise });
  const updating = fixture.registry.save(sensor.id, { ...payload, expectedVersion: "1" });
  server = [placed(resultFor(payload, { version: "3", placement: { row: 7, column: 80 } }))];
  await fixture.registry.refresh();
  const observed = [];
  fixture.registry.subscribe((view) => observed.push(view.sensors[0].placement.version));
  write.resolve(resultFor(payload, { version: "2" })); await updating;
  assert.ok(observed.every((version) => version === "3"));
  assert.equal(fixture.registry.view.sensors[0].placement.row, 7);
});

test("a timeout that committed on the server triggers GET reconciliation and never repeats PUT or claims success", async () => {
  let writes = 0, server = [sensor];
  const fixture = await setup({ read: async () => server, write: async (_id, payload) => {
    writes++; server = [placed(resultFor(payload))]; throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
  } });
  await assert.rejects(fixture.registry.save(sensor.id, placementPayload(sensor, values)));
  assert.equal(writes, 1); assert.equal(fixture.registry.view.sensors[0].placement.version, "1");
  assert.equal(fixture.registry.view.operations[sensor.id].state, "warning");
  assert.match(fixture.registry.view.operations[sensor.id].message, /belum pasti/);
});

test("uncertain results with failed reconciliation block retries until an explicit successful GET", async () => {
  const fixture = await setup({ write: async () => { throw new Error("network"); } });
  fixture.registry.read = async () => { throw new Error("read outage"); };
  const payload = placementPayload(sensor, values);
  await assert.rejects(fixture.registry.save(sensor.id, payload));
  assert.equal(fixture.registry.view.operations[sensor.id].state, "needs_read");
  await assert.rejects(fixture.registry.save(sensor.id, payload));
  fixture.registry.read = async () => [sensor]; await fixture.registry.refresh();
  assert.equal(fixture.registry.view.operations[sensor.id].state, "warning");
});

test("known rejection codes never report success and 409 refreshes to the latest server version", async () => {
  for (const [status, code] of [[400, "INVALID_PLACEMENT"], [401, "SESSION_TIMEOUT"], [403, "PLACEMENT_ACCESS_DENIED"],
    [404, "SENSOR_NOT_FOUND"], [503, "SENSOR_PLACEMENT_WRITE_DISABLED"], [503, "SENSOR_PLACEMENT_READ_NOT_READY"]]) {
    const fixture = await setup({ write: async () => { throw rejection(status, code); } });
    await assert.rejects(fixture.registry.save(sensor.id, placementPayload(sensor, values)));
    assert.equal(fixture.registry.view.operations[sensor.id].state, "error");
    assert.equal(fixture.registry.view.sensors[0].placement, null);
  }
  const fixture = await setup({ write: async () => { throw rejection(409, "PLACEMENT_VERSION_CONFLICT"); } });
  fixture.setServer([placed(resultFor(placementPayload(sensor, values), { version: "2", placement: { row: 7, column: 80 } }))]);
  await assert.rejects(fixture.registry.save(sensor.id, placementPayload(sensor, values)));
  assert.equal(fixture.registry.view.sensors[0].placement.version, "2");
  assert.equal(fixture.registry.view.sensors[0].placement.row, 7);
});

test("confirmed commit with refresh failure retains the marker and requires a read before another write", async () => {
  const fixture = await setup(); fixture.registry.read = async () => { throw new Error("read outage"); };
  await fixture.registry.save(sensor.id, placementPayload(sensor, values));
  assert.equal(fixture.registry.view.sensors[0].placement.row, 5);
  assert.equal(fixture.registry.view.operations[sensor.id].confirmed, true);
  await assert.rejects(fixture.registry.save(sensor.id, placementPayload(fixture.registry.view.sensors[0], values)));
});

test("late responses after page unmount do not publish; malformed/JSON payloads never invoke the writer", async () => {
  const write = deferred(), fixture = await setup({ write: async () => write.promise });
  const payload = placementPayload(sensor, values), saving = fixture.registry.save(sensor.id, payload);
  fixture.registry.deactivate(); const before = fixture.registry.view;
  write.resolve(resultFor(payload)); await saving;
  assert.equal(fixture.registry.view, before);
  const fresh = await setup();
  await assert.rejects(fresh.registry.save(sensor.id, { ...payload, row: "5" }));
  fresh.setServer([{ ...sensor, placementSource: "json" }]); await fresh.registry.refresh();
  await assert.rejects(fresh.registry.save(sensor.id, payload));
  assert.equal(fresh.writes, 0);
});
