-- Amplía la lista blanca de carpetas del bucket "pedidos" en el Storage.
--
-- Las políticas RLS del Storage solo permitían subir/leer en:
--   producto | control-calidad | comprobantes | entrega
-- Por eso, al subir una foto en una categoría nueva (empaque, recibido_hausline) o en las
-- de recepción (recepcion_miami, recibido_local) fallaba con:
--   "new row violates row-level security policy"
-- porque la carpeta del path (p. ej. pedidos/<id>/recibido_hausline/...) no calzaba.
--
-- Aquí recreamos las 4 políticas (leer/insertar/actualizar/eliminar) con TODAS las carpetas
-- que la app usa hoy. Solo cambia el regex de carpetas permitidas; el resto (bucket_id y
-- usuario_activo()) queda igual, así el operador también puede subir/ver fotos.
begin;

-- Carpetas válidas: las 4 originales + las de recepción y las nuevas del flujo de entrega.
-- OJO: 'control-calidad' y 'comprobantes' van con su nombre de carpeta (guion/plural); las
-- demás usan el nombre del tipo tal cual (con guion bajo).
drop policy if exists storage_pedidos_leer on storage.objects;
create policy storage_pedidos_leer on storage.objects for select to authenticated
using (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega|recepcion_miami|recibido_local|empaque|recibido_hausline)/' and public.usuario_activo());

drop policy if exists storage_pedidos_insertar on storage.objects;
create policy storage_pedidos_insertar on storage.objects for insert to authenticated
with check (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega|recepcion_miami|recibido_local|empaque|recibido_hausline)/' and public.usuario_activo());

drop policy if exists storage_pedidos_actualizar on storage.objects;
create policy storage_pedidos_actualizar on storage.objects for update to authenticated
using (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega|recepcion_miami|recibido_local|empaque|recibido_hausline)/' and public.usuario_activo())
with check (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega|recepcion_miami|recibido_local|empaque|recibido_hausline)/' and public.usuario_activo());

drop policy if exists storage_pedidos_eliminar on storage.objects;
create policy storage_pedidos_eliminar on storage.objects for delete to authenticated
using (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega|recepcion_miami|recibido_local|empaque|recibido_hausline)/' and public.usuario_activo());

commit;
