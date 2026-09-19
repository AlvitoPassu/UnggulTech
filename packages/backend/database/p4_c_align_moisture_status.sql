-- P4C: align the sensor_logs compatibility view with the canonical 30/70
-- moisture-status policy. This migration is intentionally limited to the
-- verified live STATE D: sensor_readings is a raw table without status, and
-- sensor_logs is the legacy 40/70 compatibility view.

begin;

do $$
declare
  readings_relkind "char";
  logs_relkind "char";
  view_definition text;
  normalized_definition text;
  view_columns text[];
  view_options text[];
  has_known_view_contract boolean;
  is_legacy_40_70 boolean;
  is_target_30_70 boolean;
begin
  select c.relkind
    into readings_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'sensor_readings';

  if readings_relkind is distinct from 'r' then
    raise exception 'P4C expected public.sensor_readings to be an ordinary table (relkind r), found %.', coalesce(readings_relkind::text, 'missing');
  end if;

  if exists (
    select 1
    from pg_attribute a
    where a.attrelid = 'public.sensor_readings'::regclass
      and a.attname = 'status'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    raise exception 'P4C expected public.sensor_readings to have no status column; aborting unknown schema state.';
  end if;

  if not exists (
    select 1
    from pg_attribute a
    where a.attrelid = 'public.sensor_readings'::regclass
      and a.attname = 'moisture'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    raise exception 'P4C expected public.sensor_readings.moisture; column is missing.';
  end if;

  select c.relkind, c.reloptions, pg_get_viewdef(c.oid, true)
    into logs_relkind, view_options, view_definition
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'sensor_logs';

  if logs_relkind is distinct from 'v' then
    raise exception 'P4C expected public.sensor_logs to be a view (relkind v), found %.', coalesce(logs_relkind::text, 'missing');
  end if;

  if view_options is not null then
    raise exception 'P4C found unsupported public.sensor_logs view options (%); aborting rather than replacing an unknown view contract.', view_options;
  end if;

  select array_agg(a.attname order by a.attnum)
    into view_columns
  from pg_attribute a
  where a.attrelid = 'public.sensor_logs'::regclass
    and a.attnum > 0
    and not a.attisdropped;

  if view_columns is distinct from array[
    'id', 'sensor_id', 'moisture', 'temperature', 'humidity', 'status',
    'pump', 'created_at'
  ]::text[] then
    raise exception 'P4C found unsupported public.sensor_logs column contract (%); aborting.', view_columns;
  end if;

  normalized_definition := regexp_replace(lower(view_definition), '\s+', ' ', 'g');
  has_known_view_contract := normalized_definition ~ 'from.*sensor_readings'
    and normalized_definition ~ 'temperature'
    and normalized_definition ~ 'humidity'
    and normalized_definition ~ 'pump_status.*as.*pump';

  if not has_known_view_contract then
    raise exception 'P4C found an unsupported public.sensor_logs view definition; aborting without replacing an unknown contract.';
  end if;

  is_legacy_40_70 := normalized_definition ~ 'case.*when.*moisture.*<.*40.*then.*low.*when.*moisture.*>.*70.*then.*high.*else.*normal.*end.*as.*status';
  is_target_30_70 := normalized_definition ~ 'case.*when.*moisture.*<=.*30.*then.*low.*when.*moisture.*<=.*70.*then.*normal.*else.*high.*end.*as.*status';

  if is_target_30_70 then
    raise notice 'P4C target 30/70 view definition is already applied; no change made.';
  elsif not is_legacy_40_70 then
    raise exception 'P4C found an unrecognized public.sensor_logs status expression; aborting without guessing.';
  end if;
end;
$$;

do $$
declare
begin
  if regexp_replace(lower(pg_get_viewdef('public.sensor_logs'::regclass, true)), '\s+', ' ', 'g') !~
    'case.*when.*moisture.*<.*40.*then.*low.*when.*moisture.*>.*70.*then.*high.*else.*normal.*end.*as.*status' then
    return;
  end if;

  create or replace view public.sensor_logs as
  select
    sr.id,
    sr.sensor_id,
    sr.moisture,
    sr.temperature,
    sr.humidity,
    case
      when sr.moisture <= 30 then 'Low'
      when sr.moisture <= 70 then 'Normal'
      else 'High'
    end as status,
    sr.pump_status as pump,
    sr.created_at
  from public.sensor_readings sr;
end;
$$;

do $$
declare
  logs_relkind "char";
  view_columns text[];
  normalized_definition text;
begin
  select c.relkind
    into logs_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'sensor_logs';

  if logs_relkind is distinct from 'v' then
    raise exception 'P4C postcondition failed: public.sensor_logs is no longer a view.';
  end if;

  select array_agg(a.attname order by a.attnum)
    into view_columns
  from pg_attribute a
  where a.attrelid = 'public.sensor_logs'::regclass
    and a.attnum > 0
    and not a.attisdropped;

  if view_columns is distinct from array[
    'id', 'sensor_id', 'moisture', 'temperature', 'humidity', 'status',
    'pump', 'created_at'
  ]::text[] then
    raise exception 'P4C postcondition failed: public.sensor_logs column contract changed (%).', view_columns;
  end if;

  normalized_definition := regexp_replace(lower(pg_get_viewdef('public.sensor_logs'::regclass, true)), '\s+', ' ', 'g');
  if normalized_definition !~ 'case.*when.*moisture.*<=.*30.*then.*low.*when.*moisture.*<=.*70.*then.*normal.*else.*high.*end.*as.*status' then
    raise exception 'P4C postcondition failed: public.sensor_logs does not expose the canonical 30/70 status expression.';
  end if;
end;
$$;

commit;
