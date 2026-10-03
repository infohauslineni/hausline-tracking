-- COMPRAS LIBRES → TIENDA, AUTOMÁTICO (correr DESPUÉS del SQL del catálogo hausline-web/admin/en-camino.sql)
--   · Compra "En camino" (con código de la tienda) → aparece en la tienda como "En camino · Apartalo".
--   · Pasa a "Disponible" → sale de En camino y entra sola a "Entrega inmediata".
--   · Se vende / descarta / borra / cambia de código o talla → la tienda se actualiza sola.
-- Usa la clave guardada en config_privada (secreto_entrega_inmediata). Nunca frena el guardado.

-- Tallas de una compra: "42" ×2 unidades → ["42","42"]; "S, M" → ["S","M"]; "M BLACK" → ["M"];
-- lo que va después de "·" es el color y no cuenta.
create or replace function public.tallas_de_compra(p_talla_color text, p_cantidad int)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare base text := btrim(split_part(coalesce(p_talla_color, ''), '·', 1)); arr jsonb; primera text;
begin
  select coalesce(jsonb_agg(btrim(x)), '[]'::jsonb) into arr from regexp_split_to_table(base, ',') x where btrim(x) <> '';
  if jsonb_array_length(arr) = 1 then
    primera := arr->>0;
    if primera ~* '^\s*(xxs|xs|s|m|l|xl|xxl|xxxl|[0-9]{1,2}(\.5)?)\s+\S' then primera := split_part(btrim(primera), ' ', 1); end if;
    select jsonb_agg(primera) into arr from generate_series(1, greatest(1, least(coalesce(p_cantidad, 1), 20)));
  end if;
  return arr;
end;
$$;

-- Color de una compra: lo que va después de "·" ("S · Negro" → ["Negro"]) o después de la talla
-- ("M BLACK" → ["BLACK"]). Sin color → [].
create or replace function public.colores_de_compra(p_talla_color text)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := btrim(coalesce(p_talla_color, '')); resto text;
begin
  if position('·' in t) > 0 then resto := btrim(substr(t, position('·' in t) + 1));
  elsif t ~* '^\s*(xxs|xs|s|m|l|xl|xxl|xxxl|[0-9]{1,2}(\.5)?)\s+\S' then resto := btrim(regexp_replace(t, '^\s*\S+\s+', ''));
  end if;
  if coalesce(resto, '') = '' then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(btrim(x)), '[]'::jsonb) from regexp_split_to_table(resto, ',') x where btrim(x) <> '');
end;
$$;

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
  v_activo := new.estado = 'en_transito' and btrim(coalesce(new.codigo, '')) <> '';
  if v_activo or (tg_op = 'UPDATE' and old.estado = 'en_transito') then
    perform net.http_post(url := v_url || 'sync_en_camino', headers := v_hdr,
      body := jsonb_build_object('p_secreto', v_sec, 'p_ref', new.id::text, 'p_codigo', new.codigo,
        'p_tallas', public.tallas_de_compra(new.talla_color, new.cantidad), 'p_activo', v_activo));
  end if;
  -- Llegó (En camino → Disponible): entra sola a Entrega inmediata.
  if tg_op = 'UPDATE' and old.estado = 'en_transito' and new.estado = 'en_inventario' and btrim(coalesce(new.codigo, '')) <> '' then
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
  after insert or update of estado, talla_color, cantidad, codigo or delete on public.inversiones
  for each row execute function public.compra_a_catalogo();

-- Las compras que YA están "En camino" se publican ahora una vez.
do $$
declare r record; v_sec text := (select valor from public.config_privada where clave = 'secreto_entrega_inmediata');
begin
  if v_sec is null then return; end if;
  for r in select id, codigo, talla_color, cantidad from public.inversiones where estado = 'en_transito' and btrim(coalesce(codigo, '')) <> '' loop
    perform net.http_post(url := 'https://xgdijumnmaqfirmckugw.supabase.co/rest/v1/rpc/sync_en_camino',
      headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw", "Authorization": "Bearer sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw"}'::jsonb,
      body := jsonb_build_object('p_secreto', v_sec, 'p_ref', r.id::text, 'p_codigo', r.codigo, 'p_tallas', public.tallas_de_compra(r.talla_color, r.cantidad), 'p_activo', true));
  end loop;
end $$;

select (select count(*) from pg_trigger where tgname = 'inversiones_catalogo') as trigger_creado,
       (select count(*) from public.inversiones where estado = 'en_transito' and btrim(coalesce(codigo, '')) <> '') as compras_en_camino_publicadas,
       public.tallas_de_compra('M BLACK', 1) as ejemplo_talla,
       public.colores_de_compra('M BLACK') as ejemplo_color;
