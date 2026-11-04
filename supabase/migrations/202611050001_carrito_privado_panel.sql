-- CARRITO PRIVADO desde el panel (Productos → elegir productos → "Carrito privado").
-- Para el cliente que compra varios productos (mayoreo): el equipo arma el carrito con el precio
-- que quiera en cada producto (mayorista, el de tienda o uno especial) y le manda por WhatsApp
-- el link de pago de la tienda (/checkout/?c=SOL-####&paso=pago). Ahí el cliente ve sus
-- productos con esos precios, las cuentas y sube el comprobante. Cae en "Encargos por confirmar"
-- como un carrito normal (todas las filas comparten un grupo_codigo) y se confirma igual.
--
-- Igual que crear_encargo_panel (compra directa) pero con varios productos:
--   • Solo personal del panel (usuario_activo).
--   • El precio es el que pone el equipo: no se fuerza al del catálogo ni aplica promos/cupones.
--   • Envío estándar (sin recargo). 50 % de anticipo o total.
--   • Si el cliente tiene cuenta en la tienda, le sale en Mi cuenta. Vence en 48 h.
-- Es seguro correrlo de nuevo.

create or replace function public.crear_carrito_panel(
  p_nombre text,
  p_whatsapp text,
  p_correo text default null,
  p_ciudad text default null,
  p_direccion text default null,
  p_pago text default '50',
  p_cliente_id uuid default null,
  p_items jsonb default '[]'::jsonb
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_grupo text;
  v_rate numeric(12,4);
  v_pago text;
  v_user uuid;
  v_n integer;
  it jsonb;
  v_cant integer;
  v_precio numeric(12,2);
  v_total numeric(12,2);
begin
  if not public.usuario_activo() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_whatsapp is null or trim(p_whatsapp) !~ '^[0-9+ ()-]{7,25}$' then raise exception 'WhatsApp inválido'; end if;
  if p_nombre is null or char_length(trim(p_nombre)) < 2 then raise exception 'Nombre inválido'; end if;
  v_n := coalesce(jsonb_array_length(p_items), 0);
  if v_n < 1 then raise exception 'Carrito vacío'; end if;
  if v_n > 40 then raise exception 'Demasiados productos en un solo carrito'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if char_length(trim(coalesce(it->>'producto', ''))) < 2 then raise exception 'Producto inválido'; end if;
    if coalesce((it->>'precio_unitario')::numeric, 0) <= 0 then raise exception 'Precio inválido en %', it->>'producto'; end if;
  end loop;

  v_pago := case when p_pago = 'total' then 'total' else '50' end;
  if p_cliente_id is not null then select user_id into v_user from public.clientes where id = p_cliente_id; end if;
  select (valor_json->>'tipo_cambio')::numeric into v_rate from public.configuracion where clave = 'moneda';
  v_grupo := public.generar_codigo_solicitud();

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := least(200, greatest(1, coalesce((it->>'cantidad')::integer, 1)));
    v_precio := round((it->>'precio_unitario')::numeric, 2);
    v_total := round(v_precio * v_cant, 2);
    insert into public.solicitudes (
      cliente_nombre, cliente_whatsapp, cliente_correo, cliente_ciudad, cliente_direccion,
      producto, producto_codigo, marca, talla, color, cantidad, precio_unitario, total,
      tipo_cambio, total_nio, envio, recargo, pago_tipo, abono, imagen, user_id, notas, vence_at, grupo_codigo
    ) values (
      trim(p_nombre), trim(p_whatsapp), nullif(trim(p_correo), ''), nullif(trim(p_ciudad), ''), nullif(trim(p_direccion), ''),
      trim(it->>'producto'), nullif(trim(coalesce(it->>'producto_codigo', '')), ''), nullif(trim(coalesce(it->>'marca', '')), ''),
      nullif(trim(coalesce(it->>'talla', '')), ''), nullif(trim(coalesce(it->>'color', '')), ''),
      v_cant, v_precio, v_total, v_rate, case when v_rate is not null then ceil(v_total * v_rate / 10.0) * 10 end,
      'estandar', 0, v_pago, case when v_pago = '50' then round(v_total * 0.5, 2) else v_total end,
      nullif(trim(coalesce(it->>'imagen', '')), ''), v_user, 'Carrito privado creado desde el panel', now() + interval '48 hours', v_grupo
    );
  end loop;

  return v_grupo;
end;
$$;

revoke all on function public.crear_carrito_panel(text, text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crear_carrito_panel(text, text, text, text, text, text, uuid, jsonb) to authenticated;
