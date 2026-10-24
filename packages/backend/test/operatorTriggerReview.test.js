import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createOperatorDatabase } from "./support/operatorDatabase.js";
import { syntheticTriggerFixtureSql, syntheticTriggerInventory, triggerInventorySql,
  triggerEvidenceSql, triggerSnapshotSql, assertTriggerGuardFailsClosed,
  maliciousTriggerBodies, assertMaliciousStorageTriggerRejected } from "./support/syntheticTriggerFixture.js";

let db;
before(async () => {
  db = await createOperatorDatabase({ migrations: ["20261008_01_global_operator_session.sql"] });
  await db.exec(syntheticTriggerFixtureSql);
});
after(async () => { await db?.close(); });

test("synthetic inventory matches all 10 modeled identities, owners, invoker flags and trigger types", async () => {
  assert.deepEqual((await db.query(triggerInventorySql)).rows,
    [...syntheticTriggerInventory].sort((a,b) => a.name.localeCompare(b.name)));
});

test("all seven Storage triggers require source review; failure names every blocker and is atomic", async () => {
  await assertTriggerGuardFailsClosed(db);
});

test("targeted evidence query is catalog-only READ ONLY and captures complete trigger/function metadata", async () => {
  const baseline = (await db.query(triggerSnapshotSql)).rows;
  await db.exec(`create schema hidden_probe;
    create function hidden_probe.attack() returns void language plpgsql security definer as $$
      begin execute 'up' || 'date public.' || 'rain' || 'fall_readings set notes=''attack'''; end; $$;
    revoke all on function hidden_probe.attack() from public;
    grant execute on function hidden_probe.attack() to supabase_storage_admin;
    create view storage.rain_alias as select id,notes from public.rainfall_readings;
    grant update(notes) on storage.rain_alias to authenticated;
    create role storage_helper_executor; grant storage_helper_executor to supabase_storage_admin;
    grant execute on function hidden_probe.attack() to storage_helper_executor;
    create rule alias_probe as on insert to storage.objects do also
      update public.rainfall_readings set notes='attack';
    alter table storage.objects add column helper_note text default 'default probe';`);
  const changedBaseline = (await db.query(triggerSnapshotSql)).rows;
  await db.exec("begin read only");
  const rows = (await db.query(triggerEvidenceSql)).rows;
  await db.exec("rollback");
  const find = (section, predicate) => rows.find(r => r.section === section && predicate(r.details))?.details;
  assert.equal(find("environment", () => true).noninternal_root_trigger_count, 10);
  assert.equal(rows.filter(r => r.section === "trigger" && r.details.production_inventory_root && !r.details.tgisinternal).length, 10);
  const triggerFn = find("routine", r => r.signature === "storage.protect_delete()");
  assert.equal(triggerFn.owner, "supabase_storage_admin");
  assert.equal(triggerFn.prosecdef, false);
  assert.ok(triggerFn.prosrc);
  assert.ok(triggerFn.definition);
  assert.ok("proconfig" in triggerFn && "proacl" in triggerFn && "prosupport" in triggerFn);
  const helper = find("routine", r => r.signature === "hidden_probe.attack()");
  assert.match(helper.prosrc, /execute/);
  assert.equal(helper.principal_execute.find(r => r.role === "authenticated").execute, false);
  assert.equal(helper.principal_execute.find(r => r.role === "supabase_storage_admin").execute, true);
  assert.ok(find("relation", r => r.signature === "storage.rain_alias").view_definition);
  assert.ok(find("rule", r => r.rulename === "alias_probe"));
  assert.ok(find("column_default", r => r.definition.includes("default probe")));
  assert.ok(rows.some(r => r.section === "role_membership"));
  assert.deepEqual((await db.query(triggerSnapshotSql)).rows, changedBaseline);
  await db.exec(`drop rule alias_probe on storage.objects; alter table storage.objects drop column helper_note;
    drop view storage.rain_alias; drop schema hidden_probe cascade; drop role storage_helper_executor;`);
  assert.deepEqual((await db.query(triggerSnapshotSql)).rows, baseline);
});

for (const [name, body] of maliciousTriggerBodies) test(`managed-looking Storage trigger with ${name} remains rejected`, async () => {
  await assertMaliciousStorageTriggerRejected(db, body);
});

test("a hardened database retains rainfall denies, service-role writes and sensor ingestion after a rejected rerun", async () => {
  const hardened = await createOperatorDatabase();
  try {
    await hardened.exec(syntheticTriggerFixtureSql);
    await assertTriggerGuardFailsClosed(hardened);
    for (const role of ["anon", "authenticated"]) {
      await hardened.exec(`set role ${role}`);
      try {
        assert.equal((await hardened.query("select notes from public.rainfall_readings where id=1")).rows[0].notes,"historical data");
        for (const sql of ["insert into public.rainfall_readings(id) values(99)",
          "update public.rainfall_readings set notes='attack'", "delete from public.rainfall_readings", "truncate public.rainfall_readings"]) {
          await assert.rejects(hardened.exec(sql), error => error.code === "42501");
        }
      } finally { await hardened.exec("reset role"); }
    }
    await hardened.exec(`set role service_role;
      insert into public.rainfall_readings(id,notes) values(2,'service ingestion');
      update public.rainfall_readings set rainfall_value=12 where id=2;
      delete from public.rainfall_readings where id=2;
      insert into public.sensors(id) values(2);
      reset role;`);
    assert.equal((await hardened.query("select notes from public.rainfall_readings")).rows[0].notes,"historical data");
    assert.equal((await hardened.query("select count(*)::int as n from public.sensors")).rows[0].n,2);
  } finally { await hardened.close(); }
});
