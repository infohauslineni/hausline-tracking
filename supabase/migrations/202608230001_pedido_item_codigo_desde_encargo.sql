-- Al confirmar un encargo web, el pedido creado NO copiaba el código del producto
-- (`producto_codigo`) al ítem del pedido. Sin código, el panel no muestra "Cód. XXXX"
-- y —lo más importante— la FOTO no aparece, porque la foto se resuelve buscando el
-- código en el catálogo (tabla productos). Resultado: el ítem quedaba solo con el
-- NOMBRE y sin foto.
--
-- Fix: (1) confirmar_solicitud ahora copia s.producto_codigo -> codigo_producto, y
-- (2) rellenamos los pedidos ya creados desde un encargo cuyo ítem quedó sin código.

begin;

drop function if exists public.confirmar_solicitud(uuid, numeric);

create or replace function public.confirmar_solicitud(p_id uuid, p_abono numeric default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.solicitudes;
  v_cliente uuid;
  v_pedido uuid;
  v_codigo text;
  v_abono numeric(12,2);
  v_tel text;
begin
  if not public.usuario_activo() then raise exception 'No autorizado'; end if;
  select * into s from public.solicitudes where id = p_id and estado = 'pendiente' for update;
  if not found then raise exception 'Solicitud no encontrada o ya procesada'; end if;

  -- Cliente: reusar si ya existe (por teléfono normalizado: solo dígitos, últimos 8).
  v_tel := right(regexp_replace(coalesce(s.cliente_whatsapp, ''), '[^0-9]', '', 'g'), 8);
  if v_tel <> '' then
    select id into v_cliente from public.clientes
      where right(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 8) = v_tel
      limit 1;
  end if;
  if v_cliente is null then
    insert into public.clientes (nombre, whatsapp, correo, ciudad, direccion)
    values (s.cliente_nombre, s.cliente_whatsapp, s.cliente_correo, s.cliente_ciudad, s.cliente_direccion)
    returning id into v_cliente;
  end if;

  -- Monto real pagado: el que indica el admin (p_abono); si no manda nada, el de la solicitud.
  v_abono := least(greatest(0, coalesce(p_abono, s.abono, 0)), s.total);

  insert into public.pedidos (cliente_id, estado, total, abono, saldo, notas_internas)
  values (v_cliente, 'pedido_confirmado', s.total, v_abono, s.total - v_abono,
          'Encargo web ' || s.codigo || ' · envío ' || coalesce(s.envio, 'estandar'))
  returning id, codigo into v_pedido, v_codigo;

  -- Ahora SÍ copiamos el código del producto: sin él no salía "Cód." ni la foto.
  insert into public.pedido_items (pedido_id, producto, codigo_producto, marca, talla, color, cantidad, precio_unitario)
  values (v_pedido, s.producto, s.producto_codigo, s.marca, s.talla, s.color, s.cantidad, s.precio_unitario);

  update public.solicitudes set estado = 'confirmada', pedido_id = v_pedido, updated_at = now() where id = s.id;

  return v_codigo;
end;
$$;

grant execute on function public.confirmar_solicitud(uuid, numeric) to authenticated;

-- Backfill: pedidos ya creados desde un encargo cuyo ítem quedó sin código. Copiamos
-- el código de su solicitud (emparejando por nombre de producto, por si tuviera varios).
update public.pedido_items pi
set codigo_producto = s.producto_codigo
from public.solicitudes s
where s.pedido_id = pi.pedido_id
  and pi.codigo_producto is null
  and s.producto_codigo is not null
  and pi.producto = s.producto;

-- El seguimiento PÚBLICO (obtener_pedido_publico) devolvía la imagen del ítem tal
-- cual (null en los encargos), sin resolverla desde el catálogo. Ahora, si el ítem
-- no trae foto, la toma de la tabla productos emparejando por código (o, en su
-- defecto, por nombre) — igual que hace el panel. Así la foto aparece también en la
-- página que ve el cliente.
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
