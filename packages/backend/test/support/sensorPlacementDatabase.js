// Test-only bootstrap: no application imports, .env, remote URL or existing DB.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { USER_A, USER_B, AUTH_A } from "./operatorDatabase.js";

export { USER_A, USER_B, AUTH_A };
export const PLACEMENT_MIGRATION = "20261028_04_sensor_placements_REVIEW_ONLY.sql";
export const SQL = (name) => readFile(new URL(`../../database/${name}`, import.meta.url), "utf8");
export const HASH = "a".repeat(64);
export const signature = "public.sensor_placement_save(uuid,uuid,text,text,jsonb)";
export const optIn = "set unggul.sensor_placements_review='isolated-local-review'";
export const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export const payload = (overrides = {}) => ({ row: 1, column: 1, expectedVersion: null,
  expectedContext: { location: "Nursery test", bedengan: 1 }, ...overrides });
export const saveSql = (id = "126", values = payload(), user = USER_A, auth = AUTH_A, hash = HASH) =>
  `select public.sensor_placement_save(${quote(user)},${quote(auth)},${quote(hash)},${id === null ? "null" : quote(id)},${values === undefined ? "null" : quote(JSON.stringify(values))}::jsonb) as result`;
export const acquireSql = `select public.operator_session_acquire('${USER_A}','${AUTH_A}','${HASH}') as result`;
export const resetSql = `reset role;
  delete from public.sensor_placements; delete from public.audit_logs; delete from public.operator_session_admissions;
  update public.global_operator_session set user_id=null,auth_session_id=null,app_session_hash=null,
    created_at=null,last_active_at=null,expires_at=null,expiry_reported=false,last_activity_revision=0;`;
export const snapshotSql = `select jsonb_build_object(
  'sensors',(select jsonb_agg(to_jsonb(t) order by id) from public.sensors t),
  'readings',(select jsonb_agg(to_jsonb(t) order by id) from public.sensor_readings t),
  'ph',(select jsonb_agg(to_jsonb(t) order by id) from public.soil_ph_readings t),
  'rainfall',(select jsonb_agg(to_jsonb(t) order by id) from public.rainfall_readings t)) as result`;
export const role = async (db, name, action) => {
  if (!["anon", "authenticated", "service_role"].includes(name)) throw new Error("Unexpected fixture role");
  await db.exec(`set role ${name}`);
  try { return await action(); } finally { await db.exec("reset role"); }
};

export async function bootstrapPlacementBase(db, { native = false } = {}) {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    grant usage on schema public to anon,authenticated,service_role;`);
  await db.exec(await readFile(new URL("./supabaseAuthFunctions.sql", import.meta.url), "utf8"));
  for (const name of ["schema.sql", "auth_and_audit.sql"]) {
    const source = await SQL(name);
    // PGlite already has gen_random_uuid, but cannot load the native pgcrypto extension.
    await db.exec(native ? source : source.replace("create extension if not exists pgcrypto with schema extensions;", ""));
  }
  await db.exec(`insert into auth.users(id,email) values('${USER_A}','a@fixture.invalid'),('${USER_B}','b@fixture.invalid');
    insert into public.sensors(id,sensor_name,bedengan,location) values
      (126,'Sensor 126','B1','Nursery test'),(127,'Sensor 127','Bedengan 1','Nursery test'),
      (128,'Sensor 128','2','Nursery test'),(129,'Sensor 129','1','Other nursery'),
      (130,'Sensor 130','1',null),(131,'Sensor 131','61','Nursery test'),
      (9007199254740993,'Big ID','60','Nursery test');
    insert into public.sensor_readings(sensor_id,moisture) values(126,55);
    insert into public.soil_ph_readings(ph_value) values(6.4);
    insert into public.rainfall_readings(rainfall_value,notes) values(10,'Historical fixture');
    grant select on public.sensors,public.sensor_logs,public.sensor_readings,public.soil_ph_readings to anon,authenticated;
    grant all on all tables in schema public to service_role;
    grant usage,select on all sequences in schema public to service_role;`);
  for (const name of ["20261008_01_global_operator_session.sql", "20261008_02_operator_write_permissions.sql", "20261010_03_operator_activity_revision.sql"]) {
    await db.exec(await SQL(name));
  }
}

export async function createPlacementDatabase({ migrate = true } = {}) {
  const pg = new PGlite();
  const db = { exec: (sql) => pg.exec(sql), json: async (sql) => (await pg.query(sql)).rows[0].result,
    close: () => pg.close() };
  try {
    await bootstrapPlacementBase(db);
    if (migrate) { await db.exec(optIn); await db.exec(await SQL(PLACEMENT_MIGRATION)); }
    return db;
  } catch (error) { await db.close(); throw error; }
}
