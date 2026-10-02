-- CARRITO ABANDONADO: cuando el cliente escribe su correo en el checkout, la tienda guarda su
-- carrito aquí. Si 2 horas después no terminó el pedido, la tarea de cada 15 min
-- (api/_automatico.js) le manda UN correo con sus productos. Si termina el pedido, no se manda.
--
-- La tabla NO es accesible desde la tienda (RLS sin políticas para anon): la tienda solo puede
-- llamar guardar_carrito_abandonado(), que valida el correo y limita el tamaño. El panel (admin)
-- puede leerla.

create table if not exists public.carritos_abandonados (
  id uuid primary key default gen_random_uuid(),
  correo text not null,
  nombre text,
  items jsonb not null default '[]'::jsonb,
  total numeric(12,2),
  actualizado_at timestamptz not null default now(),
  aviso_at timestamptz,          -- cuándo se le mandó el correo (null = todavía no)
  recuperado_at timestamptz,     -- terminó su pedido: ya no se le escribe
  created_at timestamptz not null default now()
);
create unique index if not exists carritos_abandonados_correo_idx on public.carritos_abandonados (lower(correo));
create index if not exists carritos_abandonados_pend_idx on public.carritos_abandonados (actualizado_at) where aviso_at is null and recuperado_at is null;

alter table public.carritos_abandonados enable row level security;
drop policy if exists carritos_abandonados_admin on public.carritos_abandonados;
create policy carritos_abandonados_admin on public.carritos_abandonados for select to authenticated using (public.usuario_admin());

create or replace function public.guardar_carrito_abandonado(p_correo text, p_nombre text, p_items jsonb, p_total numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_correo text := lower(btrim(coalesce(p_correo, '')));
begin
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or char_length(v_correo) > 160 then return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 20 or pg_column_size(p_items) > 20000 then return; end if;
  insert into public.carritos_abandonados as c (correo, nombre, items, total, actualizado_at)
  values (v_correo, left(nullif(btrim(p_nombre), ''), 120), p_items, least(greatest(coalesce(p_total, 0), 0), 100000), now())
  on conflict (lower(correo)) do update set
    nombre = coalesce(excluded.nombre, c.nombre),
    items = excluded.items,
    total = excluded.total,
    actualizado_at = now(),
    recuperado_at = null,
    -- Un carrito NUEVO (otros productos) puede recibir otro aviso, pero no más de 1 cada 7 días.
    aviso_at = case when c.items is distinct from excluded.items and (c.aviso_at is null or c.aviso_at < now() - interval '7 days') then null else c.aviso_at end;
end;
$$;
revoke all on function public.guardar_carrito_abandonado(text, text, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.guardar_carrito_abandonado(text, text, jsonb, numeric) to anon, authenticated;

-- Comprobación (debe salir 1 fila con la tabla y la función).
select (select count(*) from pg_tables where schemaname = 'public' and tablename = 'carritos_abandonados') as tabla,
       (select count(*) from pg_proc where proname = 'guardar_carrito_abandonado') as funcion;
