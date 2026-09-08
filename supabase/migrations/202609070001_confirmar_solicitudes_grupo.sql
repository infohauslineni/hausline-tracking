-- Hausline · Confirmar VARIOS encargos web del mismo cliente como UN solo pedido.
--
-- Cuando un cliente encarga muchos productos desde la web, cada uno crea una solicitud
-- SOL-#### aparte. Esta función junta las solicitudes indicadas (todas del mismo cliente,
-- verificado por teléfono) en UN único pedido HS con todas las líneas, el total sumado y un
-- solo abono. Espeja a confirmar_solicitud (mismo cliente reusado por teléfono, herencia de
-- envío rápido / descuento / cupón, abono a la cuenta elegida), pero en lote.
-- Idempotente respecto a la caja: registra UN solo ingreso por el abono del grupo.
begin;

create or replace function public.confirmar_solicitudes_grupo(
  p_ids uuid[],
  p_abono numeric default null,
  p_cuenta_id uuid default null,
  p_monto_cuenta numeric default null
)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.solicitudes;
  v_first public.solicitudes;
  v_cliente uuid;
  v_pedido uuid;
  v_codigo text;
  v_total numeric(12,2);
  v_desc numeric(12,2);
  v_abono numeric(12,2);
  v_sum_abono numeric(12,2);
  v_rapido boolean;
  v_cupon uuid;
  v_cupon_cod text;
  v_tel text;
  v_pago uuid;
  v_foto text;
  v_delta_cuenta numeric(14,2);
  v_n integer;
begin
  if not public.usuario_activo() then raise exception 'No autorizado'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'Sin encargos que confirmar'; end if;

  -- Bloquea las solicitudes pendientes del grupo (evita doble confirmación en paralelo).
  perform 1 from public.solicitudes where id = any(p_ids) and estado = 'pendiente' for update;

  -- La más antigua manda los datos del cliente.
  select * into v_first from public.solicitudes
    where id = any(p_ids) and estado = 'pendiente'
    order by created_at asc limit 1;
  if not found then raise exception 'Ningún encargo del grupo sigue pendiente'; end if;

  -- Todas deben ser del MISMO cliente (por teléfono normalizado: solo dígitos, últimos 8).
  v_tel := right(regexp_replace(coalesce(v_first.cliente_whatsapp, ''), '[^0-9]', '', 'g'), 8);
  if v_tel <> '' and exists (
    select 1 from public.solicitudes
    where id = any(p_ids) and estado = 'pendiente'
      and right(regexp_replace(coalesce(cliente_whatsapp, ''), '[^0-9]', '', 'g'), 8) <> v_tel
  ) then
    raise exception 'Los encargos del grupo no son del mismo cliente';
  end if;

  -- Totales del grupo: total neto, descuento, abono sugerido y si algún encargo es rápido.
  select count(*), sum(total), sum(coalesce(descuento, 0)),
         bool_or(coalesce(envio, '') = 'rapido'), sum(coalesce(abono, 0))
    into v_n, v_total, v_desc, v_rapido, v_sum_abono
    from public.solicitudes where id = any(p_ids) and estado = 'pendiente';

  -- Cupón: el primero que traiga uno (el descuento total ya va en v_desc; esto es informativo).
  select cupon_id, cupon_codigo into v_cupon, v_cupon_cod
    from public.solicitudes
    where id = any(p_ids) and estado = 'pendiente' and cupon_id is not null
    order by created_at asc limit 1;

  -- Cliente: reusar por teléfono; si no existe, crearlo.
  if v_tel <> '' then
    select id into v_cliente from public.clientes
      where right(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 8) = v_tel
      limit 1;
  end if;
  if v_cliente is null then
    insert into public.clientes (nombre, whatsapp, correo, ciudad, direccion)
    values (v_first.cliente_nombre, v_first.cliente_whatsapp, v_first.cliente_correo, v_first.cliente_ciudad, v_first.cliente_direccion)
    returning id into v_cliente;
  else
    update public.clientes set
      nombre    = coalesce(nullif(trim(v_first.cliente_nombre), ''), nombre),
      correo    = coalesce(nullif(trim(correo), ''), nullif(trim(v_first.cliente_correo), '')),
      ciudad    = coalesce(nullif(trim(ciudad), ''), nullif(trim(v_first.cliente_ciudad), '')),
      direccion = coalesce(nullif(trim(direccion), ''), nullif(trim(v_first.cliente_direccion), '')),
      updated_at = now()
    where id = v_cliente;
  end if;

  -- Monto real pagado ahora: el que indica el admin; si no manda nada, la suma de abonos.
  v_abono := least(greatest(0, coalesce(p_abono, v_sum_abono, 0)), v_total);

  -- UN solo pedido con el total sumado. El descuento total hace que recalcular_totales_pedido
  -- cuadre total = suma(líneas) − descuento.
  insert into public.pedidos (cliente_id, estado, total, abono, saldo, envio_rapido, descuento, cupon_id, cupon_codigo, notas_internas)
  values (v_cliente, 'pedido_confirmado', v_total, v_abono, v_total - v_abono,
          coalesce(v_rapido, false), coalesce(v_desc, 0), v_cupon, v_cupon_cod,
          'Encargo web agrupado · ' || v_n || ' productos (' || v_first.codigo || ' +' || (v_n - 1) || ')')
  returning id, codigo into v_pedido, v_codigo;

  -- Una línea por producto (+ su línea de envío rápido si aplica). Foto: la del encargo o la
  -- del catálogo por código. Se queman los cupones y se marcan las solicitudes confirmadas.
  for s in
    select * from public.solicitudes
    where id = any(p_ids) and estado = 'pendiente'
    order by created_at asc
  loop
    v_foto := coalesce(
      s.imagen,
      (select imagen from public.productos where upper(codigo) = upper(coalesce(s.producto_codigo, '')) and imagen is not null limit 1)
    );
    insert into public.pedido_items (pedido_id, producto, codigo_producto, marca, talla, color, cantidad, precio_unitario, imagen)
    values (v_pedido, s.producto, s.producto_codigo, s.marca, s.talla, s.color, s.cantidad, s.precio_unitario, v_foto);

    if coalesce(s.envio, '') = 'rapido' and coalesce(s.recargo, 0) > 0 then
      insert into public.pedido_items (pedido_id, producto, categoria, cantidad, precio_unitario, notas)
      values (v_pedido, 'Envío rápido (14–17 días)', 'Servicio', 1, s.recargo, '__envio_rapido__');
    end if;

    if s.cupon_id is not null then
      perform public.registrar_uso_cupon(s.cupon_id);
    end if;

    update public.solicitudes set estado = 'confirmada', pedido_id = v_pedido, updated_at = now() where id = s.id;
  end loop;

  -- Un solo ingreso por el abono del grupo, a la cuenta elegida.
  if v_abono > 0 then
    insert into public.pagos (pedido_id, cliente_id, fecha, tipo, monto, moneda, monto_original, metodo_pago, observaciones)
    values (v_pedido, v_cliente, current_date, 'abono_inicial', v_abono, 'USD', v_abono, 'Transferencia',
            'Abono del encargo agrupado (' || v_n || ' productos)')
    returning id into v_pago;

    v_delta_cuenta := case when p_cuenta_id is not null then abs(coalesce(p_monto_cuenta, v_abono)) else null end;

    insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, moneda, monto_original, metodo, pedido_id, pago_id, cuenta_id, monto_cuenta, observaciones)
    values (now(), 'ingreso', 'Abono inicial ' || v_codigo, v_abono, 'USD', v_abono, 'Transferencia', v_pedido, v_pago, p_cuenta_id, v_delta_cuenta,
            'Encargo web agrupado · ' || v_first.codigo);

    if p_cuenta_id is not null then
      perform public.ajustar_saldo_cuenta(p_cuenta_id, v_delta_cuenta);
    end if;
  end if;

  return v_codigo;
end;
$$;

grant execute on function public.confirmar_solicitudes_grupo(uuid[], numeric, uuid, numeric) to authenticated;

commit;
