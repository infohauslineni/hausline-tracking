-- Hausline · BANNERS autoadministrables desde admin.html.
--
-- ⚠️ IMPORTANTE: esta migración va en el proyecto Supabase del CATÁLOGO
--    (xgdijumnmaqfirmckugw), NO en el del tracking (epslwaxjemlysqtubbfu),
--    porque admin.html se autentica y escribe en ese proyecto (igual que catalogo_web
--    y el bucket de imágenes). La tienda lo lee de ahí vía catalogo-remoto/banner.js.
--
-- El dueño sube una imagen (bucket) y le pone un link. La tienda muestra el aviso
-- emergente leyendo esta tabla (RPC pública banners_activos), ya no config.js.
begin;

create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  imagen_url text not null,
  enlace text,
  titulo text,               -- nombre interno para reconocerlo en el panel (opcional)
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists banners_activos_idx on public.banners (activo, orden) where activo;

alter table public.banners enable row level security;
-- Cualquier admin autenticado (el que entra a admin.html en este proyecto) administra.
drop policy if exists banners_admin on public.banners;
create policy banners_admin on public.banners for all to authenticated using (true) with check (true);
-- El público (tienda, anon) puede LEER los activos.
drop policy if exists banners_lectura_publica on public.banners;
create policy banners_lectura_publica on public.banners for select to anon using (activo);
grant select, insert, update, delete on public.banners to authenticated;
grant select on public.banners to anon;

-- Banners activos para la TIENDA (aviso emergente). Pública (anon).
create or replace function public.banners_activos()
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_object('imagen', b.imagen_url, 'enlace', b.enlace)
           order by b.orden, b.created_at), '[]'::json)
  from public.banners b where b.activo;
$$;
grant execute on function public.banners_activos() to anon, authenticated;

commit;
