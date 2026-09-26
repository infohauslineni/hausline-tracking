-- Tienda: "Tendencias" (más vistos) y "Lo más vendido" con datos REALES.
-- Proyecto: epslwaxjemlysqtubbfu (el mismo que ya usa la tienda: config.js → SUPABASE_URL).
--
--   1. vistas_producto + incrementar_vista(): la tienda suma 1 vista cuando alguien abre un
--      producto (máx. 1 por navegador cada 24 h, lo controla la tienda). Solo cuenta códigos
--      que existen en el catálogo (productos), así nadie puede llenar la tabla de basura.
--   2. mas_vendidos_semana(): sale de los PEDIDOS reales del panel (no de una tabla aparte
--      que hubiera que llenar a mano). Últimos 7 días; si hay pocos productos, amplía a 30.
--      Excluye pedidos cancelados o archivados.
-- Es seguro correrlo más de una vez.

-- 1) Vistas por producto ------------------------------------------------------------------
create table if not exists public.vistas_producto (
  codigo      text primary key,
  vistas      bigint not null default 0,
  actualizado timestamptz not null default now()
);
create index if not exists vistas_producto_orden_idx on public.vistas_producto (vistas desc);

alter table public.vistas_producto enable row level security;
drop policy if exists "Todos leen las vistas" on public.vistas_producto;
create policy "Todos leen las vistas" on public.vistas_producto for select using (true);
revoke all on public.vistas_producto from anon, authenticated;
grant select on public.vistas_producto to anon, authenticated;

create or replace function public.incrementar_vista(p_codigo text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_codigo text;
  v_total bigint;
begin
  -- Se guarda con el código tal como está en el catálogo.
  select p.codigo into v_codigo from public.productos p
   where upper(trim(p.codigo)) = upper(trim(coalesce(p_codigo, ''))) limit 1;
  if v_codigo is null then return null; end if;

  insert into public.vistas_producto (codigo, vistas, actualizado) values (v_codigo, 1, now())
  on conflict (codigo) do update set vistas = vistas_producto.vistas + 1, actualizado = now()
  returning vistas into v_total;
  return v_total;
end;
$$;
revoke all on function public.incrementar_vista(text) from public;
grant execute on function public.incrementar_vista(text) to anon, authenticated;

-- 2) Más vendidos (de los pedidos reales) --------------------------------------------------
create or replace function public.mas_vendidos_semana()
returns table (codigo text, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_dias integer := 7;
begin
  if (select count(distinct upper(trim(i.codigo_producto)))
        from public.pedido_items i join public.pedidos p on p.id = i.pedido_id
       where p.activo and p.estado <> 'cancelado' and nullif(trim(i.codigo_producto), '') is not null
         and p.fecha_pedido >= current_date - 7) < 4 then
    v_dias := 30;
  end if;

  return query
    select max(trim(i.codigo_producto)) as codigo, sum(i.cantidad)::bigint as total
      from public.pedido_items i join public.pedidos p on p.id = i.pedido_id
     where p.activo and p.estado <> 'cancelado' and nullif(trim(i.codigo_producto), '') is not null
       and p.fecha_pedido >= current_date - v_dias
     group by upper(trim(i.codigo_producto))
     order by total desc, codigo
     limit 12;
end;
$$;
revoke all on function public.mas_vendidos_semana() from public;
grant execute on function public.mas_vendidos_semana() to anon, authenticated;
