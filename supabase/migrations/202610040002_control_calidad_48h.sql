-- Control de calidad: 48 horas (antes 24). Pedido del dueño 2026-10-04.
--   · avanzar_control_calidad: el pedido pasa solo a "En tránsito internacional" tras 2 días
--     en Control de calidad (antes 1).
--   · etapa_reembolso_pedido: el cliente tiene 48 h desde las fotos para reclamar por calidad.
-- Es seguro correrlo de nuevo.
begin;

create or replace function public.avanzar_control_calidad()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actualizadas integer := 0;
begin
  if coalesce(auth.role(), '') not in ('service_role', '') and not public.usuario_activo() then
    raise exception 'No autorizado';
  end if;

  with candidatos as (
    select p.id
    from public.pedidos p
    where p.activo
      and p.estado = 'control_calidad'
      and coalesce(
            (select max(h.created_at)
               from public.historial_pedidos h
              where h.pedido_id = p.id
                and h.estado_nuevo = 'control_calidad'),
            p.updated_at
          ) <= now() - interval '2 days'
  )
  update public.pedidos p
  set estado = 'transito_internacional',
      notas_publicas = 'Su pedido está en tránsito internacional.'
  from candidatos c
  where p.id = c.id;

  get diagnostics v_actualizadas = row_count;
  return v_actualizadas;
end;
$$;

revoke all on function public.avanzar_control_calidad() from public, anon;
grant execute on function public.avanzar_control_calidad() to authenticated, service_role;

create or replace function public.etapa_reembolso_pedido(p_pedido_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_estado text;
  v_qc timestamptz;
  v_etapa text;
begin
  select case when p.estado = 'incidencia' then coalesce((
           select h.estado_nuevo::text from public.historial_pedidos h
            where h.pedido_id = p.id and h.estado_nuevo <> 'incidencia'
            order by h.created_at desc limit 1), 'pedido_confirmado') else p.estado::text end
    into v_estado from public.pedidos p where p.id = p_pedido_id;
  if v_estado is null then return null; end if;

  select min(a.created_at) into v_qc from public.archivos_pedido a
   where a.pedido_id = p_pedido_id and a.tipo = 'control_calidad' and a.visible_cliente;

  v_etapa := case
    when v_estado in ('entregado', 'cancelado') then 'no_permitida'
    when v_estado in ('pedido_confirmado', 'en_preparacion') then case when v_qc is not null and now() <= v_qc + interval '48 hours' then 'calidad' else 'antes_envio' end
    when v_estado = 'control_calidad' then case when v_qc is null then 'antes_envio' when now() <= v_qc + interval '48 hours' then 'calidad' else 'transito' end
    when v_estado in ('disponible_entrega', 'pagado', 'empaquetado') then 'disponible'
    else 'transito'
  end;

  return jsonb_build_object(
    'etapa', v_etapa, 'estado_pedido', v_estado,
    'qc_desde', v_qc, 'qc_vence', case when v_qc is not null then v_qc + interval '48 hours' end,
    'motivos', to_jsonb(case v_etapa
      when 'antes_envio' then array['error_pedido', 'pedido_duplicado', 'demora_preparacion', 'otro']
      when 'calidad'     then array['calidad_no_coincide', 'calidad_defecto', 'calidad_expectativas', 'otro']
      when 'transito'    then array['retraso_excesivo', 'paquete_perdido', 'otro']
      when 'disponible'  then array['llego_danado', 'no_coincide', 'otro']
      else array[]::text[] end)
  );
end;
$$;
revoke all on function public.etapa_reembolso_pedido(uuid) from public, anon, authenticated;

commit;
