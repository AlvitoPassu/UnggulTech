-- Align only rainfall unit metadata with the ombrometer's millimeter scale.
-- This migration never changes rainfall_value, timestamps, or rows in other tables.

begin;

do $$
declare
  unit_constraint_definition text;
  unit_default_expression text;
  updated_at_trigger_enabled "char";
begin
  select pg_get_constraintdef(constraint_row.oid)
    into unit_constraint_definition
  from pg_constraint constraint_row
  join pg_class relation_row on relation_row.oid = constraint_row.conrelid
  join pg_namespace schema_row on schema_row.oid = relation_row.relnamespace
  where schema_row.nspname = 'public'
    and relation_row.relname = 'rainfall_readings'
    and constraint_row.conname = 'rainfall_readings_unit_check';

  if unit_constraint_definition is null then
    raise exception 'Expected constraint public.rainfall_readings_unit_check was not found; aborting P4-0 unit alignment.';
  end if;

  if unit_constraint_definition is distinct from 'CHECK ((unit = ''ml''::text))' then
    raise exception 'Constraint public.rainfall_readings_unit_check has unexpected definition (%); aborting P4-0 unit alignment.', unit_constraint_definition;
  end if;

  select pg_get_expr(default_row.adbin, default_row.adrelid)
    into unit_default_expression
  from pg_attrdef default_row
  join pg_attribute attribute_row
    on attribute_row.attrelid = default_row.adrelid
   and attribute_row.attnum = default_row.adnum
  join pg_class relation_row on relation_row.oid = default_row.adrelid
  join pg_namespace schema_row on schema_row.oid = relation_row.relnamespace
  where schema_row.nspname = 'public'
    and relation_row.relname = 'rainfall_readings'
    and attribute_row.attname = 'unit';

  if unit_default_expression is distinct from '''ml''::text' then
    raise exception 'Default public.rainfall_readings.unit has unexpected definition (%); aborting P4-0 unit alignment.', unit_default_expression;
  end if;

  select trigger_row.tgenabled
    into updated_at_trigger_enabled
  from pg_trigger trigger_row
  join pg_class relation_row on relation_row.oid = trigger_row.tgrelid
  join pg_namespace schema_row on schema_row.oid = relation_row.relnamespace
  where schema_row.nspname = 'public'
    and relation_row.relname = 'rainfall_readings'
    and trigger_row.tgname = 'set_rainfall_readings_updated_at'
    and not trigger_row.tgisinternal;

  if updated_at_trigger_enabled is null then
    raise exception 'Expected trigger public.set_rainfall_readings_updated_at was not found; aborting P4-0 unit alignment.';
  end if;

  if updated_at_trigger_enabled <> 'O' then
    raise exception 'Trigger public.set_rainfall_readings_updated_at is not normally enabled (tgenabled = %); aborting P4-0 unit alignment.', updated_at_trigger_enabled;
  end if;
end;
$$;

alter table public.rainfall_readings
  drop constraint rainfall_readings_unit_check;

alter table public.rainfall_readings
  alter column unit set default 'mm';

-- Preserve historical updated_at values while only metadata changes from ml to mm.
alter table public.rainfall_readings
  disable trigger set_rainfall_readings_updated_at;

update public.rainfall_readings
  set unit = 'mm'
  where unit = 'ml';

alter table public.rainfall_readings
  enable trigger set_rainfall_readings_updated_at;

alter table public.rainfall_readings
  add constraint rainfall_readings_unit_check
  check (unit = 'mm');

commit;
