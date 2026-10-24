-- Test-only catalog query; used only against disposable local fixtures. No exported data.
-- REVIEW ONLY: one catalog SELECT; prepared locally, NOT executed on production.
-- Inspect complete routine contracts on the local fixture:
-- full routine metadata/source/probin, effective/default ACL and role inheritance,
-- dependency closure (including non-callable helpers), and indirect write paths.
-- Includes all application routines because dynamic calls need not be in pg_depend.
-- Does not invoke application/extension routines or read rows from application tables,
-- views, FDWs, or Storage. Export section/object_id/details and review privately;
-- customized source/configuration can contain sensitive information.
-- For C routines prosrc is a symbol, not binary source. Binary/build provenance and
-- upstream source review must still be supplied separately; this query cannot prove it.
WITH RECURSIVE
app_namespaces AS (
  SELECT oid FROM pg_catalog.pg_namespace
  WHERE nspname NOT IN ('pg_catalog', 'information_schema')
    AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%'
),
app_routines AS (
  SELECT p.* FROM pg_catalog.pg_proc p
  WHERE p.pronamespace IN (SELECT oid FROM app_namespaces)
),
app_relations AS (
  SELECT c.* FROM pg_catalog.pg_class c
  WHERE c.relnamespace IN (SELECT oid FROM app_namespaces)
),
seed_objects(classid, objid) AS (
  SELECT 'pg_catalog.pg_proc'::regclass::oid, oid FROM app_routines
  UNION SELECT 'pg_catalog.pg_class'::regclass::oid, oid FROM app_relations
  UNION SELECT 'pg_catalog.pg_trigger'::regclass::oid, oid FROM pg_catalog.pg_trigger
    WHERE tgrelid IN (SELECT oid FROM app_relations)
  UNION SELECT 'pg_catalog.pg_event_trigger'::regclass::oid, oid FROM pg_catalog.pg_event_trigger
  UNION SELECT 'pg_catalog.pg_rewrite'::regclass::oid, oid FROM pg_catalog.pg_rewrite
    WHERE ev_class IN (SELECT oid FROM app_relations)
  UNION SELECT 'pg_catalog.pg_policy'::regclass::oid, oid FROM pg_catalog.pg_policy
    WHERE polrelid IN (SELECT oid FROM app_relations)
  UNION SELECT 'pg_catalog.pg_attrdef'::regclass::oid, oid FROM pg_catalog.pg_attrdef
    WHERE adrelid IN (SELECT oid FROM app_relations)
  UNION SELECT 'pg_catalog.pg_constraint'::regclass::oid, oid FROM pg_catalog.pg_constraint
    WHERE connamespace IN (SELECT oid FROM app_namespaces)
  UNION SELECT 'pg_catalog.pg_type'::regclass::oid, oid FROM pg_catalog.pg_type
    WHERE typnamespace IN (SELECT oid FROM app_namespaces)
  UNION SELECT 'pg_catalog.pg_operator'::regclass::oid, oid FROM pg_catalog.pg_operator
    WHERE oprnamespace IN (SELECT oid FROM app_namespaces)
  UNION SELECT 'pg_catalog.pg_cast'::regclass::oid, c.oid FROM pg_catalog.pg_cast c
    JOIN pg_catalog.pg_type src ON src.oid=c.castsource
    JOIN pg_catalog.pg_type dst ON dst.oid=c.casttarget
    WHERE src.typnamespace IN (SELECT oid FROM app_namespaces)
      OR dst.typnamespace IN (SELECT oid FROM app_namespaces)
),
dependency_objects(classid, objid) AS (
  SELECT classid, objid FROM seed_objects
  UNION
  SELECT d.refclassid, d.refobjid FROM dependency_objects o
  JOIN pg_catalog.pg_depend d ON d.classid=o.classid AND d.objid=o.objid
),
routine_scope AS (
  SELECT p.* FROM pg_catalog.pg_proc p
  WHERE p.oid IN (SELECT objid FROM dependency_objects
    WHERE classid='pg_catalog.pg_proc'::regclass)
),
evidence(section, object_id, details) AS (
  SELECT 'environment', 'database', pg_catalog.jsonb_build_object(
    'database', pg_catalog.current_database(), 'server_version', pg_catalog.current_setting('server_version'),
    'server_version_num', pg_catalog.current_setting('server_version_num'),
    'audit_role', current_user, 'session_role', session_user,
    'search_path', pg_catalog.current_setting('search_path'),
    'resolved_search_path', pg_catalog.current_schemas(true),
    'snapshot_at', pg_catalog.statement_timestamp(),
    'routine_scope', 'all application routines plus recorded dependency closure',
    'limitations', 'pg_depend omits string-body and dynamic references; C binary provenance remains external')
  UNION ALL
  SELECT 'routine', p.oid::text, pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object(
    'schema_name', n.nspname, 'routine_owner', pg_catalog.pg_get_userbyid(p.proowner),
    'language', l.lanname, 'language_trusted', l.lanpltrusted,
    'signature', pg_catalog.format('%I.%I(%s)', n.nspname,p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)),
    'input_types', pg_catalog.oidvectortypes(p.proargtypes),
    'result_type', pg_catalog.format_type(p.prorettype,NULL),
    'source_md5', pg_catalog.md5(p.prosrc),
    'definition', CASE WHEN p.prokind IN ('f','p','w') THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END,
    'anon_execute', pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated_execute', pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'service_execute', pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'),
    'anon_schema_usage', pg_catalog.has_schema_privilege('anon',n.oid,'USAGE'),
    'authenticated_schema_usage', pg_catalog.has_schema_privilege('authenticated',n.oid,'USAGE'),
    'extension', (SELECT pg_catalog.jsonb_build_object('name',e.extname,'version',e.extversion,
       'owner',pg_catalog.pg_get_userbyid(e.extowner),'schema',e.extnamespace::regnamespace::text)
      FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid
        AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e'),
    'effective_acl_entries', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantor',pg_catalog.pg_get_userbyid(a.grantor),
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable))
      FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a))
  FROM routine_scope p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  UNION ALL
  SELECT 'dependency', pg_catalog.format('%s/%s/%s->%s/%s/%s',d.classid,d.objid,d.objsubid,
    d.refclassid,d.refobjid,d.refobjsubid), pg_catalog.to_jsonb(d) || pg_catalog.jsonb_build_object(
    'dependent',pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid),
    'referenced',pg_catalog.pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid))
  FROM pg_catalog.pg_depend d WHERE
    EXISTS (SELECT 1 FROM dependency_objects o WHERE o.classid=d.classid AND o.objid=d.objid)
    OR EXISTS (SELECT 1 FROM dependency_objects o WHERE o.classid=d.refclassid AND o.objid=d.refobjid)
  UNION ALL
  SELECT 'role', r.oid::text, pg_catalog.jsonb_build_object('name',r.rolname,'superuser',r.rolsuper,
    'bypassrls',r.rolbypassrls,'inherit',r.rolinherit,'createrole',r.rolcreaterole,
    'createdb',r.rolcreatedb,'replication',r.rolreplication,'config',r.rolconfig,
    'anon_member',pg_catalog.pg_has_role('anon',r.oid,'MEMBER'),
    'authenticated_member',pg_catalog.pg_has_role('authenticated',r.oid,'MEMBER'),
    'service_member',pg_catalog.pg_has_role('service_role',r.oid,'MEMBER'))
  FROM pg_catalog.pg_roles r
  UNION ALL
  SELECT 'role_membership', pg_catalog.format('%s/%s',m.roleid,m.member), pg_catalog.to_jsonb(m) ||
    pg_catalog.jsonb_build_object('role',pg_catalog.pg_get_userbyid(m.roleid),
      'member_name',pg_catalog.pg_get_userbyid(m.member),'grantor_name',pg_catalog.pg_get_userbyid(m.grantor))
  FROM pg_catalog.pg_auth_members m
  UNION ALL
  SELECT 'role_database_setting', pg_catalog.format('%s/%s',s.setdatabase,s.setrole), pg_catalog.to_jsonb(s)
  FROM pg_catalog.pg_db_role_setting s
  WHERE s.setdatabase=0 OR s.setdatabase=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
  UNION ALL
  SELECT 'default_acl', a.oid::text, pg_catalog.to_jsonb(a) ||
    pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(a.defaclrole))
  FROM pg_catalog.pg_default_acl a
  UNION ALL
  SELECT 'schema', n.oid::text, pg_catalog.to_jsonb(n) || pg_catalog.jsonb_build_object(
    'owner',pg_catalog.pg_get_userbyid(n.nspowner),
    'anon_create',pg_catalog.has_schema_privilege('anon',n.oid,'CREATE'),
    'authenticated_create',pg_catalog.has_schema_privilege('authenticated',n.oid,'CREATE'),
    'anon_usage',pg_catalog.has_schema_privilege('anon',n.oid,'USAGE'),
    'authenticated_usage',pg_catalog.has_schema_privilege('authenticated',n.oid,'USAGE'))
  FROM pg_catalog.pg_namespace n WHERE n.oid IN (SELECT oid FROM app_namespaces) OR n.nspname='pg_catalog'
  UNION ALL
  SELECT 'relation', c.oid::text, pg_catalog.to_jsonb(c) || pg_catalog.jsonb_build_object(
    'signature',pg_catalog.format('%I.%I',n.nspname,c.relname),'owner',pg_catalog.pg_get_userbyid(c.relowner),
    'view_definition', CASE WHEN c.relkind IN ('v','m') THEN pg_catalog.pg_get_viewdef(c.oid,true) ELSE NULL END,
    'anon_table_write',CASE WHEN c.relkind IN ('r','p','v','m','f') THEN pg_catalog.has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ELSE NULL END,
    'authenticated_table_write',CASE WHEN c.relkind IN ('r','p','v','m','f') THEN pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ELSE NULL END,
    'anon_column_write',CASE WHEN c.relkind IN ('r','p','v','m','f') THEN pg_catalog.has_any_column_privilege('anon',c.oid,'INSERT,UPDATE,REFERENCES') ELSE NULL END,
    'authenticated_column_write',CASE WHEN c.relkind IN ('r','p','v','m','f') THEN pg_catalog.has_any_column_privilege('authenticated',c.oid,'INSERT,UPDATE,REFERENCES') ELSE NULL END)
  FROM app_relations c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  UNION ALL
  SELECT 'column', pg_catalog.format('%s/%s',a.attrelid,a.attnum), pg_catalog.to_jsonb(a)
  FROM pg_catalog.pg_attribute a WHERE a.attrelid IN (SELECT oid FROM app_relations)
    AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'index', i.indexrelid::text, pg_catalog.to_jsonb(i) || pg_catalog.jsonb_build_object(
    'definition',pg_catalog.pg_get_indexdef(i.indexrelid),
    'expressions',pg_catalog.pg_get_expr(i.indexprs,i.indrelid),
    'predicate',pg_catalog.pg_get_expr(i.indpred,i.indrelid))
  FROM pg_catalog.pg_index i WHERE i.indrelid IN (SELECT oid FROM app_relations)
  UNION ALL
  SELECT 'trigger', t.oid::text, pg_catalog.to_jsonb(t) || pg_catalog.jsonb_build_object(
    'definition',pg_catalog.pg_get_triggerdef(t.oid,true))
  FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM app_relations)
  UNION ALL
  SELECT 'event_trigger', t.oid::text, pg_catalog.to_jsonb(t) FROM pg_catalog.pg_event_trigger t
  UNION ALL
  SELECT 'rule', r.oid::text, pg_catalog.to_jsonb(r) || pg_catalog.jsonb_build_object(
    'definition',pg_catalog.pg_get_ruledef(r.oid,true))
  FROM pg_catalog.pg_rewrite r WHERE r.ev_class IN (SELECT oid FROM app_relations)
  UNION ALL
  SELECT 'policy', p.oid::text, pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object(
    'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'with_check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
  FROM pg_catalog.pg_policy p WHERE p.polrelid IN (SELECT oid FROM app_relations)
  UNION ALL
  SELECT 'column_default', d.oid::text, pg_catalog.to_jsonb(d) || pg_catalog.jsonb_build_object(
    'definition',pg_catalog.pg_get_expr(d.adbin,d.adrelid))
  FROM pg_catalog.pg_attrdef d WHERE d.adrelid IN (SELECT oid FROM app_relations)
  UNION ALL
  SELECT 'constraint', c.oid::text, pg_catalog.to_jsonb(c) || pg_catalog.jsonb_build_object(
    'definition',pg_catalog.pg_get_constraintdef(c.oid,true))
  FROM pg_catalog.pg_constraint c WHERE c.connamespace IN (SELECT oid FROM app_namespaces)
  UNION ALL
  SELECT 'inheritance', pg_catalog.format('%s/%s',i.inhrelid,i.inhparent), pg_catalog.to_jsonb(i)
  FROM pg_catalog.pg_inherits i WHERE i.inhrelid IN (SELECT oid FROM app_relations)
    OR i.inhparent IN (SELECT oid FROM app_relations)
  UNION ALL
  SELECT 'operator', o.oid::text, pg_catalog.to_jsonb(o) FROM pg_catalog.pg_operator o
  WHERE o.oid IN (SELECT objid FROM dependency_objects WHERE classid='pg_catalog.pg_operator'::regclass)
  UNION ALL
  SELECT 'type', t.oid::text, pg_catalog.to_jsonb(t) FROM pg_catalog.pg_type t
  WHERE t.oid IN (SELECT objid FROM dependency_objects WHERE classid='pg_catalog.pg_type'::regclass)
  UNION ALL
  SELECT 'cast', c.oid::text, pg_catalog.to_jsonb(c) FROM pg_catalog.pg_cast c
  WHERE c.castsource IN (SELECT objid FROM dependency_objects WHERE classid='pg_catalog.pg_type'::regclass)
    OR c.casttarget IN (SELECT objid FROM dependency_objects WHERE classid='pg_catalog.pg_type'::regclass)
  UNION ALL
  SELECT 'extension', e.oid::text, pg_catalog.to_jsonb(e) FROM pg_catalog.pg_extension e
  UNION ALL
  SELECT 'foreign_table', f.ftrelid::text, pg_catalog.jsonb_build_object(
    'relation',f.ftrelid,'server',f.ftserver,'wrapper',s.srvfdw)
  FROM pg_catalog.pg_foreign_table f JOIN pg_catalog.pg_foreign_server s ON s.oid=f.ftserver
  WHERE f.ftrelid IN (SELECT oid FROM app_relations)
)
SELECT section, object_id, details FROM evidence ORDER BY section, object_id;
