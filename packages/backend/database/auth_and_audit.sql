-- =============================================================================
-- UNGGULTECH AUTHENTICATION & AUDIT LOG MIGRATION
-- =============================================================================
-- Deskripsi:
-- 1. Menambahkan tabel `public.user_sessions` untuk kontrol Single Active Session
--    dan pelacakan inaktivitas.
-- 2. Menambahkan tabel `public.audit_logs` untuk mencatat seluruh aktivitas
--    penting operator tanpa menyimpan kredensial sensitif.
-- 3. Menjaga struktur tabel existing tetap utuh (tanpa perubahan tabel lain).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- =============================================================================
-- 1. TABEL USER_SESSIONS (Single Device / Active Session Control)
-- =============================================================================
create table if not exists public.user_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id text not null,
  last_active_at timestamptz not null default timezone('utc', now()),
  user_agent text,
  ip_address text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_user_sessions_session_id
  on public.user_sessions (session_id);

create index if not exists idx_user_sessions_last_active
  on public.user_sessions (last_active_at);

-- =============================================================================
-- 2. TABEL AUDIT_LOGS (Audit Trail Operator)
-- =============================================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (
    action in (
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'LOGOUT_MANUAL',
      'LOGOUT_TIMEOUT',
      'DOWNLOAD_HISTORICAL_DATA',
      'RAINFALL_CREATE',
      'RAINFALL_UPDATE'
    )
  ),
  resource text,
  resource_id text,
  metadata jsonb default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_audit_logs_user_id
  on public.audit_logs (user_id);

create index if not exists idx_audit_logs_action
  on public.audit_logs (action);

create index if not exists idx_audit_logs_created_at
  on public.audit_logs (created_at desc);

-- =============================================================================
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================
alter table public.user_sessions enable row level security;
alter table public.audit_logs enable row level security;

-- user_sessions: Layanan backend Express menggunakan Supabase Service Role Key
-- yang secara default mem-bypass RLS. Kebijakan ini memastikan client anonim/pengguna umum
-- tidak dapat membaca atau memodifikasi sesi secara sembarangan.
drop policy if exists "user_sessions_service_role" on public.user_sessions;
create policy "user_sessions_service_role"
  on public.user_sessions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "user_sessions_select_own" on public.user_sessions;
create policy "user_sessions_select_own"
  on public.user_sessions
  for select
  to authenticated
  using (auth.uid() = user_id);

-- audit_logs: Hanya dapat diakses dan ditulis oleh backend service role
drop policy if exists "audit_logs_service_role" on public.audit_logs;
create policy "audit_logs_service_role"
  on public.audit_logs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "audit_logs_select_own" on public.audit_logs;
create policy "audit_logs_select_own"
  on public.audit_logs
  for select
  to authenticated
  using (auth.uid() = user_id);
