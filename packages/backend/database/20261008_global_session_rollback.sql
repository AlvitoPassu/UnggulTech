-- LOCAL REVIEW ONLY. Fail-closed emergency shutdown, not a schema rollback.
-- Preserve accounts, readings, audit history, slot and admission tombstones.
-- REVOKE alone cannot stop inherited EXECUTE or implicit owner privileges.
begin;
create schema if not exists operator_session_recovery;
do $$ begin
  if (select nspowner from pg_catalog.pg_namespace where nspname='operator_session_recovery')
    <> (select oid from pg_catalog.pg_roles where rolname=current_user) then
    raise exception 'Unexpected recovery schema owner: manual review required';
  end if;
end $$;
revoke all on schema operator_session_recovery from public, anon, authenticated, service_role;
create table if not exists operator_session_recovery.rpc_backup (
  signature text primary key,
  function_oid oid not null,
  owner_name name not null,
  definition text not null,
  definition_hash text not null,
  original_acl aclitem[] not null,
  backup_hash text not null,
  disabled_hash text
);
do $$ begin
  if (select relowner from pg_catalog.pg_class where oid='operator_session_recovery.rpc_backup'::regclass)
    <> (select oid from pg_catalog.pg_roles where rolname=current_user) then
    raise exception 'Unexpected recovery table owner: manual review required';
  end if;
end $$;
alter table operator_session_recovery.rpc_backup enable row level security;
revoke all on operator_session_recovery.rpc_backup from public, anon, authenticated, service_role;
do $$
declare
  rpc_signature text;
  target oid;
  routine record;
  saved operator_session_recovery.rpc_backup%rowtype;
  definition text;
  fingerprint text;
begin
  if exists(select 1 from pg_catalog.pg_roles api cross join pg_catalog.pg_roles r
    where api.rolname in ('anon','authenticated','service_role')
      and (api.oid=r.oid or pg_catalog.pg_has_role(api.oid,r.oid,'MEMBER'))
      and (pg_catalog.has_schema_privilege(r.oid,'operator_session_recovery','USAGE,CREATE')
        or pg_catalog.has_table_privilege(r.oid,'operator_session_recovery.rpc_backup','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or pg_catalog.has_any_column_privilege(r.oid,'operator_session_recovery.rpc_backup','SELECT,INSERT,UPDATE,REFERENCES'))) then
    raise exception 'Recovery storage is accessible to API roles: manual review required';
  end if;
  perform 1 from public.global_operator_session where slot_id=1 for update;
  foreach rpc_signature in array array[
    'public.operator_session_acquire(uuid,uuid,text)',
    'public.operator_session_check(uuid,uuid,text,text)',
    'public.operator_session_extend(uuid,uuid,text,bigint,timestamptz)'
  ] loop
    target := pg_catalog.to_regprocedure(rpc_signature);
    if target is null then
      if rpc_signature like 'public.operator_session_extend(%' then continue; end if;
      raise exception 'Missing required RPC: %', rpc_signature;
    end if;
    select p.*, n.nspname into routine from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace where p.oid=target;
    if routine.prokind <> 'f' or routine.prorettype <> 'jsonb'::regtype or routine.proretset then
      raise exception 'Unexpected RPC contract: %; manual review required', rpc_signature;
    end if;
    definition := pg_catalog.pg_get_functiondef(target);
    fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(definition,'UTF8')),'hex');
    select * into saved from operator_session_recovery.rpc_backup b where b.signature=rpc_signature;
    if found then
      -- A repeated shutdown must not overwrite the originals with disabled stubs.
      if saved.function_oid <> target or saved.owner_name <> pg_catalog.pg_get_userbyid(routine.proowner)
        or saved.definition_hash <> pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(saved.definition,'UTF8')),'hex')
        or saved.backup_hash <> pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.concat_ws(E'\n',saved.signature,saved.function_oid::text,saved.owner_name::text,
            saved.definition_hash,saved.original_acl::text),'UTF8')),'hex')
        or saved.disabled_hash is distinct from fingerprint then
        raise exception 'Saved RPC or disabled implementation changed: %; manual review required', rpc_signature;
      end if;
    else
      insert into operator_session_recovery.rpc_backup values (
        rpc_signature, target, pg_catalog.pg_get_userbyid(routine.proowner), definition, fingerprint,
        coalesce(routine.proacl, pg_catalog.acldefault('f',routine.proowner)),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.concat_ws(E'\n',rpc_signature,target::text,pg_catalog.pg_get_userbyid(routine.proowner),
            fingerprint,coalesce(routine.proacl,pg_catalog.acldefault('f',routine.proowner))::text),'UTF8')),'hex'), null
      );
    end if;
    -- Preserve OID, parameter names/defaults, owner and dependent callers.
    -- Inherited grantees and owners also reach this unconditional rejection.
    execute pg_catalog.format(
      'create or replace function %I.%I(%s) returns jsonb language plpgsql security invoker set search_path = '''' as %L',
      routine.nspname, routine.proname, pg_catalog.pg_get_function_arguments(target),
      'begin raise exception using errcode = ''55000'', message = ''Operator session authorization disabled by emergency rollback''; end;'
    );
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated, service_role',target::regprocedure);
    update operator_session_recovery.rpc_backup b set disabled_hash =
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(target),'UTF8')),'hex')
      where b.signature=rpc_signature;
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
-- Inspect saved definitions/hash/ACLs, then use 20261008_global_session_recovery.sql.
-- Restoring EXECUTE alone cannot restore authorization.
