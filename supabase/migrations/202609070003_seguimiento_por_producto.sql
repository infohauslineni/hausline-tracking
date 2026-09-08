-- Hausline · Seguimiento por producto dentro de un pedido (Fase 1).
--
-- Un pedido de varios productos (típico de un carrito web agrupado) puede tener productos que
-- llegan del proveedor y se envían en momentos/paquetes distintos. Estas columnas permiten
-- seguir CADA producto por separado sin romper el pago único ni el estado general del pedido:
--   • pedido_items.estado_item: la etapa de ese producto (por llegar → recibido → enviado → entregado).
--   • archivos_pedido.pedido_item_id: enlaza una foto (p. ej. de control de calidad) a un producto.
begin;

alter table public.pedido_items
  add column if not exists estado_item text not null default 'pendiente'
  check (estado_item in ('pendiente', 'recibido', 'enviado', 'entregado'));

alter table public.archivos_pedido
  add column if not exists pedido_item_id uuid references public.pedido_items(id) on delete set null;

create index if not exists archivos_pedido_item_idx on public.archivos_pedido(pedido_item_id);

commit;
