-- Hausline · Checkout: RPC + columnas de pago (SIN partes de storage).
-- Las políticas de storage ya se crearon por el Dashboard, así que este bloque solo
-- tiene funciones y columnas del esquema public → se corre en el SQL editor sin errores.
-- Re-ejecutable (create or replace / add column if not exists).
begin;

-- Columnas del estado de pago del encargo.
alter table public.solicitudes add column if not exists pago_reportado_at timestamptz;
alter table public.solicitudes add column if not exists aviso_pago_at timestamptz;
create index if not exists solicitudes_pago_reportado_idx
  on public.solicitudes (cliente_whatsapp, pago_reportado_at, aviso_pago_at);

-- Lectura pública de UNA solicitud (checkout): + imagen, comprobante, pago_reportado.
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
    'cliente_nombre', s.cliente_nombre, 'created_at', s.created_at, 'vence_at', s.vence_at
  ) from public.solicitudes s where s.codigo = upper(trim(p_codigo)) limit 1;
$$;

-- Lectura pública del GRUPO (carrito): array con cada producto.
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
    'created_at', s.created_at, 'vence_at', s.vence_at
  ) order by s.created_at), '[]'::json)
  from public.solicitudes s
  where upper(trim(p_codigo)) in (upper(coalesce(s.grupo_codigo, '')), upper(s.codigo));
$$;

-- Registrar el comprobante subido (ruta en el bucket) + marcar pago reportado.
create or replace function public.registrar_comprobante_publico(p_codigo text, p_ruta text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer; v_cod text;
begin
  if p_codigo is null or p_ruta is null or btrim(p_codigo) = '' or btrim(p_ruta) = '' then return false; end if;
  v_cod := upper(btrim(p_codigo));
  if left(upper(p_ruta), length(v_cod) + 1) <> v_cod || '/' then return false; end if;
  update public.solicitudes
     set comprobante_url = p_ruta, pago_reportado_at = coalesce(pago_reportado_at, now())
   where upper(trim(p_codigo)) in (upper(coalesce(grupo_codigo, '')), upper(codigo)) and estado = 'pendiente';
  get diagnostics v_n = row_count; return v_n > 0;
end; $$;

-- El cliente reporta que ya pagó (aunque no suba comprobante).
create or replace function public.reportar_pago_publico(p_codigo text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if p_codigo is null or btrim(p_codigo) = '' then return false; end if;
  update public.solicitudes set pago_reportado_at = coalesce(pago_reportado_at, now())
   where upper(trim(p_codigo)) in (upper(coalesce(grupo_codigo, '')), upper(codigo)) and estado = 'pendiente';
  get diagnostics v_n = row_count; return v_n > 0;
end; $$;

grant execute on function public.obtener_solicitud_publica(text)      to anon, authenticated;
grant execute on function public.obtener_solicitud_grupo(text)         to anon, authenticated;
grant execute on function public.registrar_comprobante_publico(text, text) to anon, authenticated;
grant execute on function public.reportar_pago_publico(text)           to anon, authenticated;

commit;
