-- "Compra directa" desde el panel: el equipo le arma el encargo al cliente (producto, talla,
-- color, precio, envío, 50% o total) y le manda por WhatsApp el link de pago de la tienda
-- (/checkout/?c=SOL-####&paso=pago). El cliente solo transfiere y sube el comprobante; después
-- se confirma igual que cualquier encargo web (Encargos por confirmar).
--
-- Diferencias con crear_solicitud_publica (la de la tienda):
--   • Solo personal del panel (usuario_activo).
--   • El precio es el que pone el equipo (no se fuerza al del catálogo) y no aplica promos.
--   • Si el cliente tiene cuenta en la tienda, el encargo le sale en Mi cuenta.
--   • Vence en 48 h (en vez de 24) para darle tiempo de transferir.

create or replace function public.crear_encargo_panel(
  p_nombre text,
  p_whatsapp text,
  p_correo text default null,
  p_ciudad text default null,
  p_direccion text default null,
  p_producto text default null,
  p_producto_codigo text default null,
  p_marca text default null,
  p_talla text default null,
  p_color text default null,
  p_cantidad integer default 1,
  p_precio_unitario numeric default 0,
  p_envio text default 'estandar',
  p_recargo numeric default 0,
  p_pago text default '50',
  p_imagen text default null,
  p_cliente_id uuid default null
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cant integer;
  v_precio numeric(12,2);
  v_recargo numeric(12,2);
  v_total numeric(12,2);
  v_rate numeric(12,4);
  v_pago text;
  v_user uuid;
  v_codigo text;
begin
  if not public.usuario_activo() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_whatsapp is null or trim(p_whatsapp) !~ '^[0-9+ ()-]{7,25}$' then raise exception 'WhatsApp inválido'; end if;
  if p_nombre is null or char_length(trim(p_nombre)) < 2 then raise exception 'Nombre inválido'; end if;
  if p_producto is null or char_length(trim(p_producto)) < 2 then raise exception 'Producto inválido'; end if;
  if coalesce(p_precio_unitario, 0) <= 0 then raise exception 'Precio inválido'; end if;

  v_cant := least(50, greatest(1, coalesce(p_cantidad, 1)));
  v_precio := round(p_precio_unitario, 2);
  v_recargo := round(greatest(0, coalesce(p_recargo, 0)), 2);
  v_total := round(v_precio * v_cant + v_recargo, 2);
  v_pago := case when p_pago = 'total' then 'total' else '50' end;
  if p_cliente_id is not null then select user_id into v_user from public.clientes where id = p_cliente_id; end if;

  select (valor_json->>'tipo_cambio')::numeric into v_rate from public.configuracion where clave = 'moneda';

  insert into public.solicitudes (
    cliente_nombre, cliente_whatsapp, cliente_correo, cliente_ciudad, cliente_direccion,
    producto, producto_codigo, marca, talla, color, cantidad, precio_unitario, total,
    tipo_cambio, total_nio, envio, recargo, pago_tipo, abono, imagen, user_id, notas, vence_at
  ) values (
    trim(p_nombre), trim(p_whatsapp), nullif(trim(p_correo), ''), nullif(trim(p_ciudad), ''), nullif(trim(p_direccion), ''),
    trim(p_producto), nullif(trim(p_producto_codigo), ''), nullif(trim(p_marca), ''), nullif(trim(p_talla), ''), nullif(trim(p_color), ''),
    v_cant, v_precio, v_total, v_rate, case when v_rate is not null then ceil(v_total * v_rate / 10.0) * 10 end,
    case when p_envio = 'rapido' then 'rapido' else 'estandar' end, v_recargo, v_pago,
    case when v_pago = '50' then round(v_total * 0.5, 2) else v_total end,
    nullif(trim(p_imagen), ''), v_user, 'Compra directa creada desde el panel', now() + interval '48 hours'
  ) returning codigo into v_codigo;

  return v_codigo;
end;
$$;

revoke all on function public.crear_encargo_panel(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.crear_encargo_panel(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text, text, uuid) to authenticated;
