-- Test-only catalog query; used only against disposable local fixtures. No exported data.
-- LOCAL PREPARATION ONLY: not executed on production by this agent.
-- One catalog-only SELECT for the local trigger contract.
-- Does not execute any Storage/app function or read application rows.
select n.nspname as schema_name,c.relname as table_name,t.tgname as trigger_name,
  pg_catalog.pg_get_triggerdef(t.oid,true) as trigger_definition,
  pg_catalog.pg_get_expr(t.tgqual,t.tgrelid,true) as when_expression,
  t.tgtype,t.tgenabled,t.tgisinternal,t.tgnargs,
  pg_catalog.encode(t.tgargs,'hex') as arguments_hex,
  t.tgconstraint,t.tgparentid,
  pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
  p.oid::regprocedure::text as trigger_function,p.prosecdef,p.proleakproof,
  p.proretset,p.prokind,p.prorettype::regtype::text as return_type,
  p.pronargs,p.pronargdefaults,p.provariadic,p.prosupport,p.proconfig,
  l.lanname as language,pg_catalog.md5(p.prosrc) as source_fingerprint
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid=t.tgrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
join pg_catalog.pg_proc p on p.oid=t.tgfoid
join pg_catalog.pg_language l on l.oid=p.prolang
where n.nspname='storage' and (c.relname,t.tgname) in (
  ('buckets','enforce_bucket_name_length_trigger'),
  ('buckets','protect_bucket_control_insert'),
  ('buckets','protect_bucket_control_update'),
  ('buckets','protect_bucket_control_update_role'),
  ('buckets','protect_buckets_delete'),
  ('objects','protect_objects_delete'),
  ('objects','update_objects_updated_at'))
order by c.relname,t.tgname;
