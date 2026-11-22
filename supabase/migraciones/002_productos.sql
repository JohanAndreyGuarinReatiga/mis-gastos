-- Actualización: agrega la lista de productos a cada gasto.
-- Ejecutar UNA vez en Supabase > SQL Editor (es seguro repetirla).
alter table public.gastos add column if not exists items jsonb not null default '[]'::jsonb;
notify pgrst, 'reload schema';
