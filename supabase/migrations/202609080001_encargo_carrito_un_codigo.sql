-- Hausline · Encargo web con UN SOLO código por carrito.
--
-- Antes la tienda creaba un encargo (y un código SOL-####) por CADA producto del carrito.
-- Ahora `crear_solicitud_carrito` crea TODO el carrito en UNA sola llamada atómica: cada
-- producto sigue siendo una fila de `solicitudes` (para el seguimiento por producto), pero
-- todas comparten UN `grupo_codigo` — el único código que ve el cliente. Al ser atómico, ya
-- no se pierden productos si falla una llamada a mitad del carrito.
begin;

alter table public.solicitudes add column if not exists grupo_codigo text;
create index if not exists solicitudes_grupo_idx on public.solicitudes (grupo_codigo);

-- Crea todo el carrito de una vez y devuelve el ÚNICO código de grupo (SOL-####).
-- p_items: [{producto, producto_codigo, marca, talla, color, cantidad, precio_unitario, recargo, imagen}]
create or replace function public.crear_solicitud_carrito(
  p_nombre text,
  p_whatsapp text,
  p_correo text default null,
  p_ciudad text default null,
  p_direccion text default null,
  p_envio text default 'estandar',
  p_pago text default 'total',
  p_cupon_codigo text default null,
  p_items jsonb default '[]'::jsonb
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_grupo text;
  v_rate numeric(12,4);
  v_envio text;
  v_pago text;
  c public.cupones;
  v_cupon_ok boolean := false;
  it jsonb;
  idx integer := 0;
  v_cant integer;
  v_precio numeric(12,2);
  v_recargo numeric(12,2);
  v_bruto numeric(12,2);
  v_desc numeric(12,2);
  v_total numeric(12,2);
  v_abono numeric(12,2);
  v_item_envio text;
  v_n integer;
begin
  if p_whatsapp is null or trim(p_whatsapp) !~ '^[0-9+ ()-]{7,25}$' then raise exception 'WhatsApp inválido'; end if;
  if p_nombre is null or char_length(trim(p_nombre)) < 2 then raise exception 'Nombre inválido'; end if;
  v_n := coalesce(jsonb_array_length(p_items), 0);
  if v_n < 1 then raise exception 'Carrito vacío'; end if;

  v_envio := case when p_envio = 'rapido' then 'rapido' else 'estandar' end;
  v_pago := case when p_pago = '50' then '50' else 'total' end;
  select (valor_json->>'tipo_cambio')::numeric into v_rate from public.configuracion where clave = 'moneda';
  v_grupo := public.generar_codigo_solicitud();

  -- Cupón: validación autoritativa (una vez para todo el carrito).
  if p_cupon_codigo is not null and btrim(p_cupon_codigo) <> '' then
    select * into c from public.cupones where upper(btrim(codigo)) = upper(btrim(p_cupon_codigo)) limit 1;
    if found and c.activo and (c.vence_el is null or c.vence_el >= current_date)
       and (c.usos_max is null or c.usos_confirmados < c.usos_max) then
      v_cupon_ok := true;
    end if;
  end if;

  for it in select * from jsonb_array_elements(p_items)
  loop
    idx := idx + 1;
    v_cant := least(50, greatest(1, coalesce((it->>'cantidad')::integer, 1)));
    v_precio := round(greatest(0, coalesce((it->>'precio_unitario')::numeric, 0)), 2);
    v_recargo := round(greatest(0, coalesce((it->>'recargo')::numeric, 0)), 2);
    v_bruto := round(v_precio * v_cant + v_recargo, 2);
    -- Descuento del cupón: porcentaje en cada ítem; monto fijo solo en el primero.
    v_desc := 0;
    if v_cupon_ok then
      if c.tipo = 'porcentaje' then v_desc := round(v_bruto * c.valor / 100.0, 2);
      elsif idx = 1 then v_desc := least(c.valor, v_bruto);
      end if;
    end if;
    v_total := greatest(0, round(v_bruto - v_desc, 2));
    v_abono := case when v_pago = '50' then round(v_total * 0.5, 2) else v_total end;
    v_item_envio := case when coalesce(it->>'envio', v_envio) = 'rapido' then 'rapido' else 'estandar' end;

    insert into public.solicitudes (
      cliente_nombre, cliente_whatsapp, cliente_correo, cliente_ciudad, cliente_direccion,
      producto, producto_codigo, marca, talla, color, cantidad, precio_unitario, total,
      tipo_cambio, total_nio, envio, recargo, pago_tipo, abono, imagen,
      cupon_id, cupon_codigo, descuento, grupo_codigo
    ) values (
      trim(p_nombre), trim(p_whatsapp), nullif(trim(p_correo), ''), nullif(trim(p_ciudad), ''), nullif(trim(p_direccion), ''),
      trim(coalesce(it->>'producto', 'Producto')), nullif(trim(coalesce(it->>'producto_codigo','')), ''),
      nullif(trim(coalesce(it->>'marca','')), ''), nullif(trim(coalesce(it->>'talla','')), ''), nullif(trim(coalesce(it->>'color','')), ''),
      v_cant, v_precio, v_total, v_rate,
      case when v_rate is not null then ceil(v_total * v_rate / 10.0) * 10 end,
      v_item_envio, v_recargo, v_pago, v_abono, nullif(trim(coalesce(it->>'imagen','')), ''),
      case when v_desc > 0 then c.id else null end, case when v_desc > 0 then c.codigo else null end, v_desc,
      v_grupo
    );
  end loop;

  return v_grupo;
end;
$$;

revoke all on function public.crear_solicitud_carrito(text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.crear_solicitud_carrito(text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;

-- Lectura pública del carrito por su ÚNICO código: devuelve un ARRAY con cada producto (los
-- mismos campos seguros que obtener_solicitud_publica). Acepta el grupo_codigo o, para
-- compatibilidad, el código de una sola solicitud. Ordena por creación.
create or replace function public.obtener_solicitud_grupo(p_codigo text)
returns json
language sql security definer stable
set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_object(
    'codigo', s.codigo,
    'grupo_codigo', s.grupo_codigo,
    'producto', s.producto,
    'producto_codigo', s.producto_codigo,
    'marca', s.marca, 'talla', s.talla, 'color', s.color,
    'cantidad', s.cantidad, 'precio_unitario', s.precio_unitario,
    'total', s.total, 'abono', s.abono,
    'saldo', greatest(0, s.total - coalesce(s.abono, 0)),
    'pago_tipo', s.pago_tipo, 'envio', s.envio,
    'tipo_cambio', s.tipo_cambio, 'total_nio', s.total_nio,
    'abono_nio', case when s.tipo_cambio is not null then ceil(coalesce(s.abono,0) * s.tipo_cambio / 10.0) * 10 else null end,
    'estado', s.estado, 'cliente_nombre', s.cliente_nombre,
    'created_at', s.created_at, 'vence_at', s.vence_at
  ) order by s.created_at), '[]'::json)
  from public.solicitudes s
  where upper(trim(p_codigo)) in (upper(coalesce(s.grupo_codigo, '')), upper(s.codigo));
$$;

revoke all on function public.obtener_solicitud_grupo(text) from public;
grant execute on function public.obtener_solicitud_grupo(text) to anon, authenticated;

commit;
