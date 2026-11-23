-- Actualización 005
--  Gastos en dólares: se guarda el monto original en USD y la TRM usada.
--  "monto" sigue siendo siempre el valor en pesos (COP), así los totales,
--  gráficos y exportaciones no cambian.
-- Ejecutar UNA vez en Supabase > SQL Editor (es seguro repetirla).

alter table public.gastos add column if not exists moneda text not null default 'COP';
alter table public.gastos add column if not exists monto_original numeric(14,2);
alter table public.gastos add column if not exists tasa_cambio numeric(12,4);

do $$ begin
  alter table public.gastos add constraint gastos_moneda_chk check (moneda in ('COP', 'USD'));
exception when duplicate_object then null; end $$;
