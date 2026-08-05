-- Renombra las etiquetas públicas de los estados según la nueva nomenclatura:
--   Etiqueta creada        -> Despachado
--   En tránsito hacia/EEUU -> En tránsito internacional
--   Llegó a Nicaragua      -> País de destino
-- No cambia el enum ni los datos: solo cómo se muestran al cliente en el historial.
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
    when 'entregado' then 'Entregado'
    when 'cancelado' then 'Cancelado'
    else 'Requiere atención'
  end;
$$;

commit;
