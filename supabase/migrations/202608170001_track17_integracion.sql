-- Integración con 17TRACK (rastreo automático proveedor → Miami).
--
-- La app ya traía casi todo listo: tracking_eventos.fuente acepta 'track17' y
-- logistica.service.ts ya traduce eventos del transportista → estado del pedido.
-- Esta migración solo agrega:
--   • el rastro de "ya lo registré en 17track" (para que el barrido diario no
--     vuelva a gastar cuota con un número ya registrado), y
--   • un índice para que el webhook encuentre rápido el trayecto por su guía.
begin;

alter table public.trayectos
  add column if not exists track17_registrado_at timestamptz;

comment on column public.trayectos.track17_registrado_at is
  'Cuándo se registró este número de guía en 17TRACK. NULL = pendiente de registrar.';

create index if not exists trayectos_tracking_idx
  on public.trayectos (tracking)
  where tracking is not null;

commit;
