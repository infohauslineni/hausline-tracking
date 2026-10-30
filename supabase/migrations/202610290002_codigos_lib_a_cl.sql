-- Ventas libres que ya se publicaron en la tienda con su código definitivo:
--   LIB003 → CL0055 (Suela Roja)   ·   LIB004 → CL0056 (Suela Roja Monograma)
-- Cambia el código en todo el panel (pedidos, compras libres, encargos web, reseñas) y deja un
-- solo producto con el código nuevo (si ya existía el CL, se le pasan las referencias y el LIB
-- queda inactivo).
do $$
declare
  r record; m record; n integer; v_lib uuid; v_cl uuid;
begin
  for m in select * from (values ('LIB003', 'CL0055'), ('LIB004', 'CL0056')) v(viejo, nuevo) loop
    -- 1) Códigos sueltos en cada tabla que guarda el código del producto.
    for r in select * from (values ('pedido_items', 'codigo_producto'), ('inversiones', 'codigo'), ('solicitudes', 'producto_codigo'), ('resenas', 'producto_codigo')) t(tabla, columna) loop
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tabla and column_name = r.columna) then
        execute format('update public.%I set %I = $1 where upper(trim(%I)) = $2', r.tabla, r.columna, r.columna) using m.nuevo, m.viejo;
        get diagnostics n = row_count;
        raise notice '% → %: %.% (% filas)', m.viejo, m.nuevo, r.tabla, r.columna, n;
      end if;
    end loop;

    -- 2) Tabla productos: un solo producto con el código nuevo.
    select id into v_lib from public.productos where upper(trim(codigo)) = m.viejo limit 1;
    select id into v_cl from public.productos where upper(trim(codigo)) = m.nuevo limit 1;
    if v_lib is not null and v_cl is null then
      update public.productos set codigo = m.nuevo where id = v_lib;
      raise notice 'productos: % renombrado a %', m.viejo, m.nuevo;
    elsif v_lib is not null and v_cl is not null then
      update public.pedido_items set producto_id = v_cl where producto_id = v_lib;
      update public.inversiones set producto_id = v_cl where producto_id = v_lib;
      update public.productos set activo = false where id = v_lib;
      raise notice 'productos: % ya existía; referencias pasadas y % desactivado', m.nuevo, m.viejo;
    end if;
  end loop;
end $$;

-- Verificación: debe dar 0 en todas.
select 'pedido_items' as tabla, count(*) from public.pedido_items where upper(codigo_producto) in ('LIB003', 'LIB004')
union all select 'inversiones', count(*) from public.inversiones where upper(codigo) in ('LIB003', 'LIB004')
union all select 'solicitudes', count(*) from public.solicitudes where upper(producto_codigo) in ('LIB003', 'LIB004')
union all select 'productos activos', count(*) from public.productos where upper(codigo) in ('LIB003', 'LIB004') and activo;
