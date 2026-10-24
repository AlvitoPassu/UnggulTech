import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { operatorFixtureSql, USER_A, AUTH_A, AUTH_A2 } from "../support/operatorDatabase.js";
import { syntheticTriggerFixtureSql, syntheticTriggerInventory, triggerInventorySql,
  triggerEvidenceSql, triggerSnapshotSql, assertTriggerGuardFailsClosed,
  maliciousTriggerBodies, assertMaliciousStorageTriggerRejected } from "../support/syntheticTriggerFixture.js";
import { syntheticStorageOnlyFixtureSql, assertSyntheticStorageMigration,
  assertSyntheticStorageAttacksRejected, syntheticStorageHardeningSql } from "../support/syntheticStorageFixture.js";

// No existing server, URL, password or database name can be supplied. Always
// initialize a new disposable native cluster bound only to 127.0.0.1.
assert.ok(process.env.UNGGUL_TEST_PG_BIN, "Set UNGGUL_TEST_PG_BIN to native PostgreSQL bin directory; no remote database is accepted");
const bin = resolve(process.env.UNGGUL_TEST_PG_BIN);
const executable = name => join(bin, name + (process.platform === "win32" ? ".exe" : ""));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("PG")));
const run = (name, args) => promisify(execFile)(executable(name), args, { env, windowsHide: true, timeout: 30_000 });
const readSql = name => readFile(new URL(`../../database/${name}`, import.meta.url), "utf8");
const connections = new Set();
let folder, port, started = false, a, b, observer;

class Connection {
  constructor() {
    this.pending = [];
    this.ready = new Promise((resolveReady, reject) => { this.resolveReady = resolveReady; this.rejectReady = reject; });
    this.child = spawn(process.env.UNGGUL_TEST_PYTHON || "python", [
      fileURLToPath(new URL("../support/nativePostgresClient.py", import.meta.url)), bin, String(port),
    ], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.stderr = "";
    this.child.stderr.on("data", chunk => { this.stderr += chunk; });
    this.child.on("error", error => this.fail(error));
    this.child.on("exit", code => this.fail(new Error(`Native client exited (${code}): ${this.stderr}`)));
    createInterface({ input: this.child.stdout }).on("line", line => {
      const value = JSON.parse(line);
      if (value.ready) return this.resolveReady();
      const pending = this.pending.shift();
      if (value.error) pending.reject(Object.assign(new Error(value.error), { code: value.code }));
      else pending.resolve(value.rows);
    });
    connections.add(this);
  }
  fail(error) { this.rejectReady(error); for (const item of this.pending.splice(0)) item.reject(error); }
  async exec(sql) {
    await this.ready;
    return new Promise((resolveQuery, reject) => {
      this.pending.push({ resolve: resolveQuery, reject });
      this.child.stdin.write(JSON.stringify({ sql }) + "\n");
    });
  }
  async json(sql) { return JSON.parse((await this.exec(sql))[0].result); }
  close() { this.child.stdin.end(); connections.delete(this); }
}
const acquire = (auth = AUTH_A, hash = "a".repeat(64)) =>
  `select public.operator_session_acquire('${USER_A}','${auth}','${hash}') as result`;
const check = (operation = "validate", auth = AUTH_A, hash = "a".repeat(64)) =>
  `select public.operator_session_check('${USER_A}','${auth}','${hash}','${operation}') as result`;
const extend = revision => `select public.operator_session_extend('${USER_A}','${AUTH_A}','${"a".repeat(64)}',${revision},clock_timestamp()) as result`;
const slot = () => observer.json("select row_to_json(s) as result from public.global_operator_session s");
const waitForLock = async pid => {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const waiting = await observer.exec(`select pid from pg_stat_activity where ${Number(pid)}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`);
    if (waiting.length) return;
    await delay(15);
  }
  assert.fail("Expected an independent backend to block on the singleton row lock");
};

before(async () => {
  folder = await mkdtemp(join(tmpdir(), "unggul-native-regression-"));
  const listener = createServer();
  await new Promise(done => listener.listen(0, "127.0.0.1", done));
  port = listener.address().port;
  await new Promise(done => listener.close(done));
  await run("initdb", ["-D", join(folder, "data"), "-U", "postgres", "-A", "trust", "--encoding=UTF8", "--no-locale"]);
  await run("pg_ctl", ["-D", join(folder, "data"), "-l", join(folder, "server.log"), "-o", `-h 127.0.0.1 -p ${port} -F`, "-w", "start"]);
  started = true;
  a = new Connection(); b = new Connection(); observer = new Connection();
  await Promise.all([a.ready, b.ready, observer.ready]);
  const pids = await Promise.all([a, b, observer].map(async client => (await client.exec("select pg_backend_pid() as pid"))[0].pid));
  assert.equal(new Set(pids).size, 3);
  console.log(`Native PostgreSQL: ${(await observer.exec("show server_version"))[0].server_version}; independent backend PIDs: ${pids.join(", ")}; temp cluster: ${folder}`);
  await observer.exec(operatorFixtureSql);
  await observer.exec(`create table public.sensor_probe(id int primary key,value int);
    insert into public.sensor_probe values(1,55); grant select on public.sensor_probe to anon,authenticated;
    grant insert on public.sensor_probe to service_role;`);
  for (const file of ["20261008_01_global_operator_session.sql", "20261008_02_operator_write_permissions.sql", "20261010_03_operator_activity_revision.sql"]) {
    await observer.exec(await readSql(file));
    console.log(`Native migration PASS: ${file}`);
  }
  await a.exec("set role service_role"); await b.exec("set role service_role");
});
after(async () => {
  for (const client of [...connections]) client.close();
  if (started) await run("pg_ctl", ["-D", join(folder, "data"), "-m", "fast", "-w", "stop"]);
});
beforeEach(async () => {
  await observer.exec(`update public.global_operator_session set user_id=null,auth_session_id=null,app_session_hash=null,
    created_at=null,last_active_at=null,expires_at=null,expiry_reported=false,last_activity_revision=0;
    delete from public.operator_session_admissions; delete from public.audit_logs;`);
});

test("native 01 -> 02 -> 03 preserves public reads, blocks direct writes and protects RPCs", async () => {
  await observer.exec("set role anon");
  try {
    assert.equal((await observer.exec("select notes from public.rainfall_readings"))[0].notes, "historical data");
    for (const sql of ["insert into public.rainfall_readings values(2,99,'bypass')", "update public.rainfall_readings set notes='bypass'",
      "delete from public.rainfall_readings", "truncate public.rainfall_readings", acquire()]) {
      await assert.rejects(observer.exec(sql), error => error.code === "42501");
    }
  } finally { await observer.exec("reset role"); }
  assert.equal((await a.json(acquire())).code, "OK");
  assert.equal(new Date((await slot()).expires_at) - new Date((await slot()).last_active_at), 600_000);
});

test("native independent connections: B really waits for uncommitted A, then sees GLOBAL_SESSION_BUSY", async () => {
  await a.exec("begin");
  try {
    assert.equal((await a.json(acquire())).created, true);
    const pid = (await a.exec("select pg_backend_pid() as pid"))[0].pid;
    const pending = b.json(acquire(AUTH_A2, "b".repeat(64)));
    await waitForLock(pid);
    await a.exec("commit");
    assert.equal((await pending).code, "GLOBAL_SESSION_BUSY");
    assert.equal((await a.json(acquire())).created, false);
    assert.equal((await observer.exec("select count(*) as n from public.operator_session_admissions"))[0].n, "1");
  } finally { await a.exec("rollback"); }
});

test("native ten simultaneous same-account contenders produce exactly one admission and login audit", async () => {
  const contenders = Array.from({ length: 10 }, () => new Connection());
  try {
    await Promise.all(contenders.map(client => client.exec("set role service_role")));
    const result = await Promise.all(contenders.map(client => client.json(acquire(randomUUID()))));
    assert.equal(result.filter(value => value.code === "OK").length, 1);
    assert.equal(result.filter(value => value.code === "GLOBAL_SESSION_BUSY").length, 9);
    assert.equal((await observer.exec("select count(*) as n from public.audit_logs where action='LOGIN_SUCCESS'"))[0].n, "1");
  } finally { contenders.forEach(client => client.close()); }
});

test("native admission evaluates expiry after waiting for a lock, rather than transaction start", async () => {
  await a.json(acquire());
  await observer.exec(`update public.global_operator_session set created_at=clock_timestamp()-interval '11 minutes',
    last_active_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()+interval '700 milliseconds'`);
  await observer.exec("begin; select * from public.global_operator_session for update");
  try {
    const pid = (await observer.exec("select pg_backend_pid() as pid"))[0].pid;
    const pending = b.json(acquire(AUTH_A2, "b".repeat(64)));
    // Use a third connection to observe the wait while observer owns the lock.
    const until = Date.now() + 5000;
    while (!(await a.exec(`select pid from pg_stat_activity where ${Number(pid)}=any(pg_blocking_pids(pid))`)).length) {
      assert.ok(Date.now() < until); await delay(15);
    }
    await delay(800);
    await observer.exec("commit");
    assert.equal((await pending).code, "OK");
    assert.equal((await slot()).auth_session_id, AUTH_A2);
    assert.equal((await a.json(check())).code, "SESSION_MISMATCH");
  } finally { await observer.exec("rollback"); }
});

test("native concurrent/reordered activity revisions cannot repeatedly extend expiry", async () => {
  await a.json(acquire());
  await a.exec("begin");
  try {
    const first = await a.json(extend(2));
    const pid = (await a.exec("select pg_backend_pid() as pid"))[0].pid;
    const pending = b.json(extend(1));
    await waitForLock(pid); await a.exec("commit");
    const reordered = await pending;
    assert.equal(reordered.duplicate, true);assert.equal(reordered.expiresAt, first.expiresAt);
    const retry = await b.json(extend(2));
    assert.equal(retry.duplicate, true);assert.equal(retry.expiresAt, first.expiresAt);
  } finally { await a.exec("rollback"); }
});

test("native logout and competing admission serialize; retired credentials cannot release the new owner", async () => {
  await a.json(acquire()); await a.exec("begin");
  try {
    assert.equal((await a.json(check("release"))).released, true);
    const pid = (await a.exec("select pg_backend_pid() as pid"))[0].pid;
    const pending = b.json(acquire(AUTH_A2, "b".repeat(64)));
    await waitForLock(pid); await a.exec("commit");
    assert.equal((await pending).created, true);
    assert.equal((await a.json(check("release"))).code, "SESSION_MISMATCH");
    assert.equal((await a.json(acquire())).code, "SESSION_TIMEOUT");
  } finally { await a.exec("rollback"); }
});

test("native emergency shutdown denies inherited and owner EXECUTE; recovery preserves sensor data and hardened ACL", async () => {
  await observer.exec(`create role native_executor; grant native_executor to service_role;
    grant execute on function public.operator_session_acquire(uuid,uuid,text),
      public.operator_session_check(uuid,uuid,text,text),
      public.operator_session_extend(uuid,uuid,text,bigint,timestamptz) to native_executor;`);
  await a.json(acquire()); const original = await slot();
  const definitions = () => observer.json(`select json_agg(t order by oid) as result from
    (select oid,proacl::text,pg_get_functiondef(oid) as body from pg_proc where proname like 'operator_session_%') t`);
  const expected = await definitions();
  await observer.exec(await readSql("20261008_global_session_rollback.sql"));
  for (const client of [a, observer]) for (const sql of [acquire(), check(), extend(1)]) {
    await assert.rejects(client.exec(sql), error => error.code === "55000");
  }
  assert.deepEqual(await slot(), original);
  await observer.exec("set role service_role; insert into public.sensor_probe values(2,60); reset role");
  await observer.exec(await readSql("20261008_global_session_recovery.sql"));
  assert.deepEqual(await definitions(), expected);
  assert.equal((await a.json(check())).code, "OK");
  assert.equal((await observer.exec("select count(*) as n from public.sensor_probe"))[0].n, "2");
  assert.equal((await observer.exec("select has_table_privilege('anon','public.rainfall_readings','INSERT,UPDATE,DELETE,TRUNCATE') as allowed"))[0].allowed, "f");
});

test("native production-shaped 10-trigger fixture stays fail-closed, including malicious Storage bodies", async () => {
  // All Storage objects here are synthetic, inside this fresh loopback cluster.
  // These bodies are not production source and cannot approve an exemption.
  const adapter = { exec: sql => observer.exec(sql), query: async sql => ({ rows: (await observer.exec(sql)).map(row =>
    Object.fromEntries(Object.entries(row).map(([key,value]) => [key,
      ["result","details"].includes(key) && value !== null ? JSON.parse(value) : value]))) }) };
  await observer.exec(syntheticTriggerFixtureSql);
  try {
    const inventory = (await observer.exec(triggerInventorySql)).map(r => ({ ...r, type: Number(r.type), definer: r.definer === "f" ? false : true }));
    assert.deepEqual(inventory,[...syntheticTriggerInventory].sort((a,b) => a.name.localeCompare(b.name)));
    await assertTriggerGuardFailsClosed(adapter);
    const baseline = (await adapter.query(triggerSnapshotSql)).rows;
    await observer.exec("begin read only");
    const evidence = (await adapter.query(triggerEvidenceSql)).rows;
    await observer.exec("rollback");
    assert.equal(evidence.find(r => r.section === "environment").details.noninternal_root_trigger_count,10);
    assert.ok(evidence.some(r => r.section === "routine" && r.details.signature === "storage.protect_delete()" && r.details.prosrc));
    assert.deepEqual((await adapter.query(triggerSnapshotSql)).rows,baseline);
    for (const [,body] of maliciousTriggerBodies) await assertMaliciousStorageTriggerRejected(adapter,body);
    for (const role of ["anon","authenticated"]) {
      await observer.exec(`set role ${role}`);
      try {
        assert.equal((await observer.exec("select notes from public.rainfall_readings"))[0].notes,"historical data");
        for (const sql of ["insert into public.rainfall_readings(id) values(987)",
          "update public.rainfall_readings set notes='attack'", "delete from public.rainfall_readings", "truncate public.rainfall_readings"]) {
          await assert.rejects(observer.exec(sql),error => error.code === "42501");
        }
      } finally { await observer.exec("reset role"); }
    }
    // The changed Storage trigger is on objects only; service-role rainfall and
    // sensor ingestion must continue to work, without touching Storage rows.
    await observer.exec(`set role service_role;
      insert into public.rainfall_readings(id,notes) values(2,'service probe');
      update public.rainfall_readings set rainfall_value=12 where id=2;
      delete from public.rainfall_readings where id=2;
      insert into public.sensors(id) values(2); reset role;`);
  } finally {
    await observer.exec(`rollback; reset role; drop schema storage cascade;
      drop table public.profiles,public.sensors;
      drop trigger set_rainfall_readings_updated_at on public.rainfall_readings;
      drop function public.set_updated_at();
      alter table public.rainfall_readings drop column updated_at; drop role supabase_storage_admin;`);
  }
});

test("native repository schema with synthetic Storage exercises test-adapted 02 and preserves sensor_logs writable view", async () => {
  // Only the fresh cluster initialized by this harness is reachable. Rebuild its
  // fixture using repository SQL, including real constraints, triggers and view.
  await observer.exec(`drop schema public cascade; drop schema auth cascade;
    create schema public; create schema auth; create schema extensions;
    grant usage on schema public to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);`);
  await observer.exec(await readFile(new URL("../support/supabaseAuthFunctions.sql",import.meta.url),"utf8"));
  await observer.exec(await readSql("schema.sql"));
  await observer.exec(await readSql("auth_and_audit.sql"));
  await observer.exec(`grant select on public.rainfall_readings,public.sensors,public.sensor_readings,public.sensor_logs,public.soil_ph_readings to anon,authenticated;
    grant all on all tables in schema public to service_role;
    grant usage,select on all sequences in schema public to service_role;
    insert into auth.users(id,email) values('${USER_A}','operator@fixture.test');
    insert into public.rainfall_readings(rainfall_value,notes) values(10,'historical data');
    insert into public.sensors(id,sensor_name,bedengan) values(1,'Sensor 1','1');
    insert into public.sensor_logs(sensor_id,moisture,temperature,humidity) values(1,55,28,72);
    insert into public.soil_ph_readings(ph_value) values(6.4);`);
  const snapshot=()=>observer.json(`select json_build_object(
    'rainfall',(select json_agg(t) from public.rainfall_readings t),
    'moisture',(select json_agg(t) from public.sensor_logs t),
    'ph',(select json_agg(t) from public.soil_ph_readings t)) as result`);
  const original=await snapshot();
  await observer.exec(syntheticStorageOnlyFixtureSql);
  for(const file of ["20261008_01_global_operator_session.sql","20261008_02_operator_write_permissions.sql","20261010_03_operator_activity_revision.sql"])
    await observer.exec(file === "20261008_02_operator_write_permissions.sql" ? syntheticStorageHardeningSql : await readSql(file));
  assert.deepEqual(await snapshot(),original);
  const adapter = { exec: sql => observer.exec(sql), query: async sql => ({ rows: (await observer.exec(sql)).map(row =>
    Object.fromEntries(Object.entries(row).map(([key,value]) => [key,
      ["result","details"].includes(key) && value !== null ? JSON.parse(value) : value]))) }) };
  await assertSyntheticStorageMigration(adapter);
  await assertSyntheticStorageAttacksRejected(adapter);
  await observer.exec(`set role service_role;
    insert into public.sensor_logs(sensor_id,moisture) values(1,60);
    insert into public.soil_ph_readings(ph_value) values(6.5);
    update public.rainfall_readings set rainfall_value=20;
    reset role;`);
  await observer.exec("set role anon");
  try {
    assert.equal((await observer.exec("select count(*) as n from public.sensor_logs"))[0].n,"2");
    assert.equal((await observer.exec("select count(*) as n from public.soil_ph_readings"))[0].n,"2");
    await assert.rejects(observer.exec("update public.rainfall_readings set rainfall_value=999"),error=>error.code==="42501");
  } finally {await observer.exec("reset role");}
  assert.equal((await a.json(acquire())).code,"OK");
});
