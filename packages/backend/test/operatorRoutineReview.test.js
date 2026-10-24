import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createOperatorDatabase, USER_A } from "./support/operatorDatabase.js";

const fixture = await readFile(new URL("./support/supabaseAuthFunctions.sql", import.meta.url), "utf8");
const hardening = await readFile(new URL("../database/20261008_02_operator_write_permissions.sql", import.meta.url), "utf8");
let db;
before(async () => { db = await createOperatorDatabase({ beforeMigration: database => database.exec(fixture) }); });
after(async () => { await db?.close(); });
const assertReview = async () => {
  await assert.rejects(db.exec(hardening), /manual chain review required/);
  await db.exec("rollback");
};

test("reviewed Auth helpers retain owner, body, ACL and RLS-dependent reads after 01 -> 02 -> 03", async () => {
  const baseline = (await db.query("select oid,prosrc,proowner,proacl::text from pg_proc where pronamespace='auth'::regnamespace order by oid")).rows;
  await db.exec(hardening);
  assert.deepEqual((await db.query("select oid,prosrc,proowner,proacl::text from pg_proc where pronamespace='auth'::regnamespace order by oid")).rows,baseline);
  await db.exec(`create table public.identity_read_probe(owner_id uuid); insert into public.identity_read_probe values('${USER_A}');
    alter table public.identity_read_probe enable row level security;
    grant select on public.identity_read_probe to authenticated;
    create policy own_rows on public.identity_read_probe for select to authenticated using(auth.uid()=owner_id);`);
  for(const role of ["anon","authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      const claims = { sub:USER_A,role,email:"operator@example.test" };
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(claims)]);
      const row = (await db.query("select auth.uid() as uid,auth.role() as role,auth.email() as email,auth.jwt() as jwt")).rows[0];
      assert.deepEqual(row,{uid:USER_A,role,email:claims.email,jwt:claims});
      assert.equal((await db.query("select * from public.rainfall_readings")).rows.length,1);
      if(role==="authenticated") assert.equal((await db.query("select * from public.identity_read_probe")).rows.length,1);
    } finally { await db.exec("reset role"); }
  }
  await db.exec("drop table public.identity_read_probe");
});


test("unrelated platform invokers do not require a global routine/source allowlist", async () => {
  // Synthetic bodies, not copies or verification of hosted Supabase routines.
  await db.exec(`create schema if not exists extensions; create schema storage;
    create schema realtime; create schema graphql_public;
    create function extensions.digest(text,text) returns text language sql immutable as 'select $1';
    alter extension plpgsql add function extensions.digest(text,text);
    create function storage.filename(text) returns text language sql immutable as 'select $1';
    create function realtime.topic() returns text language sql stable as 'select current_setting(''request.topic'',true)';
    create function graphql_public.graphql(text) returns text language sql as 'select $1';`);
  try {
    const snapshot = () => db.query(`select oid,prosrc,proowner,proacl::text as acl from pg_proc
      where oid in ('extensions.digest(text,text)'::regprocedure,'storage.filename(text)'::regprocedure,
        'realtime.topic()'::regprocedure,'graphql_public.graphql(text)'::regprocedure) order by oid`);
    const before = (await snapshot()).rows;
    await db.exec(hardening);
    assert.deepEqual((await snapshot()).rows,before);
  } finally {
    await db.exec(`alter extension plpgsql drop function extensions.digest(text,text);
      drop function extensions.digest(text,text); drop schema storage cascade;
      drop schema realtime cascade; drop schema graphql_public cascade;`);
  }
});

for (const schema of ["auth","extensions","storage"]) test(`rainfall write RPC remains blocked in ${schema} regardless of managed-looking owner/schema`, async () => {
  await db.exec(`create schema if not exists ${schema};
    create function ${schema}.write_probe() returns void language sql security definer
      as 'update public.rainfall_readings set notes=''bypass'' where id=1';`);
  try { await assertReview(); }
  finally { await db.exec(`drop function ${schema}.write_probe()`); }
});

test("cross-schema definer with an obfuscated table name is blocked by rainfall capabilities", async () => {
  await db.exec(`create schema other_api; grant usage on schema other_api to anon;
    create function other_api.dynamic_write() returns void language plpgsql security definer as $$
    begin execute 'update public.' || 'rain' || 'fall_readings set notes=''bypass'''; end $$;`);
  try { await assertReview(); } finally { await db.exec("drop schema other_api cascade"); }
});

test("extension membership does not exempt a rainfall write RPC", async () => {
  await db.exec(`create schema if not exists extensions;
    create function extensions.write_probe() returns void language sql security definer
      as 'delete from public.rainfall_readings';
    alter extension plpgsql add function extensions.write_probe();`);
  try { await assertReview(); }
  finally { await db.exec("alter extension plpgsql drop function extensions.write_probe(); drop function extensions.write_probe()"); }
});

test("recorded cross-schema SQL dependency chains remain review blockers", async () => {
  await db.exec(`create schema other_api;
    create function other_api.read_one() returns int language sql
      begin atomic select id from public.rainfall_readings limit 1; end;
    create function other_api.wrapper() returns int language sql
      begin atomic select other_api.read_one(); end;`);
  try { await assertReview(); } finally { await db.exec("drop schema other_api cascade"); }
});

test("nested rainfall views with only column UPDATE grants remain blocked", async () => {
  await db.exec(`create schema other_api;
    create view other_api.first_alias as select id,notes from public.rainfall_readings;
    create view other_api.second_alias as select * from other_api.first_alias;
    grant update(notes) on other_api.second_alias to authenticated;`);
  try {
    await assert.rejects(db.exec(hardening), /Writable view depends on rainfall/);
    await db.exec("rollback");
  } finally { await db.exec("drop schema other_api cascade"); }
});

test("an unrelated writable view does not block rainfall hardening or change sensor permissions", async () => {
  await db.exec(`create table public.sensor_probe(id int primary key,value int);
    grant select,insert on public.sensor_probe to anon;
    create view public.sensor_alias as select * from public.sensor_probe;
    grant select,update(value) on public.sensor_alias to anon;`);
  try {
    const acl=await db.query("select relname,relacl::text as acl from pg_class where oid in ('public.sensor_probe'::regclass,'public.sensor_alias'::regclass) order by relname");
    await db.exec(hardening);
    assert.deepEqual((await db.query("select relname,relacl::text as acl from pg_class where oid in ('public.sensor_probe'::regclass,'public.sensor_alias'::regclass) order by relname")).rows,acl.rows);
  } finally { await db.exec("drop view public.sensor_alias; drop table public.sensor_probe"); }
});

test("invoker triggers on rainfall remain blocked when their helper chain is unreviewed", async () => {
  await db.exec(`create function public.indirect_trigger() returns trigger language plpgsql as $$
      begin execute 'select pg_sleep(0)'; return new; end $$;
    create trigger indirect_write before update on public.rainfall_readings
      for each row execute function public.indirect_trigger();`);
  try {
    await assert.rejects(db.exec(hardening), /Unreviewed trigger/);
    await db.exec("rollback");
  } finally { await db.exec("drop trigger indirect_write on public.rainfall_readings; drop function public.indirect_trigger()"); }
});

test("optional local Migration 02 draft copies use the same focused guards", {
  skip: ["SIMPLIFIED_REVIEW_ONLY", "DRAFT_REVIEW_ONLY"].some(variant => !existsSync(new URL(`../database/20261008_02_operator_write_permissions_${variant}.sql`, import.meta.url))),
}, async () => {
  for (const variant of ["SIMPLIFIED_REVIEW_ONLY","DRAFT_REVIEW_ONLY"]) {
    const sql = await readFile(new URL(`../database/20261008_02_operator_write_permissions_${variant}.sql`,import.meta.url),"utf8");
    assert.equal(sql,hardening);
  }
});

test("metadata query works inside READ ONLY and includes hidden dynamic helpers and indirect write paths", async () => {
  const isolated = await createOperatorDatabase({beforeMigration:database=>database.exec(fixture)});
  const query = await readFile(new URL("./support/routineCatalogQuery.sql",import.meta.url),"utf8");
  try {
    await isolated.exec(`create schema hidden_probe;
      create role metadata_executor; grant metadata_executor to authenticated;
      create function hidden_probe.write_rainfall() returns text language plpgsql security definer as $$
        begin update public.rainfall_readings set notes='indirect'; return 'result'; end $$;
      revoke all on function hidden_probe.write_rainfall() from public;
      create schema storage;
      create function storage.filename(text) returns text language plpgsql as $$
        declare result text; begin execute 'select hidden_probe.write_rainfall()' into result; return result; end $$;
      revoke all on function storage.filename(text) from public;
      grant execute on function storage.filename(text) to metadata_executor;
      create table public.metadata_probe(id int primary key, note text default hidden_probe.write_rainfall());
      grant insert(note) on public.metadata_probe to authenticated;
      create function hidden_probe.write_trigger() returns trigger language plpgsql security definer as $$
        begin perform hidden_probe.write_rainfall(); return new; end $$;
      create trigger indirect_write before insert on public.metadata_probe for each row execute function hidden_probe.write_trigger();
      create view public.metadata_view as select * from public.rainfall_readings;
      grant update(notes) on public.metadata_view to authenticated;
      create rule probe_rule as on insert to public.metadata_probe do also update public.rainfall_readings set notes='rule';
      alter default privileges grant execute on functions to metadata_executor;`);
    const before = (await isolated.query("select * from public.rainfall_readings")).rows;
    await isolated.exec("begin read only");
    const rows=(await isolated.query(query)).rows;
    await isolated.exec("rollback");
    const find=(section,predicate)=>rows.find(r=>r.section===section && predicate(r.details))?.details;
    const hidden=find("routine",r=>r.signature==="hidden_probe.write_rainfall()");
    assert.match(hidden.prosrc,/update public.rainfall_readings/);
    assert.equal(hidden.anon_execute,false);
    assert.equal(hidden.authenticated_execute,false);
    const wrapper=find("routine",r=>r.schema_name==="storage" && r.proname==="filename");
    assert.equal(wrapper.authenticated_execute,true);
    assert.match(wrapper.prosrc,/execute 'select hidden_probe/);
    assert.ok(wrapper.effective_acl_entries.some(a=>a.grantee==="metadata_executor"));
    assert.ok(find("role_membership",r=>r.member_name==="authenticated" && r.role==="metadata_executor"));
    assert.ok(find("default_acl",r=>r.defaclacl.some(a=>a.includes("metadata_executor"))));
    assert.ok(find("dependency",r=>r.dependent.includes("metadata_view")));
    assert.ok(find("column_default",r=>r.definition.includes("write_rainfall")));
    assert.ok(find("trigger",r=>r.tgname==="indirect_write"));
    assert.ok(find("rule",r=>r.rulename==="probe_rule"));
    assert.equal(find("relation",r=>r.signature==="public.metadata_view").authenticated_column_write,true);
    assert.deepEqual((await isolated.query("select * from public.rainfall_readings")).rows,before);
    await assert.rejects(isolated.exec(hardening),/manual chain review required/);
    await isolated.exec("rollback");
    assert.deepEqual((await isolated.query("select * from public.rainfall_readings")).rows,before);
  } finally { await isolated.close(); }
});
