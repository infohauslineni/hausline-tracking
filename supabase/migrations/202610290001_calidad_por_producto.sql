-- Control de calidad POR PRODUCTO en pedidos de 2 o más productos.
-- Un pedido de varios productos pasa solo a "En tránsito" cuando TODOS sus productos tienen foto
-- de calidad visible al cliente (las fotos sin producto asignado cuentan como de un producto
-- pendiente) y pasaron 2 días desde que se completó la última. Pedidos de un solo producto: igual
-- que antes (2 días desde que entró a Control de calidad).
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

  with base as (
    select p.id,
      coalesce((select max(h.created_at) from public.historial_pedidos h
                 where h.pedido_id = p.id and h.estado_nuevo = 'control_calidad'), p.updated_at) as entrada,
      (select count(*) from public.pedido_items it
        where it.pedido_id = p.id and coalesce(it.precio_unitario, 0) > 0
          and coalesce(it.producto, '') !~* '^\s*(env[íi]o|delivery|cup[óo]n)') as n_productos
    from public.pedidos p
    where p.activo and p.estado = 'control_calidad'
  ),
  fotos as (
    select b.id,
      (select count(distinct a.pedido_item_id) from public.archivos_pedido a
         join public.pedido_items it on it.id = a.pedido_item_id
        where a.pedido_id = b.id and a.tipo = 'control_calidad' and a.visible_cliente) as con_foto,
      (select count(*) from public.archivos_pedido a
        where a.pedido_id = b.id and a.tipo = 'control_calidad' and a.visible_cliente and a.pedido_item_id is null) as generales,
      (select max(primera) from (select min(a.created_at) as primera from public.archivos_pedido a
          where a.pedido_id = b.id and a.tipo = 'control_calidad' and a.visible_cliente and a.pedido_item_id is not null
          group by a.pedido_item_id) x) as ultima_item,
      (select max(a.created_at) from public.archivos_pedido a
        where a.pedido_id = b.id and a.tipo = 'control_calidad' and a.visible_cliente and a.pedido_item_id is null) as ultima_general
    from base b
    where b.n_productos >= 2
  ),
  candidatos as (
    select b.id from base b
    where b.n_productos < 2 and b.entrada <= now() - interval '2 days'
    union all
    select b.id from base b join fotos f on f.id = b.id
    where f.con_foto + f.generales >= b.n_productos
      and greatest(b.entrada, coalesce(f.ultima_item, b.entrada), coalesce(f.ultima_general, b.entrada)) <= now() - interval '2 days'
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
