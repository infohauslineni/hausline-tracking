begin;

create or replace function public.archivo_pedido_visible(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.archivos_pedido a
    join public.pedidos p on p.id = a.pedido_id
    where a.storage_path = p_storage_path
      and a.visible_cliente
      and p.activo
  );
$$;

revoke all on function public.archivo_pedido_visible(text) from public;
grant execute on function public.archivo_pedido_visible(text) to anon, authenticated;

drop policy if exists storage_pedidos_cliente_ver on storage.objects;
create policy storage_pedidos_cliente_ver
on storage.objects for select to anon
using (bucket_id = 'pedidos' and public.archivo_pedido_visible(name));

create or replace function public.obtener_archivos_pedido_publicos(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tipo', a.tipo,
    'nombre', a.nombre,
    'storage_path', a.storage_path,
    'orden', a.orden
  ) order by a.tipo, a.orden), '[]'::jsonb)
  from public.archivos_pedido a
  join public.pedidos p on p.id = a.pedido_id
  where p.codigo = upper(trim(p_codigo))
    and p.activo
    and a.visible_cliente;
$$;

revoke all on function public.obtener_archivos_pedido_publicos(text) from public;
grant execute on function public.obtener_archivos_pedido_publicos(text) to anon, authenticated;

commit;
