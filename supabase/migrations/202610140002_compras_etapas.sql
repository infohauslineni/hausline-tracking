-- COMPRAS LIBRES: etapas como un pedido normal (2026-10-14).
-- Para la base y la tienda la compra sigue en estado = 'en_transito' (nada más cambia: tienda,
-- Logística). `etapa` dice en qué parte va: en_preparacion, control_calidad,
-- transito_internacional, recibido_estados_unidos, transito_nicaragua. Al apartarla, el pedido del
-- cliente arranca en esa etapa. Si sale en la tienda o no lo decide `mostrar_tienda`.
alter table public.inversiones add column if not exists etapa text;
alter table public.inversiones drop constraint if exists inversiones_etapa_check;
alter table public.inversiones add constraint inversiones_etapa_check
  check (etapa is null or etapa in ('en_preparacion','control_calidad','transito_internacional','recibido_estados_unidos','transito_nicaragua'));

-- Las que hoy vienen en camino: sin tracking → En preparación; con tracking → En tránsito internacional.
update public.inversiones
set etapa = case when btrim(coalesce(tracking, '')) = '' then 'en_preparacion' else 'transito_internacional' end
where estado = 'en_transito' and etapa is null;

select (select count(*) from information_schema.columns where table_name = 'inversiones' and column_name = 'etapa') as columna_creada,
       (select count(*) from public.inversiones where estado = 'en_transito' and etapa = 'en_preparacion') as en_preparacion,
       (select count(*) from public.inversiones where estado = 'en_transito' and etapa = 'transito_internacional') as en_transito;
