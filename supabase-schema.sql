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
  atendida_por uuid references public.perfiles(id),
  monto_cobrado integer check (monto_cobrado > 0), 
  acepta_no_reembolso boolean not null default false,
  acepta_no_reembolso_en timestamptz,
  motivo_cancelacion text,
  cancelada_por uuid references public.perfiles(id),
  cancelada_en timestamptz,
  reagendada_desde_fecha date,
  reagendada_desde_hora time,
  reagendada_por uuid references public.perfiles(id),
  reagendada_en timestamptz,
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
alter table public.citas add column if not exists atendida_por uuid references public.perfiles(id);
alter table public.citas add column if not exists monto_cobrado integer check (monto_cobrado > 0);
alter table public.citas add column if not exists acepta_no_reembolso boolean not null default false;
alter table public.citas add column if not exists acepta_no_reembolso_en timestamptz;
alter table public.citas add column if not exists motivo_cancelacion text;
alter table public.citas add column if not exists cancelada_por uuid references public.perfiles(id);
alter table public.citas add column if not exists cancelada_en timestamptz;
alter table public.citas add column if not exists reagendada_desde_fecha date;
alter table public.citas add column if not exists reagendada_desde_hora time;
alter table public.citas add column if not exists reagendada_por uuid references public.perfiles(id);
alter table public.citas add column if not exists reagendada_en timestamptz;
alter table public.citas add column if not exists created_at timestamptz not null default now();

create table if not exists public.ingresos (
  id uuid primary key default gen_random_uuid(),
  cita_id uuid not null unique references public.citas(id),
  descripcion text not null,
  monto integer not null check (monto > 0),
  fecha date not null,
  registrado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.egresos (
  id uuid primary key default gen_random_uuid(),
  descripcion text not null,
  categoria text not null check (categoria in ('insumos', 'arriendo', 'gastos_varios', 'otro')),
  monto integer not null check (monto > 0),
  fecha date not null,
  registrado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.servicios (
  id text primary key,
  nombre text not null,
  descripcion text not null default '',
  precio integer not null check (precio > 0),
  duracion integer not null check (duracion > 0),
  icono text not null default 'bi bi-magic',
  imagen_url text not null default '',
  activo boolean not null default true,
  orden integer not null default 0,
  actualizado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Catálogo inicial. Los cambios desde el panel se guardan aquí y se publican
-- automáticamente en el landing a través de /api/servicios.
insert into public.servicios (id, nombre, descripcion, precio, duracion, icono, orden) values
  ('clasicas', 'Pestañas clásicas', 'Un acabado natural y delicado, pelo a pelo.', 80000, 120, 'bi bi-magic', 0),
  ('hibrido', 'Volumen híbrido', 'Equilibrio entre definición y volumen.', 100000, 150, 'bi bi-layers', 1),
  ('ruso', 'Volumen ruso', 'Abanicos ligeros para una mirada intensa.', 120000, 180, 'bi bi-stars', 2),
  ('retoque', 'Mantenimiento / retoque', 'Renueva y conserva tu diseño.', 50000, 90, 'bi bi-arrow-repeat', 3)
on conflict (id) do nothing;

-- Si ya existía la tabla, asegura la columna de imagen sin borrar datos.
alter table public.servicios add column if not exists imagen_url text not null default '';

-- Disponibilidad: horario base semanal + excepciones por fecha. El servidor
-- calcula las horas elegibles para el formulario público.
create table if not exists public.horarios_semana (
  dia_semana integer not null check (dia_semana between 0 and 6),
  hora time not null,
  activo boolean not null default true,
  actualizado_por uuid references public.perfiles(id),
  updated_at timestamptz not null default now(),
  primary key (dia_semana, hora)
);

create table if not exists public.dias_bloqueados (
  fecha date primary key,
  creado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now()
);

-- Excepciones por fecha respecto al horario semanal: disponible=true habilita
-- una hora normalmente cerrada, disponible=false la cierra ese día.
create table if not exists public.disponibilidad_horas (
  fecha date not null,
  hora time not null,
  disponible boolean not null,
  creado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  primary key (fecha, hora)
);

-- Compatibilidad: tabla usada por versiones anteriores.
create table if not exists public.horas_bloqueadas (
  fecha date not null,
  hora time not null,
  creado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  primary key (fecha, hora)
);

create index if not exists citas_lookup_idx on public.citas (cedula, telefono);
create index if not exists citas_agenda_idx on public.citas (fecha, hora);

alter table public.perfiles enable row level security;
alter table public.citas enable row level security;
alter table public.ingresos enable row level security;
alter table public.egresos enable row level security;
alter table public.servicios enable row level security;
alter table public.horarios_semana enable row level security;
alter table public.dias_bloqueados enable row level security;
alter table public.disponibilidad_horas enable row level security;
alter table public.horas_bloqueadas enable row level security;

-- Los clientes no acceden directamente a tablas ni archivos: el servidor
-- valida los datos de consulta y crea enlaces temporales para el equipo.
revoke all on public.perfiles from anon, authenticated;
revoke all on public.citas from anon, authenticated;
revoke all on public.ingresos from anon, authenticated;
revoke all on public.egresos from anon, authenticated;
revoke all on public.servicios from anon, authenticated;
revoke all on public.horarios_semana from anon, authenticated;
revoke all on public.dias_bloqueados from anon, authenticated;
revoke all on public.disponibilidad_horas from anon, authenticated;
revoke all on public.horas_bloqueadas from anon, authenticated;

create or replace function public.marcar_cita_atendida(p_cita_id uuid, p_staff_id uuid, p_monto integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cita public.citas%rowtype;
begin
  if p_monto is null or p_monto < 1 then
    raise exception 'El valor cobrado debe ser mayor que cero.';
  end if;
  select * into v_cita from public.citas where id = p_cita_id for update;
  if not found or v_cita.estado <> 'confirmada' then
    raise exception 'La cita debe estar confirmada para marcarse como atendida.';
  end if;

  update public.citas
    set estado = 'atendida', atendida_por = p_staff_id, monto_cobrado = p_monto
    where id = p_cita_id;

  insert into public.ingresos (cita_id, descripcion, monto, fecha, registrado_por)
    values (p_cita_id, 'Servicio: ' || v_cita.servicio, p_monto, v_cita.fecha, p_staff_id)
    on conflict (cita_id) do nothing;
end;
$$;

revoke all on function public.marcar_cita_atendida(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.marcar_cita_atendida(uuid, uuid, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes-abono', 'comprobantes-abono', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Bucket público para las imágenes de presentación de los servicios. El servidor
-- sube las fotos con la clave de servicio y guarda la URL pública en servicios.imagen_url.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('servicios-imagenes', 'servicios-imagenes', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Después de crear cada usuario en Authentication, agregar su perfil:
-- insert into public.perfiles (id, nombre, rol)
-- values ('UUID_DEL_USUARIO', 'Nombre del equipo', 'admin');
-- Los valores de rol aceptados son 'admin' y 'profesional'.
