-- Ejecutar después de 202607190003_add_order_label_stage.sql.
update public.configuracion
set valor_json = jsonb_set(valor_json, '{dias_por_estado,etiqueta_creada}', '18'::jsonb, true)
where clave = 'estimaciones';

create or replace function public.etiqueta_estado_publico(p_estado public.estado_pedido)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_estado
    when 'pedido_confirmado' then 'Pedido confirmado'
    when 'en_preparacion' then 'En preparación'
    when 'control_calidad' then 'Control de calidad'
    when 'etiqueta_creada' then 'Etiqueta creada'
    when 'despachado' then 'Despachado'
    when 'transito_internacional' then 'En tránsito internacional'
    when 'recibido_estados_unidos' then 'Recibido en Estados Unidos'
    when 'transito_nicaragua' then 'En tránsito hacia Nicaragua'
    when 'llego_nicaragua' then 'Llegó a Nicaragua'
    when 'disponible_entrega' then 'Disponible para entrega'
    when 'entregado' then 'Entregado'
    when 'cancelado' then 'Cancelado'
    else 'Requiere atención'
  end;
$$;

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
      when 'control_calidad' then 20 when 'etiqueta_creada' then 18
      when 'despachado' then 16 when 'transito_internacional' then 12
      when 'recibido_estados_unidos' then 8 when 'transito_nicaragua' then 4
      when 'llego_nicaragua' then 1 when 'incidencia' then 5 else 7
    end);
  return current_date + greatest(0, v_dias) + v_margen;
end;
$$;

create or replace function public.sugerir_estado_pedido(p_pedido_id uuid)
returns public.estado_pedido language sql stable set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from public.trayectos where pedido_id = p_pedido_id and activo and lower(tipo_trayecto) like '%estados unidos%nicaragua%' and estado = 'en_transito') then 'transito_nicaragua'::public.estado_pedido
    when exists (select 1 from public.trayectos where pedido_id = p_pedido_id and activo and pais_destino ilike '%nicaragua%' and estado = 'entregado') then 'llego_nicaragua'::public.estado_pedido
    when exists (select 1 from public.trayectos where pedido_id = p_pedido_id and activo and pais_destino ilike '%estados unidos%' and estado = 'entregado') then 'recibido_estados_unidos'::public.estado_pedido
    when exists (select 1 from public.trayectos where pedido_id = p_pedido_id and activo and estado = 'etiqueta_creada') then 'etiqueta_creada'::public.estado_pedido
    else null
  end;
$$;

revoke all on function public.etiqueta_estado_publico(public.estado_pedido) from public, anon;
revoke all on function public.calcular_fecha_estimada_dinamica(public.estado_pedido) from public, anon;
revoke all on function public.sugerir_estado_pedido(uuid) from public, anon;
grant execute on function public.etiqueta_estado_publico(public.estado_pedido) to authenticated, service_role;
grant execute on function public.calcular_fecha_estimada_dinamica(public.estado_pedido) to authenticated, service_role;
grant execute on function public.sugerir_estado_pedido(uuid) to authenticated, service_role;
