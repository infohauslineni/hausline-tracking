-- Etiqueta pública para los estados "pagado" y "empaquetado".
--
-- Va DESPUÉS de 202609060001 (que agrega el valor 'empaquetado' al enum): esta función usa
-- ese literal, así que el valor ya debe estar confirmado en su propia transacción.
--
-- Antes, ambos estados caían al else ('Requiere atención'): eso hacía que en el HISTORIAL
-- del cliente (que pasa por etiqueta_estado_publico) la etapa apareciera como "Requiere
-- atención" y hasta se ocultara. Ahora devuelven su etiqueta real.
begin;

create or replace function public.etiqueta_estado_publico(p_estado public.estado_pedido)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_estado
    when 'pedido_confirmado' then 'Orden confirmada'
    when 'en_preparacion' then 'En preparación'
    when 'control_calidad' then 'Control de calidad'
    when 'etiqueta_creada' then 'Despachado'
    when 'despachado' then 'Despachado'
    when 'transito_internacional' then 'En tránsito internacional'
    when 'recibido_estados_unidos' then 'En tránsito internacional'
    when 'transito_nicaragua' then 'En tránsito internacional'
    when 'llego_nicaragua' then 'País de destino'
    when 'disponible_entrega' then 'Disponible para entrega'
    when 'pagado' then 'Pagado'
    when 'empaquetado' then 'Empaquetado, listo para envío'
    when 'entregado' then 'Entregado'
    when 'cancelado' then 'Cancelado'
    else 'Requiere atención'
  end;
$$;

commit;
