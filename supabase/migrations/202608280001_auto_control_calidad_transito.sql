begin;

-- Auto-avance de etapa: un pedido que lleva 1 día o más en "Control de calidad"
-- pasa automáticamente a "En tránsito". Se apoya en historial_pedidos (que registra
-- cuándo entró a cada estado) para saber desde cuándo está en control de calidad.
--
-- El UPDATE del estado dispara, como cualquier cambio manual:
--   • el trigger de historial (registra la transición), y
--   • el webhook de la base → correo automático al cliente.
-- El mensaje de WhatsApp sigue siendo manual (no se envía solo).
--
-- La corre el cron diario (api/cron-estimaciones) con la service_role. Mismo patrón que
-- avanzar_transito_internacional (202608160002).
create or replace function public.avanzar_control_calidad()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actualizadas integer := 0;
begin
  if auth.role() <> 'service_role' and not public.usuario_activo() then
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
          ) <= now() - interval '1 day'
  )
  update public.pedidos p
  set estado = 'transito_internacional',
      notas_publicas = 'Tu pedido está en tránsito internacional.'
  from candidatos c
  where p.id = c.id;

  get diagnostics v_actualizadas = row_count;
  return v_actualizadas;
end;
$$;

revoke all on function public.avanzar_control_calidad() from public, anon;
grant execute on function public.avanzar_control_calidad() to authenticated, service_role;

commit;
