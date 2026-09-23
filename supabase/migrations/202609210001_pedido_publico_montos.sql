-- Hausline · Montos en el seguimiento PÚBLICO (link único sin login).
--
-- Agrega al RPC público `obtener_pedido_publico` el total del pedido, lo pagado (abono) y el
-- saldo pendiente, junto con la moneda, para que el portal del cliente muestre "Total del
-- pedido / Total pagado / Saldo pendiente". Cualquiera con el código HS del pedido los ve
-- (el código es la llave de acceso). El resto del RPC queda IGUAL que 202609070004.
begin;

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
    -- Montos del pedido (para el resumen de pago del portal público).
    'total', p.total,
    'abono', p.abono,
    'saldo', p.saldo,
    'moneda', p.moneda,
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

commit;
