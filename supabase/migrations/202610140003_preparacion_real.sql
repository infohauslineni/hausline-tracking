-- PREPARACIÓN REAL POR MARCA / PRODUCTO (2026-10-14).
-- Reportes → Tiempos reales → "Usar en la tienda" guarda aquí cuánto tarda de verdad cada marca o
-- producto en prepararse (En preparación → Control de calidad):
--   configuracion.preparacion_tienda = { "marcas": { "GOLDEN GOOSE": {"min":6,"max":8} },
--                                        "productos": { "CL0044": {"min":2,"max":3} } }
-- Lo usan:
--   · la TIENDA (RPC pública preparacion_tienda) para prometer la preparación real de CADA producto,
--     también los que no están en el admin de la tienda;
--   · la FECHA ESTIMADA de los pedidos: mientras están en "Pedido confirmado" o "En preparación",
--     en vez de los días generales de preparación se usan los reales de sus productos.
-- Incluye la "fecha fija" (desde el día en que entró a su etapa; si llega y no avanza, de a 3 días).
-- Es seguro correrlo de nuevo.

insert into public.configuracion (clave, valor_json)
values ('preparacion_tienda', '{"marcas":{},"productos":{}}'::jsonb)
on conflict (clave) do nothing;

-- Pública (solo lectura): la tienda la pide al cargar.
create or replace function public.preparacion_tienda()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select valor_json from public.configuracion where clave = 'preparacion_tienda'), '{}'::jsonb);
$$;
revoke all on function public.preparacion_tienda() from public;
grant execute on function public.preparacion_tienda() to anon, authenticated, service_role;

-- Días reales de preparación de un pedido: el producto más lento manda (por código, si no por marca).
-- null = ninguno de sus productos tiene dato real → se usan los días generales.
create or replace function public.dias_preparacion_pedido(p_pedido uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  with cfg as (select coalesce((select valor_json from public.configuracion where clave = 'preparacion_tienda'), '{}'::jsonb) as v)
  select max(coalesce(
           nullif((cfg.v -> 'productos' -> upper(btrim(coalesce(i.codigo_producto, ''))) ->> 'max'), '')::integer,
           nullif((cfg.v -> 'marcas' -> upper(btrim(coalesce(i.marca, ''))) ->> 'max'), '')::integer))
    from public.pedido_items i, cfg
   where i.pedido_id = p_pedido
     and i.producto !~* '^env[íi]o\M';
$$;

-- Cuántos días correr la fecha por la preparación real (puede ser negativo: marcas más rápidas).
-- Solo antes de Control de calidad; después la preparación ya pasó.
create or replace function public.ajuste_preparacion(p_pedido uuid, p_estado public.estado_pedido)
returns integer language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_real integer; v_cfg jsonb; v_prep integer; v_cc integer;
begin
  if p_estado not in ('pedido_confirmado', 'en_preparacion') then return 0; end if;
  v_real := public.dias_preparacion_pedido(p_pedido);
  if v_real is null then return 0; end if;
  select valor_json into v_cfg from public.configuracion where clave = 'estimaciones';
  v_prep := coalesce((v_cfg -> 'dias_por_estado' ->> 'en_preparacion')::integer, 24);
  v_cc := coalesce((v_cfg -> 'dias_por_estado' ->> 'control_calidad')::integer, 20);
  return v_real - greatest(0, v_prep - v_cc);
end;
$$;
revoke all on function public.dias_preparacion_pedido(uuid) from public, anon;
revoke all on function public.ajuste_preparacion(uuid, public.estado_pedido) from public, anon;
grant execute on function public.dias_preparacion_pedido(uuid) to authenticated, service_role;
grant execute on function public.ajuste_preparacion(uuid, public.estado_pedido) to authenticated, service_role;

-- Al cambiar de etapa: fecha = hoy + días de la etapa (+ ajuste por la preparación real).
create or replace function public.actualizar_estimacion_al_cambiar_estado()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_activo boolean := true;
begin
  select coalesce((valor_json ->> 'activo')::boolean, true) into v_activo from public.configuracion where clave = 'estimaciones';
  if coalesce(v_activo, true) and (tg_op = 'INSERT' or old.estado is distinct from new.estado) then
    new.fecha_estimada := public.calcular_fecha_estimada_dinamica(new.estado) + coalesce(public.ajuste_preparacion(new.id, new.estado), 0);
  end if;
  return new;
end;
$$;

-- Al crear un pedido sus productos llegan después del pedido: apenas se agregan, se corrige la fecha
-- (solo pedidos recién creados y antes de Control de calidad). No cambia el estado → no manda correos.
create or replace function public.estimacion_por_productos()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.pedidos p
     set fecha_estimada = public.calcular_fecha_estimada_dinamica(p.estado) + public.ajuste_preparacion(p.id, p.estado)
   where p.id = new.pedido_id
     and p.estado in ('pedido_confirmado', 'en_preparacion')
     and p.created_at > now() - interval '12 hours'
     and public.calcular_fecha_estimada_dinamica(p.estado) is not null
     and p.fecha_estimada is distinct from public.calcular_fecha_estimada_dinamica(p.estado) + public.ajuste_preparacion(p.id, p.estado);
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.estimacion_por_productos() from public, anon, authenticated;
drop trigger if exists pedido_items_estimacion on public.pedido_items;
create trigger pedido_items_estimacion after insert on public.pedido_items
  for each row execute function public.estimacion_por_productos();

-- Recálculo diario (fecha fija + preparación real).
create or replace function public.recalcular_fechas_estimadas()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hoy date := (now() at time zone 'America/Managua')::date;
  v_actualizadas integer := 0;
begin
  if coalesce(auth.role(), '') not in ('service_role', '') and not public.usuario_activo() then raise exception 'No autorizado' using errcode = '42501'; end if;

  with base as (
    select p.id,
           (public.calcular_fecha_estimada_dinamica(p.estado) - current_date) + coalesce(public.ajuste_preparacion(p.id, p.estado), 0) as dias,
           coalesce(
             (select (max(h.created_at) at time zone 'America/Managua')::date
                from public.historial_pedidos h
               where h.pedido_id = p.id and h.estado_nuevo = p.estado),
             p.fecha_pedido::date,
             v_hoy
           ) as entrada
      from public.pedidos p
     where p.activo
       and p.estado not in ('cancelado', 'entregado', 'llego_nicaragua', 'disponible_entrega', 'pagado', 'empaquetado')
  ), calc as (
    select b.id,
           case
             when b.dias is null then null
             when b.entrada + b.dias > v_hoy then b.entrada + b.dias
             else (b.entrada + b.dias) + 3 * ceil((v_hoy - (b.entrada + b.dias) + 1) / 3.0)::integer
           end as nueva
      from base b
  )
  update public.pedidos p set fecha_estimada = greatest(coalesce(p.fecha_estimada, c.nueva), c.nueva)
    from calc c
   where p.id = c.id and c.nueva is not null
     and p.fecha_estimada is distinct from greatest(coalesce(p.fecha_estimada, c.nueva), c.nueva);
  get diagnostics v_actualizadas = row_count;

  return v_actualizadas + public.posponer_entregas_pais_destino();
end;
$$;
revoke all on function public.recalcular_fechas_estimadas() from public, anon;
grant execute on function public.recalcular_fechas_estimadas() to authenticated, service_role;

select public.preparacion_tienda() as preparacion_guardada,
       (select count(*) from pg_trigger where tgname = 'pedido_items_estimacion') as trigger_productos;
