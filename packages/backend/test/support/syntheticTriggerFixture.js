import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Synthetic identities exercise the contracts already named in Migration 02.
// This is a local test model, not a production inventory or source review.
export const syntheticTriggerInventory = [
  ...["profiles", "rainfall_readings", "sensors"].map(table => ({
    schema: "public", table, name: `set_${table}_updated_at`, fn: "set_updated_at()",
    owner: "postgres", definer: false, type: 19,
    reason: table === "rainfall_readings" ? "RAINFALL" : "API_WRITABLE_TABLE",
  })),
  ...[
    ["buckets", "enforce_bucket_name_length_trigger", "enforce_bucket_name_length", 23],
    ["buckets", "protect_bucket_control_insert", "protect_bucket_control_columns", 7],
    ["buckets", "protect_bucket_control_update", "protect_bucket_control_columns", 19],
    ["buckets", "protect_bucket_control_update_role", "enforce_bucket_lifecycle_service_role", 17],
    ["buckets", "protect_buckets_delete", "protect_delete", 10],
    ["objects", "protect_objects_delete", "protect_delete", 10],
    ["objects", "update_objects_updated_at", "update_updated_at_column", 19],
  ].map(([table, name, fn, type]) => ({ schema: "storage", table, name,
    fn: `storage.${fn}()`, owner: "supabase_storage_admin", definer: false, type,
    reason: "API_WRITABLE_TABLE" })),
];
const events = { 7: "before insert", 19: "before update", 23: "before insert or update", 17: "after update", 10: "before delete" };
export const syntheticTriggerFixtureSql = `
  create role supabase_storage_admin;
  create schema storage authorization supabase_storage_admin;
  grant usage on schema storage to anon,authenticated,service_role;
  create table storage.buckets(id text primary key,updated_at timestamptz);
  create table storage.objects(id text primary key,updated_at timestamptz);
  alter table storage.buckets owner to supabase_storage_admin;
  alter table storage.objects owner to supabase_storage_admin;
  grant select,insert,update,delete on storage.buckets,storage.objects to anon,authenticated,service_role;
  insert into storage.buckets values('historical-bucket',null);
  insert into storage.objects values('historical-object',null);
  create table public.profiles(id int primary key,updated_at timestamptz);
  create table public.sensors(id int primary key,updated_at timestamptz);
  grant select,insert,update,delete on public.profiles,public.sensors to anon,authenticated,service_role;
  insert into public.sensors values(1,null);
  alter table public.rainfall_readings add column updated_at timestamptz;
  create function public.set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at = timezone('utc', now()); return new; end;
  $$;
  ${[...new Set(syntheticTriggerInventory.filter(r => r.schema === "storage").map(r => r.fn))].map(fn => `
    create function ${fn} returns trigger language plpgsql as $$begin return new; end;$$;
    alter function ${fn} owner to supabase_storage_admin;
  `).join("\n")}
  ${syntheticTriggerInventory.map(r => `create trigger ${r.name} ${events[r.type]}
    on ${r.schema}.${r.table} for each ${r.type & 1 ? "row" : "statement"}
    execute function ${r.schema === "public" ? "public." : ""}${r.fn};`).join("\n")}
`;

export const triggerSnapshotSql = `select jsonb_build_object(
  'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t
    where t.tgrelid in ('public.profiles'::regclass,'public.rainfall_readings'::regclass,
      'public.sensors'::regclass,'storage.buckets'::regclass,'storage.objects'::regclass)),
  'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
    where p.oid in (select tgfoid from pg_trigger where not tgisinternal)),
  'acl',(select jsonb_agg(jsonb_build_object('oid',oid,'acl',relacl,'rls',relrowsecurity) order by oid)
    from pg_class where oid in ('public.rainfall_readings'::regclass,'public.sensors'::regclass,
      'storage.buckets'::regclass,'storage.objects'::regclass)),
  'rainfall',(select jsonb_agg(to_jsonb(r) order by id) from public.rainfall_readings r),
  'buckets',(select jsonb_agg(to_jsonb(r) order by id) from storage.buckets r),
  'objects',(select jsonb_agg(to_jsonb(r) order by id) from storage.objects r)) as result`;

export const triggerInventorySql = `select n.nspname as schema,c.relname as table,t.tgname as name,
  case when n.nspname='public' then p.proname||'()' else pn.nspname||'.'||p.proname||'()' end as fn,
  pg_get_userbyid(p.proowner) as owner,p.prosecdef as definer,t.tgtype::int as type,
  case when c.oid='public.rainfall_readings'::regclass then 'RAINFALL' else 'API_WRITABLE_TABLE' end as reason
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
  where not t.tgisinternal and (n.nspname,c.relname) in (('public','profiles'),('public','rainfall_readings'),
    ('public','sensors'),('storage','buckets'),('storage','objects')) order by t.tgname`;

export const triggerHardeningSql = await readFile(new URL("../../database/20261008_02_operator_write_permissions.sql", import.meta.url), "utf8");
export const triggerEvidenceSql = await readFile(new URL("./triggerCatalogQuery.sql", import.meta.url), "utf8");

// Works with both PGlite and the native libpq adapter. Each rejected migration
// must be rolled back before examining the unchanged catalog/data.
export async function assertTriggerGuardFailsClosed(db) {
  const baseline = (await db.query(triggerSnapshotSql)).rows;
  await assert.rejects(db.exec(triggerHardeningSql), error => {
    assert.match(error.message, /Unreviewed trigger on rainfall or API-writable table/);
    const diagnostic = error.detail || error.message;
    for (const r of syntheticTriggerInventory.filter(r => r.schema === "storage")) {
      assert.ok(diagnostic.includes(r.name), `Missing diagnostic for ${r.name}`);
    }
    assert.ok(!diagnostic.includes("set_rainfall_readings_updated_at"));
    return true;
  });
  await db.exec("rollback");
  assert.deepEqual((await db.query(triggerSnapshotSql)).rows, baseline);
}

export const maliciousTriggerBodies = [
  ["direct INSERT", "insert into public.rainfall_readings(id,rainfall_value,notes) values(987,12,'attack');"],
  ["direct UPDATE", "update public.rainfall_readings set notes='attack';"],
  ["direct DELETE", "delete from public.rainfall_readings;"],
  ["direct TRUNCATE", "truncate public.rainfall_readings;"],
  ["obfuscated dynamic SQL", "execute 'up' || 'date public.' || 'rain' || 'fall_readings set notes=''attack''';"],
  ["helper call", "perform hidden_probe.attack();"],
  ["view alias", "update storage.rain_alias set notes='attack';"],
];

export async function assertMaliciousStorageTriggerRejected(db, body, hardeningSql = triggerHardeningSql) {
  const original = (await db.query("select pg_get_functiondef('storage.update_updated_at_column()'::regprocedure) as definition")).rows[0].definition;
  // Make the helper/view cases executable, then demonstrate the actual write in
  // a rolled-back LOCAL transaction. Rejection must not pass on dead source alone.
  await db.exec(`create schema hidden_probe;
    create function hidden_probe.attack() returns void language sql security definer
      as 'update public.rainfall_readings set notes=''attack''';
    revoke all on function hidden_probe.attack() from public;
    create view storage.rain_alias as select id,notes from public.rainfall_readings;`);
  try {
    await db.exec(`create or replace function storage.update_updated_at_column() returns trigger language plpgsql
      as $$begin ${body} return new; end;$$;`);
    const baseline = (await db.query(triggerSnapshotSql)).rows;
    await db.exec("begin");
    try {
      await db.exec("update storage.objects set updated_at=clock_timestamp()");
      const changed = (await db.query(triggerSnapshotSql)).rows;
      assert.notDeepEqual(changed[0].result.rainfall, baseline[0].result.rainfall,
        "The synthetic malicious trigger must actually change rainfall before guard review");
    } finally { await db.exec("rollback"); }
    await assert.rejects(db.exec(hardeningSql), error => {
      assert.match(error.message, /Unreviewed trigger on rainfall or API-writable table/);
      assert.match(error.detail || error.message, /update_objects_updated_at/,
        "The modified malicious entrypoint itself must remain a blocker");
      return true;
    });
    await db.exec("rollback");
    assert.deepEqual((await db.query(triggerSnapshotSql)).rows, baseline);
  } finally {
    await db.exec(`rollback; drop view storage.rain_alias; drop schema hidden_probe cascade; ${original}`);
  }
}
