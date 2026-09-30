-- Fecha de entrega (pedido del dueño 2026-09-29):
--   · "País de destino" (llego_nicaragua): la fecha estimada ya NO se recalcula sola cada noche
--     (antes quedaba siempre en "hoy + 3" y nunca llegaba). Si llega el día de la entrega y el
--     pedido sigue en País de destino, a las 12:00 a. m. (hora de Nicaragua) se corre 3 días, y
--     así cada vez hasta que se marque "Disponible para entrega".
--   · "Disponible para entrega" / "Pagado" / "Empaquetado": la fecha queda FIJA en el día en que
--     se marcó (el trigger ya la pone en current_date al cambiar de estado). Esa es la fecha de
--     entrega oficial; antes el recálculo diario la movía a "hoy" todos los días.
--   · Los demás estados siguen igual que antes.
-- Es seguro correrlo de nuevo.

-- 1) El recálculo diario ya no toca País de destino ni los estados ya disponibles ------------
create or replace function public.recalcular_fechas_estimadas()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actualizadas integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.usuario_activo() then raise exception 'No autorizado'; end if;
  update public.pedidos p
     set fecha_estimada = public.calcular_fecha_estimada_dinamica(p.estado)
   where p.activo
     and p.estado not in ('cancelado', 'entregado', 'llego_nicaragua', 'disponible_entrega', 'pagado', 'empaquetado')
     and p.fecha_estimada is distinct from public.calcular_fecha_estimada_dinamica(p.estado);
  get diagnostics v_actualizadas = row_count;
  return v_actualizadas + public.posponer_entregas_pais_destino();
end;
$$;

-- 2) País de destino: si llegó el día (o ya pasó) sin pasar a Disponible, +3 días -----------
create or replace function public.posponer_entregas_pais_destino()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hoy date := (now() at time zone 'America/Managua')::date;
  v_n integer;
begin
  if coalesce(auth.role(), '') not in ('service_role', '') and not public.usuario_activo() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update public.pedidos p
     set fecha_estimada = case
           when p.fecha_estimada is null then v_hoy + 3
           -- de a 3 días hasta quedar DESPUÉS de hoy (ej. era el 29 y hoy es 29 → 2 de octubre)
           else p.fecha_estimada + 3 * ceil((v_hoy - p.fecha_estimada + 1) / 3.0)::integer
         end
   where p.activo and p.estado = 'llego_nicaragua'
     and (p.fecha_estimada is null or p.fecha_estimada <= v_hoy);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.posponer_entregas_pais_destino() from public, anon;
grant execute on function public.posponer_entregas_pais_destino() to authenticated, service_role;
revoke all on function public.recalcular_fechas_estimadas() from public, anon;
grant execute on function public.recalcular_fechas_estimadas() to authenticated, service_role;

-- 3) Tarea a las 12:00 a. m. de Nicaragua (06:00 UTC) ----------------------------------------
create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'posponer-entregas-pais-destino') then
    perform cron.unschedule('posponer-entregas-pais-destino');
  end if;
  perform cron.schedule('posponer-entregas-pais-destino', '0 6 * * *', 'select public.posponer_entregas_pais_destino()');
end $$;

-- Aplica ya la regla a los pedidos que hoy están en País de destino con la fecha vencida.
select public.posponer_entregas_pais_destino();
