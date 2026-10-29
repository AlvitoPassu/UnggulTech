import test from "node:test";
import assert from "node:assert/strict";
import { createNativePlacementCluster } from "../support/sensorPlacementNativeDatabase.js";
import { bootstrapPlacementBase, SQL, quote, signature, acquireSql, saveSql,
  payload, snapshotSql } from "../support/sensorPlacementDatabase.js";
import { CANDIDATE, approveLocalCandidate, approvalKey, auditKey, checkerKey,
  authSnapshot, auditDefinition } from "../support/sensorPlacementProductionCandidate.js";

test("production candidate guards and atomic migration on fresh loopback PostgreSQL 17.6", async t => {
  const cluster = await createNativePlacementCluster();
  try {
    const db = await cluster.connect();
    const other = await cluster.connect();
    await bootstrapPlacementBase(db, { native: true });
    console.log(`Candidate guards PostgreSQL ${await db.json("select to_jsonb(current_setting('server_version')) as result")}; new cluster ${cluster.folder}`);
    const migration = await SQL(CANDIDATE);
    const set = (key, value) => db.exec(`select set_config(${quote(key)},${quote(value)},false)`);
    const stableSnapshot = async () => ({
      audit: await db.json(auditDefinition), auth: await db.json(authSnapshot),
      data: await db.json(snapshotSql),
      defaults: await db.json("select coalesce(jsonb_agg(to_jsonb(d) order by oid),'[]') as result from pg_default_acl d"),
      // Compare all placement object collisions, including overloads.
      table: await db.json("select to_jsonb(to_regclass('public.sensor_placements')::text) as result"),
      routines: await db.json(`select coalesce(jsonb_agg(pg_get_functiondef(p.oid) order by p.oid),'[]') as result
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='sensor_placement_save'`),
    });
    const reject = async pattern => {
      const before = await stableSnapshot();
      await assert.rejects(db.exec(migration), pattern);
      await db.exec("rollback");
      assert.deepEqual(await stableSnapshot(), before, "failure must preserve existing state and create no partial placement objects");
    };

    await t.test("missing approval and legacy local opt-in cannot authorize candidate", async () => {
      await reject(/explicit recorded approval/);
      await db.exec("set unggul.sensor_placements_review='isolated-local-review'");
      await reject(/explicit recorded approval/);
    });
    for (const [name, key, value, pattern] of [
      ["wrong approval token", approvalKey, "isolated-local-review", /explicit recorded approval/],
      ["missing approval reference", "unggul.sensor_placements_approval_reference", "", /explicit recorded approval/],
      ["wrong database", "unggul.sensor_placements_target_database", "another_database", /matching target/],
      ["wrong checker fingerprint", checkerKey, "0".repeat(32), /fingerprint required/],
      ["missing audit approval", auditKey, "", /invalid input syntax/],
      ["non-array audit approval", auditKey, "{}", /JSON array/],
      ["wrong number of approved actions", auditKey, "[]", /Exactly 11/],
      ["non-string approved action", auditKey, JSON.stringify(Array(11).fill(1)), /11 reviewed existing/],
      ["duplicate approved actions", auditKey, JSON.stringify(Array(11).fill("LOGIN_SUCCESS")), /differs/],
    ]) await t.test(name, async () => {
      await approveLocalCandidate(db); await set(key, value); await reject(pattern);
    });

    await t.test("11 strings with one mismatched action cannot silently replace production vocabulary", async () => {
      const actions = await approveLocalCandidate(db); actions[0] = "UNREVIEWED_ACTION";
      await set(auditKey, JSON.stringify(actions)); await reject(/differs/);
    });

    for (const [name, inject, restore, pattern] of [
      ["owner role membership", "grant postgres to anon", "revoke postgres from anon", /Unsafe effective/],
      ["browser checker execute", "grant execute on function public.operator_session_check(uuid,uuid,text,text) to authenticated",
        "revoke execute on function public.operator_session_check(uuid,uuid,text,text) from authenticated", /Unsafe effective/],
      ["missing backend checker execute", "revoke execute on function public.operator_session_check(uuid,uuid,text,text) from service_role",
        "grant execute on function public.operator_session_check(uuid,uuid,text,text) to service_role", /EXECUTE contract is missing/],
      ["checker SECURITY INVOKER", "alter function public.operator_session_check(uuid,uuid,text,text) security invoker",
        "alter function public.operator_session_check(uuid,uuid,text,text) security definer", /Migration 03/],
      ["sensor metadata contract", "alter table public.sensors rename column location to legacy_location",
        "alter table public.sensors rename column legacy_location to location", /sensors identity/],
      ["untrusted table owner", "alter table public.sensors owner to authenticated",
        "alter table public.sensors owner to postgres", /trusted-owner ordinary/],
      ["auth FK identity contract", "alter table auth.users rename column id to legacy_id",
        "alter table auth.users rename column legacy_id to id", /auth.users UUID/],
      ["missing backend BYPASSRLS", "alter role service_role nobypassrls", "alter role service_role bypassrls", /BYPASSRLS/],
      ["additional restrictive audit check", "alter table public.audit_logs add constraint fixture_extra_check check(action<>'SENSOR_PLACEMENT_SAVE')",
        "alter table public.audit_logs drop constraint fixture_extra_check", /Additional audit action/],
      ["existing placement table", "create table public.sensor_placements(id int)", "drop table public.sensor_placements", /object collision/],
      ["existing RPC overload", "create function public.sensor_placement_save(int) returns int language sql as 'select 1'",
        "drop function public.sensor_placement_save(int)", /object collision/],
    ]) await t.test(name, async () => {
      await db.exec(inject);
      try { await approveLocalCandidate(db); await reject(pattern); }
      finally { await db.exec(restore); }
    });

    const initialAudit = await db.json(auditDefinition);
    const replaceAudit = expression => db.exec(`alter table public.audit_logs drop constraint audit_logs_action_check;
      alter table public.audit_logs add constraint audit_logs_action_check ${expression}`);
    await t.test("unsupported and unvalidated existing audit constraints", async () => {
      await approveLocalCandidate(db);
      try {
        await replaceAudit("check(length(action)>0)"); await reject(/Unreviewed audit action/);
        await replaceAudit(initialAudit + " not valid"); await reject(/Unreviewed audit action/);
      } finally { await replaceAudit(initialAudit); }
    });
    await t.test("12 existing audit actions require a new review", async () => {
      const actions = await approveLocalCandidate(db);
      try {
        await replaceAudit(`check(action in (${[...actions, "CUSTOM_ACTION"].map(quote).join(",")}))`);
        await reject(/differs/);
      } finally { await replaceAudit(initialAudit); }
    });
    await t.test("parallel migration lock refuses execution", async () => {
      await approveLocalCandidate(db); await other.exec("begin; select pg_advisory_xact_lock(20261029,4)");
      try { await reject(/Another placement migration/); }
      finally { await other.exec("rollback"); }
    });
    await t.test("audit lock timeout fails without partial changes", async () => {
      await approveLocalCandidate(db); await other.exec("begin; lock table public.audit_logs in access share mode");
      try { await reject(e => e.code === "55P03"); }
      finally { await other.exec("rollback"); }
    });

    await t.test("failure AFTER vocabulary and table/index creation rolls all DDL back", async () => {
      await db.exec(`create function public.fixture_candidate_ddl_failure() returns event_trigger language plpgsql as $$ begin
        if to_regclass('public.sensor_placements') is not null then raise exception 'injected late DDL failure'; end if;
        end $$;
        create event trigger fixture_candidate_ddl_failure on ddl_command_end when tag in ('CREATE FUNCTION')
        execute function public.fixture_candidate_ddl_failure()`);
      try { await approveLocalCandidate(db); await reject(/injected late DDL failure/); }
      finally { await db.exec("drop event trigger fixture_candidate_ddl_failure; drop function public.fixture_candidate_ddl_failure()"); }
    });
    await t.test("unexpected privilege added late aborts after grant/revoke sequence", async () => {
      await db.exec(`create function public.fixture_candidate_acl_failure() returns event_trigger language plpgsql as $$ begin
        if to_regclass('public.sensor_placements') is not null
          and current_setting('unggul.fixture_acl_injected',true) is distinct from 'yes' then
          perform set_config('unggul.fixture_acl_injected','yes',true);
          execute 'grant update on public.sensor_placements to anon';
        end if; end $$;
        create event trigger fixture_candidate_acl_failure on ddl_command_end when tag in ('GRANT')
        execute function public.fixture_candidate_acl_failure()`);
      try { await approveLocalCandidate(db); await reject(/Unexpected effective placement privileges/); }
      finally { await db.exec("drop event trigger fixture_candidate_acl_failure; drop function public.fixture_candidate_acl_failure()"); }
    });

    await t.test("six synthetic NULL sensors; preserve 11 actions, data, auth and default ACLs", async () => {
      // Prepare production-shaped SYNTHETIC fixture before migration, never real sensor data.
      await db.exec(`delete from public.sensor_readings; delete from public.sensors;
        insert into public.sensors(id,sensor_name,bedengan,location)
          select n,'Synthetic sensor '||n,'Bedengan '||n,null from generate_series(1,6) n;
        create role fixture_candidate_default; grant fixture_candidate_default to anon;
        alter default privileges grant all on tables to fixture_candidate_default;
        alter default privileges grant execute on functions to fixture_candidate_default;`);
      const actions = await approveLocalCandidate(db);
      const before = await stableSnapshot();
      const sensorStructureSql = `select jsonb_build_object('relation',
        (select jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity) from pg_class where oid='public.sensors'::regclass),
        'columns',(select jsonb_agg(to_jsonb(a) order by attnum) from pg_attribute a where attrelid='public.sensors'::regclass and attnum>0),
        'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid='public.sensors'::regclass)) as result`;
      const structure = await db.json(sensorStructureSql);
      await db.exec(migration);
      const after = await stableSnapshot();
      assert.deepEqual(after.data, before.data);
      assert.deepEqual(after.auth, before.auth);
      assert.deepEqual(after.defaults, before.defaults);
      assert.deepEqual(await db.json(sensorStructureSql), structure);
      assert.equal(await db.json(`select to_jsonb(has_table_privilege('fixture_candidate_default','public.sensor_placements',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as result`), false);
      assert.equal(await db.json(`select to_jsonb(has_function_privilege('fixture_candidate_default','${signature}','EXECUTE')) as result`), false);
      assert.equal(await db.json(`select to_jsonb(current_setting('${approvalKey}',true)) as result`), "");
      // Each original action remains insertable; the newly allowed save audit is exercised by RPC below.
      await db.exec(`insert into public.audit_logs(action) values ${actions.map(v => `(${quote(v)})`).join(",")}`);
      await db.exec("set role service_role");
      assert.equal((await db.json(acquireSql)).code, "OK");
      for (let n=1; n<=6; n++) {
        const result = await db.json(saveSql(String(n),payload({ expectedContext: { location:null,bedengan:n } })));
        assert.equal(result.code, "OK"); assert.equal(result.context.location, null);
      }
      await db.exec("reset role");
      assert.deepEqual(await db.json(snapshotSql), before.data);
      assert.equal(await db.json("select count(*)::int as result from public.sensor_placements where location_key is null"), 6);
      const finalActions = [...(await db.json(auditDefinition)).matchAll(/'([A-Z][A-Z0-9_]*)'::text/g)].map(m => m[1]);
      assert.deepEqual(finalActions.sort(), [...actions,"SENSOR_PLACEMENT_SAVE"].sort());
      await approveLocalCandidateForRerun();
      async function approveLocalCandidateForRerun() {
        // Restore only the gate fields for the collision check; no need to accept a 12-action approval.
        await set(approvalKey,"execute-20261029_04_sensor_placements-PRODUCTION");
        await set("unggul.sensor_placements_approval_reference","SYNTHETIC-LOCAL-RERUN-ONLY");
        await set("unggul.sensor_placements_target_database","postgres");
        await set(checkerKey,await db.json(`select to_jsonb(md5(pg_get_functiondef('public.operator_session_check(uuid,uuid,text,text)'::regprocedure))) as result`));
        await reject(/object collision/);
      }
    });
  } finally { await cluster.close(); }
});
