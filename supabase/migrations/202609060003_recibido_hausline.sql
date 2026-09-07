-- Categoría de foto "recibido_hausline": las fotos REALES del producto que el equipo le
-- toma con el teléfono cuando el pedido llega a HAUSLINE (Nicaragua). Al subirlas, el
-- pedido pasa solo a "Disponible para entrega" y el cliente recibe el correo con esas
-- fotos (marca chica arriba al centro, para que sirvan también para redes / IG).
--
-- Sustituye el uso de la vieja "recepción en Miami" (que ya no se ocupa). El valor de enum
-- 'recepcion_miami' se deja inactivo —no se puede quitar de un enum sin recrearlo— pero ya
-- no aparece en el panel.
alter type public.tipo_archivo add value if not exists 'recibido_hausline';
