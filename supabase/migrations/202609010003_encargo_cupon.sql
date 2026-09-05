-- Hausline · Cupones en el encargo web (Fase 2).
--
-- El cliente escribe un código de descuento en el checkout (no hay registro, así que el
-- código ES la forma de identificar su cupón). `crear_solicitud_publica` VALIDA el código
-- del lado servidor (nunca confía en el descuento que manda el navegador) y aplica el
-- descuento al total del encargo. Al CONFIRMAR el encargo (que implica pago), el pedido
-- hereda el descuento y el cupón se "quema" (registrar_uso_cupon). Depende de 202609010002.
begin;

alter table public.solicitudes add column if not exists cupon_id uuid references public.cupones(id) on delete set null;
alter table public.solicitudes add column if not exists cupon_codigo text;
alter table public.solicitudes add column if not exists descuento numeric(12,2) not null default 0 check (descuento >= 0);

-- ── crear_solicitud_publica v4: + código de cupón (validado y aplicado en el servidor) ──
drop function if exists public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text, text);

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
  p_imagen text default null,
  p_cupon_codigo text default null
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cant integer;
  v_precio numeric(12,2);
  v_recargo numeric(12,2);
  v_bruto numeric(12,2);
  v_total numeric(12,2);
  v_abono numeric(12,2);
  v_rate numeric(12,4);
  v_pago text;
  v_envio text;
  v_codigo text;
  c public.cupones;
  v_desc numeric(12,2) := 0;
begin
  if p_whatsapp is null or trim(p_whatsapp) !~ '^[0-9+ ()-]{7,25}$' then raise exception 'WhatsApp inválido'; end if;
  if p_nombre is null or char_length(trim(p_nombre)) < 2 then raise exception 'Nombre inválido'; end if;
  if p_producto is null or char_length(trim(p_producto)) < 2 then raise exception 'Producto inválido'; end if;

  v_cant := least(50, greatest(1, coalesce(p_cantidad, 1)));
  v_precio := round(greatest(0, coalesce(p_precio_unitario, 0)), 2);
  v_recargo := round(greatest(0, coalesce(p_recargo, 0)), 2);
  v_bruto := round(v_precio * v_cant + v_recargo, 2);
  v_envio := case when p_envio = 'rapido' then 'rapido' else 'estandar' end;
  v_pago := case when p_pago = '50' then '50' else 'total' end;

  -- Cupón: validación AUTORITATIVA. Ignora en silencio los inválidos/inactivos/vencidos/
  -- agotados (no rompe el encargo). Solo se guarda si de verdad genera descuento.
  if p_cupon_codigo is not null and btrim(p_cupon_codigo) <> '' then
    select * into c from public.cupones where upper(btrim(codigo)) = upper(btrim(p_cupon_codigo)) limit 1;
    if found and c.activo
       and (c.vence_el is null or c.vence_el >= current_date)
       and (c.usos_max is null or c.usos_confirmados < c.usos_max) then
      v_desc := case when c.tipo = 'porcentaje' then round(v_bruto * c.valor / 100.0, 2) else least(c.valor, v_bruto) end;
    end if;
  end if;

  v_total := greatest(0, round(v_bruto - v_desc, 2));
  -- Monto a pagar ahora: total completo, o la mitad si eligió abono 50%.
  v_abono := case when v_pago = '50' then round(v_total * 0.5, 2) else v_total end;

  select (valor_json->>'tipo_cambio')::numeric into v_rate from public.configuracion where clave = 'moneda';

  insert into public.solicitudes (
    cliente_nombre, cliente_whatsapp, cliente_correo, cliente_ciudad, cliente_direccion,
    producto, producto_codigo, marca, talla, color, cantidad, precio_unitario, total,
    tipo_cambio, total_nio, envio, recargo, pago_tipo, abono, imagen,
    cupon_id, cupon_codigo, descuento
  ) values (
    trim(p_nombre), trim(p_whatsapp), nullif(trim(p_correo), ''), nullif(trim(p_ciudad), ''), nullif(trim(p_direccion), ''),
    trim(p_producto), nullif(trim(p_producto_codigo), ''), nullif(trim(p_marca), ''), nullif(trim(p_talla), ''), nullif(trim(p_color), ''),
    -- Córdobas "cerrados" (redondeados hacia arriba al múltiplo de 10).
    v_cant, v_precio, v_total, v_rate, case when v_rate is not null then ceil(v_total * v_rate / 10.0) * 10 end,
    v_envio, v_recargo, v_pago, v_abono, nullif(trim(p_imagen), ''),
    case when v_desc > 0 then c.id else null end, case when v_desc > 0 then c.codigo else null end, v_desc
  ) returning codigo into v_codigo;

  return v_codigo;
end;
$$;

revoke all on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text, text, text) from public;
grant execute on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text, text, text) to anon, authenticated;

-- ── confirmar_solicitud v4: el pedido hereda el descuento/cupón y el cupón se "quema" ──
create or replace function public.confirmar_solicitud(
  p_id uuid,
  p_abono numeric default null,
  p_cuenta_id uuid default null,
  p_monto_cuenta numeric default null
)
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
  v_foto text;
  v_delta_cuenta numeric(14,2);
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
  else
    update public.clientes set
      nombre    = coalesce(nullif(trim(s.cliente_nombre), ''), nombre),
      correo    = coalesce(nullif(trim(correo), ''), nullif(trim(s.cliente_correo), '')),
      ciudad    = coalesce(nullif(trim(ciudad), ''), nullif(trim(s.cliente_ciudad), '')),
      direccion = coalesce(nullif(trim(direccion), ''), nullif(trim(s.cliente_direccion), '')),
      updated_at = now()
    where id = v_cliente;
  end if;

  -- Monto real pagado: el que indica el admin (p_abono); si no manda nada, el de la solicitud.
  v_abono := least(greatest(0, coalesce(p_abono, s.abono, 0)), s.total);

  -- El pedido hereda el descuento/cupón del encargo. El total ya viene NETO en s.total; la
  -- columna descuento hace que recalcular_totales_pedido cuadre total = suma(líneas) − descuento.
  insert into public.pedidos (cliente_id, estado, total, abono, saldo, envio_rapido, descuento, cupon_id, cupon_codigo, notas_internas)
  values (v_cliente, 'pedido_confirmado', s.total, v_abono, s.total - v_abono,
          coalesce(s.envio, 'estandar') = 'rapido', coalesce(s.descuento, 0), s.cupon_id, s.cupon_codigo,
          'Encargo web ' || s.codigo || ' · envío ' || coalesce(s.envio, 'estandar'))
  returning id, codigo into v_pedido, v_codigo;

  -- Foto: la del encargo o, si no, la del catálogo por código.
  v_foto := coalesce(
    s.imagen,
    (select imagen from public.productos where upper(codigo) = upper(coalesce(s.producto_codigo, '')) and imagen is not null limit 1)
  );

  insert into public.pedido_items (pedido_id, producto, codigo_producto, marca, talla, color, cantidad, precio_unitario, imagen)
  values (v_pedido, s.producto, s.producto_codigo, s.marca, s.talla, s.color, s.cantidad, s.precio_unitario, v_foto);

  -- Línea de ENVÍO RÁPIDO (imprescindible: el total se recalcula desde las líneas).
  if coalesce(s.envio, '') = 'rapido' and coalesce(s.recargo, 0) > 0 then
    insert into public.pedido_items (pedido_id, producto, categoria, cantidad, precio_unitario, notas)
    values (v_pedido, 'Envío rápido (14–17 días)', 'Servicio', 1, s.recargo, '__envio_rapido__');
  end if;

  -- Registrar el abono como INGRESO en la caja (pago del cliente) y en la cuenta elegida.
  if v_abono > 0 then
    insert into public.pagos (pedido_id, cliente_id, fecha, tipo, monto, moneda, monto_original, metodo_pago, observaciones)
    values (v_pedido, v_cliente, current_date, 'abono_inicial', v_abono, 'USD', v_abono, 'Transferencia', 'Abono del encargo ' || s.codigo)
    returning id into v_pago;

    v_delta_cuenta := case when p_cuenta_id is not null then abs(coalesce(p_monto_cuenta, v_abono)) else null end;

    insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, moneda, monto_original, metodo, pedido_id, pago_id, cuenta_id, monto_cuenta, observaciones)
    values (now(), 'ingreso', 'Abono inicial ' || v_codigo, v_abono, 'USD', v_abono, 'Transferencia', v_pedido, v_pago, p_cuenta_id, v_delta_cuenta, 'Encargo web ' || s.codigo);

    if p_cuenta_id is not null then
      perform public.ajustar_saldo_cuenta(p_cuenta_id, v_delta_cuenta);
    end if;
  end if;

  -- Quemar el cupón: confirmar el encargo implica que el cliente pagó/transfirió.
  if s.cupon_id is not null then
    perform public.registrar_uso_cupon(s.cupon_id);
  end if;

  update public.solicitudes set estado = 'confirmada', pedido_id = v_pedido, updated_at = now() where id = s.id;

  return v_codigo;
end;
$$;

grant execute on function public.confirmar_solicitud(uuid, numeric, uuid, numeric) to authenticated;

commit;
