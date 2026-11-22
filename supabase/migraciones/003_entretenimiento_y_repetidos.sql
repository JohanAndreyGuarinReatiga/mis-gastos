-- Actualización 003
--  1) Categoría "Entretenimiento" para los usuarios existentes.
--  2) Datos de la factura (n.º, NIT, CUFE) y huella de cada archivo,
--     para detectar facturas registradas dos veces.
-- Ejecutar UNA vez en Supabase > SQL Editor (es seguro repetirla).

insert into public.categorias (user_id, nombre, color, icono)
select u.id, 'Entretenimiento', '#ec4899', '🎬' from auth.users u
on conflict (user_id, nombre) do nothing;

alter table public.gastos   add column if not exists numero_factura text;
alter table public.gastos   add column if not exists nit text;
alter table public.gastos   add column if not exists cufe text;
alter table public.adjuntos add column if not exists hash text;   -- SHA-256 del archivo original

create index if not exists gastos_numero_idx on public.gastos (user_id, numero_factura);
create index if not exists adjuntos_hash_idx on public.adjuntos (user_id, hash);

notify pgrst, 'reload schema';
