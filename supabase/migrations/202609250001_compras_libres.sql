-- Hausline · Compras libres (antes "Stock e inversiones")
-- Lo que se compra por cuenta propia para vender, sin pedido de cliente detrás.
--   · pagado: si ya se le pagó al proveedor. false = "por pagar" (no salió de caja todavía;
--     se registra el pago después desde la tarjeta). Lo existente se considera pagado.
--   · estado 'en_transito': comprado pero todavía no llega (se puede apartar igual a un
--     cliente y convertirlo en pedido normal).
begin;

alter table public.inversiones add column if not exists pagado boolean not null default true;
alter table public.inversiones add column if not exists pagado_at timestamptz;

alter table public.inversiones drop constraint if exists inversiones_estado_check;
alter table public.inversiones add constraint inversiones_estado_check
  check (estado in ('en_transito','en_inventario','reservado','vendido','descartado'));

commit;
