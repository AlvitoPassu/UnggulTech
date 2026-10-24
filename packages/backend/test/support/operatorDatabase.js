import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

export const USER_A = "00000000-0000-4000-8000-000000000001";
export const USER_B = "00000000-0000-4000-8000-000000000002";
export const AUTH_A = "10000000-0000-4000-8000-000000000001";
export const AUTH_B = "10000000-0000-4000-8000-000000000002";
export const AUTH_A2 = "10000000-0000-4000-8000-000000000003";

export const operatorFixtureSql = `
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    insert into auth.users values ('${USER_A}'), ('${USER_B}');
    create table public.audit_logs (
      user_id uuid references auth.users(id) on delete set null, action text not null constraint audit_logs_action_check check (action in (
        'LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT_MANUAL','LOGOUT_TIMEOUT',
        'DOWNLOAD_HISTORICAL_DATA','RAINFALL_CREATE','RAINFALL_UPDATE')),
      resource text, metadata jsonb default '{}'::jsonb
    );
    create table public.rainfall_readings (id integer primary key, rainfall_value numeric, notes text);
    insert into public.rainfall_readings values (1, 10, 'historical data');
    alter table public.rainfall_readings enable row level security;
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on public.rainfall_readings to anon, authenticated;
    grant insert(rainfall_value), update(notes) on public.rainfall_readings to anon, authenticated;
    create policy rainfall_readings_read_all on public.rainfall_readings for select to anon, authenticated using (true);
    create policy rainfall_readings_insert_all on public.rainfall_readings for insert to anon, authenticated with check (true);
    create policy unknown_permissive_update on public.rainfall_readings for update to authenticated using (true) with check (true);
  `;

export const createOperatorDatabase = async ({ beforeMigration,
  migrations = ["20261008_01_global_operator_session.sql", "20261008_02_operator_write_permissions.sql",
    "20261010_03_operator_activity_revision.sql"] } = {}) => {
  const db = new PGlite();
  await db.exec(operatorFixtureSql);
  try {
    if (beforeMigration) await beforeMigration(db);
    for (const name of migrations) {
      await db.exec(await readFile(new URL(`../../database/${name}`, import.meta.url), "utf8"));
    }
  } catch (error) { await db.close(); throw error; }
  return db;
};

export const rpcClient = (db) => ({
  async rpc(name, args) {
    try {
      const params = [args.p_user_id, args.p_auth_session_id, args.p_app_session_hash];
      if (name === "operator_session_check") params.push(args.p_operation);
      if (name === "operator_session_extend") params.push(args.p_activity_revision, args.p_activity_at);
      const placeholders = params.map((_, index) => `$${index + 1}`).join(",");
      const { rows } = await db.query(`select public.${name}(${placeholders}) as result`, params);
      return { data: rows[0].result, error: null };
    } catch (error) { return { data: null, error: { message: error.message } }; }
  },
});
