-- "En camino": la entrega se calcula con la COMPRA que viene en camino, no con el tiempo de un
-- encargo nuevo (20 a 25 días).
--   · inversiones.llega_aprox: fecha aproximada de llegada (opcional, en Compras libres).
--   · en_camino_llegada(codigo): rango de llegada para la tienda. Con fecha de llegada → de esa
--     fecha a +3 días; sin ella → fecha de compra + 15 a 25 días. Nunca en el pasado.
alter table public.inversiones add column if not exists llega_aprox date;

create or replace function public.en_camino_llegada(p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_hoy date := (now() at time zone 'America/Managua')::date;
  v_llega date;
  v_compra date;
  v_desde date;
  v_hasta date;
begin
  select i.llega_aprox, i.fecha into v_llega, v_compra
    from public.inversiones i
   where i.estado = 'en_transito' and upper(btrim(coalesce(i.codigo, ''))) = upper(btrim(coalesce(p_codigo, '')))
   order by coalesce(i.llega_aprox, i.fecha + 20)
   limit 1;
  if not found then return null; end if;
  if v_llega is not null then v_desde := v_llega; v_hasta := v_llega + 3;
  else v_desde := v_compra + 15; v_hasta := v_compra + 25;
  end if;
  -- Si ya pasó la fecha y sigue en camino: muy pronto (de mañana a 5 días).
  if v_hasta < v_hoy + 1 then v_desde := v_hoy + 1; v_hasta := v_hoy + 5;
  elsif v_desde < v_hoy + 1 then v_desde := v_hoy + 1;
  end if;
  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'fija', v_llega is not null);
end;
$$;
revoke all on function public.en_camino_llegada(text) from public;
grant execute on function public.en_camino_llegada(text) to anon, authenticated;

notify pgrst, 'reload schema';
