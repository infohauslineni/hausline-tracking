-- Nuevas categorías de foto visibles para el cliente:
--   recepcion_miami -> foto del paquete al llegar a la bodega de la agencia (Miami)
--   recibido_local  -> foto de cuando Hausline recibe el paquete físicamente (con sello de recepción)
-- add value no puede usarse en la misma transacción, por eso no se envuelve en begin/commit.
alter type public.tipo_archivo add value if not exists 'recepcion_miami';
alter type public.tipo_archivo add value if not exists 'recibido_local';
