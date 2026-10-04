-- Tienda: la página del producto muestra las fotos REALES de control de calidad de las
-- compras libres que siguen a la venta (en camino o disponibles), aunque nadie las haya
-- comprado todavía. Al venderse, apartarse o descartarse dejan de ser públicas.
--   · fotos_calidad_producto(codigo): rutas de esas fotos (para la tienda, sin sesión).
--   · Política del Storage: la tienda puede firmar SOLO esas rutas (nada más del bucket).
begin;

create or replace function public.archivo_inversion_publico(p_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.archivos_inversion a
      join public.inversiones i on i.id = a.inversion_id
     where a.storage_path = p_name and i.estado in ('en_transito', 'en_inventario')
  );
$$;
revoke all on function public.archivo_inversion_publico(text) from public;
grant execute on function public.archivo_inversion_publico(text) to anon, authenticated;

create or replace function public.fotos_calidad_producto(p_codigo text)
returns table (storage_path text, talla_color text, en_camino boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.storage_path, i.talla_color, i.estado = 'en_transito'
    from public.archivos_inversion a
    join public.inversiones i on i.id = a.inversion_id
   where upper(btrim(i.codigo)) = upper(btrim(p_codigo))
     and i.estado in ('en_transito', 'en_inventario')
   order by i.estado, a.created_at
   limit 24;
$$;
revoke all on function public.fotos_calidad_producto(text) from public;
grant execute on function public.fotos_calidad_producto(text) to anon, authenticated;

drop policy if exists storage_inversiones_publico on storage.objects;
create policy storage_inversiones_publico on storage.objects for select to anon
using (bucket_id = 'pedidos' and name ~ '^inversiones/[0-9a-f-]{36}/control-calidad/' and public.archivo_inversion_publico(name));

commit;
