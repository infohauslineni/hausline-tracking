-- Etapa 8: estimaciones dinámicas con margen operativo configurable.
insert into public.configuracion (clave, valor_json)
values ('estimaciones', '{"activo":true,"dias_margen":2,"dias_por_estado":{"pedido_confirmado":28,"en_preparacion":24,"control_calidad":20,"despachado":16,"transito_internacional":12,"recibido_estados_unidos":8,"transito_nicaragua":4,"llego_nicaragua":1,"incidencia":5}}'::jsonb)
on conflict (clave) do nothing;

create or replace function public.calcular_fecha_estimada_dinamica(p_estado public.estado_pedido)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_config jsonb;
  v_margen integer := 2;
  v_dias integer := 0;
begin
  select valor_json into v_config from public.configuracion where clave = 'estimaciones';
  if coalesce((v_config ->> 'activo')::boolean, true) is false then return null; end if;
  v_margen := greatest(1, least(2, coalesce((v_config ->> 'dias_margen')::integer, 2)));

  if p_estado = 'cancelado' then return null; end if;
  if p_estado in ('disponible_entrega', 'entregado') then return current_date; end if;

  v_dias := coalesce((v_config -> 'dias_por_estado' ->> p_estado::text)::integer,
    case p_estado
      when 'pedido_confirmado' then 28 when 'en_preparacion' then 24
      when 'control_calidad' then 20 when 'despachado' then 16
      when 'transito_internacional' then 12 when 'recibido_estados_unidos' then 8
      when 'transito_nicaragua' then 4 when 'llego_nicaragua' then 1
      when 'incidencia' then 5 else 7
    end);
  return current_date + greatest(0, v_dias) + v_margen;
end;
$$;

create or replace function public.actualizar_estimacion_al_cambiar_estado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activo boolean := true;
begin
  select coalesce((valor_json ->> 'activo')::boolean, true) into v_activo
  from public.configuracion where clave = 'estimaciones';
  if coalesce(v_activo, true) and (tg_op = 'INSERT' or old.estado is distinct from new.estado) then
    new.fecha_estimada := public.calcular_fecha_estimada_dinamica(new.estado);
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_estimacion_dinamica on public.pedidos;
create trigger pedidos_estimacion_dinamica
before insert or update of estado on public.pedidos
for each row execute function public.actualizar_estimacion_al_cambiar_estado();

create or replace function public.recalcular_fechas_estimadas()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actualizadas integer := 0;
begin
  if auth.role() <> 'service_role' and not public.usuario_activo() then raise exception 'No autorizado'; end if;
  update public.pedidos p
  set fecha_estimada = public.calcular_fecha_estimada_dinamica(p.estado)
  where p.activo and p.estado not in ('cancelado','entregado')
    and p.fecha_estimada is distinct from public.calcular_fecha_estimada_dinamica(p.estado);
  get diagnostics v_actualizadas = row_count;
  return v_actualizadas;
end;
$$;

revoke all on function public.calcular_fecha_estimada_dinamica(public.estado_pedido) from public, anon;
revoke all on function public.recalcular_fechas_estimadas() from public, anon;
grant execute on function public.calcular_fecha_estimada_dinamica(public.estado_pedido) to authenticated, service_role;
grant execute on function public.recalcular_fechas_estimadas() to authenticated, service_role;
