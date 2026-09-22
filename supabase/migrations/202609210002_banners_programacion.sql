-- Hausline · BANNERS programables (ventana de fechas: desde / hasta).
--
-- ⚠️ IMPORTANTE: igual que 202609200006_banners.sql, esta migración va en el
--    proyecto Supabase del CATÁLOGO (xgdijumnmaqfirmckugw), NO en el del tracking,
--    porque admin.html y la tienda leen/escriben la tabla banners de ese proyecto.
--
-- El dueño puede dejar un banner "para siempre" (ambas fechas vacías) o programarlo:
--   · inicia_at  = cuándo EMPIEZA a salir (vacío = ya mismo)
--   · finaliza_at = cuándo DEJA de salir  (vacío = sin fin; queda hasta que lo oculte)
-- La tienda lo respeta solo porque banners_activos() filtra por la ventana; banner.js no cambia.
begin;

alter table public.banners add column if not exists inicia_at   timestamptz;
alter table public.banners add column if not exists finaliza_at timestamptz;

-- Banners activos para la TIENDA (aviso emergente). Pública (anon).
-- Ahora además respeta la ventana de fechas programada.
create or replace function public.banners_activos()
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_object('imagen', b.imagen_url, 'enlace', b.enlace)
           order by b.orden, b.created_at), '[]'::json)
  from public.banners b
  where b.activo
    and (b.inicia_at   is null or b.inicia_at   <= now())
    and (b.finaliza_at is null or b.finaliza_at >= now());
$$;
grant execute on function public.banners_activos() to anon, authenticated;

commit;
