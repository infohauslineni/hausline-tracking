-- Hausline · Motivos de cancelación reformulados (pedido del dueño 2026-09-25)
--
-- Se QUITA "Ya no quiero el producto": no es un motivo verificable. Cada etapa ofrece una
-- lista de motivos concretos y comprobables + "Otro motivo" donde el cliente lo escribe.
-- Las solicitudes viejas conservan su texto (motivo_label se guardó al crearlas).
begin;

create or replace function public.motivo_reembolso_label(p_motivo text)
returns text language sql immutable as $$
  select case p_motivo
    -- Antes del envío (en preparación)
    when 'error_pedido'         then 'Elegí por error la talla, el color o el modelo'
    when 'pedido_duplicado'     then 'Hice el mismo pedido dos veces por error'
    when 'demora_preparacion'   then 'La preparación superó el tiempo que me indicaron'
    -- Dentro de las 24 h de las fotos de control de calidad
    when 'calidad_no_coincide'  then 'Las fotos de control de calidad muestran otro modelo, talla o color'
    when 'calidad_defecto'      then 'Las fotos de control de calidad muestran un defecto, daño o mancha'
    when 'calidad_expectativas' then 'La calidad que se ve en las fotos no corresponde a lo ofrecido'
    -- En tránsito
    when 'retraso_excesivo'     then 'El pedido superó ampliamente el tiempo de entrega estimado'
    when 'paquete_perdido'      then 'La paquetería reportó el paquete como perdido o dañado'
    -- Ya en Nicaragua
    when 'llego_danado'         then 'Las fotos de recibido muestran el producto dañado'
    when 'no_coincide'          then 'El producto recibido no es el que pedí'
    -- Siempre disponible
    when 'otro'                 then 'Otro motivo'
    -- Motivos retirados (solo para solicitudes viejas)
    when 'no_quiero'            then 'Ya no quiero el producto'
  end;
$$;

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
    when v_estado in ('pedido_confirmado', 'en_preparacion') then case when v_qc is not null and now() <= v_qc + interval '24 hours' then 'calidad' else 'antes_envio' end
    when v_estado = 'control_calidad' then case when v_qc is null then 'antes_envio' when now() <= v_qc + interval '24 hours' then 'calidad' else 'transito' end
    when v_estado in ('disponible_entrega', 'pagado', 'empaquetado') then 'disponible'
    else 'transito'
  end;

  return jsonb_build_object(
    'etapa', v_etapa, 'estado_pedido', v_estado,
    'qc_desde', v_qc, 'qc_vence', case when v_qc is not null then v_qc + interval '24 hours' end,
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
