-- Safe migration for an existing Supabase/Postgres database.
-- Tujuan:
-- 1. Tidak menghapus data yang sudah ada.
-- 2. Tidak drop table existing.
-- 3. Menambahkan constraint, index, trigger, dan view yang lebih rapi.
--
-- Jalankan per blok di Supabase SQL Editor agar mudah jika ada error.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- =========================================================
-- 1. PROFILES
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default 'User',
  role text not null default 'viewer',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists role text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.profiles
set
  full_name = coalesce(nullif(trim(full_name), ''), 'User'),
  role = coalesce(nullif(trim(role), ''), 'viewer'),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()));

alter table public.profiles
  alter column full_name set default 'User',
  alter column role set default 'viewer',
  alter column created_at set default timezone('utc', now()),
  alter column updated_at set default timezone('utc', now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_full_name_not_blank'
  ) then
    alter table public.profiles
      add constraint profiles_full_name_not_blank
      check (char_length(trim(full_name)) > 0) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('admin', 'operator', 'viewer')) not valid;
  end if;
end $$;

alter table public.profiles validate constraint profiles_full_name_not_blank;
alter table public.profiles validate constraint profiles_role_check;

alter table public.profiles
  alter column full_name set not null,
  alter column role set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'User')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- =========================================================
-- 2. SENSORS
-- =========================================================

alter table public.sensors
  add column if not exists location text,
  add column if not exists status text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.sensors
set
  status = coalesce(nullif(trim(status), ''), 'Active'),
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()));

alter table public.sensors
  alter column status set default 'Active',
  alter column created_at set default timezone('utc', now()),
  alter column updated_at set default timezone('utc', now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sensors_status_check'
  ) then
    alter table public.sensors
      add constraint sensors_status_check
      check (status in ('Active', 'Inactive', 'Maintenance', 'Offline')) not valid;
  end if;
end $$;

alter table public.sensors validate constraint sensors_status_check;

alter table public.sensors
  alter column sensor_name set not null,
  alter column bedengan set not null,
  alter column status set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create index if not exists sensors_status_idx
  on public.sensors (status);

drop trigger if exists set_sensors_updated_at on public.sensors;
create trigger set_sensors_updated_at
before update on public.sensors
for each row
execute function public.set_updated_at();

-- Optional:
-- Jalankan hanya jika yakin tidak ada duplikasi.
-- create unique index if not exists sensors_sensor_name_key on public.sensors (sensor_name);

-- =========================================================
-- 3. SENSOR_READINGS
-- =========================================================

alter table public.sensor_readings
  add column if not exists temperature numeric,
  add column if not exists humidity numeric,
  add column if not exists created_at timestamptz,
  add column if not exists pump_status text;

update public.sensor_readings
set created_at = coalesce(created_at, timezone('utc', now()));

alter table public.sensor_readings
  alter column created_at set default timezone('utc', now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sensor_readings_sensor_id_fkey'
  ) then
    alter table public.sensor_readings
      add constraint sensor_readings_sensor_id_fkey
      foreign key (sensor_id) references public.sensors (id) on delete cascade not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sensor_readings_moisture_check'
  ) then
    alter table public.sensor_readings
      add constraint sensor_readings_moisture_check
      check (moisture >= 0 and moisture <= 100) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sensor_readings_temperature_check'
  ) then
    alter table public.sensor_readings
      add constraint sensor_readings_temperature_check
      check (temperature is null or (temperature >= -50 and temperature <= 100)) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sensor_readings_humidity_check'
  ) then
    alter table public.sensor_readings
      add constraint sensor_readings_humidity_check
      check (humidity is null or (humidity >= 0 and humidity <= 100)) not valid;
  end if;
end $$;

alter table public.sensor_readings validate constraint sensor_readings_sensor_id_fkey;
alter table public.sensor_readings validate constraint sensor_readings_moisture_check;
alter table public.sensor_readings validate constraint sensor_readings_temperature_check;
alter table public.sensor_readings validate constraint sensor_readings_humidity_check;

alter table public.sensor_readings
  alter column sensor_id set not null,
  alter column moisture set not null,
  alter column created_at set not null;

create index if not exists sensor_readings_sensor_created_at_idx
  on public.sensor_readings (sensor_id, created_at desc);

create index if not exists sensor_readings_created_at_idx
  on public.sensor_readings (created_at desc);

-- =========================================================
-- 4. COMPATIBILITY VIEW FOR BACKEND
-- =========================================================

create or replace view public.sensor_logs as
select
  sr.id,
  sr.sensor_id,
  sr.moisture,
  sr.temperature,
  sr.humidity,
  case
    when sr.moisture < 40 then 'Low'
    when sr.moisture > 70 then 'High'
    else 'Normal'
  end as status,
  sr.pump_status as pump,
  sr.created_at
from public.sensor_readings sr;

-- =========================================================
-- 5. OPTIONAL RLS
-- =========================================================
-- Jangan jalankan bagian ini kalau akses aplikasi Anda sekarang
-- belum siap dengan Row Level Security.
--
-- alter table public.profiles enable row level security;
-- alter table public.sensors enable row level security;
-- alter table public.sensor_readings enable row level security;
--
-- create policy "sensors_read_all"
-- on public.sensors
-- for select
-- to anon, authenticated
-- using (true);
--
-- create policy "sensor_readings_read_all"
-- on public.sensor_readings
-- for select
-- to anon, authenticated
-- using (true);
