import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createPlacementDatabase, resetSql, SQL, PLACEMENT_MIGRATION, optIn, signature } from "./support/sensorPlacementDatabase.js";
import { placementContracts } from "./support/sensorPlacementContracts.js";

let db;
before(async () => { db = await createPlacementDatabase(); });
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec(resetSql); });
for (const [name, run] of placementContracts) test(`PGlite: ${name}`, () => run(db));

test("migration strips default object grants, preserves custom vocabulary and default ACLs, and leaves auth source/ACL unchanged", async () => {
  const fixture = await createPlacementDatabase({ migrate: false });
  try {
    await fixture.exec(`create role placement_fixture_default; grant placement_fixture_default to anon;
      alter default privileges grant all on tables to placement_fixture_default;
      alter default privileges grant execute on functions to placement_fixture_default;
      alter table public.audit_logs drop constraint audit_logs_action_check;
      alter table public.audit_logs add constraint audit_logs_action_check check(action in (
        'LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT_MANUAL','LOGOUT_TIMEOUT','DOWNLOAD_HISTORICAL_DATA','RAINFALL_CREATE','RAINFALL_UPDATE',
        'LOGIN_REJECTED_BUSY','SESSION_EXPIRED','SESSION_INVALID','SESSION_BACKEND_ERROR','CUSTOM_ACTION'));
      insert into public.audit_logs(action) values('CUSTOM_ACTION')`);
    const sourceSql = "select jsonb_agg(jsonb_build_object('oid',oid,'body',pg_get_functiondef(oid),'acl',proacl,'owner',proowner) order by oid) as result from pg_proc where proname like 'operator_session_%'";
    const aclSql = "select coalesce(jsonb_agg(to_jsonb(d)),'[]') as result from pg_default_acl d";
    const authBefore = await fixture.json(sourceSql); const defaultsBefore = await fixture.json(aclSql);
    await fixture.exec(optIn); await fixture.exec(await SQL(PLACEMENT_MIGRATION));
    assert.deepEqual(await fixture.json(sourceSql), authBefore);
    assert.deepEqual(await fixture.json(aclSql), defaultsBefore);
    await fixture.exec("insert into public.audit_logs(action) values('CUSTOM_ACTION')");
    assert.equal(await fixture.json("select has_function_privilege('placement_fixture_default','" + signature + "','EXECUTE') as result"), false);
    assert.equal(await fixture.json("select has_table_privilege('placement_fixture_default','public.sensor_placements','INSERT,UPDATE,DELETE,TRUNCATE,SELECT') as result"), false);
  } finally { await fixture.close(); }
});

test("migration aborts atomically without opt-in, on inherited owner capability, or unsupported audit expression", async () => {
  const fixture = await createPlacementDatabase({ migrate: false });
  try {
    const migration = await SQL(PLACEMENT_MIGRATION);
    await assert.rejects(fixture.exec(migration), /opt-in/); await fixture.exec("rollback");
    await fixture.exec(optIn);
    await fixture.exec("grant postgres to anon");
    await assert.rejects(fixture.exec(migration), /Unsafe effective/); await fixture.exec("rollback");
    await fixture.exec("revoke postgres from anon");
    await fixture.exec("alter table public.audit_logs drop constraint audit_logs_action_check; alter table public.audit_logs add constraint audit_logs_action_check check(length(action)>0)");
    await assert.rejects(fixture.exec(migration), /Unreviewed audit action/); await fixture.exec("rollback");
    assert.equal(await fixture.json("select to_regclass('public.sensor_placements')::text as result"), null);
    assert.equal(await fixture.json("select to_regprocedure('" + signature + "')::text as result"), null);
  } finally { await fixture.close(); }
});

test("migration refuses rerun/collision without changing already-created placement objects", async () => {
  const before = await db.json("select pg_get_constraintdef(oid) as result from pg_constraint where conrelid='public.audit_logs'::regclass and conname='audit_logs_action_check'");
  await assert.rejects(db.exec(await SQL(PLACEMENT_MIGRATION)), /object collision/);
  await db.exec("rollback");
  assert.equal(await db.json("select pg_get_constraintdef(oid) as result from pg_constraint where conrelid='public.audit_logs'::regclass and conname='audit_logs_action_check'"), before);
});
