-- COMPRAS LIBRES: el precio de venta sigue al precio de la TIENDA (2026-11-09).
-- Antes, una compra libre guardaba el precio que tenía el producto el día que se registró
-- (inversiones.precio_venta_estimado) y no cambiaba más: si después se subía el precio en la
-- tienda (160 → 170), la compra seguía en 160.
-- Ahora, cada vez que cambia productos.precio_venta (lo actualiza la sincronización del catálogo
-- y el guardado del panel), se copia a las compras de ese producto que todavía están a la venta:
--   · En camino / En preparación (estado = 'en_transito') y Disponible (estado = 'en_inventario').
--   · NO se tocan: vendidas, descartadas, separadas para un cliente (reservado) ni las que ya
--     están en un pedido: ese precio ya se acordó.
--   · Precio 0 (producto "a cotizar") no se copia.

create or replace function public.precio_compras_sigue_tienda()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.precio_venta is distinct from old.precio_venta and coalesce(new.precio_venta, 0) > 0 then
    update public.inversiones i
       set precio_venta_estimado = new.precio_venta
     where i.estado in ('en_transito', 'en_inventario')
       and i.pedido_id is null
       and i.precio_venta_estimado is distinct from new.precio_venta
       and (i.producto_id = new.id
            or (i.producto_id is null and upper(btrim(coalesce(i.codigo, ''))) = upper(btrim(new.codigo))));
  end if;
  return new;
end;
$$;
revoke all on function public.precio_compras_sigue_tienda() from public, anon, authenticated;

drop trigger if exists productos_precio_a_compras on public.productos;
create trigger productos_precio_a_compras
  after update of precio_venta on public.productos
  for each row execute function public.precio_compras_sigue_tienda();

-- Arreglo de una vez: las compras que hoy ya están desfasadas toman el precio actual.
update public.inversiones i
   set precio_venta_estimado = p.precio_venta
  from public.productos p
 where i.estado in ('en_transito', 'en_inventario')
   and i.pedido_id is null
   and coalesce(p.precio_venta, 0) > 0
   and i.precio_venta_estimado is distinct from p.precio_venta
   and (i.producto_id = p.id
        or (i.producto_id is null and upper(btrim(coalesce(i.codigo, ''))) = upper(btrim(p.codigo))));

-- Comprobación: cuántas compras a la venta siguen con un precio distinto al de la tienda (debe dar 0).
select count(*) as compras_desfasadas
  from public.inversiones i join public.productos p
    on i.producto_id = p.id or (i.producto_id is null and upper(btrim(coalesce(i.codigo, ''))) = upper(btrim(p.codigo)))
 where i.estado in ('en_transito', 'en_inventario') and i.pedido_id is null
   and coalesce(p.precio_venta, 0) > 0 and i.precio_venta_estimado is distinct from p.precio_venta;
