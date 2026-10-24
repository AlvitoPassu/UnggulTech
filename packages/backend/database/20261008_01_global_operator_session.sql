-- REVIEW ONLY: do not apply to production before the documented preflight.
-- Prerequisites: Supabase roles, auth.users and the existing public.audit_logs.
-- Deliberately fail on unexpected objects instead of guessing production schema.
begin;

create table public.global_operator_session (
  slot_id smallint primary key default 1 check (slot_id = 1),
  -- No cascading FK here: deleting an account must not delete the singleton row.
  -- Backend verifies the live auth user before every operation.
  user_id uuid,
  auth_session_id uuid,
  app_session_hash text check (app_session_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz,
  last_active_at timestamptz,
  expires_at timestamptz,
  expiry_reported boolean not null default false,
  constraint complete_operator_session check (
    (user_id is null and auth_session_id is null and app_session_hash is null
      and created_at is null and last_active_at is null and expires_at is null)
    or (user_id is not null and auth_session_id is not null and app_session_hash is not null
      and created_at is not null and last_active_at is not null and expires_at is not null
      and created_at <= last_active_at and last_active_at <= expires_at)
  )
);
insert into public.global_operator_session (slot_id) values (1);

-- A previously admitted auth session can never acquire a new lease after expiry
-- or logout. Keep these tombstones; no dependency on auth.sessions or cron.
create table public.operator_session_admissions (
  auth_session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  admitted_at timestamptz not null default clock_timestamp()
);

alter table public.global_operator_session enable row level security;
alter table public.operator_session_admissions enable row level security;
revoke all on public.global_operator_session, public.operator_session_admissions
  from public, anon, authenticated, service_role;
-- RPCs run as their trusted owner; even service_role uses the RPC contract.

create function public.operator_session_acquire(
  p_user_id uuid, p_auth_session_id uuid, p_app_session_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.global_operator_session%rowtype;
  t timestamptz;
  admitted boolean;
begin
  if p_user_id is null or p_auth_session_id is null
    or p_app_session_hash is null or p_app_session_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('code', 'INVALID_SESSION');
  end if;
  -- The singleton row exists before any acquisition. Every contender locks it.
  select * into strict s from public.global_operator_session where slot_id = 1 for update;
  t := clock_timestamp(); -- after waiting for the lock, not transaction start
  select exists(select 1 from public.operator_session_admissions
    where auth_session_id = p_auth_session_id) into admitted;

  if admitted then
    if s.user_id is distinct from p_user_id or s.auth_session_id is distinct from p_auth_session_id then
      return jsonb_build_object('code', 'SESSION_TIMEOUT');
    end if;
    if s.app_session_hash is distinct from p_app_session_hash then
      return jsonb_build_object('code', 'SESSION_MISMATCH');
    end if;
    if s.expires_at <= t then
      return jsonb_build_object('code', 'SESSION_TIMEOUT');
    end if;
    -- A retry recovers the existing lease, without extending its expiry.
    return jsonb_build_object('code', 'OK', 'created', false,
      'serverNow', t, 'lastActiveAt', s.last_active_at, 'expiresAt', s.expires_at);
  end if;

  if s.user_id is not null and s.expires_at > t then
    return jsonb_build_object('code', 'GLOBAL_SESSION_BUSY');
  end if;
  if s.user_id is not null and not s.expiry_reported then
    insert into public.audit_logs(user_id, action, resource, metadata)
      values (case when exists(select 1 from auth.users where id = s.user_id) then s.user_id else null end,
        'SESSION_EXPIRED', 'auth', '{"reason":"expired slot replaced"}'::jsonb);
  end if;
  insert into public.operator_session_admissions(auth_session_id, user_id, admitted_at)
    values (p_auth_session_id, p_user_id, t);
  update public.global_operator_session set user_id = p_user_id,
    auth_session_id = p_auth_session_id, app_session_hash = p_app_session_hash,
    created_at = t, last_active_at = t, expires_at = t + interval '10 minutes', expiry_reported = false
    where slot_id = 1;
  -- Acquisition and its success audit commit together, including lost HTTP responses.
  insert into public.audit_logs(user_id, action, resource, metadata)
    values (p_user_id, 'LOGIN_SUCCESS', 'auth', '{}'::jsonb);
  return jsonb_build_object('code', 'OK', 'created', true,
    'serverNow', t, 'lastActiveAt', t, 'expiresAt', t + interval '10 minutes');
end;
$$;

create function public.operator_session_check(
  p_user_id uuid, p_auth_session_id uuid, p_app_session_hash text,
  p_operation text default 'validate'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.global_operator_session%rowtype;
  t timestamptz;
begin
  if p_operation not in ('validate', 'extend', 'release', 'timeout')
    or p_operation is null or p_user_id is null or p_auth_session_id is null
    or p_app_session_hash is null or p_app_session_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('code', 'INVALID_SESSION');
  end if;
  select * into strict s from public.global_operator_session where slot_id = 1 for update;
  t := clock_timestamp();
  if s.user_id is null then
    return jsonb_build_object('code', 'SESSION_NOT_FOUND');
  end if;
  if s.user_id is distinct from p_user_id or s.auth_session_id is distinct from p_auth_session_id
    or s.app_session_hash is distinct from p_app_session_hash then
    return jsonb_build_object('code', 'SESSION_MISMATCH');
  end if;

  if p_operation in ('release', 'timeout') then
    -- Timeout notification from a delayed client must not revoke a renewed lease.
    if p_operation = 'timeout' and s.expires_at > t then
      return jsonb_build_object('code', 'SESSION_STILL_ACTIVE', 'serverNow', t,
        'lastActiveAt', s.last_active_at, 'expiresAt', s.expires_at);
    end if;
    update public.global_operator_session set user_id = null, auth_session_id = null,
      app_session_hash = null, created_at = null, last_active_at = null,
      expires_at = null, expiry_reported = false where slot_id = 1;
    insert into public.audit_logs(user_id, action, resource, metadata)
      values (p_user_id, case when p_operation = 'release' then 'LOGOUT_MANUAL' else 'LOGOUT_TIMEOUT' end,
        'auth', '{}'::jsonb);
    return jsonb_build_object('code', 'OK', 'released', true, 'serverNow', t);
  end if;

  if s.expires_at <= t then
    if not s.expiry_reported then
      insert into public.audit_logs(user_id, action, resource, metadata)
        values (s.user_id, 'SESSION_EXPIRED', 'auth', '{"reason":"inactivity"}'::jsonb);
      update public.global_operator_session set expiry_reported = true where slot_id = 1;
    end if;
    return jsonb_build_object('code', 'SESSION_TIMEOUT');
  end if;
  if p_operation = 'extend' then
    update public.global_operator_session set last_active_at = t, expires_at = t + interval '10 minutes'
      where slot_id = 1;
    s.last_active_at := t;
    s.expires_at := t + interval '10 minutes';
  end if;
  return jsonb_build_object('code', 'OK', 'serverNow', t,
    'lastActiveAt', s.last_active_at, 'expiresAt', s.expires_at);
end;
$$;

revoke all on function public.operator_session_acquire(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.operator_session_check(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.operator_session_acquire(uuid, uuid, text) to service_role;
grant execute on function public.operator_session_check(uuid, uuid, text, text) to service_role;

-- Fail safely if production has a different audit constraint; inspect it first.
do $$
declare
  expected text[] := array['LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT_MANUAL','LOGOUT_TIMEOUT',
    'DOWNLOAD_HISTORICAL_DATA','RAINFALL_CREATE','RAINFALL_UPDATE'];
  actual text[];
  definition text;
begin
  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.audit_logs'::regclass and conname = 'audit_logs_action_check' and contype = 'c') then
    raise exception 'Unexpected audit_logs schema: inspect action constraint before migration';
  end if;
  select pg_catalog.pg_get_constraintdef(oid) into definition from pg_catalog.pg_constraint
    where conrelid = 'public.audit_logs'::regclass and conname = 'audit_logs_action_check';
  select array_agg(m[1] order by m[1]) into actual
    from regexp_matches(definition, '''([^'']+)''', 'g') as m;
  if actual is distinct from array(select unnest(expected) order by 1) then
    raise exception 'Unexpected audit action vocabulary: review existing constraint before migration';
  end if;
  -- Current rows must fit the known vocabulary; custom deployments need review.
  if exists(select 1 from public.audit_logs where action <> all(expected)) then
    raise exception 'Unknown audit actions: review migration before applying';
  end if;
end;
$$;
alter table public.audit_logs drop constraint audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT_MANUAL','LOGOUT_TIMEOUT',
  'DOWNLOAD_HISTORICAL_DATA','RAINFALL_CREATE','RAINFALL_UPDATE',
  'LOGIN_REJECTED_BUSY','SESSION_EXPIRED','SESSION_INVALID','SESSION_BACKEND_ERROR'
));
-- REVOKE does not remove inherited privileges or the ability to SET ROLE.
-- Abort atomically; do not change unrelated role memberships/default grants.
do $permissions$
declare
  api name;
  target oid;
begin
  foreach api in array array['anon','authenticated']::name[] loop
    if exists(select 1 from pg_catalog.pg_proc p cross join pg_catalog.pg_roles r
      where p.oid in (pg_catalog.to_regprocedure('public.operator_session_acquire(uuid,uuid,text)'),
        pg_catalog.to_regprocedure('public.operator_session_check(uuid,uuid,text,text)'),
        pg_catalog.to_regprocedure('public.operator_session_extend(uuid,uuid,text,bigint,timestamptz)'))
        and (r.rolname=api or pg_catalog.pg_has_role(api,r.oid,'MEMBER'))
        and pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE')) then
      raise exception 'Operator RPC permission contract: % can execute through a direct, inherited or assumable role',api;
    end if;
  end loop;
  foreach api in array array['anon','authenticated','service_role']::name[] loop
    foreach target in array array['public.global_operator_session'::regclass::oid,
      'public.operator_session_admissions'::regclass::oid] loop
      if exists(select 1 from pg_catalog.pg_roles r
        where (r.rolname=api or pg_catalog.pg_has_role(api,r.oid,'MEMBER'))
          and (pg_catalog.has_table_privilege(r.oid,target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            or pg_catalog.has_any_column_privilege(r.oid,target,'SELECT,INSERT,UPDATE,REFERENCES'))) then
        raise exception 'Private operator table permission contract: % can access % through a direct, inherited or assumable role',api,target::regclass;
      end if;
    end loop;
  end loop;
end;
$permissions$;
notify pgrst, 'reload schema';
commit;
