begin;

-- Marca a nivel de pedido: el cliente pidió envío rápido (14-17 días) en vez
-- del estándar (20-25 días). Es solo informativo para el equipo; no cambia
-- montos ni cálculos. Por defecto queda en false (envío estándar).
alter table public.pedidos
  add column if not exists envio_rapido boolean not null default false;

comment on column public.pedidos.envio_rapido is
  'El cliente pidió envío rápido (14-17 días) en lugar del estándar (20-25 días). Solo informativo.';

commit;
