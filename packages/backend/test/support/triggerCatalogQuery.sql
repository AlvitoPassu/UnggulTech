-- Test-only catalog query; used only against disposable local fixtures. No exported data.
-- Prepared locally; NOT executed on production. One catalog-only SELECT.
-- Run/export only through the owner's normal read-only review process.
-- No application rows, RPC execution, DDL/DML, trigger changes or Maintenance Gate changes.
-- Scope: the five relations in the local fixture, their actual triggers,
-- possible non-system helpers executable by API/trigger owners, and their writable
-- relations. Dynamic SQL can name helpers absent from pg_depend, so those helpers
-- MUST NOT be filtered solely by dependency or the text 'rainfall_readings'.
-- Source/configuration may contain private information; review export privately.
-- C/internal/native or unresolved dynamic paths still require separate source review.
WITH RECURSIVE
roots AS (
  SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname,c.relname) IN (('public','profiles'),('public','rainfall_readings'),
    ('public','sensors'),('storage','buckets'),('storage','objects'))
),
root_triggers AS (
  SELECT t.* FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM roots)
),
principals AS (
  SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role')
  UNION SELECT p.proowner FROM pg_catalog.pg_proc p JOIN root_triggers t ON t.tgfoid=p.oid
  UNION SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid IN (SELECT oid FROM roots)
),
app_namespaces AS (
  SELECT oid FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema')
    AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%'
),
helper_candidates AS (
  SELECT p.* FROM pg_catalog.pg_proc p WHERE p.oid IN (SELECT tgfoid FROM root_triggers)
    OR (p.pronamespace IN (SELECT oid FROM app_namespaces)
      AND EXISTS (SELECT 1 FROM principals r WHERE pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE')))
),
relations AS (
  SELECT c.* FROM pg_catalog.pg_class c WHERE c.oid IN (SELECT oid FROM roots)
    OR (c.relnamespace IN (SELECT oid FROM app_namespaces) AND c.relkind IN ('r','p','v','m','f')
      AND EXISTS (SELECT 1 FROM principals r
        WHERE pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
          OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE')))
),
seeds(classid,objid) AS (
  SELECT 'pg_catalog.pg_proc'::regclass::oid,oid FROM helper_candidates
  UNION SELECT 'pg_catalog.pg_class'::regclass::oid,oid FROM relations
  UNION SELECT 'pg_catalog.pg_trigger'::regclass::oid,oid FROM pg_catalog.pg_trigger
    WHERE tgrelid IN (SELECT oid FROM relations)
  UNION SELECT 'pg_catalog.pg_rewrite'::regclass::oid,oid FROM pg_catalog.pg_rewrite
    WHERE ev_class IN (SELECT oid FROM relations)
  UNION SELECT 'pg_catalog.pg_attrdef'::regclass::oid,oid FROM pg_catalog.pg_attrdef
    WHERE adrelid IN (SELECT oid FROM relations)
  UNION SELECT 'pg_catalog.pg_policy'::regclass::oid,oid FROM pg_catalog.pg_policy
    WHERE polrelid IN (SELECT oid FROM relations)
),
dependencies(classid,objid) AS (
  SELECT classid,objid FROM seeds
  UNION SELECT d.refclassid,d.refobjid FROM dependencies o JOIN pg_catalog.pg_depend d
    ON d.classid=o.classid AND d.objid=o.objid
),
evidence(section,object_id,details) AS (
  SELECT 'environment','database',pg_catalog.jsonb_build_object(
    'server_version',pg_catalog.current_setting('server_version'),
    'database',pg_catalog.current_database(),'audit_role',current_user,
    'search_path',pg_catalog.current_setting('search_path'),'resolved_search_path',pg_catalog.current_schemas(true),
    'root_relation_count',(SELECT count(*) FROM roots),
    'noninternal_root_trigger_count',(SELECT count(*) FROM root_triggers WHERE NOT tgisinternal))
  UNION ALL
  SELECT 'trigger',t.oid::text,pg_catalog.to_jsonb(t) || pg_catalog.jsonb_build_object(
    'relation',pg_catalog.format('%I.%I',n.nspname,c.relname),
    'production_inventory_root',t.tgrelid IN (SELECT oid FROM roots),
    'function',t.tgfoid::regprocedure::text,'definition',pg_catalog.pg_get_triggerdef(t.oid,true))
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE t.tgrelid IN (SELECT oid FROM relations)
  UNION ALL
  SELECT 'routine',p.oid::text,pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object(
    'signature',pg_catalog.format('%I.%I(%s)',n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)),
    'owner',pg_catalog.pg_get_userbyid(p.proowner),'language',l.lanname,
    'root_trigger_function',p.oid IN (SELECT tgfoid FROM root_triggers),
    'source_md5',pg_catalog.md5(p.prosrc),
    'definition',CASE WHEN p.prokind IN ('f','p','w') THEN pg_catalog.pg_get_functiondef(p.oid) END,
    'principal_execute',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'role',pg_catalog.pg_get_userbyid(r.oid),'execute',pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'),
      'schema_usage',pg_catalog.has_schema_privilege(r.oid,p.pronamespace,'USAGE'))) FROM principals r))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE p.oid IN (SELECT oid FROM helper_candidates) OR p.oid IN (
    SELECT objid FROM dependencies WHERE classid='pg_catalog.pg_proc'::regclass)
  UNION ALL
  SELECT 'relation',c.oid::text,pg_catalog.to_jsonb(c) || pg_catalog.jsonb_build_object(
    'signature',pg_catalog.format('%I.%I',n.nspname,c.relname),'owner',pg_catalog.pg_get_userbyid(c.relowner),
    'view_definition',CASE WHEN c.relkind IN ('v','m') THEN pg_catalog.pg_get_viewdef(c.oid,true) END,
    'principal_privileges',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'role',pg_catalog.pg_get_userbyid(r.oid),
      'insert',pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT'),
      'update',pg_catalog.has_table_privilege(r.oid,c.oid,'UPDATE'),
      'delete',pg_catalog.has_table_privilege(r.oid,c.oid,'DELETE'),
      'truncate',pg_catalog.has_table_privilege(r.oid,c.oid,'TRUNCATE'),
      'column_write',pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE'))) FROM principals r))
  FROM relations c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  UNION ALL
  SELECT 'column',pg_catalog.format('%s/%s',a.attrelid,a.attnum),pg_catalog.to_jsonb(a)
  FROM pg_catalog.pg_attribute a WHERE a.attrelid IN (SELECT oid FROM relations) AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'rule',r.oid::text,pg_catalog.to_jsonb(r) || pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_ruledef(r.oid,true))
  FROM pg_catalog.pg_rewrite r WHERE r.ev_class IN (SELECT oid FROM relations)
  UNION ALL
  SELECT 'column_default',d.oid::text,pg_catalog.to_jsonb(d) || pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_expr(d.adbin,d.adrelid))
  FROM pg_catalog.pg_attrdef d WHERE d.adrelid IN (SELECT oid FROM relations)
  UNION ALL
  SELECT 'policy',p.oid::text,pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object(
    'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'with_check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
  FROM pg_catalog.pg_policy p WHERE p.polrelid IN (SELECT oid FROM relations)
  UNION ALL
  SELECT 'dependency',pg_catalog.format('%s/%s/%s->%s/%s/%s',d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid),
    pg_catalog.to_jsonb(d) || pg_catalog.jsonb_build_object(
      'dependent',pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid),
      'referenced',pg_catalog.pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid))
  FROM pg_catalog.pg_depend d WHERE EXISTS (SELECT 1 FROM dependencies o
    WHERE (o.classid=d.classid AND o.objid=d.objid) OR (o.classid=d.refclassid AND o.objid=d.refobjid))
  UNION ALL
  SELECT 'role',r.oid::text,pg_catalog.jsonb_build_object('name',r.rolname,'superuser',r.rolsuper,
    'bypassrls',r.rolbypassrls,'createrole',r.rolcreaterole,'inherit',r.rolinherit,'config',r.rolconfig,
    'principal_membership',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'role',pg_catalog.pg_get_userbyid(p.oid),'member',pg_catalog.pg_has_role(p.oid,r.oid,'MEMBER'))) FROM principals p))
  FROM pg_catalog.pg_roles r
  UNION ALL
  SELECT 'role_membership',pg_catalog.format('%s/%s',m.roleid,m.member),pg_catalog.to_jsonb(m) FROM pg_catalog.pg_auth_members m
  UNION ALL
  SELECT 'role_database_setting',pg_catalog.format('%s/%s',s.setdatabase,s.setrole),pg_catalog.to_jsonb(s)
  FROM pg_catalog.pg_db_role_setting s WHERE s.setdatabase=0 OR s.setdatabase=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
  UNION ALL
  SELECT 'default_acl',a.oid::text,pg_catalog.to_jsonb(a) FROM pg_catalog.pg_default_acl a
  UNION ALL
  SELECT 'schema',n.oid::text,pg_catalog.to_jsonb(n) || pg_catalog.jsonb_build_object(
    'anon_create',pg_catalog.has_schema_privilege('anon',n.oid,'CREATE'),
    'authenticated_create',pg_catalog.has_schema_privilege('authenticated',n.oid,'CREATE'))
  FROM pg_catalog.pg_namespace n WHERE n.oid IN (SELECT oid FROM app_namespaces) OR n.nspname='pg_catalog'
  UNION ALL
  SELECT 'operator',o.oid::text,pg_catalog.to_jsonb(o) FROM pg_catalog.pg_operator o WHERE o.oprnamespace IN (SELECT oid FROM app_namespaces)
  UNION ALL
  SELECT 'cast',c.oid::text,pg_catalog.to_jsonb(c) FROM pg_catalog.pg_cast c JOIN pg_catalog.pg_type s ON s.oid=c.castsource
    JOIN pg_catalog.pg_type t ON t.oid=c.casttarget WHERE s.typnamespace IN (SELECT oid FROM app_namespaces) OR t.typnamespace IN (SELECT oid FROM app_namespaces)
  UNION ALL
  SELECT 'type',t.oid::text,pg_catalog.to_jsonb(t) FROM pg_catalog.pg_type t WHERE t.typnamespace IN (SELECT oid FROM app_namespaces)
  UNION ALL
  SELECT 'inheritance',pg_catalog.format('%s/%s',i.inhrelid,i.inhparent),pg_catalog.to_jsonb(i)
  FROM pg_catalog.pg_inherits i WHERE i.inhrelid IN (SELECT oid FROM relations) OR i.inhparent IN (SELECT oid FROM relations)
)
SELECT section,object_id,details FROM evidence ORDER BY section,object_id;
