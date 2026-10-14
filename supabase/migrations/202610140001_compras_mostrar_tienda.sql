-- COMPRAS LIBRES: "Mostrar en la tienda" separado del estado (2026-10-14).
-- Antes, marcar una compra "En camino" la publicaba sí o sí en la tienda. Ahora cada compra
-- tiene su interruptor `mostrar_tienda` (por defecto SÍ, así las que ya salen siguen saliendo):
--   · En camino + mostrar_tienda → sale en la tienda como "En camino · Apártelo ya".
--   · mostrar_tienda = false → se quita de la tienda (y al llegar NO entra sola a Entrega inmediata).
-- Reemplaza compra_a_catalogo() de 202610020005 (misma lógica + el interruptor).

alter table public.inversiones add column if not exists mostrar_tienda boolean not null default true;

create or replace function public.compra_a_catalogo()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sec text := (select valor from public.config_privada where clave = 'secreto_entrega_inmediata');
  v_url text := 'https://xgdijumnmaqfirmckugw.supabase.co/rest/v1/rpc/';
  v_hdr jsonb := '{"Content-Type": "application/json", "apikey": "sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw", "Authorization": "Bearer sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw"}'::jsonb;
  v_activo boolean;
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
  return new;
exception when others then
  return coalesce(new, old);
end;
$$;
revoke all on function public.compra_a_catalogo() from public, anon, authenticated;

drop trigger if exists inversiones_catalogo on public.inversiones;
create trigger inversiones_catalogo
  after insert or update of estado, talla_color, cantidad, codigo, mostrar_tienda or delete on public.inversiones
  for each row execute function public.compra_a_catalogo();

select (select count(*) from information_schema.columns where table_name = 'inversiones' and column_name = 'mostrar_tienda') as columna_creada,
       (select count(*) from pg_trigger where tgname = 'inversiones_catalogo') as trigger_creado;
