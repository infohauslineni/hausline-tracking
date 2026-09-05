-- Confirmar encargo web → crea el pedido AL INSTANTE con foto y todo.
--
-- Versión final y autocontenida de confirmar_solicitud (reemplaza a las pendientes
-- 202608230002 y 202608250001). Junta todo lo bueno y agrega la garantía de la foto:
--   • Cliente por TELÉFONO: si ya existe, se reusa y se completan datos vacíos (no se
--     duplica); si es nuevo, se inserta.
--   • Ítem del pedido CON código y CON foto. La foto es coalesce(foto del encargo,
--     foto del catálogo por código) → aunque el encargo no traiga imagen, si el
--     producto está en el catálogo, la foto aparece igual desde el primer momento.
--   • El abono se registra como INGRESO en la caja (pagos + movimientos_cuenta).
--
-- Es idempotente (create or replace): se puede correr aunque las pendientes ya se
-- hayan aplicado o no.

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
  v_foto text;
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

  insert into public.pedidos (cliente_id, estado, total, abono, saldo, notas_internas)
  values (v_cliente, 'pedido_confirmado', s.total, v_abono, s.total - v_abono,
          'Encargo web ' || s.codigo || ' · envío ' || coalesce(s.envio, 'estandar'))
  returning id, codigo into v_pedido, v_codigo;

  -- Foto: la que trajo el encargo o, si no, la del catálogo por código (upper para
  -- tolerar diferencias de mayúsculas). Así el pedido nace con miniatura.
  v_foto := coalesce(
    s.imagen,
    (select imagen from public.productos where upper(codigo) = upper(coalesce(s.producto_codigo, '')) and imagen is not null limit 1)
  );

  insert into public.pedido_items (pedido_id, producto, codigo_producto, marca, talla, color, cantidad, precio_unitario, imagen)
  values (v_pedido, s.producto, s.producto_codigo, s.marca, s.talla, s.color, s.cantidad, s.precio_unitario, v_foto);

  -- Registrar el abono como INGRESO en la caja (pago del cliente).
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
