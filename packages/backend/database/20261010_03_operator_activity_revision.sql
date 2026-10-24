-- LOCAL REVIEW ONLY. Apply AFTER 20261008_01 and reviewed 20261008_02.
-- New deployment migration; no change to a live database is performed here.
-- Activity revision is scoped to the exact admitted identity and persisted
-- under the singleton row lock. Status/polling cannot generate extensions.
-- Server/database time validates event estimates: at most 45 seconds old,
-- never future, never before admission. The estimate can only shorten a lease.
-- Timestamp claims alone never authorize: check() verifies the full owner + TTL.
-- Browser human presence cannot be proven by an API (a malicious holder of all
-- credentials can fabricate interactions); this contract prevents honest
-- delayed/retried events from repeatedly extending the lease.
begin;
alter table public.global_operator_session add column last_activity_revision bigint not null default 0
  check (last_activity_revision >= 0);

create or replace function public.operator_session_acquire(
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
      'serverNow', t, 'lastActivityRevision', s.last_activity_revision, 'lastActiveAt', s.last_active_at, 'expiresAt', s.expires_at);
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
    created_at = t, last_active_at = t, expires_at = t + interval '10 minutes', expiry_reported = false, last_activity_revision = 0
    where slot_id = 1;
  -- Acquisition and its success audit commit together, including lost HTTP responses.
  insert into public.audit_logs(user_id, action, resource, metadata)
    values (p_user_id, 'LOGIN_SUCCESS', 'auth', '{}'::jsonb);
  return jsonb_build_object('code', 'OK', 'created', true,
    'serverNow', t, 'lastActivityRevision', 0, 'lastActiveAt', t, 'expiresAt', t + interval '10 minutes');
end;
$$;


create or replace function public.operator_session_check(
  p_user_id uuid, p_auth_session_id uuid, p_app_session_hash text,
  p_operation text default 'validate'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.global_operator_session%rowtype;
  t timestamptz;
begin
  if p_operation = 'extend' then
    return jsonb_build_object('code', 'INVALID_ACTIVITY');
  end if;
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
        'lastActivityRevision', s.last_activity_revision, 'lastActiveAt', s.last_active_at, 'expiresAt', s.expires_at);
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
  return jsonb_build_object('code', 'OK', 'serverNow', t,
    'lastActivityRevision', s.last_activity_revision, 'lastActiveAt', s.last_active_at, 'expiresAt', s.expires_at);
end;
$$;

create function public.operator_session_extend(
  p_user_id uuid, p_auth_session_id uuid, p_app_session_hash text,
  p_activity_revision bigint, p_activity_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  s public.global_operator_session%rowtype;
  t timestamptz;
begin
  -- check() takes the same row lock and validates expiry before idempotency.
  result := public.operator_session_check(p_user_id, p_auth_session_id, p_app_session_hash, 'validate');
  if result->>'code' <> 'OK' then return result; end if;
  select * into strict s from public.global_operator_session where slot_id = 1 for update;
  t := clock_timestamp();
  if s.expires_at <= t then return jsonb_build_object('code', 'SESSION_TIMEOUT'); end if;
  if p_activity_revision is null or p_activity_revision <= 0 or p_activity_revision > 9007199254740991
    or p_activity_at is null or not isfinite(p_activity_at) then
    return jsonb_build_object('code', 'INVALID_ACTIVITY');
  end if;
  -- Reordered events and retries (even with changed timestamps) cannot extend.
  if p_activity_revision <= s.last_activity_revision then
    return jsonb_build_object('code', 'OK', 'serverNow', t, 'duplicate', true,
      'lastActivityRevision', s.last_activity_revision, 'lastActiveAt', s.last_active_at, 'expiresAt', s.expires_at);
  end if;
  -- JavaScript ISO dates have millisecond precision; DB timestamps can have
  -- microseconds. This tolerance never lengthens the existing lease.
  if p_activity_at > t or p_activity_at + interval '1 millisecond' < s.created_at then
    return jsonb_build_object('code', 'INVALID_ACTIVITY');
  end if;
  if p_activity_at < t - interval '45 seconds' then
    return jsonb_build_object('code', 'ACTIVITY_STALE');
  end if;
  -- Queue/transport delay is subtracted, never added to the ten-minute TTL.
  update public.global_operator_session set
    last_activity_revision = p_activity_revision,
    last_active_at = greatest(s.last_active_at, p_activity_at),
    expires_at = greatest(s.expires_at, p_activity_at + interval '10 minutes')
    where slot_id = 1 returning * into s;
  return jsonb_build_object('code', 'OK', 'serverNow', t, 'duplicate', false,
    'lastActivityRevision', s.last_activity_revision, 'lastActiveAt', s.last_active_at, 'expiresAt', s.expires_at);
end;
$$;
revoke all on function public.operator_session_extend(uuid, uuid, text, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.operator_session_extend(uuid, uuid, text, bigint, timestamptz) to service_role;
-- CREATE OR REPLACE retains existing ACLs on acquire/check. Reassert the contract.
revoke all on function public.operator_session_acquire(uuid, uuid, text),
  public.operator_session_check(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.operator_session_acquire(uuid, uuid, text),
  public.operator_session_check(uuid, uuid, text, text) to service_role;
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

