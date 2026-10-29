// SQL Editor regression: entire batch via one libpq PQexec, no psql or session approvals.
import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createNativePlacementCluster } from "../support/sensorPlacementNativeDatabase.js";
import { placementContracts } from "../support/sensorPlacementContracts.js";
import { bootstrapPlacementBase, resetSql, acquireSql, saveSql, payload, USER_A, AUTH_A, HASH } from "../support/sensorPlacementDatabase.js";

import { localEditorBatch, assertNoEditorApproval } from "../support/sensorPlacementSqlEditorCandidate.js";

let cluster, db, a, b;
before(async () => {
  cluster = await createNativePlacementCluster();
  db = await cluster.connect(); a = await cluster.connect(); b = await cluster.connect();
  const pids = await Promise.all([db, a, b].map((connection) => connection.json("select pg_backend_pid() as result")));
  assert.equal(new Set(pids).size, 3);
  console.log(`SQL Editor native PostgreSQL ${await db.json("select to_jsonb(current_setting('server_version')) as result")}; PIDs ${pids.join(', ')}; new cluster ${cluster.folder}`);
  await bootstrapPlacementBase(db, { native: true });
  const definitions = "select jsonb_agg(jsonb_build_object('oid',oid,'body',pg_get_functiondef(oid),'acl',proacl,'owner',proowner) order by oid) as result from pg_proc where proname like 'operator_session_%'";
  const authBefore = await db.json(definitions);
  const { sql } = await localEditorBatch(db);
  const started = performance.now(); await db.exec(sql);
  console.log(`SQL Editor full batch completed in ${(performance.now()-started).toFixed(2)} ms`);
  await assertNoEditorApproval(db); await assertNoEditorApproval(a); await assertNoEditorApproval(b);
  assert.deepEqual(await db.json(definitions), authBefore);
  await a.exec("set role service_role"); await b.exec("set role service_role");
});
after(async () => { await cluster?.close(); });
beforeEach(async () => { await db.exec(resetSql); });
for (const [name, run] of placementContracts) test(`native: ${name}`, () => run(db));

async function waitForBlocked(holder, observer = db) {
  const pid = await holder.json("select pg_backend_pid() as result");
  const until = Date.now() + 2500;
  while (Date.now() < until) {
    if (await observer.json(`select to_jsonb(exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)))) as result`)) return;
    await delay(15);
  }
  assert.fail("Independent connection did not block on the expected row lock");
}

test("native concurrent create/update serialize and stale expected versions cannot overwrite", async () => {
  await a.json(acquireSql);
  await a.exec("begin");
  try {
    assert.equal((await a.json(saveSql())).version, "1");
    const pending = b.json(saveSql());
    await waitForBlocked(a); await a.exec("commit");
    assert.equal((await pending).code, "PLACEMENT_VERSION_CONFLICT");
  } finally { await a.exec("rollback"); }
  await a.exec("begin");
  try {
    assert.equal((await a.json(saveSql("126", payload({ row: 2, expectedVersion: "1" })))).version, "2");
    const pending = b.json(saveSql("126", payload({ row: 3, expectedVersion: "1" })));
    await waitForBlocked(a); await a.exec("commit");
    assert.equal((await pending).code, "PLACEMENT_VERSION_CONFLICT");
    assert.equal(await db.json("select row_index as result from public.sensor_placements where sensor_id=126"), 2);
  } finally { await a.exec("rollback"); }
});

test("native two sensors cannot commit the same point, including concurrent transactions", async () => {
  await a.json(acquireSql); await a.exec("begin");
  try {
    assert.equal((await a.json(saveSql())).code, "OK");
    const pending = b.json(saveSql("127"));
    await waitForBlocked(a); await a.exec("commit");
    assert.equal((await pending).code, "PLACEMENT_OCCUPIED");
    assert.equal(await db.json("select count(*)::int as result from public.sensor_placements"), 1);
    assert.equal(await db.json("select count(*)::int as result from public.audit_logs where action='SENSOR_PLACEMENT_SAVE'"), 1);
  } finally { await a.exec("rollback"); }
});

test("native NULL point unique index blocks concurrent insert and RPC reports occupied after winner commits", async () => {
  await db.exec("update public.sensors set location=null where id in (126,127)");
  const body = payload({ expectedContext: { location: null, bedengan: 1 } });
  try {
    await a.json(acquireSql);
    // Owner connection inserts directly to force contention on the partial index,
    // rather than only the RPC's shared session lock.
    await db.exec("begin; insert into public.sensor_placements(sensor_id,location_key,bed_number,row_index,column_index) values(127,null,1,1,1)");
    const pending = a.json(saveSql("126", body));
    await waitForBlocked(db, b); await db.exec("commit");
    assert.equal((await pending).code, "PLACEMENT_OCCUPIED");
    assert.equal(await db.json("select count(*)::int as result from public.sensor_placements"), 1);
    assert.equal(await db.json("select count(*)::int as result from public.audit_logs where action='SENSOR_PLACEMENT_SAVE'"), 0);
  } finally {
    await db.exec("rollback");
    await db.exec("update public.sensors set location='Nursery test' where id in (126,127)");
  }
});

test("native expiry is rechecked after waiting for sensor lock; no save after TTL", async () => {
  await a.json(acquireSql);
  await db.exec("update public.global_operator_session set created_at=clock_timestamp()-interval '10 minutes',last_active_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '650 milliseconds'");
  await db.exec("begin; select * from public.sensors where id=126 for update");
  try {
    const pending = a.json(saveSql());
    await waitForBlocked(db, b); await delay(750); await db.exec("commit");
    assert.equal((await pending).code, "SESSION_TIMEOUT");
    assert.equal(await db.json("select count(*)::int as result from public.sensor_placements"), 0);
  } finally { await db.exec("rollback"); }
});

test("native logout holds singleton lock; a queued save is rejected after release commits", async () => {
  await a.json(acquireSql); await a.exec("begin");
  try {
    await a.json(`select public.operator_session_check('${USER_A}','${AUTH_A}','${HASH}','release') as result`);
    const pending = b.json(saveSql());
    await waitForBlocked(a); await a.exec("commit");
    assert.equal((await pending).code, "SESSION_NOT_FOUND");
    assert.equal(await db.json("select count(*)::int as result from public.sensor_placements"), 0);
  } finally { await a.exec("rollback"); }
});

test("native expiry during a unique-index wait rolls back the completed write AND success audit", async () => {
  await a.json(acquireSql);
  await db.exec("update public.global_operator_session set created_at=clock_timestamp()-interval '10 minutes',last_active_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '650 milliseconds'");
  await db.exec("begin; insert into public.sensor_placements(sensor_id,location_key,bed_number,row_index,column_index) values(127,'Nursery test',1,1,1)");
  try {
    const pending = a.json(saveSql());
    await waitForBlocked(db, b); await delay(750);
    // Vacate the slot after expiry: DML could now succeed unless the RPC rechecks.
    await db.exec("rollback");
    assert.equal((await pending).code, "SESSION_TIMEOUT");
    assert.equal(await db.json("select count(*)::int as result from public.sensor_placements"), 0);
    assert.equal(await db.json("select count(*)::int as result from public.audit_logs where action='SENSOR_PLACEMENT_SAVE'"), 0);
    assert.equal(await db.json("select count(*)::int as result from public.audit_logs where action='SESSION_EXPIRED'"), 1);
  } finally { await db.exec("rollback"); }
});

test("native committed placement is readable from another independent backend", async () => {
  await a.json(acquireSql);
  const first = await a.json(saveSql());
  const reader = await cluster.connect();
  try {
    await reader.exec("set role service_role");
    assert.deepEqual(await reader.json("select jsonb_build_object('row',row_index,'column',column_index,'version',version::text) as result from public.sensor_placements where sensor_id=126"),
      { ...first.placement, version: first.version });
  } finally { await reader.close(); }
});
