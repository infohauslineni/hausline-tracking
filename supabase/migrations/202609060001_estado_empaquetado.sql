-- Nuevo estado "empaquetado" (Empaquetado, listo para envío) entre "pagado" y "entregado".
--
-- Es el momento en que el pedido ya quedó empacado y listo para salir: delivery en Managua
-- o bus/Cargotrans a los departamentos. Al subir la foto del paquete empacado, el pedido
-- pasa solo a este estado (igual que la foto de Miami avanza a Warehouse) y el cliente
-- recibe el correo automático CON esa foto, para que vea que su pedido ya va en camino y
-- no quede preocupado.
--
-- ADD VALUE con IF NOT EXISTS es idempotente y no usa el valor nuevo en la misma sentencia,
-- así que en Postgres 15 (Supabase) puede ir dentro de transacción.
alter type public.estado_pedido add value if not exists 'empaquetado' before 'entregado';

-- Categoría de foto para el paquete empacado (marca HAUSLINE.NI en la esquina, como la de
-- recepción en Miami). Es lo que dispara el paso a "Empaquetado, listo para envío".
alter type public.tipo_archivo add value if not exists 'empaque';
