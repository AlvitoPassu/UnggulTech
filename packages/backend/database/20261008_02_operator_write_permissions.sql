-- LOCAL REVIEW ONLY. Focused rainfall hardening; not approved for production.
-- Apply after Migration 01 and before 03. No global Supabase-routine allowlist.
-- Catalog/source hints cannot prove the absence of arbitrary dynamic/native paths.
-- Review relevant RPC exposure and indirect write paths before production.
-- No historical data, sensor grants, public SELECT or platform routines are changed.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public;

do $guard$
declare
  rainfall oid := pg_catalog.to_regclass('public.rainfall_readings');
  rainfall_owner oid;
  related_relations oid[];
  related_routines oid[];
  risk text;
  trigger_risks text;
begin
  select relowner into rainfall_owner from pg_catalog.pg_class
    where oid=rainfall and relkind='r';
  if rainfall_owner is null then
    raise exception 'Expected ordinary public.rainfall_readings table: manual review required';
  end if;
  if exists(select 1 from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated')
    and (r.rolsuper or r.rolbypassrls or r.rolcreaterole)) then
    raise exception 'Untrusted API role is privileged: stop and review';
  end if;
  if pg_catalog.pg_has_role('anon','service_role','MEMBER')
    or pg_catalog.pg_has_role('authenticated','service_role','MEMBER') then
    raise exception 'Untrusted API roles inherit service_role: stop and review';
  end if;
  if exists(select 1 from pg_catalog.pg_roles r where (r.rolsuper or r.rolbypassrls or r.rolcreaterole)
    and (pg_catalog.pg_has_role('anon',r.oid,'MEMBER')
      or pg_catalog.pg_has_role('authenticated',r.oid,'MEMBER'))) then
    raise exception 'API role can assume a privileged role: manual review required';
  end if;
  if pg_catalog.pg_has_role('anon',rainfall_owner,'MEMBER')
    or pg_catalog.pg_has_role('authenticated',rainfall_owner,'MEMBER') then
    raise exception 'API role can assume rainfall owner: manual review required';
  end if;
  if exists(select 1 from pg_catalog.pg_inherits where inhrelid=rainfall or inhparent=rainfall) then
    raise exception 'Rainfall inheritance/partition paths: manual review required';
  end if;

  -- Follow rainfall dependencies and nested view aliases across schemas.
  -- Rewrite objects carry view dependencies; bridge them back to the view.
  with recursive edges(src_class,src_id,dst_class,dst_id) as (
    select refclassid,refobjid,classid,objid from pg_catalog.pg_depend
    union all
    select 'pg_catalog.pg_rewrite'::regclass,oid,'pg_catalog.pg_class'::regclass,ev_class
      from pg_catalog.pg_rewrite
  ), related(classid,objid) as (
    select 'pg_catalog.pg_class'::regclass::oid,rainfall
    union
    select e.dst_class,e.dst_id from related r join edges e
      on e.src_class=r.classid and e.src_id=r.objid
  )
  select array_agg(objid) filter(where classid='pg_catalog.pg_class'::regclass),
    array_agg(objid) filter(where classid='pg_catalog.pg_proc'::regclass)
    into related_relations,related_routines from related;

  -- Seed only explicit rainfall references/dependencies and definer capabilities.
  -- Follow recorded and visible string-body calls, not a global routine allowlist.
  with recursive candidates as (
    select p.* from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema')
  ), seeds(oid) as (
    select p.oid from candidates p
    where p.oid=any(coalesce(related_routines,'{}'::oid[]))
      or p.prosrc ilike '%rainfall_readings%'
      or (p.prosecdef and (
        pg_catalog.pg_has_role(p.proowner,rainfall_owner,'MEMBER')
        or pg_catalog.pg_has_role(p.proowner,'service_role','MEMBER')
        or pg_catalog.has_table_privilege(p.proowner,rainfall,'INSERT,UPDATE,DELETE,TRUNCATE')
        or pg_catalog.has_any_column_privilege(p.proowner,rainfall,'INSERT,UPDATE')))
  ), calls(caller,callee) as (
    select d.objid,d.refobjid from pg_catalog.pg_depend d
      where d.classid='pg_catalog.pg_proc'::regclass and d.refclassid='pg_catalog.pg_proc'::regclass
    union
    select caller.oid,callee.oid from candidates caller join candidates callee
      on caller.oid<>callee.oid and position(callee.proname::text in caller.prosrc)>0
    union
    -- A definer can delegate via dynamic SQL under its owner role. If that owner
    -- can execute a rainfall capability, require chain review before allowing it.
    select caller.oid,callee.oid from candidates caller join seeds callee
      on caller.prosecdef and caller.oid<>callee.oid
      and pg_catalog.has_function_privilege(caller.proowner,callee.oid,'EXECUTE')
  ), reachable(oid) as (
    select oid from seeds
    union
    select c.caller from reachable r join calls c on c.callee=r.oid
  )
  select array_agg(oid) into related_routines from reachable;

  select pg_catalog.format('%I.%I(%s)',n.nspname,p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid)) into risk
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname not in ('pg_catalog','information_schema') and p.prokind in ('f','p')
    and p.prorettype not in ('pg_catalog.trigger'::regtype,'pg_catalog.event_trigger'::regtype)
    and (pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'))
    -- Public application RPCs can construct object names dynamically. Known
    -- rainfall paths in ANY schema remain blockers even without schema USAGE.
    and (n.nspname='public' or p.oid=any(coalesce(related_routines,'{}'::oid[])))
  order by p.prosecdef desc,n.nspname,p.proname limit 1;
  if risk is not null then
    raise exception 'Callable rainfall/application RPC or unreviewed invoker routine: %; manual chain review required',risk;
  end if;

  if exists(select 1 from pg_catalog.pg_class c
    where c.relkind='v' and c.oid=any(related_relations)
      and (pg_catalog.has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE')
        or pg_catalog.has_any_column_privilege('anon',c.oid,'INSERT,UPDATE')
        or pg_catalog.has_any_column_privilege('authenticated',c.oid,'INSERT,UPDATE'))) then
    raise exception 'Writable view depends on rainfall: manual rule/dependency review required';
  end if;
  -- Triggers/rules on other writable tables can run privileged, dynamic code.
  -- Keep these indirect entrypoints fail-closed; leave their permissions intact.
  -- Supabase-managed triggers are not necessarily tgisinternal. Schema, owner,
  -- name, SECURITY INVOKER and an empty pg_depend result do not establish safety.
  -- Exact reviewed Storage contracts: inventory (9), metadata/fingerprints (10),
  -- pg_get_functiondef source (11), and full trigger metadata (12), exported
  -- from production 2026-10-24. Argument counts AND raw bytes must match (12).
  -- All five bodies only validate Storage state or set NEW.updated_at; no SQL
  -- writes, dynamic SQL or application helpers. MD5 values below are the exported
  -- md5(prosrc), checked against the raw source in the source CSV, not invented
  -- or whitespace-normalized. Tests retain both original exports byte-for-byte.
  -- Never extend this to a schema/owner-only exemption. A WHEN expression is
  -- executable code outside prosrc, so it is deliberately NOT exempted.
  -- Report every unresolved entrypoint so the missing evidence can be collected
  -- without modifying or disabling any platform trigger.
  select pg_catalog.string_agg(pg_catalog.format('%I.%I: %I -> %I.%I(%s) [owner=%I, definer=%s, type=%s, enabled=%s, source_md5=%s]',
      n.nspname,c.relname,tr.tgname,pn.nspname,p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid),
      pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,tr.tgtype,tr.tgenabled,pg_catalog.md5(p.prosrc)),
      E'\n' order by n.nspname,c.relname,tr.tgname) into trigger_risks
    from pg_catalog.pg_trigger tr
    join pg_catalog.pg_class c on c.oid=tr.tgrelid
    join pg_catalog.pg_proc p on p.oid=tr.tgfoid
    join pg_catalog.pg_namespace pn on pn.oid=p.pronamespace
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where not tr.tgisinternal and n.nspname not in ('pg_catalog','information_schema')
      and (c.oid=rainfall
        or pg_catalog.has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE')
        or pg_catalog.has_any_column_privilege('anon',c.oid,'INSERT,UPDATE')
        or pg_catalog.has_any_column_privilege('authenticated',c.oid,'INSERT,UPDATE'))
      and not (p.oid=pg_catalog.to_regprocedure('public.set_updated_at()') and not p.prosecdef
        and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
        and p.proconfig is null and p.prosupport=0
        and regexp_replace(lower(p.prosrc),'\s','','g')='beginnew.updated_at=timezone(''utc'',now());returnnew;end;'
        and tr.tgtype=19 and tr.tgqual is null and tr.tgnargs=0)
      and not exists (
        select 1 from (values
          ('buckets','enforce_bucket_name_length_trigger','enforce_bucket_name_length',23,'bd3d77a2603f7f344035a81def5502fa',null::text[],0,''),
          ('buckets','protect_bucket_control_insert','protect_bucket_control_columns',7,'7870415452678f5aa85f91dde952ef12',array['search_path=pg_catalog'],1,'736572766963655f726f6c6500'),
          ('buckets','protect_bucket_control_update','protect_bucket_control_columns',19,'7870415452678f5aa85f91dde952ef12',array['search_path=pg_catalog'],0,''),
          ('buckets','protect_bucket_control_update_role','enforce_bucket_lifecycle_service_role',17,'7691066f4111610b457b74bdead6e80b',array['search_path=pg_catalog'],1,'736572766963655f726f6c6500'),
          ('buckets','protect_buckets_delete','protect_delete',10,'998d324ea2b1abc49351e8c2367b5796',null::text[],0,''),
          ('objects','protect_objects_delete','protect_delete',10,'998d324ea2b1abc49351e8c2367b5796',null::text[],0,''),
          ('objects','update_objects_updated_at','update_updated_at_column',19,'7596e66a7698d5a6b5129c5ce9b24c5f',null::text[],0,'')
        ) reviewed(table_name,trigger_name,function_name,trigger_type,source_md5,function_config,argument_count,arguments_hex)
        where n.nspname='storage' and c.relkind='r' and c.relname=reviewed.table_name
          and tr.tgname=reviewed.trigger_name and tr.tgtype=reviewed.trigger_type
          and tr.tgenabled='O' and tr.tgqual is null and tr.tgnargs=reviewed.argument_count
          and pg_catalog.encode(tr.tgargs,'hex')=reviewed.arguments_hex
          and not tr.tgisinternal and tr.tgparentid=0 and tr.tgconstraint=0
          and pn.nspname='storage' and p.proname=reviewed.function_name
          and p.oid=pg_catalog.to_regprocedure(pg_catalog.format('storage.%I()',reviewed.function_name))
          and pg_catalog.pg_get_userbyid(p.proowner)='supabase_storage_admin'
          and not p.prosecdef and not p.proleakproof and not p.proretset
          and p.prokind='f' and p.prorettype='pg_catalog.trigger'::regtype
          and p.pronargs=0 and p.pronargdefaults=0 and p.provariadic=0 and p.prosupport=0
          and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
          and p.proconfig is not distinct from reviewed.function_config
          and pg_catalog.md5(p.prosrc)=reviewed.source_md5
      );
  if trigger_risks is not null then
    raise exception 'Unreviewed trigger on rainfall or API-writable table: manual review required'
      using detail=trigger_risks,
        hint='Collect operator_trigger_missing_evidence_READ_ONLY.sql; review full source, helper/dynamic paths, views and effective privileges before adding an exact contract. Platform identity alone is not approval.';
  end if;
  if exists(select 1 from pg_catalog.pg_rewrite rw join pg_catalog.pg_class c on c.oid=rw.ev_class
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where rw.rulename<>'_RETURN' and n.nspname not in ('pg_catalog','information_schema')
      and (c.oid=rainfall
        or pg_catalog.has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE')
        or pg_catalog.has_any_column_privilege('anon',c.oid,'INSERT,UPDATE')
        or pg_catalog.has_any_column_privilege('authenticated',c.oid,'INSERT,UPDATE'))) then
    raise exception 'Unreviewed writable rule: manual review required';
  end if;
end;
$guard$;

alter table public.rainfall_readings enable row level security;
drop policy if exists rainfall_readings_insert_all on public.rainfall_readings;
drop policy if exists rainfall_operator_no_direct_insert on public.rainfall_readings;
create policy rainfall_operator_no_direct_insert on public.rainfall_readings
  as restrictive for insert to anon, authenticated with check(false);
drop policy if exists rainfall_operator_no_direct_update on public.rainfall_readings;
create policy rainfall_operator_no_direct_update on public.rainfall_readings
  as restrictive for update to anon, authenticated using(false) with check(false);
drop policy if exists rainfall_operator_no_direct_delete on public.rainfall_readings;
create policy rainfall_operator_no_direct_delete on public.rainfall_readings
  as restrictive for delete to anon, authenticated using(false);
revoke insert, update, delete, truncate, references, trigger on public.rainfall_readings
  from public, anon, authenticated;
do $columns$
declare col record;
begin
  for col in select attname from pg_catalog.pg_attribute
    where attrelid='public.rainfall_readings'::regclass and attnum>0 and not attisdropped loop
    execute pg_catalog.format('revoke insert (%I), update (%I), references (%I) on public.rainfall_readings from public, anon, authenticated',
      col.attname,col.attname,col.attname);
  end loop;
end;
$columns$;
grant select, insert, update, delete on public.rainfall_readings to service_role;
do $verify$
begin
  if exists(select 1 from pg_catalog.pg_roles api cross join pg_catalog.pg_roles r
    where api.rolname in ('anon','authenticated')
      and (api.oid=r.oid or pg_catalog.pg_has_role(api.oid,r.oid,'MEMBER'))
    and (pg_catalog.has_table_privilege(r.oid,'public.rainfall_readings','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or pg_catalog.has_any_column_privilege(r.oid,'public.rainfall_readings','INSERT,UPDATE,REFERENCES'))) then
    raise exception 'Inherited rainfall write privileges remain: manual review required';
  end if;
end;
$verify$;
-- Preserve existing SELECT ACL/policies and all sensor permissions.
commit;
