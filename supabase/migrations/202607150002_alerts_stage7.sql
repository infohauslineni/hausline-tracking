-- Etapa 7: detección operativa ampliada y actualización en tiempo real.
create or replace function public.generar_alertas_operativas()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_creadas integer := 0;
  v_filas integer := 0;
  v_dias_sin_actualizacion integer := 7;
  v_dias_atraso integer := 1;
begin
  if not public.usuario_activo() then raise exception 'No autorizado'; end if;

  select
    coalesce((valor_json ->> 'dias_sin_actualizacion')::integer, 7),
    coalesce((valor_json ->> 'dias_atraso')::integer, 1)
  into v_dias_sin_actualizacion, v_dias_atraso
  from public.configuracion where clave = 'alertas';
  v_dias_sin_actualizacion := coalesce(v_dias_sin_actualizacion, 7);
  v_dias_atraso := coalesce(v_dias_atraso, 1);

  -- Cierra alertas que ya no representan un problema.
  update public.alertas a set resuelta = true, fecha_resuelta = now()
  where not a.resuelta and a.tipo = 'sin_tracking' and exists (
    select 1 from public.trayectos t where t.pedido_id = a.pedido_id and t.activo and nullif(trim(t.tracking), '') is not null
  );
  update public.alertas a set resuelta = true, fecha_resuelta = now()
  where not a.resuelta and a.tipo = 'pedido_atrasado' and exists (
    select 1 from public.pedidos p where p.id = a.pedido_id and (not p.activo or p.estado in ('entregado','cancelado') or p.fecha_estimada + v_dias_atraso >= current_date)
  );

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  select p.id, 'sin_tracking', 'Pedido sin tracking', 'El pedido no tiene un trayecto activo con número de tracking.', 'media'
  from public.pedidos p
  where p.activo and p.estado not in ('pedido_confirmado','en_preparacion','control_calidad','cancelado','entregado')
    and not exists (select 1 from public.trayectos t where t.pedido_id = p.id and t.activo and nullif(trim(t.tracking), '') is not null)
    and not exists (select 1 from public.alertas a where a.pedido_id = p.id and a.tipo = 'sin_tracking' and not a.resuelta);
  get diagnostics v_filas = row_count; v_creadas := v_creadas + v_filas;

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  select p.id, 'pedido_atrasado', 'Pedido atrasado', 'La fecha estimada, incluyendo la tolerancia configurada, ya fue superada.', 'alta'
  from public.pedidos p
  where p.activo and p.fecha_estimada + v_dias_atraso < current_date and p.estado not in ('entregado','cancelado')
    and not exists (select 1 from public.alertas a where a.pedido_id = p.id and a.tipo = 'pedido_atrasado' and not a.resuelta);
  get diagnostics v_filas = row_count; v_creadas := v_creadas + v_filas;

  insert into public.alertas (pedido_id, trayecto_id, tipo, titulo, descripcion, prioridad)
  select t.pedido_id, t.id, 'sin_actualizacion', 'Tracking sin actualización', 'El trayecto no recibe eventos dentro del plazo configurado.', 'media'
  from public.trayectos t
  where t.activo and t.estado not in ('entregado','cancelado')
    and coalesce((select max(e.fecha_evento) from public.tracking_eventos e where e.trayecto_id = t.id), t.updated_at) < now() - make_interval(days => v_dias_sin_actualizacion)
    and not exists (select 1 from public.alertas a where a.trayecto_id = t.id and a.tipo = 'sin_actualizacion' and not a.resuelta);
  get diagnostics v_filas = row_count; v_creadas := v_creadas + v_filas;

  insert into public.alertas (pedido_id, trayecto_id, tipo, titulo, descripcion, prioridad)
  select t.pedido_id, t.id, 'entrega_fallida', 'Entrega fallida', coalesce(e.descripcion_original, 'La paquetería reportó una entrega fallida.'), 'critica'
  from public.tracking_eventos e join public.trayectos t on t.id = e.trayecto_id
  where e.estado_normalizado = 'entrega_fallida'
    and not exists (select 1 from public.alertas a where a.trayecto_id = t.id and a.tipo = 'entrega_fallida' and not a.resuelta);
  get diagnostics v_filas = row_count; v_creadas := v_creadas + v_filas;

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  select p.id, 'falta_cliente', 'Información del cliente incompleta', 'Revisa nombre, WhatsApp, ciudad y dirección antes de continuar.', 'alta'
  from public.pedidos p join public.clientes c on c.id = p.cliente_id
  where p.activo and p.estado not in ('entregado','cancelado')
    and (nullif(trim(c.nombre), '') is null or nullif(trim(c.whatsapp), '') is null or nullif(trim(coalesce(c.ciudad,'')), '') is null or nullif(trim(coalesce(c.direccion,'')), '') is null)
    and not exists (select 1 from public.alertas a where a.pedido_id = p.id and a.tipo = 'falta_cliente' and not a.resuelta);
  get diagnostics v_filas = row_count; v_creadas := v_creadas + v_filas;

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  select p.id, 'falta_foto_producto', 'Falta foto del producto', 'El pedido no tiene una imagen registrada en la categoría Producto.', 'media'
  from public.pedidos p
  where p.activo and p.estado not in ('pedido_confirmado','cancelado','entregado')
    and not exists (select 1 from public.archivos_pedido f where f.pedido_id = p.id and f.tipo = 'producto')
    and not exists (select 1 from public.alertas a where a.pedido_id = p.id and a.tipo = 'falta_foto_producto' and not a.resuelta);
  get diagnostics v_filas = row_count; v_creadas := v_creadas + v_filas;

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  select p.id, 'falta_control_calidad', 'Falta control de calidad', 'El pedido avanzó sin fotografías de control de calidad.', 'media'
  from public.pedidos p
  where p.activo and p.estado in ('despachado','transito_internacional','recibido_estados_unidos','transito_nicaragua','llego_nicaragua','disponible_entrega')
    and not exists (select 1 from public.archivos_pedido f where f.pedido_id = p.id and f.tipo = 'control_calidad')
    and not exists (select 1 from public.alertas a where a.pedido_id = p.id and a.tipo = 'falta_control_calidad' and not a.resuelta);
  get diagnostics v_filas = row_count; v_creadas := v_creadas + v_filas;

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  select p.id, 'falta_tracking_nicaragua', 'Falta envío hacia Nicaragua', 'El pedido llegó a Estados Unidos y aún no tiene el siguiente trayecto.', 'alta'
  from public.pedidos p
  where p.activo and p.estado = 'recibido_estados_unidos'
    and not exists (select 1 from public.trayectos t where t.pedido_id = p.id and t.activo and coalesce(t.pais_destino,'') ilike '%nicaragua%')
    and not exists (select 1 from public.alertas a where a.pedido_id = p.id and a.tipo = 'falta_tracking_nicaragua' and not a.resuelta);
  get diagnostics v_filas = row_count; v_creadas := v_creadas + v_filas;

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  select p.id, 'llego_nicaragua_pendiente', 'Pedido pendiente de disponibilidad', 'El pedido llegó a Nicaragua y todavía no está marcado como disponible.', 'alta'
  from public.pedidos p
  where p.activo and p.estado = 'llego_nicaragua'
    and not exists (select 1 from public.alertas a where a.pedido_id = p.id and a.tipo = 'llego_nicaragua_pendiente' and not a.resuelta);
  get diagnostics v_filas = row_count; v_creadas := v_creadas + v_filas;

  return v_creadas;
end;
$$;

revoke all on function public.generar_alertas_operativas() from public, anon;
grant execute on function public.generar_alertas_operativas() to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alertas') then
    alter publication supabase_realtime add table public.alertas;
  end if;
end $$;
