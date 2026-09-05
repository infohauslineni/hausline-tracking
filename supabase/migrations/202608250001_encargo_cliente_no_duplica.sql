-- Encargo web: NO duplicar el cliente al confirmar.
--
-- La llave del cliente es el TELÉFONO (WhatsApp), normalizado a los últimos 8 dígitos.
-- Si ese teléfono ya está en public.clientes se REUSA ese registro (no se crea otro).
-- Además, con los datos que el cliente puso al encargar:
--   • nombre    → se REEMPLAZA por el del encargo (el teléfono manda; el nombre puede
--                 corregirse). Solo si viene un nombre válido en el encargo.
--   • correo    → se COMPLETA solo si el cliente NO tenía correo guardado.
--   • ciudad    → se COMPLETA solo si estaba vacía.
--   • dirección → se COMPLETA solo si estaba vacía.
-- El teléfono nunca se toca (es la llave). Si el teléfono es nuevo, se inserta normal.
--
-- Resto de la función igual a 202608240001 (código+foto del ítem y registro del abono).

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
    -- Teléfono nuevo (o encargo sin teléfono): se crea el cliente.
    insert into public.clientes (nombre, whatsapp, correo, ciudad, direccion)
    values (s.cliente_nombre, s.cliente_whatsapp, s.cliente_correo, s.cliente_ciudad, s.cliente_direccion)
    returning id into v_cliente;
  else
    -- Ya existe ese teléfono: NO se duplica. Se actualiza el nombre al del encargo y
    -- se completan los datos que estaban vacíos, sin pisar los que ya tenías.
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
