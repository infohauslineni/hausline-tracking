-- ENTREGA INMEDIATA: al confirmarse un pedido (se crean sus productos en pedido_items), se le
-- avisa al proyecto del CATÁLOGO para que quite esa talla de "entrega inmediata"
-- (función descontar_entrega_inmediata, SQL hausline-web/admin/entrega-inmediata-vendidos.sql).
-- El catálogo ignora los productos que no son de entrega inmediata o tallas que eran por encargo.
--
-- Editar un pedido borra y vuelve a crear sus productos: el registro entrega_inmediata_descuentos
-- evita descontar dos veces la misma venta (un descuento por pedido + producto + talla).
-- La clave __SECRETO__ es la misma del SQL del catálogo (no se guarda en el repositorio).

create table if not exists public.entrega_inmediata_descuentos (
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  codigo text not null,
  talla text not null default '',
  cantidad int not null default 1,
  peticion_id bigint,
  created_at timestamptz not null default now(),
  primary key (pedido_id, codigo, talla)
);
alter table public.entrega_inmediata_descuentos enable row level security;
drop policy if exists entrega_inmediata_descuentos_admin on public.entrega_inmediata_descuentos;
create policy entrega_inmediata_descuentos_admin on public.entrega_inmediata_descuentos for select to authenticated using (public.usuario_admin());

create or replace function public.avisar_venta_entrega_inmediata()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_codigo text := upper(btrim(coalesce(new.codigo_producto, ''))); v_talla text := btrim(coalesce(new.talla, '')); v_id bigint;
begin
  if v_codigo = '' then return new; end if;
  -- Solo pedidos recién creados (al confirmarse). Editar un pedido viejo no cuenta como venta nueva.
  if not exists (select 1 from public.pedidos p where p.id = new.pedido_id and p.created_at > now() - interval '6 hours') then return new; end if;
  insert into public.entrega_inmediata_descuentos (pedido_id, codigo, talla, cantidad)
  values (new.pedido_id, v_codigo, v_talla, greatest(1, coalesce(new.cantidad, 1)::int))
  on conflict do nothing;
  if not found then return new; end if; -- ya se descontó (pedido editado)
  select net.http_post(
    url := 'https://xgdijumnmaqfirmckugw.supabase.co/rest/v1/rpc/descontar_entrega_inmediata',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw", "Authorization": "Bearer sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw"}'::jsonb,
    body := jsonb_build_object('p_secreto', '__SECRETO__', 'p_codigo', v_codigo, 'p_talla', v_talla, 'p_cantidad', greatest(1, coalesce(new.cantidad, 1)::int)),
    timeout_milliseconds := 15000
  ) into v_id;
  update public.entrega_inmediata_descuentos set peticion_id = v_id where pedido_id = new.pedido_id and codigo = v_codigo and talla = v_talla;
  return new;
exception when others then
  return new; -- nunca frena la creación del pedido
end;
$$;
revoke all on function public.avisar_venta_entrega_inmediata() from public, anon, authenticated;

drop trigger if exists pedido_items_entrega_inmediata on public.pedido_items;
create trigger pedido_items_entrega_inmediata
  after insert on public.pedido_items
  for each row execute function public.avisar_venta_entrega_inmediata();

select tgname as trigger_creado from pg_trigger where tgname = 'pedido_items_entrega_inmediata';
