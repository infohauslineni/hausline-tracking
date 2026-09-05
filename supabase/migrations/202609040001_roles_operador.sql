-- Hausline Tracking · Rol "operador" (dar trabajo sin filtrar finanzas)
--
-- Hoy TODAS las tablas usan usuario_activo() en sus políticas, así que cualquier
-- usuario activo ve todo (finanzas, costos, ganancias). Esta migración:
--   1. Deja como admin a los perfiles existentes (el dueño) para no auto-bloquearse.
--   2. Mueve los costos por ítem a una tabla hermana solo-admin (blindaje total: ni
--      por API se filtran, porque RLS no puede ocultar columnas del mismo rol Postgres).
--   3. Expone una vista solo-lectura del catálogo (código/nombre/foto) para que el
--      operador vea las fotos de los pedidos sin poder leer productos.precio_compra.
--   4. Blinda a admin todas las tablas de dinero y las RPCs "security definer" que leen
--      totales o mueven saldos (esas saltan el RLS, así que se protegen por dentro).
-- El operador conserva: pedidos, pedido_items (sin costos), clientes, trayectos,
-- tracking_eventos, transportistas, archivos_pedido, historial_pedidos, alertas y
-- solicitudes (encargos web, solo ver). Los usuarios NUEVOS nacen 'operador' por el
-- trigger crear_perfil_nuevo_usuario.

begin;

-- 1) No auto-bloqueo: los perfiles que ya existen son cuentas del dueño (antes no había
-- distinción de rol). Se marcan admin. Los nuevos empleados nacen 'operador'.
update public.perfiles set rol = 'admin' where rol <> 'admin';

-- 2) Costos por ítem -> tabla solo-admin ------------------------------------------------
create table if not exists public.pedido_item_costos (
  item_id uuid primary key references public.pedido_items(id) on delete cascade,
  precio_compra numeric(12,2) not null default 0 check (precio_compra >= 0),
  envio_internacional numeric(12,2) not null default 0 check (envio_internacional >= 0),
  costo_delivery numeric(12,2) not null default 0 check (costo_delivery >= 0),
  otros_gastos numeric(12,2) not null default 0 check (otros_gastos >= 0)
);

-- Copia los costos actuales antes de eliminar las columnas de pedido_items.
insert into public.pedido_item_costos (item_id, precio_compra, envio_internacional, costo_delivery, otros_gastos)
select id, precio_compra, envio_internacional, costo_delivery, otros_gastos
from public.pedido_items
on conflict (item_id) do nothing;

alter table public.pedido_items
  drop column if exists precio_compra,
  drop column if exists envio_internacional,
  drop column if exists costo_delivery,
  drop column if exists otros_gastos;

alter table public.pedido_item_costos enable row level security;
drop policy if exists pedido_item_costos_admin on public.pedido_item_costos;
create policy pedido_item_costos_admin on public.pedido_item_costos for all to authenticated
  using (public.usuario_admin()) with check (public.usuario_admin());
grant select, insert, update, delete on public.pedido_item_costos to authenticated;

-- 3) Vista de fotos del catálogo para el operador --------------------------------------
-- El operador necesita nombre/foto del producto para ver los pedidos, pero NO debe leer
-- productos (que trae precio_compra). Esta vista corre con privilegios del dueño (no
-- aplica el RLS de productos) y solo expone tres columnas no sensibles.
create or replace view public.catalogo_fotos as
  select codigo, nombre, imagen from public.productos;
grant select on public.catalogo_fotos to authenticated;

-- 4) Blindar a admin las tablas de dinero ----------------------------------------------
-- Patrón: reemplazar usuario_activo() por usuario_admin() en cada política. El operador
-- que consulte estas tablas recibirá 0 filas (RLS), aunque lo intente por consola.
drop policy if exists pagos_admin_total on public.pagos;
create policy pagos_admin_solo on public.pagos for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists gastos_admin_total on public.gastos;
create policy gastos_admin_solo on public.gastos for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists movimientos_cuenta_admin_total on public.movimientos_cuenta;
create policy movimientos_cuenta_admin_solo on public.movimientos_cuenta for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists cuentas_bancarias_admin_total on public.cuentas_bancarias;
create policy cuentas_bancarias_admin_solo on public.cuentas_bancarias for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists transferencias_cuenta_admin_total on public.transferencias_cuenta;
create policy transferencias_cuenta_admin_solo on public.transferencias_cuenta for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists inversiones_admin_total on public.inversiones;
create policy inversiones_admin_solo on public.inversiones for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists deudas_admin_total on public.deudas;
create policy deudas_admin_solo on public.deudas for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists pagos_deuda_admin_total on public.pagos_deuda;
create policy pagos_deuda_admin_solo on public.pagos_deuda for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists metas_compra_admin_total on public.metas_compra;
create policy metas_compra_admin_solo on public.metas_compra for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists asignaciones_ganancia_admin_total on public.asignaciones_ganancia;
create policy asignaciones_ganancia_admin_solo on public.asignaciones_ganancia for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists aperturas_caja_admin_total on public.aperturas_caja;
create policy aperturas_caja_admin_solo on public.aperturas_caja for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists proveedores_admin_total on public.proveedores;
create policy proveedores_admin_solo on public.proveedores for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists productos_admin_total on public.productos;
create policy productos_admin_solo on public.productos for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

drop policy if exists configuracion_admin_total on public.configuracion;
create policy configuracion_admin_solo on public.configuracion for all to authenticated using (public.usuario_admin()) with check (public.usuario_admin());

-- 5) Blindar a admin las RPCs security-definer que leen totales o mueven saldos --------
-- (saltan el RLS por ser security definer, así que se protegen con un chequeo interno).

create or replace function public.ajustar_saldo_cuenta(p_id uuid, p_delta numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare nuevo numeric;
begin
  if not public.usuario_admin() then raise exception 'No autorizado'; end if;
  if p_id is null then return null; end if;
  update public.cuentas_bancarias
     set saldo = round(saldo + coalesce(p_delta, 0), 2)
   where id = p_id
  returning saldo into nuevo;
  return nuevo;
end;
$$;

create or replace function public.transferir_entre_cuentas(
  p_origen uuid, p_destino uuid, p_monto_origen numeric, p_monto_destino numeric, p_nota text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public.usuario_admin() then raise exception 'No autorizado'; end if;
  if p_origen is null or p_destino is null then raise exception 'Elegí la cuenta de origen y la de destino.'; end if;
  if p_origen = p_destino then raise exception 'Elegí dos cuentas distintas.'; end if;
  if coalesce(p_monto_origen, 0) <= 0 or coalesce(p_monto_destino, 0) <= 0 then raise exception 'Indicá un monto válido.'; end if;
  perform public.ajustar_saldo_cuenta(p_origen, -abs(p_monto_origen));
  perform public.ajustar_saldo_cuenta(p_destino, abs(p_monto_destino));
  insert into public.transferencias_cuenta (origen_id, destino_id, monto_origen, monto_destino, nota)
    values (p_origen, p_destino, abs(p_monto_origen), abs(p_monto_destino), nullif(btrim(p_nota), ''))
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.obtener_apertura_caja(p_periodo date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_inicio date := date_trunc('month', p_periodo)::date;
  v_fin date := (date_trunc('month', p_periodo) + interval '1 month')::date;
  v_sugerido numeric;
  v_apertura numeric;
  v_mov_mes numeric;
  v_opening numeric;
begin
  if not public.usuario_admin() then raise exception 'No autorizado'; end if;
  select coalesce(sum(case when tipo in ('ingreso','ajuste_entrada') then monto else -monto end), 0)
    into v_sugerido from public.movimientos_cuenta where fecha < v_inicio::timestamptz;
  select monto into v_apertura from public.aperturas_caja where periodo = v_inicio;
  select coalesce(sum(case when tipo in ('ingreso','ajuste_entrada') then monto else -monto end), 0)
    into v_mov_mes from public.movimientos_cuenta where fecha >= v_inicio::timestamptz and fecha < v_fin::timestamptz;
  v_opening := coalesce(v_apertura, v_sugerido);
  return jsonb_build_object(
    'periodo', v_inicio, 'sugerido', v_sugerido, 'apertura', v_apertura, 'opening', v_opening,
    'movimientos_mes', v_mov_mes, 'saldo_mes', v_opening + v_mov_mes, 'confirmada', v_apertura is not null
  );
end;
$$;

create or replace function public.guardar_apertura_caja(p_periodo date, p_monto numeric, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inicio date := date_trunc('month', p_periodo)::date;
begin
  if not public.usuario_admin() then raise exception 'No autorizado'; end if;
  insert into public.aperturas_caja (periodo, monto, nota) values (v_inicio, coalesce(p_monto, 0), p_nota)
  on conflict (periodo) do update set monto = excluded.monto, nota = excluded.nota, updated_at = now();
  return public.obtener_apertura_caja(v_inicio);
end;
$$;

-- Resumen comercial: admin-only + lee los costos desde pedido_item_costos.
create or replace function public.obtener_resumen_comercial(p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare resultado jsonb;
begin
  if not public.usuario_admin() then raise exception 'No autorizado'; end if;
  select jsonb_build_object(
    'ventas', coalesce((select sum(total) from public.pedidos where activo and (p_desde is null or fecha_pedido >= p_desde) and (p_hasta is null or fecha_pedido <= p_hasta)), 0),
    'cobrado', coalesce((select sum(case when tipo = 'reembolso' then -monto else monto end) from public.pagos where (p_desde is null or fecha >= p_desde) and (p_hasta is null or fecha <= p_hasta)), 0),
    'por_cobrar', coalesce((select sum(greatest(saldo, 0)) from public.pedidos where activo and estado <> 'cancelado'), 0),
    'gastos', coalesce((select sum(monto) from public.gastos where (p_desde is null or fecha >= p_desde) and (p_hasta is null or fecha <= p_hasta)), 0),
    'costos_productos', coalesce((select sum(i.cantidad * (c.precio_compra + c.envio_internacional + c.costo_delivery + c.otros_gastos)) from public.pedido_items i join public.pedido_item_costos c on c.item_id = i.id join public.pedidos p on p.id = i.pedido_id where (p_desde is null or p.fecha_pedido >= p_desde) and (p_hasta is null or p.fecha_pedido <= p_hasta)), 0),
    'saldo_cuenta', coalesce((select sum(case when tipo in ('ingreso','ajuste_entrada') then monto else -monto end) from public.movimientos_cuenta), 0),
    'pedidos', coalesce((select count(*) from public.pedidos where activo and (p_desde is null or fecha_pedido >= p_desde) and (p_hasta is null or fecha_pedido <= p_hasta)), 0)
  ) into resultado;
  return resultado;
end;
$$;

-- Ganancia realizada: admin-only + costos desde pedido_item_costos (convertida a plpgsql
-- para poder rechazar al operador; antes era SQL sin control de acceso).
create or replace function public.obtener_ganancia_realizada(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.usuario_admin() then raise exception 'No autorizado'; end if;
  return (
    with entregados as (
      select p.id, p.total,
        coalesce((select sum(case when pa.tipo = 'reembolso' then -pa.monto else pa.monto end) from public.pagos pa where pa.pedido_id = p.id), 0) as cobrado,
        coalesce((select sum(g.monto) from public.gastos g where g.pedido_id = p.id), 0) as gastos,
        coalesce((select sum(i.cantidad * (c.precio_compra + c.envio_internacional + c.costo_delivery + c.otros_gastos)) from public.pedido_items i join public.pedido_item_costos c on c.item_id = i.id where i.pedido_id = p.id), 0) as costo_items
      from public.pedidos p
      where p.activo = true and p.estado = 'entregado'
        and p.updated_at::date between p_desde and p_hasta
    ), resumen as (
      select count(*)::int pedidos_entregados,
        coalesce(sum(least(total, greatest(0,cobrado))),0) cobrado,
        coalesce(sum(greatest(gastos,costo_items)),0) costos,
        coalesce(sum(greatest(0, least(total,greatest(0,cobrado)) - greatest(gastos,costo_items))),0) ganancia
      from entregados
    ), usado as (
      select coalesce(sum(case when tipo='reintegro' then -monto else monto end),0) monto
      from public.asignaciones_ganancia where fecha between p_desde and p_hasta
    )
    select jsonb_build_object(
      'desde', p_desde, 'hasta', p_hasta,
      'pedidos_entregados', r.pedidos_entregados,
      'cobrado', r.cobrado, 'costos', r.costos,
      'ganancia_realizada', r.ganancia,
      'ganancia_asignada', u.monto,
      'ganancia_disponible', greatest(0, r.ganancia-u.monto)
    ) from resumen r cross join usado u
  );
end;
$$;

commit;
