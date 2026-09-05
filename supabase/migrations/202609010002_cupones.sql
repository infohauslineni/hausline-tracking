-- Hausline · Cupones y descuentos.
--
-- Dos usos en un solo sistema:
--  1) Cupón personal de un cliente (cliente_id): se lo mandás por WhatsApp y lo usa en su
--     próxima compra; además, cuando su encargo llega al panel, se reconoce por el cliente.
--  2) Código suelto para redes (sin cliente): ej. HAUS10, cualquiera lo escribe en el checkout.
--
-- Regla de consumo (clave): un cupón SOLO se "quema" cuando el cliente realmente pagó /
-- transfirió. Si escribe el código y hace el pedido pero no transfiere, el cupón sigue vivo.
-- Por eso el contador `usos_confirmados` sube al CONFIRMARSE el pago, no al crear el pedido.
-- `usos_max` = 1 (un solo uso) o N (tope) o NULL (ilimitado).
begin;

create table if not exists public.cupones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null check (char_length(btrim(codigo)) between 3 and 40),
  tipo text not null default 'porcentaje' check (tipo in ('porcentaje','monto')),
  valor numeric(12,2) not null check (valor > 0),            -- % (1–100) o monto en USD
  cliente_id uuid references public.clientes(id) on delete set null,  -- null = código suelto
  usos_max integer check (usos_max is null or usos_max > 0), -- null = ilimitado
  usos_confirmados integer not null default 0 check (usos_confirmados >= 0),
  vence_el date,
  nota text,
  activo boolean not null default true,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tipo <> 'porcentaje' or valor <= 100)
);
-- Código único sin importar mayúsculas/espacios.
create unique index if not exists cupones_codigo_norm_idx on public.cupones (upper(btrim(codigo)));
create index if not exists cupones_cliente_idx on public.cupones(cliente_id);

alter table public.cupones enable row level security;
drop policy if exists cupones_admin_total on public.cupones;
create policy cupones_admin_total on public.cupones for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());
grant select, insert, update, delete on public.cupones to authenticated;

drop trigger if exists cupones_updated_at on public.cupones;
create trigger cupones_updated_at before update on public.cupones for each row execute function public.set_updated_at();

-- Descuento a nivel de pedido.
alter table public.pedidos add column if not exists descuento numeric(12,2) not null default 0 check (descuento >= 0);
alter table public.pedidos add column if not exists cupon_id uuid references public.cupones(id) on delete set null;
alter table public.pedidos add column if not exists cupon_codigo text;

-- El total del pedido pasa a ser NETO: suma de las líneas MENOS el descuento (nunca < 0).
-- El saldo sigue siendo total - abono, así que la restricción check(saldo = total - abono)
-- se mantiene. De este modo el descuento reduce la venta y la ganancia reportadas.
create or replace function public.recalcular_totales_pedido(p_pedido_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.pedidos p
  set total = greatest(coalesce((select sum(i.subtotal) from public.pedido_items i where i.pedido_id = p_pedido_id), 0) - coalesce(p.descuento, 0), 0),
      saldo = greatest(coalesce((select sum(i.subtotal) from public.pedido_items i where i.pedido_id = p_pedido_id), 0) - coalesce(p.descuento, 0), 0) - p.abono
  where p.id = p_pedido_id;
$$;

-- Si cambia el descuento de un pedido (sin cambiar sus líneas), recalcular sus totales.
create or replace function public.pedidos_recalcular_por_descuento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.recalcular_totales_pedido(new.id);
  return null;
end;
$$;
drop trigger if exists pedidos_descuento_recalcular on public.pedidos;
create trigger pedidos_descuento_recalcular after update of descuento on public.pedidos
  for each row when (old.descuento is distinct from new.descuento) execute function public.pedidos_recalcular_por_descuento();

-- Valida un código para un total dado SIN consumirlo. Pública (anon) para el checkout de la
-- tienda. Devuelve validez, motivo y el descuento calculado (acotado al total).
create or replace function public.validar_cupon(p_codigo text, p_total numeric default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.cupones; v_desc numeric := 0;
begin
  select * into c from public.cupones where upper(btrim(codigo)) = upper(btrim(p_codigo)) limit 1;
  if not found then return jsonb_build_object('valido', false, 'motivo', 'Código no válido.'); end if;
  if not c.activo then return jsonb_build_object('valido', false, 'motivo', 'Este cupón ya no está activo.'); end if;
  if c.vence_el is not null and c.vence_el < current_date then return jsonb_build_object('valido', false, 'motivo', 'Este cupón venció.'); end if;
  if c.usos_max is not null and c.usos_confirmados >= c.usos_max then return jsonb_build_object('valido', false, 'motivo', 'Este cupón ya se usó.'); end if;
  if c.tipo = 'porcentaje' then v_desc := round(coalesce(p_total, 0) * c.valor / 100.0, 2);
  else v_desc := least(c.valor, coalesce(p_total, 0)); end if;
  return jsonb_build_object('valido', true, 'id', c.id, 'codigo', c.codigo, 'tipo', c.tipo, 'valor', c.valor, 'descuento', v_desc, 'cliente_id', c.cliente_id);
end;
$$;
grant execute on function public.validar_cupon(text, numeric) to anon, authenticated;

-- Registra un uso confirmado (el cliente realmente pagó). Sube el contador y desactiva el
-- cupón si llegó a su tope. Se llama UNA vez por pedido, al confirmarse el pago.
create or replace function public.registrar_uso_cupon(p_cupon_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_cupon_id is null then return; end if;
  update public.cupones
     set usos_confirmados = usos_confirmados + 1,
         activo = case when usos_max is not null and usos_confirmados + 1 >= usos_max then false else activo end
   where id = p_cupon_id;
end;
$$;
grant execute on function public.registrar_uso_cupon(uuid) to authenticated;

commit;
