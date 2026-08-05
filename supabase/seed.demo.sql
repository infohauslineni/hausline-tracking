-- SOLO PARA DESARROLLO O UN PROYECTO DE PRUEBA.
-- No ejecutar en producción. Todos los registros usan UUID y códigos deterministas.

begin;

insert into public.clientes (id, nombre, whatsapp, correo, departamento, ciudad, direccion, referencia, notas) values
  ('10000000-0000-4000-8000-000000000001', 'Sofía Martínez', '+505 8888 1001', 'sofia@example.com', 'Managua', 'Managua', 'Residencial Las Colinas', 'Portón negro', '[DEMO] Cliente frecuente'),
  ('10000000-0000-4000-8000-000000000002', 'Carlos Hernández', '+505 8888 1002', null, 'León', 'León', 'Centro histórico', 'Frente al parque', '[DEMO] Prefiere WhatsApp'),
  ('10000000-0000-4000-8000-000000000003', 'María López', '+505 8888 1003', 'maria@example.com', 'Masaya', 'Masaya', 'Barrio San Jerónimo', null, '[DEMO] Entrega por la tarde')
on conflict (id) do update set nombre = excluded.nombre, whatsapp = excluded.whatsapp, updated_at = now();

insert into public.pedidos (id, codigo, cliente_id, estado, fecha_pedido, fecha_estimada, abono, notas_internas, notas_publicas) values
  ('20000000-0000-4000-8000-000000000001', 'HS483682', '10000000-0000-4000-8000-000000000001', 'transito_internacional', current_date - 12, current_date + 9, 40, '[DEMO] Pedido en tránsito', 'Tu pedido avanza según lo previsto.'),
  ('20000000-0000-4000-8000-000000000002', 'HS902174', '10000000-0000-4000-8000-000000000002', 'disponible_entrega', current_date - 20, current_date, 85, '[DEMO] Disponible', 'Tu pedido está listo para entrega.'),
  ('20000000-0000-4000-8000-000000000003', 'HS137590', '10000000-0000-4000-8000-000000000003', 'control_calidad', current_date - 4, current_date + 18, 25, '[DEMO] Control de calidad', 'Estamos verificando tu producto.'),
  ('20000000-0000-4000-8000-000000000004', 'HS714206', '10000000-0000-4000-8000-000000000001', 'incidencia', current_date - 35, current_date - 5, 100, '[DEMO] Pedido atrasado con entrega fallida', 'Estamos gestionando una incidencia logística.'),
  ('20000000-0000-4000-8000-000000000005', 'HS628431', '10000000-0000-4000-8000-000000000002', 'entregado', current_date - 40, current_date - 8, 120, '[DEMO] Pedido entregado', 'Pedido entregado. Gracias por comprar en Hausline.')
on conflict (id) do update set estado = excluded.estado, fecha_estimada = excluded.fecha_estimada, abono = excluded.abono, notas_publicas = excluded.notas_publicas;

insert into public.pedido_items (id, pedido_id, producto, marca, categoria, talla, color, cantidad, precio_unitario, notas) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Tenis retro', 'New Balance', 'Calzado', '38', 'Gris', 1, 95, '[DEMO]'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Camiseta básica', 'Uniqlo', 'Ropa', 'M', 'Negro', 2, 22.50, '[DEMO]'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Bolso bandolera', 'Coach', 'Accesorios', null, 'Café', 1, 85, '[DEMO]'),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003', 'Sandalias', 'Birkenstock', 'Calzado', '37', 'Beige', 1, 72, '[DEMO]'),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000004', 'Chaqueta ligera', 'Zara', 'Ropa', 'S', 'Verde', 1, 100, '[DEMO]'),
  ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000005', 'Reloj clásico', 'Casio', 'Accesorios', null, 'Plateado', 1, 120, '[DEMO]')
on conflict (id) do update set cantidad = excluded.cantidad, precio_unitario = excluded.precio_unitario;

insert into public.trayectos (id, pedido_id, transportista_id, tipo_trayecto, pais_origen, pais_destino, tracking, estado, ultima_ubicacion, ultimo_evento, fecha_envio, fecha_estimada, visible_cliente, orden) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', (select id from public.transportistas where codigo='YUNEXPRESS'), 'China → Estados Unidos', 'China', 'Estados Unidos', 'YT-DEMO-483682', 'en_transito', 'Los Ángeles, CA', 'Procesado en centro logístico', now()-interval '10 days', now()+interval '3 days', true, 1),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', (select id from public.transportistas where codigo='YUNEXPRESS'), 'China → Estados Unidos', 'China', 'Estados Unidos', 'YT-DEMO-902174', 'entregado', 'Miami, FL', 'Entregado al casillero', now()-interval '18 days', now()-interval '11 days', true, 1),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', (select id from public.transportistas where codigo='AEREO'), 'Estados Unidos → Nicaragua', 'Estados Unidos', 'Nicaragua', 'AIR-DEMO-902174', 'entregado', 'Managua', 'Recibido en Nicaragua', now()-interval '9 days', now()-interval '2 days', true, 2),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', (select id from public.transportistas where codigo='USPS'), 'China → Estados Unidos', 'China', 'Estados Unidos', 'USPS-DEMO-714206', 'entrega_fallida', 'Miami, FL', 'No se pudo completar la entrega', now()-interval '30 days', now()-interval '12 days', true, 1),
  ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000005', (select id from public.transportistas where codigo='YUNEXPRESS'), 'China → Estados Unidos', 'China', 'Estados Unidos', 'YT-DEMO-628431', 'entregado', 'Miami, FL', 'Entregado al casillero', now()-interval '38 days', now()-interval '28 days', true, 1),
  ('40000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000005', (select id from public.transportistas where codigo='AEREO'), 'Estados Unidos → Nicaragua', 'Estados Unidos', 'Nicaragua', 'AIR-DEMO-628431', 'entregado', 'Managua', 'Recibido en Nicaragua', now()-interval '25 days', now()-interval '15 days', true, 2),
  ('40000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000005', (select id from public.transportistas where codigo='OTRA'), 'Entrega nacional', 'Nicaragua', 'Nicaragua', 'NIC-DEMO-628431', 'entregado', 'León', 'Entregado al cliente', now()-interval '12 days', now()-interval '8 days', true, 3)
on conflict (id) do update set estado = excluded.estado, ultima_ubicacion = excluded.ultima_ubicacion, ultimo_evento = excluded.ultimo_evento;

insert into public.tracking_eventos (id, trayecto_id, estado_original, estado_normalizado, descripcion_original, descripcion_publica, ubicacion, fecha_evento, fuente) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Departed facility', 'en_transito', 'Departed sorting facility Shenzhen', 'Tu pedido salió del centro logístico.', 'Shenzhen, China', now()-interval '8 days', 'manual'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'Processed', 'en_transito', 'Processed at destination facility', 'Tu pedido fue procesado en Estados Unidos.', 'Los Ángeles, CA', now()-interval '1 day', 'manual'),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004', 'Delivery failed', 'entrega_fallida', 'Business closed', 'La paquetería no pudo completar la entrega.', 'Miami, FL', now()-interval '10 days', 'manual'),
  ('50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000007', 'Delivered', 'entregado', 'Delivered to recipient', 'Tu pedido fue entregado.', 'León, Nicaragua', now()-interval '8 days', 'manual')
on conflict (id) do update set descripcion_publica = excluded.descripcion_publica, fecha_evento = excluded.fecha_evento;

insert into public.alertas (id, pedido_id, trayecto_id, tipo, titulo, descripcion, prioridad) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', 'entrega_fallida', 'Entrega fallida', 'La paquetería no pudo completar la entrega en Miami.', 'critica'),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004', null, 'pedido_atrasado', 'Pedido atrasado', 'La fecha estimada ya fue superada.', 'alta')
on conflict (id) do update set descripcion = excluded.descripcion, prioridad = excluded.prioridad;

commit;
