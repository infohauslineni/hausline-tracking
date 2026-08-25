-- Encargos web: la FOTO del producto ahora viaja CON el encargo y se pega al pedido.
--
-- Problema de fondo: la foto nunca se guardaba con el pedido; se re-buscaba por código
-- en el catálogo (tabla productos). Los encargos de marcas que no están en el catálogo
-- (p. ej. "Burberry Sandalia Slide") quedaban SIN foto en el panel, la factura y los
-- correos a la vez. Al crear el encargo sí teníamos la URL de la foto (el catálogo web
-- la muestra), pero la tirábamos. Ahora la guardamos en la solicitud y la copiamos al
-- ítem del pedido al confirmar. Así panel/factura/correos la leen directo, sin depender
-- de que el producto exista en el catálogo.
--
-- Además arregla una REGRESIÓN: la migración 202608230002 (registrar el abono en caja)
-- reescribió confirmar_solicitud y se le olvidó copiar `codigo_producto` al ítem —que
-- la 202608230001 sí copiaba—. Sin código, el pedido no mostraba "Cód." NI foto. Aquí
-- se restituye el código y se hace backfill de los pedidos que quedaron sin él.

begin;

-- Foto del producto tal como la vio el cliente en el catálogo, al momento del encargo.
alter table public.solicitudes add column if not exists imagen text;

-- ── Crear solicitud desde el catálogo (rol anon), ahora con la foto ──────────
drop function if exists public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text);

create or replace function public.crear_solicitud_publica(
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
  p_pago text default 'total',
  p_imagen text default null
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cant integer;
  v_precio numeric(12,2);
  v_recargo numeric(12,2);
  v_total numeric(12,2);
  v_abono numeric(12,2);
  v_rate numeric(12,4);
  v_pago text;
  v_envio text;
  v_codigo text;
begin
  if p_whatsapp is null or trim(p_whatsapp) !~ '^[0-9+ ()-]{7,25}$' then raise exception 'WhatsApp inválido'; end if;
  if p_nombre is null or char_length(trim(p_nombre)) < 2 then raise exception 'Nombre inválido'; end if;
  if p_producto is null or char_length(trim(p_producto)) < 2 then raise exception 'Producto inválido'; end if;

  v_cant := least(50, greatest(1, coalesce(p_cantidad, 1)));
  v_precio := round(greatest(0, coalesce(p_precio_unitario, 0)), 2);
  v_recargo := round(greatest(0, coalesce(p_recargo, 0)), 2);
  v_total := round(v_precio * v_cant + v_recargo, 2);
  v_envio := case when p_envio = 'rapido' then 'rapido' else 'estandar' end;
  v_pago := case when p_pago = '50' then '50' else 'total' end;
  -- Monto a pagar ahora: total completo, o la mitad si eligió abono 50%.
  v_abono := case when v_pago = '50' then round(v_total * 0.5, 2) else v_total end;

  select (valor_json->>'tipo_cambio')::numeric into v_rate from public.configuracion where clave = 'moneda';

  insert into public.solicitudes (
    cliente_nombre, cliente_whatsapp, cliente_correo, cliente_ciudad, cliente_direccion,
    producto, producto_codigo, marca, talla, color, cantidad, precio_unitario, total,
    tipo_cambio, total_nio, envio, recargo, pago_tipo, abono, imagen
  ) values (
    trim(p_nombre), trim(p_whatsapp), nullif(trim(p_correo), ''), nullif(trim(p_ciudad), ''), nullif(trim(p_direccion), ''),
    trim(p_producto), nullif(trim(p_producto_codigo), ''), nullif(trim(p_marca), ''), nullif(trim(p_talla), ''), nullif(trim(p_color), ''),
    -- Córdobas "cerrados" (redondeados hacia arriba al múltiplo de 10).
    v_cant, v_precio, v_total, v_rate, case when v_rate is not null then ceil(v_total * v_rate / 10.0) * 10 end,
    v_envio, v_recargo, v_pago, v_abono, nullif(trim(p_imagen), '')
  ) returning codigo into v_codigo;

  return v_codigo;
end;
$$;

revoke all on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text, text) from public;
grant execute on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text, text) to anon, authenticated;

-- ── Confirmar solicitud → pedido HS, copiando CÓDIGO + FOTO y registrando el abono ──
-- Junta las tres cosas que antes vivían separadas (y una se había perdido):
--   · el abono en caja (de 202608230002),
--   · el código del producto en el ítem (de 202608230001, perdido en 230002),
--   · la foto del producto en el ítem (NUEVO).
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
  v_pago uuid;
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

  -- Ítem CON código y CON foto: así el panel muestra "Cód." y la miniatura, y la
  -- factura/correos llevan la imagen aunque el producto no esté en el catálogo.
  insert into public.pedido_items (pedido_id, producto, codigo_producto, marca, talla, color, cantidad, precio_unitario, imagen)
  values (v_pedido, s.producto, s.producto_codigo, s.marca, s.talla, s.color, s.cantidad, s.precio_unitario, s.imagen);

  -- Registrar el abono como INGRESO en la caja (pago del cliente), igual que un pedido
  -- normal. Sin esto, el dinero del encargo no entraba a "Entradas del mes" ni al saldo.
  if v_abono > 0 then
    insert into public.pagos (pedido_id, cliente_id, fecha, tipo, monto, moneda, monto_original, observaciones)
    values (v_pedido, v_cliente, current_date, 'abono_inicial', v_abono, 'USD', v_abono, 'Abono del encargo ' || s.codigo)
    returning id into v_pago;

    insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, moneda, monto_original, pedido_id, pago_id, observaciones)
    values (now(), 'ingreso', 'Abono inicial ' || v_codigo, v_abono, 'USD', v_abono, v_pedido, v_pago, 'Encargo web ' || s.codigo);
  end if;

  update public.solicitudes set estado = 'confirmada', pedido_id = v_pedido, updated_at = now() where id = s.id;

  return v_codigo;
end;
$$;

grant execute on function public.confirmar_solicitud(uuid, numeric) to authenticated;

-- ── Backfill: pedidos ya confirmados desde un encargo que quedaron SIN código ──
-- (por la regresión de 202608230002). Recuperamos el código —y, si la solicitud lo
-- tenía, la foto— desde la solicitud origen, emparejando por nombre de producto.
update public.pedido_items pi
set codigo_producto = coalesce(pi.codigo_producto, s.producto_codigo),
    imagen          = coalesce(pi.imagen, s.imagen)
from public.solicitudes s
where s.pedido_id = pi.pedido_id
  and pi.producto = s.producto
  and (
    (pi.codigo_producto is null and s.producto_codigo is not null)
    or (pi.imagen is null and s.imagen is not null)
  );

commit;
