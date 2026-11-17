-- Ejecutar una vez en Supabase > SQL Editor.
-- Crear primero los usuarios del equipo en Authentication > Users y luego
-- asociarlos aquí como admin o profesional.

create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('admin', 'profesional')),
  created_at timestamptz not null default now()
);

create table if not exists public.citas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  cedula text not null,
  telefono text not null,
  servicio text not null,
  servicio_id text not null,
  precio integer not null,
  abono integer not null default 20000 check (abono = 20000),
  fecha date not null,
  hora time not null,
  comprobante_path text not null,
  estado text not null default 'pendiente_verificacion'
    check (estado in ('pendiente_verificacion', 'verificada', 'confirmada', 'cancelada', 'atendida')),
  verificada_por uuid references public.perfiles(id),
  confirmada_por uuid references public.perfiles(id),
  created_at timestamptz not null default now()
);

-- Compatibilidad con la tabla citas previa del sitio, si ya existía.
alter table public.citas add column if not exists cedula text;
alter table public.citas add column if not exists servicio_id text;
alter table public.citas add column if not exists precio integer;
alter table public.citas add column if not exists abono integer not null default 20000;
alter table public.citas add column if not exists comprobante_path text;
alter table public.citas add column if not exists estado text not null default 'pendiente_verificacion';
alter table public.citas add column if not exists verificada_por uuid references public.perfiles(id);
alter table public.citas add column if not exists confirmada_por uuid references public.perfiles(id);
alter table public.citas add column if not exists created_at timestamptz not null default now();

create index if not exists citas_lookup_idx on public.citas (cedula, telefono);
create index if not exists citas_agenda_idx on public.citas (fecha, hora);

alter table public.perfiles enable row level security;
alter table public.citas enable row level security;

-- Los clientes no acceden directamente a tablas ni archivos: el servidor
-- valida los datos de consulta y crea enlaces temporales para el equipo.
revoke all on public.perfiles from anon, authenticated;
revoke all on public.citas from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes-abono', 'comprobantes-abono', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Después de crear cada usuario en Authentication, agregar su perfil:
-- insert into public.perfiles (id, nombre, rol)
-- values ('UUID_DEL_USUARIO', 'Nombre del equipo', 'admin');
-- Los valores de rol aceptados son 'admin' y 'profesional'.
