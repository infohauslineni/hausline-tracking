-- Confirmar encargo web (v3): reemplaza 202608260001. Al crear el pedido ahora:
--
--   • Agrega la LÍNEA de ENVÍO RÁPIDO cuando el encargo lo pidió (s.envio = 'rapido'),
--     con el recargo REAL del encargo (s.recargo). El trigger pedido_items_recalcular_totales
--     recalcula pedidos.total = suma(subtotales), así que SIN esta línea el recargo (que ya
--     venía dentro de s.total) se perdía: el pedido y la factura quedaban sin el envío rápido.
--     Se marca con la misma nota '__envio_rapido__' que usa la app, para que el editor lo
--     reconozca (casilla marcada) y no lo duplique.
--
--   • Registra el abono en la CUENTA elegida por el admin (p_cuenta_id + p_monto_cuenta) y
--     ajusta el saldo de esa tarjeta, igual que el resto de la caja. Antes el abono entraba
--     "sin método" y sin cuenta, así que no sumaba a ninguna tarjeta.
--
-- Cambia la firma (agrega 2 parámetros), por eso primero se elimina la versión de 2 args
-- para que PostgREST no quede con dos overloads ambiguos.

drop function if exists public.confirmar_solicitud(uuid, numeric);

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

  insert into public.pedidos (cliente_id, estado, total, abono, saldo, envio_rapido, notas_internas)
  values (v_cliente, 'pedido_confirmado', s.total, v_abono, s.total - v_abono,
          coalesce(s.envio, 'estandar') = 'rapido',
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

    -- Delta a la tarjeta EN LA MONEDA de la cuenta (el panel lo manda ya convertido); si no
    -- vino, cae al abono en USD. Solo cuando el admin eligió cuenta.
    v_delta_cuenta := case when p_cuenta_id is not null then abs(coalesce(p_monto_cuenta, v_abono)) else null end;

    insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, moneda, monto_original, metodo, pedido_id, pago_id, cuenta_id, monto_cuenta, observaciones)
    values (now(), 'ingreso', 'Abono inicial ' || v_codigo, v_abono, 'USD', v_abono, 'Transferencia', v_pedido, v_pago, p_cuenta_id, v_delta_cuenta, 'Encargo web ' || s.codigo);

    if p_cuenta_id is not null then
      perform public.ajustar_saldo_cuenta(p_cuenta_id, v_delta_cuenta);
    end if;
  end if;

  update public.solicitudes set estado = 'confirmada', pedido_id = v_pedido, updated_at = now() where id = s.id;

  return v_codigo;
end;
$$;

grant execute on function public.confirmar_solicitud(uuid, numeric, uuid, numeric) to authenticated;
