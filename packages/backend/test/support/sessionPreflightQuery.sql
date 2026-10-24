-- Test-only catalog query; used only against disposable local fixtures. No exported data.
-- READ-ONLY METADATA ONLY. Do not run against production in this work.
-- Usage: trusted administrator executes SELECT statements on an approved local
-- clone first, retains each result set, then reviews it before any migration.
-- No DDL/DML, no data sampling, no auth tokens, passwords, role settings dump,
-- or raw routine source. Source can embed secrets: fingerprints below are for
-- change detection ONLY, not proof of authorization. Review source privately in
-- a secure admin environment (including helpers, dynamic SQL and extensions).
-- String literals in definitions/defaults/policies are redacted in this output.
-- Unresolved chains/owners/exposure/grants are BLOCKERS, not automatic PASS.
-- Catalog dependencies are incomplete for PL/pgSQL/text/dynamic SQL.
-- Audit count is intentionally omitted: reltuples below is only an estimate.
-- Optional exact action counts require a separately approved, bounded read on a
-- local clone, and must not be added to this metadata-only preflight.

select version(), current_database(), current_user;

-- Relations, ownership, persistence, partitions, RLS and FORCE RLS.
select n.nspname as schema_name, c.relname, c.relkind, c.relpersistence,
  pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls,
  c.relforcerowsecurity as force_rls, c.relispartition, c.reltuples as estimated_rows,
  c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast'
  and c.relkind in ('r','p','v','m','S','f') order by 1,2;

-- Columns and defaults for operator, audit, authentication and ingestion tables.
select n.nspname, c.relname, a.attname, format_type(a.atttypid,a.atttypmod) as type,
  a.attnotnull, a.attidentity, a.attgenerated, a.attacl,
  regexp_replace(pg_get_expr(d.adbin,d.adrelid), '''([^'']|'''')*''', '''[REDACTED]''', 'g') as default_redacted
from pg_attribute a join pg_class c on c.oid=a.attrelid
join pg_namespace n on n.oid=c.relnamespace
left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attnum>0 and not a.attisdropped and c.relname in
  ('rainfall_readings','global_operator_session','operator_session_admissions','user_sessions',
   'audit_logs','users','sessions','profiles','sensors','sensor_readings','soil_ph_readings')
order by 1,2,a.attnum;

-- PK/FK/UNIQUE/CHECK/EXCLUDE; FK target can be in a different schema.
select n.nspname, c.relname, con.conname, con.contype, con.convalidated,
  con.condeferrable, con.condeferred, con.confrelid::regclass as referenced_table,
  regexp_replace(pg_get_constraintdef(con.oid), '''([^'']|'''')*''', '''[REDACTED]''', 'g') as definition_redacted
from pg_constraint con join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname not in ('pg_catalog','information_schema') order by 1,2,3;

select n.nspname, c.relname, i.indexrelid::regclass as index_name,
  i.indisprimary, i.indisunique, i.indisvalid, i.indisready,
  regexp_replace(pg_get_indexdef(i.indexrelid), '''([^'']|'''')*''', '''[REDACTED]''', 'g') as definition_redacted
from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname not in ('pg_catalog','information_schema') order by 1,2,3;

select schemaname, tablename, policyname, permissive, roles, cmd,
  regexp_replace(qual, '''([^'']|'''')*''', '''[REDACTED]''', 'g') as using_redacted,
  regexp_replace(with_check, '''([^'']|'''')*''', '''[REDACTED]''', 'g') as check_redacted
from pg_policies where schemaname not in ('pg_catalog','information_schema') order by 1,2,3;

-- Raw ACL + expanded ACL include PUBLIC (grantee=0), grantor and grant option.
-- acldefault is needed when ACL=NULL (not equivalent to no privileges).
select n.nspname, c.relname, c.relkind,
  case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor, acl.privilege_type, acl.is_grantable
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) acl
where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p','v','m','S','f') order by 1,2,4,6;

select n.nspname, c.relname, a.attname,
  case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor, acl.privilege_type, acl.is_grantable
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(a.attacl) acl
where a.attnum>0 and not a.attisdropped and n.nspname not in ('pg_catalog','information_schema') order by 1,2,3,4;

select n.nspname, pg_get_userbyid(n.nspowner) as owner, n.nspacl,
  case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  acl.privilege_type, acl.is_grantable
from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' order by 1,4;

select pg_get_userbyid(d.defaclrole) as owner, n.nspname as schema_name, d.defaclobjtype,
  d.defaclacl, case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  acl.privilege_type, acl.is_grantable
from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) acl order by 1,2,3;

-- Effective grants include role inheritance/PUBLIC, not only direct ACL.
select r.rolname, n.nspname, has_schema_privilege(r.oid,n.oid,'USAGE') as can_use,
  has_schema_privilege(r.oid,n.oid,'CREATE') as can_create,
  pg_has_role(r.oid,n.nspowner,'MEMBER') as can_assume_owner
from pg_roles r cross join pg_namespace n
where r.rolname in ('anon','authenticated','service_role')
  and n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' order by 1,2;

select r.rolname, n.nspname, c.relname, c.relkind,
  has_schema_privilege(r.oid,n.oid,'USAGE') as schema_usage,
  has_table_privilege(r.oid,c.oid,'SELECT') as can_select,
  has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as any_table_write,
  has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES') as any_column_write,
  pg_has_role(r.oid,c.relowner,'MEMBER') as can_assume_owner
from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
where r.rolname in ('anon','authenticated','service_role') and c.relkind in ('r','p','v','m','f')
  and n.nspname not in ('pg_catalog','information_schema') order by 1,2,3;

select r.rolname, n.nspname, c.relname,
  has_sequence_privilege(r.oid,c.oid,'USAGE') as can_use,
  has_sequence_privilege(r.oid,c.oid,'SELECT') as can_read,
  has_sequence_privilege(r.oid,c.oid,'UPDATE') as can_advance
from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
where r.rolname in ('anon','authenticated','service_role') and c.relkind='S' order by 1,2,3;

select rolname, rolinherit, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
from pg_roles order by rolname;
select member.rolname as member, parent.rolname as parent_role,
  pg_get_userbyid(m.grantor) as grantor, m.admin_option,
  -- Preserve version-specific inherit_option/set_option without PG version assumptions.
  to_jsonb(m)->>'inherit_option' as inherit_option, to_jsonb(m)->>'set_option' as set_option
from pg_auth_members m join pg_roles member on member.oid=m.member
join pg_roles parent on parent.oid=m.roleid order by 1,2;
select api.rolname, parent.rolname as reachable_role,
  pg_has_role(api.oid,parent.oid,'MEMBER') as member,
  pg_has_role(api.oid,parent.oid,'USAGE') as inherited_now
from pg_roles api cross join pg_roles parent where api.rolname in ('anon','authenticated')
  and pg_has_role(api.oid,parent.oid,'MEMBER') order by 1,2;

-- Entire routine inventory: invoker chains are also review items, not just RPC
-- names containing rainfall. EXECUTE is shown even when schema USAGE is absent.
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_userbyid(p.proowner) as owner, l.lanname, p.prokind, p.prosecdef,
  p.provolatile, p.proacl, md5(p.prosrc) as source_fingerprint,
  md5(coalesce(p.prosqlbody::text,'')) as sql_body_fingerprint,
  (select setting from unnest(p.proconfig) setting where setting like 'search_path=%' limit 1) as search_path,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_schema_privilege('anon',n.oid,'USAGE') as anon_schema_usage,
  has_schema_privilege('authenticated',n.oid,'USAGE') as authenticated_schema_usage,
  e.extname as extension_owner,
  case when p.prosecdef then 'REVIEW DEFINER OWNER + FULL CHAIN'
    else 'REVIEW INVOKER CHAIN / DYNAMIC SQL' end as review_required
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
left join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'
left join pg_extension e on e.oid=d.refobjid
where n.nspname not in ('pg_catalog','information_schema') order by 1,2,3;

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor, acl.privilege_type, acl.is_grantable
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
where n.nspname not in ('pg_catalog','information_schema') order by 1,2,3,4;

-- View owner/security_invoker/security_barrier and every potential writable view.
select n.nspname, c.relname, pg_get_userbyid(c.relowner) as owner, c.reloptions,
  pg_relation_is_updatable(c.oid,true) as writable_operation_mask,
  regexp_replace(pg_get_viewdef(c.oid,true), '''([^'']|'''')*''', '''[REDACTED]''', 'g') as definition_redacted
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('v','m') and n.nspname not in ('pg_catalog','information_schema') order by 1,2;

select n.nspname, c.relname, rw.rulename, rw.ev_type, rw.is_instead,
  regexp_replace(pg_get_ruledef(rw.oid,true), '''([^'']|'''')*''', '''[REDACTED]''', 'g') as definition_redacted
from pg_rewrite rw join pg_class c on c.oid=rw.ev_class join pg_namespace n on n.oid=c.relnamespace
where n.nspname not in ('pg_catalog','information_schema') order by 1,2,3;
select n.nspname, c.relname, tr.tgname, tr.tgenabled, tr.tgisinternal,
  tr.tgfoid::regprocedure as function, pg_get_userbyid(p.proowner) as function_owner, p.prosecdef,
  -- Trigger arguments may contain credentials: omit tgargs and literal args.
  tr.tgtype, tr.tgnargs, md5(tr.tgargs::text) as args_fingerprint,
  tr.tgqual is not null as has_when, md5(coalesce(tr.tgqual::text,'')) as when_fingerprint
from pg_trigger tr join pg_class c on c.oid=tr.tgrelid join pg_namespace n on n.oid=c.relnamespace
join pg_proc p on p.oid=tr.tgfoid where n.nspname not in ('pg_catalog','information_schema') order by 1,2,3;
select inhrelid::regclass as child, inhparent::regclass as parent from pg_inherits;

-- Cross-schema dependencies and operator/audit/authentication dependencies.
-- Includes rewrite/default/trigger objects; not a complete function call graph.
select pg_describe_object(d.classid,d.objid,d.objsubid) as dependent,
  pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) as referenced, d.deptype
from pg_depend d
left join pg_class c on d.classid='pg_class'::regclass and c.oid=d.objid
left join pg_proc p on d.classid='pg_proc'::regclass and p.oid=d.objid
left join pg_namespace n on n.oid=coalesce(c.relnamespace,p.pronamespace)
left join pg_class target on d.refclassid='pg_class'::regclass and target.oid=d.refobjid
where (n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast')
  or target.relname in ('rainfall_readings','audit_logs','users','sessions','global_operator_session','operator_session_admissions')
order by 1,2;

-- Exact AND overloaded collisions: existing names require migration history review.
select n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname in
  ('global_operator_session','operator_session_admissions') order by 1,2;
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.proname in ('operator_session_acquire','operator_session_check','operator_session_extend') order by 1,2,3;
select a.attrelid::regclass as relation, a.attname from pg_attribute a
where a.attrelid=to_regclass('public.global_operator_session') and a.attname='last_activity_revision' and not a.attisdropped;

-- PostgREST exposure: hints only. Do NOT dump pg_db_role_setting/settings: they
-- may hold JWT secrets. Dashboard/API gateway/env configuration is NOT provable
-- from catalogs; confirm exposed schemas and role switching with the target admin.
select current_setting('pgrst.db_schemas',true) as exposed_schemas_hint,
  'NOT VERIFIED: confirm Supabase API exposed schemas + gateway configuration externally' as review_required;
select coalesce(r.rolname,'ALL ROLES') as role_name, coalesce(db.datname,'ALL DATABASES') as database_name,
  setting as exposed_schemas_hint
from pg_db_role_setting cfg left join pg_roles r on r.oid=cfg.setrole
left join pg_database db on db.oid=cfg.setdatabase
cross join lateral unnest(cfg.setconfig) setting where setting like 'pgrst.db_schemas=%';
select extname, extversion, extnamespace::regnamespace as schema_name, pg_get_userbyid(extowner) as owner
from pg_extension order by extname;
