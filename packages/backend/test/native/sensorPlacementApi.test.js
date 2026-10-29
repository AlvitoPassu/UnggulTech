import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createNativePlacementCluster } from "../support/sensorPlacementNativeDatabase.js";
import { bootstrapPlacementBase, SQL, PLACEMENT_MIGRATION, optIn, resetSql, payload } from "../support/sensorPlacementDatabase.js";
import { databasePlacementApi } from "../support/sensorPlacementApiFixture.js";
import { placementApiContracts } from "../support/sensorPlacementApiContracts.js";

let cluster, db, api;
before(async () => {
  cluster = await createNativePlacementCluster(); db = await cluster.connect();
  console.log(`API native PostgreSQL ${await db.json("select to_jsonb(current_setting('server_version')) as result")}; new cluster ${cluster.folder}`);
  await bootstrapPlacementBase(db, { native: true }); await db.exec(optIn); await db.exec(await SQL(PLACEMENT_MIGRATION));
  api = await databasePlacementApi(db, { connectForRpc: () => cluster.connect() });
});
after(async () => { await api?.close(); await cluster?.close(); });
beforeEach(async () => {
  await db.exec(resetSql); process.env.SENSOR_PLACEMENT_WRITE_ENABLED = "true";
  api.controls.beforeSave = null; api.controls.databaseError = null; api.calls.length = 0;
  await api.login();
});
for (const [name, run] of placementApiContracts) test(`HTTP + native: ${name}`, () => run(db, api));

test("two real HTTP requests wait on independent PostgreSQL backends and only one can create the first position", async () => {
  const observer = await cluster.connect();
  let release, arrived;
  const barrier = new Promise((resolve) => { release = resolve; });
  const bothReady = new Promise((resolve) => { arrived = resolve; });
  let arrivals = 0;
  // Complete middleware first; hold both write connections at the RPC boundary.
  api.controls.beforeSave = async () => { if (++arrivals === 2) arrived(); await barrier; };
  const holder = await db.json("select pg_backend_pid() as result");
  const requests = [api.request(undefined, { body: payload() }), api.request(undefined, { body: payload() })];
  try {
    await Promise.race([bothReady, delay(15000, undefined, { ref: false }).then(() => { throw new Error("Both HTTP requests must reach the write RPC"); })]);
    await db.exec("begin; select * from public.global_operator_session for update");
    release();
    const deadline = Date.now() + 2500;
    // Observe outside the holder transaction so pg_stat_activity has a fresh snapshot.
    // The second waiter may queue behind the first waiter rather than the holder directly.
    const blockedRequests = `with recursive blocked(pid) as (
      select ${holder} union
      select a.pid from pg_stat_activity a join blocked b on b.pid=any(pg_blocking_pids(a.pid))
    ) select (count(*)-1)::int as result from blocked`;
    while (await observer.json(blockedRequests) < 2) {
      assert.ok(Date.now() < deadline, "Two independent requests must really block on the held lock"); await delay(15);
    }
    await db.exec("commit");
    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(responses.find((r) => r.status === 409).body.code, "PLACEMENT_VERSION_CONFLICT");
    const pids = api.calls.filter((call) => call.name === "sensor_placement_save").map((call) => call.pid);
    assert.equal(new Set(pids).size, 2);
    console.log(`Independent write RPC backend PIDs: ${pids.join(', ')}`);
    assert.equal(await db.json("select count(*)::int as result from public.sensor_placements"), 1);
  } finally {
    release(); api.controls.beforeSave = null;
    await db.exec("rollback"); await Promise.allSettled(requests); await observer.close();
  }
});
