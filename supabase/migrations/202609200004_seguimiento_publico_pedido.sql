-- Hausline · La página de confirmación del checkout muestra el seguimiento EN VIVO.
--
-- Problema: /checkout/?paso=confirmacion arma la línea de estados con `obtener_solicitud_grupo`,
-- que solo devuelve el estado de la SOLICITUD (queda en 'confirmada' para siempre). Cuando el
-- admin avanza el PEDIDO (En preparación, Enviado, Entregado…), el cliente no lo ve sin recargar.
--
-- Solución: exponer el estado REAL del pedido en las lecturas públicas. `solicitudes.pedido_id`
-- apunta al pedido creado al confirmar; leemos su `estado` con la función security definer (RLS
-- lo permite dentro de la función). El front hace polling y refleja el avance solo.
-- Re-ejecutable (create or replace).
begin;

create or replace function public.obtener_solicitud_grupo(p_codigo text)
returns json language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_object(
    'codigo', s.codigo, 'grupo_codigo', s.grupo_codigo,
    'producto', s.producto, 'producto_codigo', s.producto_codigo,
    'marca', s.marca, 'talla', s.talla, 'color', s.color,
    'cantidad', s.cantidad, 'precio_unitario', s.precio_unitario,
    'total', s.total, 'abono', s.abono,
    'saldo', greatest(0, s.total - coalesce(s.abono, 0)),
    'pago_tipo', s.pago_tipo, 'envio', s.envio,
    'tipo_cambio', s.tipo_cambio, 'total_nio', s.total_nio,
    'abono_nio', case when s.tipo_cambio is not null then ceil(coalesce(s.abono,0)*s.tipo_cambio/10.0)*10 else null end,
    'estado', s.estado, 'cliente_nombre', s.cliente_nombre,
    'imagen', s.imagen,
    'comprobante', (s.comprobante_url is not null),
    'pago_reportado', (s.pago_reportado_at is not null),
    'pedido_estado', (select p.estado from public.pedidos p where p.id = s.pedido_id),
    'created_at', s.created_at, 'vence_at', s.vence_at
  ) order by s.created_at), '[]'::json)
  from public.solicitudes s
  where upper(trim(p_codigo)) in (upper(coalesce(s.grupo_codigo, '')), upper(s.codigo));
$$;

create or replace function public.obtener_solicitud_publica(p_codigo text)
returns json language sql security definer stable set search_path = public, pg_temp as $$
  select json_build_object(
    'codigo', s.codigo, 'producto', s.producto, 'producto_codigo', s.producto_codigo,
    'marca', s.marca, 'talla', s.talla, 'color', s.color,
    'cantidad', s.cantidad, 'precio_unitario', s.precio_unitario,
    'total', s.total, 'abono', s.abono,
    'saldo', greatest(0, s.total - coalesce(s.abono, 0)),
    'pago_tipo', s.pago_tipo, 'envio', s.envio,
    'tipo_cambio', s.tipo_cambio, 'total_nio', s.total_nio,
    'abono_nio', case when s.tipo_cambio is not null then ceil(coalesce(s.abono,0)*s.tipo_cambio/10.0)*10 else null end,
    'estado', s.estado, 'imagen', s.imagen,
    'comprobante', (s.comprobante_url is not null),
    'pago_reportado', (s.pago_reportado_at is not null),
    'pedido_estado', (select p.estado from public.pedidos p where p.id = s.pedido_id),
    'cliente_nombre', s.cliente_nombre, 'created_at', s.created_at, 'vence_at', s.vence_at
  ) from public.solicitudes s where s.codigo = upper(trim(p_codigo)) limit 1;
$$;

grant execute on function public.obtener_solicitud_grupo(text)  to anon, authenticated;
grant execute on function public.obtener_solicitud_publica(text) to anon, authenticated;

commit;
