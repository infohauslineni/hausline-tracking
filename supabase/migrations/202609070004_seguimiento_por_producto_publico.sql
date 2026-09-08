-- Hausline · Seguimiento por producto en el tracking PÚBLICO (Fase 2).
--
-- Expone al cliente la etapa de cada producto (estado_item) y su id, y enlaza cada foto de
-- control de calidad a su producto (pedido_item_id), para mostrar en el seguimiento el
-- progreso "X de N productos listos" con la foto de cada uno.
begin;

-- obtener_pedido_publico: + id y estado_item por producto (resto igual que 202608230001).
create or replace function public.obtener_pedido_publico(p_codigo text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo text := upper(trim(p_codigo));
  resultado jsonb;
begin
  if v_codigo !~ '^HS[0-9]{6}$' then return null; end if;

  select jsonb_build_object(
    'codigo', p.codigo,
    'estado', public.etiqueta_estado_publico(p.estado),
    'estado_codigo', p.estado,
    'fecha_pedido', p.fecha_pedido,
    'fecha_estimada', p.fecha_estimada,
    'fecha_entrega', p.fecha_entrega,
    'ultima_actualizacion', p.updated_at,
    'imagen_principal', p.imagen_principal,
    'notas_publicas', p.notas_publicas,
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'estado_item', i.estado_item,
        'producto', i.producto, 'codigo', i.codigo_producto, 'marca', i.marca, 'categoria', i.categoria,
        'talla', i.talla, 'color', i.color, 'cantidad', i.cantidad,
        'imagen', coalesce(i.imagen, prod.imagen)
      ) order by i.created_at)
      from public.pedido_items i
      left join public.productos prod
        on upper(trim(prod.codigo)) = upper(trim(coalesce(nullif(i.codigo_producto, ''), i.producto)))
      where i.pedido_id = p.id
    ), '[]'::jsonb),
    'historial', coalesce((
      select jsonb_agg(jsonb_build_object(
        'estado', public.etiqueta_estado_publico(h.estado_nuevo),
        'nota', h.nota, 'ubicacion', h.ubicacion, 'fecha', h.created_at
      ) order by h.created_at)
      from public.historial_pedidos h where h.pedido_id = p.id and h.visible_cliente
    ), '[]'::jsonb),
    'trayectos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tipo', t.tipo_trayecto, 'origen', t.pais_origen, 'destino', t.pais_destino,
        'transportista', tr.nombre, 'tracking', t.tracking, 'url_tracking', t.url_tracking,
        'estado', t.estado, 'ultima_ubicacion', t.ultima_ubicacion,
        'ultimo_evento', t.ultimo_evento, 'fecha_estimada', t.fecha_estimada,
        'eventos', coalesce((select jsonb_agg(jsonb_build_object(
          'descripcion', e.descripcion_publica, 'ubicacion', e.ubicacion, 'fecha', e.fecha_evento
        ) order by e.fecha_evento) from public.tracking_eventos e
          where e.trayecto_id = t.id and e.visible_cliente and e.descripcion_publica is not null), '[]'::jsonb)
      ) order by t.orden)
      from public.trayectos t left join public.transportistas tr on tr.id = t.transportista_id
      where t.pedido_id = p.id and t.visible_cliente
    ), '[]'::jsonb)
  ) into resultado
  from public.pedidos p where p.codigo = v_codigo and p.activo;

  return resultado;
end;
$$;

-- obtener_archivos_pedido_publicos: + pedido_item_id (para enlazar cada foto a su producto).
create or replace function public.obtener_archivos_pedido_publicos(p_codigo text)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo', a.tipo,
    'nombre', a.nombre,
    'storage_path', a.storage_path,
    'orden', a.orden,
    'pedido_item_id', a.pedido_item_id
  ) order by a.tipo, a.orden), '[]'::jsonb)
  from public.archivos_pedido a
  join public.pedidos p on p.id = a.pedido_id
  where p.codigo = upper(trim(p_codigo))
    and p.activo
    and a.visible_cliente;
$$;

commit;
