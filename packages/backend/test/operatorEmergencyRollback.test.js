import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createOperatorDatabase, USER_A, AUTH_A } from "./support/operatorDatabase.js";

const readSql = (name) => readFile(new URL(`../database/${name}`, import.meta.url), "utf8");
const shutdown = await readSql("20261008_global_session_rollback.sql");
const recovery = await readSql("20261008_global_session_recovery.sql");
const hash = "a".repeat(64);
const signatures = ["public.operator_session_acquire(uuid,uuid,text)",
  "public.operator_session_check(uuid,uuid,text,text)",
  "public.operator_session_extend(uuid,uuid,text,bigint,timestamptz)"];
const calls = ["select public.operator_session_acquire($1,$2,$3) as result",
  "select public.operator_session_check($1,$2,$3,'validate') as result",
  "select public.operator_session_extend($1,$2,$3,1,clock_timestamp()) as result"];
const snapshot = async (db) => {
  const data = {};
  for (const table of ["auth.users", "public.rainfall_readings", "public.audit_logs",
    "public.global_operator_session", "public.operator_session_admissions", "public.sensor_probe"]) {
    data[table] = (await db.query(`select * from ${table}`)).rows;
  }
  return data;
};
const definitions = (db) => db.query(`select oid,pg_get_functiondef(oid) as definition,proacl::text as acl,
  proowner,prosecdef,proconfig from pg_proc
  where oid in (select to_regprocedure(s) from unnest($1::text[]) s) order by oid`, [signatures]);
const asRole = async (db, role, action) => {
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec("reset role"); }
};

for (const withActivity of [false, true]) test(`rollback/recovery with inherited EXECUTE, Migration 03 ${withActivity ? "present" : "absent"}`, async () => {
  const db = await createOperatorDatabase({
    migrations: withActivity ? undefined : ["20261008_01_global_operator_session.sql", "20261008_02_operator_write_permissions.sql"],
    beforeMigration: (database) => database.exec(`create role rpc_executor;
      grant rpc_executor to service_role;
      alter default privileges grant execute on functions to rpc_executor;
      create table public.sensor_probe(id int primary key, value int);
      insert into public.sensor_probe values(1,25);
      grant select on public.sensor_probe to anon,authenticated;
      grant insert on public.sensor_probe to service_role;`),
  });
  try {
    await asRole(db,"service_role",async () => {
      assert.equal((await db.query(calls[0],[USER_A,AUTH_A,hash])).rows[0].result.code,"OK");
    });
    const before = await snapshot(db);
    const expected = (await definitions(db)).rows;
    await db.exec(shutdown);
    const saved = (await db.query("select * from operator_session_recovery.rpc_backup order by signature")).rows;
    assert.equal(saved.length,withActivity ? 3 : 2);
    await db.exec(shutdown);
    assert.deepEqual((await db.query("select * from operator_session_recovery.rpc_backup order by signature")).rows,saved);
    for (const role of ["service_role","rpc_executor","postgres"]) await asRole(db,role,async () => {
      // Retained inherited/owner EXECUTE proves the rejecting implementation is decisive.
      for (const [index,call] of calls.entries()) {
        if (!withActivity && index===2) continue;
        assert.equal((await db.query("select has_function_privilege(current_user,$1,'EXECUTE') as allowed",[signatures[index]])).rows[0].allowed,true);
        await assert.rejects(db.query(call,[USER_A,AUTH_A,hash]),(error) => error.code==="55000" && /disabled by emergency rollback/.test(error.message));
      }
    });
    // Re-granting the direct permission also cannot revive a disabled body.
    await db.exec("grant execute on function public.operator_session_acquire(uuid,uuid,text) to service_role");
    await asRole(db,"service_role",() => assert.rejects(db.query(calls[0],[USER_A,AUTH_A,hash]),/disabled by emergency rollback/));
    for (const role of ["anon","authenticated","service_role"]) await asRole(db,role,() => assert.rejects(db.query("select * from operator_session_recovery.rpc_backup"),/permission denied/));
    assert.deepEqual(await snapshot(db),before);
    await asRole(db,"anon",async () => {
      assert.equal((await db.query("select * from public.rainfall_readings")).rows.length,1);
      assert.equal((await db.query("select * from public.sensor_probe")).rows.length,1);
      await assert.rejects(db.exec("truncate public.rainfall_readings"),/permission denied/);
    });
    await asRole(db,"service_role",() => db.exec("insert into public.sensor_probe values(2,30)"));
    await db.exec(recovery);
    assert.deepEqual((await definitions(db)).rows,expected);
    assert.equal((await db.query("select count(*)::int as count from operator_session_recovery.rpc_backup")).rows[0].count,0);
    await asRole(db,"service_role",async () => {
      for (const [index,call] of calls.entries()) {
        if (!withActivity && index===2) continue;
        assert.equal((await db.query(call,[USER_A,AUTH_A,hash])).rows[0].result.code,"OK");
      }
    });
    await db.exec(shutdown);
    await db.exec(recovery);
  } finally { await db.close(); }
});

for (const tampering of ["definition", "saved ACL", "disabled implementation", "missing backup", "assumable EXECUTE"]) test(`recovery aborts atomically on ${tampering}`, async () => {
  const db = await createOperatorDatabase();
  try {
    if (tampering === "assumable EXECUTE") await db.exec(`create role restore_executor;
      grant execute on function public.operator_session_acquire(uuid,uuid,text) to restore_executor;`);
    await db.exec(shutdown);
    if (tampering === "definition") await db.exec("update operator_session_recovery.rpc_backup set definition=definition || E'\\n-- tampered' where signature like '%extend(%'");
    if (tampering === "saved ACL") await db.exec("update operator_session_recovery.rpc_backup set original_acl='{}'::aclitem[] where signature like '%extend(%'");
    if (tampering === "disabled implementation") await db.exec("alter function public.operator_session_extend(uuid,uuid,text,bigint,timestamptz) cost 101");
    if (tampering === "missing backup") await db.exec("delete from operator_session_recovery.rpc_backup where signature like '%extend(%'");
    if (tampering === "assumable EXECUTE") await db.exec("alter role authenticated noinherit; grant restore_executor to authenticated");
    await assert.rejects(db.exec(recovery),/verification failed|Incomplete RPC backup|API permission contract/);
    await db.exec("rollback");
    // acquire/check were visited before extend: recovery must undo partial restoration.
    for (const call of calls) await assert.rejects(db.query(call,[USER_A,AUTH_A,hash]),/disabled by emergency rollback/);
  } finally { await db.close(); }
});

test("an unexpected final RPC aborts shutdown without partially replacing acquire/check", async () => {
  const db = await createOperatorDatabase();
  try {
    await db.exec(`drop function public.operator_session_extend(uuid,uuid,text,bigint,timestamptz);
      create function public.operator_session_extend(uuid,uuid,text,bigint,timestamptz)
      returns int language sql as 'select 1';`);
    const before = (await definitions(db)).rows;
    await assert.rejects(db.exec(shutdown),/Unexpected RPC contract/);
    await db.exec("rollback");
    assert.deepEqual((await definitions(db)).rows,before);
    assert.equal((await db.query("select to_regclass('operator_session_recovery.rpc_backup') as backup")).rows[0].backup,null);
    await asRole(db,"service_role",async () => {
      assert.equal((await db.query(calls[0],[USER_A,AUTH_A,hash])).rows[0].result.code,"OK");
    });
  } finally { await db.close(); }
});

test("a dependent definer wrapper cannot authorize through a replaced RPC", async () => {
  const db = await createOperatorDatabase();
  try {
    await db.exec(`create function public.wrapper(uuid,uuid,text) returns jsonb language sql security definer
      as 'select public.operator_session_acquire($1,$2,$3)';
      revoke all on function public.wrapper(uuid,uuid,text) from public;
      grant execute on function public.wrapper(uuid,uuid,text) to service_role;`);
    await db.exec(shutdown);
    await asRole(db,"service_role",() => assert.rejects(db.query("select public.wrapper($1,$2,$3)",[USER_A,AUTH_A,hash]),/disabled by emergency rollback/));
  } finally { await db.close(); }
});
