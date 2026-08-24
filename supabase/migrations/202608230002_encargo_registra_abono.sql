-- Encargos web: al CONFIRMAR una solicitud, registrar el abono del cliente como
-- INGRESO en la caja (igual que hace la app al crear un pedido normal).
--
-- Bug: confirmar_solicitud creaba el pedido + sus ítems, pero NO insertaba el pago
-- (tabla pagos) ni el movimiento de caja (movimientos_cuenta tipo 'ingreso') del
-- abono. Como "Entradas del mes" suma pagos y "Saldo de la caja" suma movimientos,
-- el dinero de los encargos confirmados no entraba a esos totales. ("Por cobrar"
-- sí los tomaba, porque suma el saldo de la tabla pedidos.)
--
-- Este archivo: (1) reescribe confirmar_solicitud para registrar el abono, y
-- (2) hace backfill de los encargos ya confirmados que quedaron sin ese registro.

begin;

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

  insert into public.pedido_items (pedido_id, producto, marca, talla, color, cantidad, precio_unitario)
  values (v_pedido, s.producto, s.marca, s.talla, s.color, s.cantidad, s.precio_unitario);

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

-- ── Backfill: encargos ya confirmados cuyo abono nunca se registró ────────────
-- Cualquier pedido con abono > 0 y SIN pago registrado (los pedidos normales
-- siempre crean su pago; los que faltan son los confirmados por confirmar_solicitud
-- antes de este arreglo). Se les crea el pago + el movimiento de ingreso.
with faltantes as (
  insert into public.pagos (pedido_id, cliente_id, fecha, tipo, monto, moneda, monto_original, observaciones)
  select p.id, p.cliente_id, p.fecha_pedido, 'abono_inicial', p.abono, 'USD', p.abono,
         'Abono inicial (registrado en backfill de encargos)'
  from public.pedidos p
  where p.abono > 0
    and not exists (select 1 from public.pagos pg where pg.pedido_id = p.id)
  returning id, pedido_id, monto, fecha
)
insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, moneda, monto_original, pedido_id, pago_id, observaciones)
select (f.fecha::timestamptz + interval '12 hours'), 'ingreso',
       'Abono inicial ' || p.codigo, f.monto, 'USD', f.monto, f.pedido_id, f.id,
       'Movimiento generado en backfill de encargos'
from faltantes f join public.pedidos p on p.id = f.pedido_id;

commit;
