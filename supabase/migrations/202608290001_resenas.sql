-- Reseñas de clientes (reales, moderadas). Se muestran en la tienda (página de
-- producto e inicio) y alimentan el JSON-LD de rating. NUNCA se inventan: entran
-- pendientes (aprobada=false) y solo el admin las aprueba desde el panel.
--
-- Flujo: el correo de "pedido entregado" lleva a /resena/?c=CODE; ahí el cliente
-- deja su reseña vía la RPC pública crear_resena_publica (queda pendiente). El panel
-- (usuario autenticado) la aprueba/oculta/destaca. La tienda lee solo las aprobadas
-- por RPC pública.

begin;

create table if not exists public.resenas (
  id             uuid primary key default gen_random_uuid(),
  pedido_codigo  text,                       -- trazabilidad (HS####); no se muestra
  producto_codigo text,                      -- para mostrar la reseña en ese producto
  cliente_nombre text not null,
  estrellas      int  not null check (estrellas between 1 and 5),
  comentario     text,
  foto_url       text,
  aprobada       boolean not null default false,
  destacada      boolean not null default false,  -- se fija en el inicio
  created_at     timestamptz not null default now()
);

create index if not exists resenas_producto_idx on public.resenas (producto_codigo) where aprobada;
create index if not exists resenas_aprobada_idx on public.resenas (aprobada, created_at desc);

alter table public.resenas enable row level security;

-- El público (anon) solo LEE las aprobadas. El admin autenticado hace todo.
drop policy if exists resenas_lectura_publica on public.resenas;
create policy resenas_lectura_publica on public.resenas
  for select to anon, authenticated using (aprobada = true);

drop policy if exists resenas_admin_todo on public.resenas;
create policy resenas_admin_todo on public.resenas
  for all to authenticated using (true) with check (true);

-- ── Lectura pública: reseñas aprobadas de UN producto (para /p/CODE) ──────────
create or replace function public.resenas_producto(p_codigo text, p_limit int default 50)
returns json
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce(json_agg(r order by r.created_at desc), '[]'::json)
  from (
    select cliente_nombre, estrellas, comentario, foto_url, producto_codigo, created_at
    from public.resenas
    where aprobada = true and producto_codigo = upper(trim(p_codigo))
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) r;
$$;

-- ── Resumen (promedio + total) — por producto si se pasa código, si no global ─
create or replace function public.resenas_resumen(p_codigo text default null)
returns json
language sql security definer stable
set search_path = public, pg_temp
as $$
  select json_build_object(
    'promedio', coalesce(round(avg(estrellas)::numeric, 1), 0),
    'total',    count(*)
  )
  from public.resenas
  where aprobada = true
    and (p_codigo is null or producto_codigo = upper(trim(p_codigo)));
$$;

-- ── Destacadas para el inicio (con o sin foto) ───────────────────────────────
create or replace function public.resenas_destacadas(p_limit int default 6)
returns json
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce(json_agg(r order by r.destacada desc, r.created_at desc), '[]'::json)
  from (
    select cliente_nombre, estrellas, comentario, foto_url, producto_codigo, created_at, destacada
    from public.resenas
    where aprobada = true
    order by destacada desc, created_at desc
    limit greatest(1, least(coalesce(p_limit, 6), 24))
  ) r;
$$;

-- ── Alta pública desde /resena/?c=CODE (queda PENDIENTE de aprobación) ────────
-- Valida el rango de estrellas y el nombre; asocia la reseña a un pedido real si el
-- código existe (no obligatorio, pero evita spam sin pedido).
create or replace function public.crear_resena_publica(
  p_pedido_codigo text,
  p_nombre        text,
  p_estrellas     int,
  p_comentario    text default null,
  p_producto_codigo text default null
) returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_prod text;
begin
  if p_estrellas is null or p_estrellas < 1 or p_estrellas > 5 then
    return json_build_object('ok', false, 'error', 'estrellas_invalidas');
  end if;
  if p_nombre is null or length(trim(p_nombre)) < 2 then
    return json_build_object('ok', false, 'error', 'nombre_invalido');
  end if;

  -- Anti-abuso: máximo 5 reseñas por pedido (evita spam masivo a un mismo código).
  if p_pedido_codigo is not null and (
       select count(*) from public.resenas
       where pedido_codigo = nullif(upper(trim(coalesce(p_pedido_codigo, ''))), '')
     ) >= 5 then
    return json_build_object('ok', false, 'error', 'demasiadas_resenas');
  end if;

  -- Si no se pasó el producto, intentamos tomarlo del pedido (primer ítem).
  v_prod := nullif(upper(trim(coalesce(p_producto_codigo, ''))), '');
  if v_prod is null and p_pedido_codigo is not null then
    begin
      select upper(trim(pi.producto_codigo)) into v_prod
      from public.pedido_items pi
      join public.pedidos p on p.id = pi.pedido_id
      where p.codigo = upper(trim(p_pedido_codigo))
        and pi.producto_codigo is not null
      limit 1;
    exception when others then
      v_prod := null;  -- si el esquema difiere, no bloquea el alta
    end;
  end if;

  -- Límites de longitud (evita payloads gigantes que inflen la base).
  insert into public.resenas (pedido_codigo, producto_codigo, cliente_nombre, estrellas, comentario)
  values (
    nullif(upper(trim(coalesce(p_pedido_codigo,''))), ''),
    left(v_prod, 40),
    left(trim(p_nombre), 60),
    p_estrellas,
    nullif(left(trim(coalesce(p_comentario,'')), 500), '')
  )
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.resenas_producto(text, int) from public;
revoke all on function public.resenas_resumen(text) from public;
revoke all on function public.resenas_destacadas(int) from public;
revoke all on function public.crear_resena_publica(text, text, int, text, text) from public;
grant execute on function public.resenas_producto(text, int) to anon, authenticated;
grant execute on function public.resenas_resumen(text) to anon, authenticated;
grant execute on function public.resenas_destacadas(int) to anon, authenticated;
grant execute on function public.crear_resena_publica(text, text, int, text, text) to anon, authenticated;

commit;
