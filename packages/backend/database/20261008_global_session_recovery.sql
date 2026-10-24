-- LOCAL REVIEW ONLY. Explicit recovery after reviewing the private RPC backup.
-- Restore saved functions without replaying Migration 01/03 or touching data.
-- A changed definition, owner, OID or backup aborts the entire transaction.
begin;
do $$
declare
  saved record;
  target oid;
  grant_entry record;
  grantee text;
  restored_count integer := 0;
begin
  if (select nspowner from pg_catalog.pg_namespace where nspname='operator_session_recovery')
      is distinct from (select oid from pg_catalog.pg_roles where rolname=current_user)
    or (select relowner from pg_catalog.pg_class where oid='operator_session_recovery.rpc_backup'::regclass)
      is distinct from (select oid from pg_catalog.pg_roles where rolname=current_user) then
    raise exception 'Unexpected recovery storage owner: manual review required';
  end if;
  perform 1 from public.global_operator_session where slot_id=1 for update;
  for saved in select * from operator_session_recovery.rpc_backup order by signature for update loop
    if saved.signature <> all(array[
      'public.operator_session_acquire(uuid,uuid,text)',
      'public.operator_session_check(uuid,uuid,text,text)',
      'public.operator_session_extend(uuid,uuid,text,bigint,timestamptz)'
    ]) then raise exception 'Unexpected saved RPC: %', saved.signature; end if;
    target := pg_catalog.to_regprocedure(saved.signature);
    if target is distinct from saved.function_oid
      or (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc where oid=target) is distinct from saved.owner_name
      or saved.definition_hash <> pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(saved.definition,'UTF8')),'hex')
      or saved.backup_hash <> pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.concat_ws(E'\n',saved.signature,saved.function_oid::text,saved.owner_name::text,
          saved.definition_hash,saved.original_acl::text),'UTF8')),'hex')
      or saved.disabled_hash is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(target),'UTF8')),'hex') then
      raise exception 'RPC backup verification failed: %; authorization remains disabled', saved.signature;
    end if;
    execute saved.definition;
    if saved.definition_hash <> pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(target),'UTF8')),'hex') then
      raise exception 'Restored RPC does not match saved definition: %', saved.signature;
    end if;
    for grant_entry in select distinct a.grantee from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where p.oid=target loop
      grantee := case when grant_entry.grantee=0 then 'public'
        else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(grant_entry.grantee)) end;
      execute pg_catalog.format('revoke all on function %s from %s',target::regprocedure,grantee);
    end loop;
    for grant_entry in select * from pg_catalog.aclexplode(saved.original_acl) loop
      grantee := case when grant_entry.grantee=0 then 'public'
        else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(grant_entry.grantee)) end;
      execute pg_catalog.format('grant execute on function %s to %s%s',target::regprocedure,grantee,
        case when grant_entry.is_grantable then ' with grant option' else '' end);
    end loop;
    if exists(select 1 from pg_catalog.pg_roles api cross join pg_catalog.pg_roles reachable
      where api.rolname in ('anon','authenticated')
        and (api.oid=reachable.oid or pg_catalog.pg_has_role(api.oid,reachable.oid,'MEMBER'))
        and pg_catalog.has_function_privilege(reachable.oid,target,'EXECUTE'))
      or not pg_catalog.has_function_privilege('service_role',target,'EXECUTE') then
      raise exception 'Restored RPC violates API permission contract: %', saved.signature;
    end if;
    restored_count := restored_count + 1;
  end loop;
  if restored_count < 2
    or not exists(select 1 from operator_session_recovery.rpc_backup where signature='public.operator_session_acquire(uuid,uuid,text)')
    or not exists(select 1 from operator_session_recovery.rpc_backup where signature='public.operator_session_check(uuid,uuid,text,text)')
    or (pg_catalog.to_regprocedure('public.operator_session_extend(uuid,uuid,text,bigint,timestamptz)') is not null
      and not exists(select 1 from operator_session_recovery.rpc_backup where signature='public.operator_session_extend(uuid,uuid,text,bigint,timestamptz)')) then
    raise exception 'Incomplete RPC backup: authorization remains disabled';
  end if;
  delete from operator_session_recovery.rpc_backup;
end $$;
notify pgrst, 'reload schema';
commit;
