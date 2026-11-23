-- Actualización 006
--  1) Gastos pendientes: la factura ya está adjunta pero los datos aún no se
--     confirman. No cuentan en totales, gráficos ni exportaciones.
--  2) "lectura": con qué se leyó la factura (QR DIAN, texto del PDF, OCR, IA).
-- Ejecutar UNA vez en Supabase > SQL Editor (es seguro repetirla).

alter table public.gastos add column if not exists estado text not null default 'confirmado';
do $$ begin
  alter table public.gastos add constraint gastos_estado_chk check (estado in ('confirmado', 'pendiente'));
exception when duplicate_object then null; end $$;

-- Un pendiente puede no tener monto todavía (se guarda en 0 hasta confirmarlo).
alter table public.gastos drop constraint if exists gastos_monto_check;
do $$ begin
  alter table public.gastos add constraint gastos_monto_chk check (monto > 0 or estado = 'pendiente');
exception when duplicate_object then null; end $$;

alter table public.gastos add column if not exists lectura text;

create index if not exists gastos_pendientes_idx on public.gastos (user_id) where estado = 'pendiente';
