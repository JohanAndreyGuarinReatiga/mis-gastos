-- Actualización 004
--  1) Historial de descargas (Excel, CSV, ZIP y archivados).
--  2) Marca de gastos cuyas facturas se archivaron en un respaldo local
--     y se borraron de la nube para liberar espacio.
-- Ejecutar UNA vez en Supabase > SQL Editor (es seguro repetirla).

create table if not exists public.exportaciones (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  tipo        text not null check (tipo in ('xlsx', 'csv', 'zip', 'archivo')),
  periodo     text,             -- p. ej. "2026-11", "historial", "2025-01 a 2025-06"
  desde       date,
  hasta       date,
  gastos      integer not null default 0,
  facturas    integer not null default 0,
  tamano      bigint,           -- peso del archivo descargado
  liberado    bigint,           -- bytes liberados en la nube (solo "archivo")
  nombre      text              -- nombre del archivo descargado
);
create index if not exists exportaciones_user_fecha_idx on public.exportaciones (user_id, created_at desc);

alter table public.exportaciones enable row level security;
drop policy if exists "exportaciones propias" on public.exportaciones;
create policy "exportaciones propias" on public.exportaciones
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.gastos add column if not exists archivado_en timestamptz;
alter table public.gastos add column if not exists archivo_respaldo text;

notify pgrst, 'reload schema';
