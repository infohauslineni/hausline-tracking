-- Ajustes al encargo web: tipo de envío (estándar/rápido con recargo), forma de pago
-- (total o abono 50%) y el monto a pagar ahora. Todo se guarda en la solicitud para
-- que al confirmar, el pedido HS quede con el total y el abono correctos.

begin;

alter table public.solicitudes add column if not exists envio text not null default 'estandar';
alter table public.solicitudes add column if not exists recargo numeric(12,2) not null default 0 check (recargo >= 0);
alter table public.solicitudes add column if not exists pago_tipo text not null default 'total';
alter table public.solicitudes add column if not exists abono numeric(12,2) not null default 0 check (abono >= 0);

-- Reemplazo de la función pública con los nuevos parámetros (envío, recargo, forma de pago).
drop function if exists public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric);

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
  p_pago text default 'total'
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
    tipo_cambio, total_nio, envio, recargo, pago_tipo, abono
  ) values (
    trim(p_nombre), trim(p_whatsapp), nullif(trim(p_correo), ''), nullif(trim(p_ciudad), ''), nullif(trim(p_direccion), ''),
    trim(p_producto), nullif(trim(p_producto_codigo), ''), nullif(trim(p_marca), ''), nullif(trim(p_talla), ''), nullif(trim(p_color), ''),
    -- Córdobas "cerrados" (redondeados hacia arriba al múltiplo de 10).
    v_cant, v_precio, v_total, v_rate, case when v_rate is not null then ceil(v_total * v_rate / 10.0) * 10 end,
    v_envio, v_recargo, v_pago, v_abono
  ) returning codigo into v_codigo;

  return v_codigo;
end;
$$;

revoke all on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text) from public;
grant execute on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text) to anon, authenticated;

-- Al confirmar: el pedido hereda el abono ya pagado (total o 50%) y anota el envío.
create or replace function public.confirmar_solicitud(p_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.solicitudes;
  v_cliente uuid;
  v_pedido uuid;
  v_codigo text;
  v_abono numeric(12,2);
begin
  if not public.usuario_activo() then raise exception 'No autorizado'; end if;
  select * into s from public.solicitudes where id = p_id and estado = 'pendiente' for update;
  if not found then raise exception 'Solicitud no encontrada o ya procesada'; end if;

  select id into v_cliente from public.clientes where whatsapp = s.cliente_whatsapp limit 1;
  if v_cliente is null then
    insert into public.clientes (nombre, whatsapp, correo, ciudad, direccion)
    values (s.cliente_nombre, s.cliente_whatsapp, s.cliente_correo, s.cliente_ciudad, s.cliente_direccion)
    returning id into v_cliente;
  end if;

  v_abono := least(coalesce(s.abono, 0), s.total);

  insert into public.pedidos (cliente_id, estado, total, abono, saldo, notas_internas)
  values (v_cliente, 'pedido_confirmado', s.total, v_abono, s.total - v_abono,
          'Encargo web ' || s.codigo || ' · envío ' || coalesce(s.envio, 'estandar'))
  returning id, codigo into v_pedido, v_codigo;

  insert into public.pedido_items (pedido_id, producto, marca, talla, color, cantidad, precio_unitario)
  values (v_pedido, s.producto, s.marca, s.talla, s.color, s.cantidad, s.precio_unitario);

  update public.solicitudes set estado = 'confirmada', pedido_id = v_pedido, updated_at = now() where id = s.id;

  return v_codigo;
end;
$$;

commit;
