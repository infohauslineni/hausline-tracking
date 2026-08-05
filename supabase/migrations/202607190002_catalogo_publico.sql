begin;

create or replace function public.obtener_catalogo_publico()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'codigo', p.codigo,
    'nombre', p.nombre,
    'marca', p.marca,
    'categoria', p.categoria,
    'tallas', p.tallas,
    'precio_venta', p.precio_venta,
    'imagen', p.imagen,
    'descripcion', p.descripcion
  ) order by p.created_at desc), '[]'::jsonb)
  from public.productos p
  where p.activo = true;
$$;

revoke all on function public.obtener_catalogo_publico() from public;
grant execute on function public.obtener_catalogo_publico() to anon, authenticated;

commit;
