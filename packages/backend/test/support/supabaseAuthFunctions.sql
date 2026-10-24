-- Isolated fixture: exact pg_proc.prosrc from the 2026-10-12 evidence CSV.
-- Preserve all source bytes; Migration 02 compares md5(p.prosrc).
create role supabase_auth_admin;
grant usage on schema auth to anon, authenticated;
create function auth.email() returns text language sql stable as $evidence$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$evidence$;
alter function auth.email() owner to supabase_auth_admin;
create function auth.jwt() returns jsonb language sql stable as $evidence$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$evidence$;
alter function auth.jwt() owner to supabase_auth_admin;
create function auth.role() returns text language sql stable as $evidence$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$evidence$;
alter function auth.role() owner to supabase_auth_admin;
create function auth.uid() returns uuid language sql stable as $evidence$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$evidence$;
alter function auth.uid() owner to supabase_auth_admin;
