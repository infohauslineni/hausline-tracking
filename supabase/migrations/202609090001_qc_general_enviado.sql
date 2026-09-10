-- Marca de cuándo se enviaron al cliente las fotos de control de calidad del PEDIDO COMPLETO
-- (las que NO están asignadas a un producto específico; esas usan pedido_items.qc_enviado_at).
-- Sirve para que el botón "Enviar / Reenviar fotos de control de calidad" del panel quede en
-- "ya enviadas" (gris, con confirmación) incluso después de recargar la página.
alter table public.pedidos
  add column if not exists qc_general_enviado_at timestamptz;
