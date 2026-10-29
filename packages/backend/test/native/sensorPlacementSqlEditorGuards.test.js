import test from "node:test";
import assert from "node:assert/strict";
import { createNativePlacementCluster } from "../support/sensorPlacementNativeDatabase.js";
import { bootstrapPlacementBase, SQL, quote, signature, acquireSql, saveSql, payload, snapshotSql } from "../support/sensorPlacementDatabase.js";
import { CANDIDATE, approvalKey, auditKey, checkerKey, authSnapshot, auditDefinition } from "../support/sensorPlacementProductionCandidate.js";
import { EDITOR_CANDIDATE, localEditorBatch, assertNoEditorApproval, approvalStateSql,
  approvalKeys, referenceKey, targetKey } from "../support/sensorPlacementSqlEditorCandidate.js";

test("SQL Editor batch preserves production migration body and ships no approval values", async () => {
  const old = (await SQL(CANDIDATE)).replaceAll("\r\n", "\n");
  const sql = await SQL(EDITOR_CANDIDATE);
  const protectedBody = text => text.slice(text.indexOf("do $preflight$"), text.indexOf("do $clear_approval$")).trim();
  assert.equal(protectedBody(sql).replace(/\n-- Clear only the transaction-local values[\s\S]*$/, "").trim(), protectedBody(old));
  for (const key of approvalKeys) assert.ok(sql.includes(`set local ${key} = '';`));
  assert.ok(sql.includes("perform pg_catalog.set_config(setting_name,'',true)"));
  assert.ok(!sql.includes("set_config(setting_name,'',false)"));
  assert.equal((sql.match(/^begin;$/gm) || []).length, 1);
  assert.equal((sql.match(/^commit;$/gm) || []).length, 1);
});

test("SQL Editor atomicity and production guards on isolated PostgreSQL 17.6", async t => {
  const cluster = await createNativePlacementCluster();
  try {
    const db = await cluster.connect(), other = await cluster.connect();
    await bootstrapPlacementBase(db, { native: true });
    assert.equal(await db.json("select current_setting('server_version_num')::int as result"), 170006);
    console.log(`SQL Editor guards PostgreSQL ${await db.json("select to_jsonb(current_setting('server_version')) as result")}; new cluster ${cluster.folder}`);
    const { actions } = await localEditorBatch(db);
    assert.equal(actions.length, 11);
    // Historical synthetic audit records exist BEFORE every attempted migration.
    await db.exec(`insert into public.audit_logs(action,metadata) values ${actions.map(v => `(${quote(v)},'{"fixture":"historical-before-migration"}')`).join(",")}`);
    const stableSnapshot = async () => ({
      audit: await db.json(auditDefinition), auth: await db.json(authSnapshot), data: await db.json(snapshotSql),
      history: await db.json("select jsonb_agg(to_jsonb(t) order by id) as result from public.audit_logs t"),
      session: await db.json("select jsonb_agg(to_jsonb(t)) as result from public.global_operator_session t"),
      admissions: await db.json("select coalesce(jsonb_agg(to_jsonb(t)),'[]') as result from public.operator_session_admissions t"),
      defaults: await db.json("select coalesce(jsonb_agg(to_jsonb(d) order by oid),'[]') as result from pg_default_acl d"),
      table: await db.json("select to_jsonb(to_regclass('public.sensor_placements')::text) as result"),
      routines: await db.json(`select coalesce(jsonb_agg(pg_get_functiondef(p.oid) order by p.oid),'[]') as result
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sensor_placement_save'`),
    });
    const reject = async (sql, pattern) => {
      const before = await stableSnapshot();
      await assert.rejects(db.exec(sql), pattern);
      // A simple-query batch stops before COMMIT on ERROR. The same connection
      // must be in failed transaction state until rollback/disconnect.
      await assert.rejects(db.exec("select 1"), e => e.code === "25P02");
      await db.exec("rollback");
      assert.deepEqual(await stableSnapshot(), before, "error must not leave partial DDL, audit changes or data writes");
      await assertNoEditorApproval(db); await assertNoEditorApproval(other);
      assert.equal(await other.json("select to_jsonb(pg_try_advisory_xact_lock(20261029,4)) as result"), true);
    };
    const batch = async overrides => (await localEditorBatch(db, { overrides })).sql;

    await t.test("unaltered empty candidate fails closed", async () => {
      await reject(await SQL(EDITOR_CANDIDATE), /explicit recorded approval/);
    });
    await t.test("legacy isolated-local-review cannot authorize this batch", async () => {
      await db.exec("set unggul.sensor_placements_review='isolated-local-review'");
      await reject(await SQL(EDITOR_CANDIDATE), /explicit recorded approval/);
      await reject(await batch({ [approvalKey]: "isolated-local-review" }), /explicit recorded approval/);
    });
    for (const key of approvalKeys) {
      await t.test(`empty ${key} aborts and clears ALL local approvals`, async () => {
        await reject(await batch({ [key]: "" }), key === auditKey ? /invalid input syntax/ : key === checkerKey ? /fingerprint/ : /explicit recorded approval/);
      });
      await t.test(`omitted SET LOCAL for ${key} cannot inherit authorization`, async () => {
        const { sql } = await localEditorBatch(db, { omit: [key] });
        await reject(sql, key === auditKey ? /invalid input syntax|JSON array/ : key === checkerKey ? /fingerprint/ : /explicit recorded approval/);
      });
    }
    for (const [name, key, value, pattern] of [
      ["wrong token", approvalKey, "wrong-token", /explicit recorded approval/],
      ["short reference", referenceKey, "short", /explicit recorded approval/],
      ["whitespace reference", referenceKey, "                 ", /explicit recorded approval/],
      ["wrong database", targetKey, "another_database", /matching target/],
      ["checker drift", checkerKey, "0".repeat(32), /fingerprint/],
      ["malformed JSON", auditKey, "[", /invalid input syntax/],
      ["JSON null", auditKey, "null", /JSON array/],
      ["non-array", auditKey, "{}", /JSON array/],
      ["empty array", auditKey, "[]", /Exactly 11/],
      ["non-string array", auditKey, JSON.stringify(Array(11).fill(1)), /11 reviewed existing/],
      ["duplicate actions", auditKey, JSON.stringify(Array(11).fill("LOGIN_SUCCESS")), /differs/],
      ["mismatched action", auditKey, JSON.stringify(["UNREVIEWED_ACTION", ...actions.slice(1)]), /differs/],
    ]) await t.test(name, async () => reject(await batch({ [key]: value }), pattern));

    await t.test("stale session approvals are refused, never silently restored as new approval", async () => {
      const sql = await batch();
      for (const key of approvalKeys) {
        await db.exec(`select set_config(${quote(key)},'STALE-LOCAL-FIXTURE',false)`);
        await assert.rejects(db.exec(sql), /empty pre-existing approval/);
        await db.exec("rollback");
        assert.equal((await db.json(approvalStateSql))[key], "STALE-LOCAL-FIXTURE", "SET LOCAL cannot erase prior session state");
        // Cleanup belongs only to this intentionally dirty LOCAL test connection.
        await db.exec(`select set_config(${quote(key)},'',false)`);
      }
      await assertNoEditorApproval(db);
    });
    await t.test("executor guard refuses an alternate role", async () => {
      const sql = await batch(); await db.exec("create role fixture_editor; set role fixture_editor");
      try { await assert.rejects(db.exec(sql), /postgres executor/); await db.exec("rollback"); }
      finally { await db.exec("reset role; drop role fixture_editor"); }
      await assertNoEditorApproval(db);
    });
    for (const [name, inject, restore, pattern] of [
      ["owner membership", "grant postgres to anon", "revoke postgres from anon", /Unsafe effective/],
      ["public schema CREATE", "grant create on schema public to authenticated", "revoke create on schema public from authenticated", /Unsafe effective/],
      ["browser checker EXECUTE", "grant execute on function public.operator_session_check(uuid,uuid,text,text) to authenticated",
        "revoke execute on function public.operator_session_check(uuid,uuid,text,text) from authenticated", /Unsafe effective/],
      ["missing backend checker EXECUTE", "revoke execute on function public.operator_session_check(uuid,uuid,text,text) from service_role",
        "grant execute on function public.operator_session_check(uuid,uuid,text,text) to service_role", /EXECUTE contract is missing/],
      ["checker SECURITY INVOKER", "alter function public.operator_session_check(uuid,uuid,text,text) security invoker",
        "alter function public.operator_session_check(uuid,uuid,text,text) security definer", /Migration 03/],
      ["sensor schema mismatch", "alter table public.sensors rename column location to legacy_location", "alter table public.sensors rename column legacy_location to location", /sensors identity/],
      ["sensor owner mismatch", "alter table public.sensors owner to authenticated", "alter table public.sensors owner to postgres", /trusted-owner ordinary/],
      ["audit owner mismatch", "alter table public.audit_logs owner to authenticated", "alter table public.audit_logs owner to postgres", /trusted-owner ordinary/],
      ["session revision mismatch", "alter table public.global_operator_session rename column last_activity_revision to legacy_revision", "alter table public.global_operator_session rename column legacy_revision to last_activity_revision", /Migration 03/],
      ["auth FK mismatch", "alter table auth.users rename column id to legacy_id", "alter table auth.users rename column legacy_id to id", /auth.users UUID/],
      ["missing BYPASSRLS", "alter role service_role nobypassrls", "alter role service_role bypassrls", /BYPASSRLS/],
      ["additional audit check", "alter table public.audit_logs add constraint fixture_extra_check check(action<>'SENSOR_PLACEMENT_SAVE')", "alter table public.audit_logs drop constraint fixture_extra_check", /Additional audit action/],
      ["table collision", "create table public.sensor_placements(id int)", "drop table public.sensor_placements", /object collision/],
      ["RPC overload collision", "create function public.sensor_placement_save(int) returns int language sql as 'select 1'", "drop function public.sensor_placement_save(int)", /object collision/],
    ]) await t.test(name, async () => {
      await db.exec(inject);
      try { await reject(await batch(), pattern); } finally { await db.exec(restore); }
    });

    const initialAudit = await db.json(auditDefinition);
    const replaceAudit = expression => db.exec(`alter table public.audit_logs drop constraint audit_logs_action_check;
      alter table public.audit_logs add constraint audit_logs_action_check ${expression}`);
    await t.test("custom, unvalidated and changed vocabulary constraints fail closed", async () => {
      const sql = await batch();
      try {
        await replaceAudit("check(length(action)>0)"); await reject(sql, /Unreviewed audit action/);
        await replaceAudit(initialAudit + " not valid"); await reject(sql, /Unreviewed audit action/);
        await replaceAudit(`check(action in (${[...actions, "CUSTOM_ACTION"].map(quote).join(",")}))`);
        await reject(sql, /differs/);
      } finally { await replaceAudit(initialAudit); }
    });
    await t.test("parallel migration lock rejects and releases local approvals", async () => {
      await other.exec("begin; select pg_advisory_xact_lock(20261029,4)");
      // reject() probes the lock after rollback; release holder first for that probe.
      const before = await stableSnapshot();
      try { await assert.rejects(db.exec(await batch()), /Another placement migration/); await db.exec("rollback"); }
      finally { await other.exec("rollback"); }
      assert.deepEqual(await stableSnapshot(), before); await assertNoEditorApproval(db);
    });
    await t.test("3-second audit lock timeout leaves no partial changes", async () => {
      // ACCESS SHARE permits the snapshot, but conflicts with migration ACCESS EXCLUSIVE.
      await other.exec("begin; lock table public.audit_logs in access share mode");
      try { await reject(await batch(), e => e.code === "55P03"); }
      finally { await other.exec("rollback"); }
    });
    await t.test("late DDL error rolls back constraint, table, indexes and approvals", async () => {
      await db.exec(`create function public.fixture_editor_ddl_failure() returns event_trigger language plpgsql as $$ begin
        if to_regclass('public.sensor_placements') is not null then raise exception 'injected late DDL failure'; end if;
        end $$;
        create event trigger fixture_editor_ddl_failure on ddl_command_end when tag in ('CREATE FUNCTION') execute function public.fixture_editor_ddl_failure()`);
      try { await reject(await batch(), /injected late DDL failure/); }
      finally { await db.exec("drop event trigger fixture_editor_ddl_failure; drop function public.fixture_editor_ddl_failure()"); }
    });
    await t.test("late unexpected ACL fails verification and rolls back", async () => {
      await db.exec(`create function public.fixture_editor_acl_failure() returns event_trigger language plpgsql as $$ begin
        if to_regclass('public.sensor_placements') is not null and current_setting('unggul.fixture_acl_injected',true) is distinct from 'yes' then
          perform set_config('unggul.fixture_acl_injected','yes',true); execute 'grant update on public.sensor_placements to anon';
        end if; end $$;
        create event trigger fixture_editor_acl_failure on ddl_command_end when tag in ('GRANT') execute function public.fixture_editor_acl_failure()`);
      try { await reject(await batch(), /Unexpected effective placement privileges/); }
      finally { await db.exec("drop event trigger fixture_editor_acl_failure; drop function public.fixture_editor_acl_failure()"); }
    });
    await t.test("late final RLS verification detects event-trigger drift", async () => {
      await db.exec(`create function public.fixture_editor_rls_failure() returns event_trigger language plpgsql as $$ begin
        execute 'alter table public.sensor_placements disable row level security'; end $$;
        create event trigger fixture_editor_rls_failure on ddl_command_end when tag in ('CREATE FUNCTION') execute function public.fixture_editor_rls_failure()`);
      try { await reject(await batch(), /final placement security/); }
      finally { await db.exec("drop event trigger fixture_editor_rls_failure; drop function public.fixture_editor_rls_failure()"); }
    });
    await t.test("statement cancellation after DDL leaves no partial migration", async () => {
      // Fault only in the in-memory fixture batch; deliverable keeps 30s unchanged.
      const sql = (await batch()).replace("do $new_acl$", "set local statement_timeout='25ms'; select pg_sleep(0.2);\ndo $new_acl$");
      await reject(sql, e => e.code === "57014");
    });
    await t.test("explicit ROLLBACK after all DDL removes objects and five approvals", async () => {
      const before = await stableSnapshot();
      await db.exec((await batch()).replace(/commit;\s*$/, "rollback;"));
      assert.deepEqual(await stableSnapshot(), before); await assertNoEditorApproval(db);
    });
    await t.test("disconnect before COMMIT discards DDL and transaction-local approvals", async () => {
      const before = await stableSnapshot(), transient = await cluster.connect();
      await transient.exec((await batch()).replace(/commit;\s*$/, ""));
      await transient.close();
      assert.deepEqual(await stableSnapshot(), before); await assertNoEditorApproval(db);
    });
    await t.test("SET LOCAL alone expires even if explicit clear block is not reached", async () => {
      const sql = await batch();
      const before = await stableSnapshot();
      // Exercise the exact opening/SET LOCAL block, commit without migration DDL.
      await db.exec(sql.slice(0, sql.indexOf("do $preflight$")) + "commit;");
      assert.deepEqual(await stableSnapshot(), before); await assertNoEditorApproval(db);
    });

    await t.test("one full batch commits; six NULL sensors, 11 historical actions, auth/data/defaults preserved", async () => {
      // Prepare production-shaped synthetic registry while keeping existing measurements.
      await db.exec(`update public.sensors set bedengan='Bedengan '||(id-125),location=null where id between 126 and 131;
        delete from public.sensors where id=9007199254740993;
        create role fixture_editor_default; grant fixture_editor_default to anon;
        alter default privileges grant all on tables to fixture_editor_default;
        alter default privileges grant execute on functions to fixture_editor_default;`);
      const before = await stableSnapshot();
      const sensorStructure = `select jsonb_build_object('relation',
        (select jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity) from pg_class where oid='public.sensors'::regclass),
        'columns',(select jsonb_agg(to_jsonb(a) order by attnum) from pg_attribute a where attrelid='public.sensors'::regclass and attnum>0),
        'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid='public.sensors'::regclass)) as result`;
      const structureBefore = await db.json(sensorStructure);
      const sql = await batch(), started = performance.now();
      await db.exec(sql);
      console.log(`SQL Editor six-NULL-sensor migration full batch ${(performance.now()-started).toFixed(2)} ms; audit bytes ${await db.json("select pg_total_relation_size('public.audit_logs')::int as result")}`);
      const after = await stableSnapshot();
      for (const field of ["auth", "data", "history", "session", "admissions", "defaults"]) assert.deepEqual(after[field], before[field], field);
      assert.deepEqual(await db.json(sensorStructure), structureBefore);
      await assertNoEditorApproval(db); await assertNoEditorApproval(other);
      assert.equal(await db.json(`select to_jsonb(has_table_privilege('fixture_editor_default','public.sensor_placements','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as result`), false);
      assert.equal(await db.json(`select to_jsonb(has_function_privilege('fixture_editor_default','${signature}','EXECUTE')) as result`), false);
      await db.exec(`insert into public.audit_logs(action) values ${actions.map(v => `(${quote(v)})`).join(",")}`);
      await db.exec("set role service_role");
      try {
        assert.equal((await db.json(acquireSql)).code, "OK");
        for (let n = 1; n <= 6; n++) {
          const result = await db.json(saveSql(String(125+n), payload({ expectedContext: { location: null, bedengan: n } })));
          assert.equal(result.code, "OK"); assert.equal(result.context.location, null);
        }
      } finally { await db.exec("reset role"); }
      assert.deepEqual(await db.json(snapshotSql), before.data);
      assert.deepEqual(await db.json("select jsonb_agg(to_jsonb(t) order by id) as result from public.audit_logs t where metadata->>'fixture'='historical-before-migration'"), before.history);
      assert.equal(await db.json("select count(*)::int as result from public.sensor_placements where location_key is null"), 6);
      assert.equal(await db.json("select count(*)::int as result from public.audit_logs where action='SENSOR_PLACEMENT_SAVE'"), 6);
      const finalActions = [...(await db.json(auditDefinition)).matchAll(/'([A-Z][A-Z0-9_]*)'::text/g)].map(m => m[1]);
      assert.deepEqual(finalActions.sort(), [...actions, "SENSOR_PLACEMENT_SAVE"].sort());
      await reject(sql, /object collision/);
    });
  } finally { await cluster.close(); }
});
