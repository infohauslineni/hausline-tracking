-- COMPRA LIBRE VENDIDA O APARTADA → SALE SOLA DE ENTREGA INMEDIATA (2026-10-14).
-- Antes solo se quitaba la talla cuando la venta creaba un pedido Y la talla coincidía. Una venta
-- sin cliente (venta suelta) o una compra sin talla anotada dejaba el producto en la tienda como
-- disponible aunque ya estaba vendido. Ahora, cuando una compra pasa a Vendido o Apartado, se le
-- pide al catálogo que quite sus tallas (o, sin talla, las que quedan si son las vendidas).
-- No se repite: si su pedido ya quitó esa misma talla, no se vuelve a quitar.
-- Correr DESPUÉS de hausline-web/admin/entrega-inmediata-sin-talla.sql (proyecto del CATÁLOGO).
-- Reemplaza compra_a_catalogo() de 202610140001 (misma lógica + esto).

create or replace function public.compra_a_catalogo()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sec text := (select valor from public.config_privada where clave = 'secreto_entrega_inmediata');
  v_url text := 'https://xgdijumnmaqfirmckugw.supabase.co/rest/v1/rpc/';
  v_hdr jsonb := '{"Content-Type": "application/json", "apikey": "sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw", "Authorization": "Bearer sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw"}'::jsonb;
  v_activo boolean;
  v_talla text;
  v_cant int;
  v_tallas jsonb;
begin
  if v_sec is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.estado = 'en_transito' then
      perform net.http_post(url := v_url || 'sync_en_camino', headers := v_hdr,
        body := jsonb_build_object('p_secreto', v_sec, 'p_ref', old.id::text, 'p_codigo', old.codigo, 'p_tallas', '[]'::jsonb, 'p_activo', false));
    end if;
    return old;
  end if;
  v_activo := new.estado = 'en_transito' and coalesce(new.mostrar_tienda, true) and btrim(coalesce(new.codigo, '')) <> '';
  if v_activo or (tg_op = 'UPDATE' and old.estado = 'en_transito') then
    perform net.http_post(url := v_url || 'sync_en_camino', headers := v_hdr,
      body := jsonb_build_object('p_secreto', v_sec, 'p_ref', new.id::text, 'p_codigo', new.codigo,
        'p_tallas', public.tallas_de_compra(new.talla_color, new.cantidad), 'p_activo', v_activo));
  end if;
  -- Llegó (En camino → Disponible): entra sola a Entrega inmediata, si se puede mostrar en la tienda.
  if tg_op = 'UPDATE' and old.estado = 'en_transito' and new.estado = 'en_inventario' and coalesce(new.mostrar_tienda, true) and btrim(coalesce(new.codigo, '')) <> '' then
    perform net.http_post(url := v_url || 'marcar_entrega_inmediata', headers := v_hdr,
      body := jsonb_build_object('p_secreto', v_sec, 'p_codigo', new.codigo, 'p_tallas', public.tallas_de_compra(new.talla_color, new.cantidad), 'p_ref', new.id::text,
        'p_colores', public.colores_de_compra(new.talla_color)));
  end if;
  -- Se vendió o se apartó: sale de Entrega inmediata (sus tallas; sin talla, las que quedan si son las vendidas).
  if tg_op = 'UPDATE' and new.estado in ('vendido', 'reservado') and old.estado not in ('vendido', 'reservado', 'en_transito', 'descartado')
     and btrim(coalesce(new.codigo, '')) <> '' then
    v_tallas := public.tallas_de_compra(new.talla_color, new.cantidad);
    if jsonb_array_length(v_tallas) = 0 then v_tallas := jsonb_build_array(''); end if;
    for v_talla, v_cant in select x, count(*)::int from jsonb_array_elements_text(v_tallas) x group by x loop
      -- Su pedido ya pidió quitar esa misma talla (o también sin talla): no repetir.
      if new.pedido_id is not null and exists (
        select 1 from public.entrega_inmediata_descuentos e
         where e.pedido_id = new.pedido_id and upper(e.codigo) = upper(btrim(new.codigo))
           and ((v_talla = '' and btrim(e.talla) = '') or (v_talla <> '' and upper(coalesce(public.tallas_de_compra(e.talla, 1) ->> 0, '')) = upper(v_talla)))
      ) then continue; end if;
      perform net.http_post(url := v_url || 'descontar_entrega_inmediata', headers := v_hdr,
        body := jsonb_build_object('p_secreto', v_sec, 'p_codigo', btrim(new.codigo), 'p_talla', v_talla,
          'p_cantidad', case when v_talla = '' then greatest(1, coalesce(new.cantidad, 1)) else v_cant end,
          'p_pedido', coalesce(new.pedido_id::text, 'compra:' || new.id::text)),
        timeout_milliseconds := 15000);
    end loop;
  end if;
  return new;
exception when others then
  return coalesce(new, old);
end;
$$;
revoke all on function public.compra_a_catalogo() from public, anon, authenticated;

select (select count(*) from pg_trigger where tgname = 'inversiones_catalogo') as trigger_activo;
