-- Lectura pública de una solicitud (encargo) por su código, para la página de pago
-- (/checkout) del sitio. La tabla `solicitudes` está cerrada por RLS (solo el admin la
-- lee directo); esta función SECURITY DEFINER devuelve SOLO campos seguros de UNA
-- solicitud a partir de su código SOL-####, para que el cliente vea su total, cuentas,
-- tiempo límite y estado del pago sin exponer la tabla ni datos sensibles.
--
-- No devuelve WhatsApp, correo, ciudad ni dirección del cliente (datos personales):
-- el botón de WhatsApp del checkout escribe al número del negocio, no al del cliente.

begin;

create or replace function public.obtener_solicitud_publica(p_codigo text)
returns json
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select json_build_object(
    'codigo',          s.codigo,
    'producto',        s.producto,
    'producto_codigo', s.producto_codigo,
    'marca',           s.marca,
    'talla',           s.talla,
    'color',           s.color,
    'cantidad',        s.cantidad,
    'precio_unitario', s.precio_unitario,
    'total',           s.total,
    'abono',           s.abono,
    'saldo',           greatest(0, s.total - coalesce(s.abono, 0)),
    'pago_tipo',       s.pago_tipo,
    'envio',           s.envio,
    'tipo_cambio',     s.tipo_cambio,
    'total_nio',       s.total_nio,
    -- Córdobas "cerrados" del monto a pagar ahora (redondeo hacia arriba al múltiplo de 10).
    'abono_nio',       case when s.tipo_cambio is not null
                            then ceil(coalesce(s.abono, 0) * s.tipo_cambio / 10.0) * 10
                            else null end,
    'estado',          s.estado,
    'cliente_nombre',  s.cliente_nombre,
    'created_at',      s.created_at,
    'vence_at',        s.vence_at
  )
  from public.solicitudes s
  where s.codigo = upper(trim(p_codigo))
  limit 1;
$$;

-- Solo el rol público (anon) y los admin pueden ejecutarla; nadie puede tocar la tabla.
revoke all on function public.obtener_solicitud_publica(text) from public;
grant execute on function public.obtener_solicitud_publica(text) to anon, authenticated;

commit;
