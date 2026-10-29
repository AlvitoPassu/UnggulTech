-- STAGE 5B.1: LOCAL REVIEW ONLY. NOT APPROVED FOR PRODUCTION.
-- Execute only in a newly initialized, isolated test database after 01 -> 02 -> 03.
-- Application DB read/write paths require this draft; flags stay opt-in. No JSON import/backfill.
-- The opt-in below prevents accidental execution, NOT proof of environment safety.
-- FK ON DELETE RESTRICT intentionally requires explicit sensor decommission review.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public;

do $preflight$
declare
  checker oid := pg_catalog.to_regprocedure('public.operator_session_check(uuid,uuid,text,text)');
  owner_id oid := (select oid from pg_catalog.pg_roles where rolname = current_user);
  api name;
  relation_name text;
begin
  if pg_catalog.current_setting('unggul.sensor_placements_review', true) is distinct from 'isolated-local-review' then
    raise exception 'Review-only migration: explicit isolated-local-review opt-in required';
  end if;
  if pg_catalog.to_regclass('public.sensor_placements') is not null
    or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='sensor_placement_save') then
    raise exception 'Placement object collision: stop and review; do not overwrite';
  end if;
  foreach relation_name in array array['public.sensors','public.audit_logs','public.global_operator_session'] loop
    if not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass(relation_name)
      and relkind='r' and relowner=owner_id) then
      raise exception 'Expected trusted-owner ordinary table: %', relation_name;
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.sensors'::regclass
      and attname='id' and atttypid='bigint'::regtype and attnotnull and not attisdropped)
    or exists(select 1 from (values ('sensor_name'),('bedengan'),('location')) v(col)
      where not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.sensors'::regclass
        and attname=v.col and atttypid='text'::regtype and not attisdropped))
    or not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='public.sensors'::regclass
      and c.contype='p' and c.conkey=array[(select attnum from pg_catalog.pg_attribute
        where attrelid=c.conrelid and attname='id')]::smallint[]) then
    raise exception 'Unexpected sensors identity/metadata contract';
  end if;
  if exists(select 1 from (values ('user_id','uuid'),('action','text'),('resource','text'),
      ('resource_id','text'),('metadata','jsonb'),('created_at','timestamp with time zone')) v(col,typ)
    where not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.audit_logs'::regclass
      and attname=v.col and atttypid=pg_catalog.to_regtype(v.typ) and not attisdropped))
    or not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.audit_logs'::regclass
      and attname='action' and attnotnull) then
    raise exception 'Unexpected audit_logs column contract';
  end if;
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
      where p.oid=checker and p.proowner=owner_id and p.prosecdef and not p.proretset
      and p.prorettype='jsonb'::regtype and l.lanname='plpgsql'
      and p.proargnames=array['p_user_id','p_auth_session_id','p_app_session_hash','p_operation']::text[]
      and p.proconfig=array['search_path=""']::text[])
    or not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.global_operator_session'::regclass
      and attname='last_activity_revision' and atttypid='bigint'::regtype and not attisdropped) then
    raise exception 'Reviewed Migration 03 operator_session_check contract required';
  end if;
  foreach api in array array['anon','authenticated','service_role']::name[] loop
    if not exists(select 1 from pg_catalog.pg_roles where rolname=api) then
      raise exception 'Missing expected API role: %', api;
    end if;
    if exists(select 1 from pg_catalog.pg_roles r
      where (r.rolname=api or pg_catalog.pg_has_role(api,r.oid,'MEMBER'))
        and (r.oid=owner_id or r.rolsuper or r.rolcreaterole
          or (r.rolbypassrls and r.rolname<>'service_role')
          or pg_catalog.has_schema_privilege(r.oid,'public','CREATE')
          or (api<>'service_role' and (r.rolname='service_role'
            or pg_catalog.has_function_privilege(r.oid,checker,'EXECUTE'))))) then
      raise exception 'Unsafe effective/assumable API role capabilities: %; manual review required', api;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege('service_role',checker,'EXECUTE') then
    raise exception 'Existing backend session-check EXECUTE contract is missing';
  end if;
  -- Definition/body, indirect entrypoints and provisioning still need target review.
  -- These catalog checks do NOT approve unknown deployed authentication logic.
end;
$preflight$;

-- Preserve the complete existing pure action vocabulary, including custom actions.
-- Reject non-enumeration/custom expressions rather than guessing their semantics.
do $audit_vocabulary$
declare old_expression text;
begin
  select pg_catalog.pg_get_expr(c.conbin,c.conrelid) into old_expression
    from pg_catalog.pg_constraint c where c.conrelid='public.audit_logs'::regclass
      and c.conname='audit_logs_action_check' and c.contype='c' and c.convalidated
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute
        where attrelid=c.conrelid and attname='action')]::smallint[];
  if old_expression is null or old_expression !~ $rx$^\(action = ANY \(ARRAY\['[A-Z][A-Z0-9_]*'::text(, '[A-Z][A-Z0-9_]*'::text)*\]\)\)$rx$ then
    raise exception 'Unreviewed audit action constraint: stop and inspect exact vocabulary';
  end if;
  alter table public.audit_logs drop constraint audit_logs_action_check;
  execute pg_catalog.format('alter table public.audit_logs add constraint audit_logs_action_check check ((%s) OR action = %L)',
    old_expression, 'SENSOR_PLACEMENT_SAVE');
end;
$audit_vocabulary$;

create table public.sensor_placements (
  sensor_id bigint primary key references public.sensors(id) on delete restrict,
  location_key text collate "C",
  bed_number smallint not null constraint sensor_placements_bed_check check (bed_number between 1 and 60),
  row_index numeric not null constraint sensor_placements_row_check check (row_index=pg_catalog.trunc(row_index) and row_index between 1 and 10),
  column_index numeric not null constraint sensor_placements_column_check check (column_index=pg_catalog.trunc(column_index) and column_index between 1 and 100),
  version bigint not null default 1 constraint sensor_placements_version_check check (version>0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint sensor_placements_location_check check (location_key is null or (location_key<>'' and location_key=pg_catalog.btrim(location_key,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))),
  constraint sensor_placements_timestamp_check check (created_at<=updated_at)
);
-- Partial unique indexes also work before PG15 (NULLS NOT DISTINCT needs PG15+).
-- No sentinel/COALESCE: SQL NULL and the literal location 'null' remain distinct.
create unique index sensor_placements_point_key on public.sensor_placements(location_key,bed_number,row_index,column_index)
  where location_key is not null;
create unique index sensor_placements_null_point_key on public.sensor_placements(bed_number,row_index,column_index)
  where location_key is null;
alter table public.sensor_placements enable row level security;
-- No browser policies. Backend reads only; mutation requires the definer RPC.

create function public.sensor_placement_save(
  p_user_id uuid, p_auth_session_id uuid, p_app_session_hash text,
  p_sensor_id text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  session_result jsonb;
  sensor public.sensors%rowtype;
  previous public.sensor_placements%rowtype;
  saved public.sensor_placements%rowtype;
  had_previous boolean;
  sensor_id_value bigint;
  expected_version bigint;
  row_value numeric;
  column_value numeric;
  location_value text;
  bed_text text;
  bed_match text[];
  bed_value numeric;
  old_position jsonb;
  new_position jsonb;
  conflict_constraint text;
  t timestamptz;
  -- ECMAScript trim/\s set, including BOM/NBSP: no case folding of location names.
  whitespace text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  -- Only the trusted backend may supply this verified identity. Never client body.
  -- This existing function owns the singleton lock until THIS transaction ends.
  session_result := public.operator_session_check(p_user_id,p_auth_session_id,p_app_session_hash,'validate');
  if session_result->>'code' is distinct from 'OK' then return session_result; end if;
  if p_sensor_id is null or p_sensor_id !~ '^[1-9][0-9]{0,18}$' then
    return pg_catalog.jsonb_build_object('code','INVALID_SENSOR_ID');
  end if;
  if p_sensor_id::numeric>9223372036854775807 then
    return pg_catalog.jsonb_build_object('code','INVALID_SENSOR_ID');
  end if;
  sensor_id_value := p_sensor_id::bigint;
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object' then
    return pg_catalog.jsonb_build_object('code','INVALID_PLACEMENT');
  end if;
  if not (p_payload ?& array['row','column','expectedVersion','expectedContext'])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload))<>4
    or pg_catalog.jsonb_typeof(p_payload->'row') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_payload->'column') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_payload->'expectedContext') is distinct from 'object' then
    return pg_catalog.jsonb_build_object('code','INVALID_PLACEMENT');
  end if;
  row_value := (p_payload->>'row')::numeric;
  column_value := (p_payload->>'column')::numeric;
  if row_value<>pg_catalog.trunc(row_value) or row_value not between 1 and 10
    or column_value<>pg_catalog.trunc(column_value) or column_value not between 1 and 100 then
    return pg_catalog.jsonb_build_object('code','INVALID_PLACEMENT');
  end if;
  if p_payload->'expectedVersion'<>'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_payload->'expectedVersion') is distinct from 'string'
      or (p_payload->>'expectedVersion') !~ '^[1-9][0-9]{0,18}$' then
      return pg_catalog.jsonb_build_object('code','INVALID_EXPECTED_VERSION');
    end if;
    if (p_payload->>'expectedVersion')::numeric>9223372036854775807 then
      return pg_catalog.jsonb_build_object('code','INVALID_EXPECTED_VERSION');
    end if;
    expected_version := (p_payload->>'expectedVersion')::bigint;
  end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_payload->'expectedContext'))<>2
    or not ((p_payload->'expectedContext') ?& array['location','bedengan'])
    or pg_catalog.jsonb_typeof(p_payload->'expectedContext'->'location') not in ('string','null')
    or pg_catalog.jsonb_typeof(p_payload->'expectedContext'->'bedengan') is distinct from 'number' then
    return pg_catalog.jsonb_build_object('code','INVALID_PLACEMENT');
  end if;
  if pg_catalog.jsonb_typeof(p_payload->'expectedContext'->'location')='string'
    and ((p_payload->'expectedContext'->>'location')=''
      or (p_payload->'expectedContext'->>'location') is distinct from
        pg_catalog.btrim(p_payload->'expectedContext'->>'location',whitespace)) then
    return pg_catalog.jsonb_build_object('code','INVALID_PLACEMENT');
  end if;
  if (p_payload->'expectedContext'->>'bedengan')::numeric<>pg_catalog.trunc((p_payload->'expectedContext'->>'bedengan')::numeric)
    or (p_payload->'expectedContext'->>'bedengan')::numeric not between 1 and 60 then
    return pg_catalog.jsonb_build_object('code','INVALID_PLACEMENT');
  end if;
  select * into sensor from public.sensors where id=sensor_id_value for update;
  if not found then return pg_catalog.jsonb_build_object('code','SENSOR_NOT_FOUND'); end if;
  location_value := pg_catalog.btrim(sensor.location,whitespace);
  bed_text := pg_catalog.btrim(pg_catalog.translate(sensor.bedengan,whitespace,
    pg_catalog.repeat(' ',pg_catalog.length(whitespace))));
  bed_match := pg_catalog.regexp_match(bed_text collate "C",'^(?:bedengan *|b *)?([0-9]+)$','i');
  if location_value='' or bed_match is null then
    return pg_catalog.jsonb_build_object('code','SENSOR_CONTEXT_INCOMPLETE');
  end if;
  bed_value := bed_match[1]::numeric;
  if bed_value not between 1 and 60 then
    return pg_catalog.jsonb_build_object('code','SENSOR_CONTEXT_INCOMPLETE');
  end if;
  if (p_payload->'expectedContext'->>'location') collate "C" is distinct from location_value collate "C"
    or (p_payload->'expectedContext'->>'bedengan')::numeric<>bed_value then
    return pg_catalog.jsonb_build_object('code','SENSOR_CONTEXT_CHANGED');
  end if;
  select * into previous from public.sensor_placements where sensor_id=sensor_id_value for update;
  had_previous := found;
  if (had_previous and expected_version is distinct from previous.version)
    or (not had_previous and expected_version is not null) then
    return pg_catalog.jsonb_build_object('code','PLACEMENT_VERSION_CONFLICT');
  end if;
  -- Sensor/placement lock waits may cross TTL. Reuse, never duplicate, auth logic.
  session_result := public.operator_session_check(p_user_id,p_auth_session_id,p_app_session_hash,'validate');
  if session_result->>'code' is distinct from 'OK' then return session_result; end if;
  if had_previous and previous.row_index=row_value and previous.column_index=column_value
    and previous.bed_number=bed_value and previous.location_key is not distinct from location_value collate "C" then
    saved := previous;
  else
    -- A savepoint lets the final authorization check undo BOTH business records
    -- if an index/audit lock wait crossed expiry after the pre-DML check.
    begin
    if had_previous and previous.version=9223372036854775807 then
      return pg_catalog.jsonb_build_object('code','PLACEMENT_VERSION_EXHAUSTED');
    end if;
    t := pg_catalog.clock_timestamp();
    begin
      if had_previous then
        update public.sensor_placements set location_key=location_value,bed_number=bed_value::smallint,
          row_index=row_value,column_index=column_value,version=previous.version+1,
          updated_at=t,updated_by=p_user_id where sensor_id=sensor_id_value returning * into saved;
      else
        insert into public.sensor_placements(sensor_id,location_key,bed_number,row_index,column_index,created_at,updated_at,updated_by)
          values(sensor_id_value,location_value,bed_value::smallint,row_value,column_value,t,t,p_user_id) returning * into saved;
      end if;
    exception when unique_violation then
      get stacked diagnostics conflict_constraint=constraint_name;
      if conflict_constraint in ('sensor_placements_point_key','sensor_placements_null_point_key') then
        return pg_catalog.jsonb_build_object('code','PLACEMENT_OCCUPIED');
      end if;
      raise;
    end;
    old_position := case when had_previous then pg_catalog.jsonb_build_object(
      'row',previous.row_index,'column',previous.column_index,'location',previous.location_key,
      'bedengan',previous.bed_number,'version',previous.version::text) else 'null'::jsonb end;
    new_position := pg_catalog.jsonb_build_object('row',saved.row_index,'column',saved.column_index,
      'location',saved.location_key,'bedengan',saved.bed_number,'version',saved.version::text);
    -- Outside the unique-conflict handler: ANY audit failure rolls back the write.
    insert into public.audit_logs(user_id,action,resource,resource_id,metadata,created_at)
      values(p_user_id,'SENSOR_PLACEMENT_SAVE','sensor_placements',sensor_id_value::text,
        pg_catalog.jsonb_build_object('operator_id',p_user_id,'sensor_id',sensor_id_value::text,
          'old_position',old_position,'new_position',new_position,'outcome','success',
          'operation',case when had_previous then 'update' else 'create' end),t);
    session_result := public.operator_session_check(p_user_id,p_auth_session_id,p_app_session_hash,'validate');
    if session_result->>'code' is distinct from 'OK' then
      raise exception using errcode='PZ001', message='Placement authorization changed before completion';
    end if;
    exception when sqlstate 'PZ001' then
      -- The savepoint also rolled back check()'s expiration audit. Reuse check()
      -- once outside it so the auth outcome persists without a success audit.
      return public.operator_session_check(p_user_id,p_auth_session_id,p_app_session_hash,'validate');
    end;
  end if;
  return pg_catalog.jsonb_build_object('code','OK','sensorId',saved.sensor_id::text,
    'placement',pg_catalog.jsonb_build_object('row',saved.row_index,'column',saved.column_index),
    'context',pg_catalog.jsonb_build_object('location',saved.location_key,'bedengan',saved.bed_number),
    'version',saved.version::text,'updatedAt',saved.updated_at,
    'unchanged',had_previous and saved.version=previous.version);
end;
$$;

-- Strip all inherited DEFAULT ACL grants on ONLY the new objects. Do not change
-- existing memberships/default ACLs/tables/functions to make this draft pass.
do $new_acl$
declare a record; grantee_name text;
begin
  for a in select distinct acl.grantee from pg_catalog.pg_class c,
      lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
      where c.oid='public.sensor_placements'::regclass and acl.grantee<>c.relowner loop
    grantee_name := case when a.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(a.grantee)) end;
    execute 'revoke all on public.sensor_placements from '||grantee_name;
  end loop;
  for a in select distinct acl.grantee from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      where p.oid='public.sensor_placement_save(uuid,uuid,text,text,jsonb)'::regprocedure and acl.grantee<>p.proowner loop
    grantee_name := case when a.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(a.grantee)) end;
    execute 'revoke all on function public.sensor_placement_save(uuid,uuid,text,text,jsonb) from '||grantee_name;
  end loop;
end;
$new_acl$;
revoke all on public.sensor_placements from public, anon, authenticated, service_role;
revoke all on function public.sensor_placement_save(uuid,uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant select on public.sensor_placements to service_role;
grant execute on function public.sensor_placement_save(uuid,uuid,text,text,jsonb) to service_role;

do $verify_acl$
declare api name; target oid := 'public.sensor_placements'::regclass;
begin
  foreach api in array array['anon','authenticated','service_role']::name[] loop
    if exists(select 1 from pg_catalog.pg_roles r
      where (r.rolname=api or pg_catalog.pg_has_role(api,r.oid,'MEMBER'))
        and (pg_catalog.has_table_privilege(r.oid,target,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_any_column_privilege(r.oid,target,'INSERT,UPDATE,REFERENCES')
          or (api<>'service_role' and (pg_catalog.has_table_privilege(r.oid,target,'SELECT')
            or pg_catalog.has_any_column_privilege(r.oid,target,'SELECT')
            or pg_catalog.has_function_privilege(r.oid,'public.sensor_placement_save(uuid,uuid,text,text,jsonb)','EXECUTE'))))) then
      raise exception 'Unexpected effective placement privileges for %',api;
    end if;
  end loop;
end;
$verify_acl$;
notify pgrst, 'reload schema';
commit;
