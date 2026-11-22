-- =====================================================================
-- Mis Gastos - esquema de base de datos para Supabase
-- Ejecutar UNA vez en: Supabase > SQL Editor > New query > pegar > Run
-- Es seguro volver a ejecutarlo (idempotente).
-- =====================================================================

-- ---------- Tablas ----------
create table if not exists public.categorias (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre      text not null,
  color       text not null default '#64748b',
  icono       text not null default '📦',
  created_at  timestamptz not null default now(),
  unique (user_id, nombre)
);

create table if not exists public.gastos (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fecha         date not null default current_date,
  monto         numeric(14,2) not null check (monto > 0),
  categoria_id  bigint references public.categorias(id) on delete set null,
  proveedor     text,
  metodo_pago   text,
  descripcion   text,
  created_at    timestamptz not null default now()
);

create table if not exists public.adjuntos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  gasto_id    bigint not null references public.gastos(id) on delete cascade,
  ruta        text not null,          -- ruta dentro del bucket "facturas"
  nombre      text,
  tipo        text,                   -- mime type
  tamano      bigint,
  created_at  timestamptz not null default now()
);

create index if not exists gastos_user_fecha_idx on public.gastos (user_id, fecha desc);
create index if not exists gastos_categoria_idx  on public.gastos (categoria_id);
create index if not exists adjuntos_gasto_idx    on public.adjuntos (gasto_id);

-- ---------- Seguridad: cada usuario solo ve lo suyo ----------
alter table public.categorias enable row level security;
alter table public.gastos     enable row level security;
alter table public.adjuntos   enable row level security;

drop policy if exists "categorias propias" on public.categorias;
create policy "categorias propias" on public.categorias
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "gastos propios" on public.gastos;
create policy "gastos propios" on public.gastos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "adjuntos propios" on public.adjuntos;
create policy "adjuntos propios" on public.adjuntos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- Almacenamiento privado de facturas ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas', 'facturas', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Los archivos se guardan como  <user_id>/<gasto_id>/<archivo>
drop policy if exists "facturas leer propias" on storage.objects;
create policy "facturas leer propias" on storage.objects
  for select to authenticated
  using (bucket_id = 'facturas' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "facturas subir propias" on storage.objects;
create policy "facturas subir propias" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'facturas' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "facturas editar propias" on storage.objects;
create policy "facturas editar propias" on storage.objects
  for update to authenticated
  using (bucket_id = 'facturas' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "facturas borrar propias" on storage.objects;
create policy "facturas borrar propias" on storage.objects
  for delete to authenticated
  using (bucket_id = 'facturas' and (storage.foldername(name))[1] = (select auth.uid())::text);
