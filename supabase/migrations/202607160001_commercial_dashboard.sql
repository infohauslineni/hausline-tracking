-- Hausline · Módulo comercial integrado con pedidos y tracking
begin;

create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  contacto text,
  whatsapp text,
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  marca text,
  categoria text,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  tallas text[] not null default '{}',
  precio_compra numeric(12,2) not null default 0 check (precio_compra >= 0),
  precio_venta numeric(12,2) not null default 0 check (precio_venta >= 0),
  imagen text,
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pedidos add column if not exists metodo_pago text;
alter table public.pedidos add column if not exists moneda text not null default 'USD';
alter table public.pedido_items add column if not exists producto_id uuid references public.productos(id) on delete set null;
alter table public.pedido_items add column if not exists codigo_producto text;
alter table public.pedido_items add column if not exists proveedor_id uuid references public.proveedores(id) on delete set null;
alter table public.pedido_items add column if not exists precio_compra numeric(12,2) not null default 0 check (precio_compra >= 0);
alter table public.pedido_items add column if not exists envio_internacional numeric(12,2) not null default 0 check (envio_internacional >= 0);
alter table public.pedido_items add column if not exists costo_delivery numeric(12,2) not null default 0 check (costo_delivery >= 0);
alter table public.pedido_items add column if not exists otros_gastos numeric(12,2) not null default 0 check (otros_gastos >= 0);

create table if not exists public.pagos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  fecha date not null default current_date,
  tipo text not null default 'abono' check (tipo in ('abono_inicial','abono','pago_final','reembolso')),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text,
  referencia text,
  observaciones text,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  categoria text not null,
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text,
  pedido_id uuid references public.pedidos(id) on delete set null,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  descripcion text not null,
  observaciones text,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.movimientos_cuenta (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  tipo text not null check (tipo in ('ingreso','retiro','pago_proveedor','gasto','ajuste_entrada','ajuste_salida')),
  descripcion text not null,
  monto numeric(12,2) not null check (monto > 0),
  metodo text,
  pedido_id uuid references public.pedidos(id) on delete set null,
  pago_id uuid references public.pagos(id) on delete set null,
  gasto_id uuid references public.gastos(id) on delete set null,
  observaciones text,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists productos_codigo_idx on public.productos(codigo);
create index if not exists pagos_pedido_fecha_idx on public.pagos(pedido_id, fecha desc);
create index if not exists gastos_fecha_idx on public.gastos(fecha desc);
create index if not exists movimientos_cuenta_fecha_idx on public.movimientos_cuenta(fecha desc);

drop trigger if exists proveedores_updated_at on public.proveedores;
create trigger proveedores_updated_at before update on public.proveedores for each row execute function public.set_updated_at();
drop trigger if exists productos_updated_at on public.productos;
create trigger productos_updated_at before update on public.productos for each row execute function public.set_updated_at();
drop trigger if exists gastos_updated_at on public.gastos;
create trigger gastos_updated_at before update on public.gastos for each row execute function public.set_updated_at();

create or replace function public.sincronizar_abono_desde_pagos()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pedido uuid := coalesce(new.pedido_id, old.pedido_id);
begin
  update public.pedidos p set abono = coalesce((
    select sum(case when tipo = 'reembolso' then -monto else monto end) from public.pagos where pedido_id = v_pedido
  ), 0) where p.id = v_pedido;
  return null;
end;
$$;
drop trigger if exists pagos_sincronizar_pedido on public.pagos;
create trigger pagos_sincronizar_pedido after insert or update or delete on public.pagos
for each row execute function public.sincronizar_abono_desde_pagos();

-- Convierte los abonos de pedidos existentes sin duplicarlos.
insert into public.pagos (pedido_id, cliente_id, fecha, tipo, monto, metodo_pago, observaciones)
select p.id, p.cliente_id, p.fecha_pedido, 'abono_inicial', p.abono, p.metodo_pago, 'Abono existente antes del módulo comercial'
from public.pedidos p
where p.abono > 0 and not exists (select 1 from public.pagos pg where pg.pedido_id = p.id);

insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, metodo, pedido_id, pago_id, observaciones)
select pg.fecha::timestamptz, 'ingreso', 'Abono inicial ' || p.codigo, pg.monto, pg.metodo_pago, p.id, pg.id, 'Movimiento generado durante la migración'
from public.pagos pg join public.pedidos p on p.id = pg.pedido_id
where pg.tipo <> 'reembolso' and not exists (select 1 from public.movimientos_cuenta m where m.pago_id = pg.id);

create or replace function public.obtener_resumen_comercial(p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare resultado jsonb;
begin
  if not public.usuario_activo() then raise exception 'No autorizado'; end if;
  select jsonb_build_object(
    'ventas', coalesce((select sum(total) from public.pedidos where activo and (p_desde is null or fecha_pedido >= p_desde) and (p_hasta is null or fecha_pedido <= p_hasta)), 0),
    'cobrado', coalesce((select sum(case when tipo = 'reembolso' then -monto else monto end) from public.pagos where (p_desde is null or fecha >= p_desde) and (p_hasta is null or fecha <= p_hasta)), 0),
    'por_cobrar', coalesce((select sum(greatest(saldo, 0)) from public.pedidos where activo and estado <> 'cancelado'), 0),
    'gastos', coalesce((select sum(monto) from public.gastos where (p_desde is null or fecha >= p_desde) and (p_hasta is null or fecha <= p_hasta)), 0),
    'costos_productos', coalesce((select sum(i.cantidad * (i.precio_compra + i.envio_internacional + i.costo_delivery + i.otros_gastos)) from public.pedido_items i join public.pedidos p on p.id=i.pedido_id where (p_desde is null or p.fecha_pedido >= p_desde) and (p_hasta is null or p.fecha_pedido <= p_hasta)), 0),
    'saldo_cuenta', coalesce((select sum(case when tipo in ('ingreso','ajuste_entrada') then monto else -monto end) from public.movimientos_cuenta), 0),
    'pedidos', coalesce((select count(*) from public.pedidos where activo and (p_desde is null or fecha_pedido >= p_desde) and (p_hasta is null or fecha_pedido <= p_hasta)), 0)
  ) into resultado;
  return resultado;
end;
$$;

alter table public.proveedores enable row level security;
alter table public.productos enable row level security;
alter table public.pagos enable row level security;
alter table public.gastos enable row level security;
alter table public.movimientos_cuenta enable row level security;
drop policy if exists proveedores_admin_total on public.proveedores;
create policy proveedores_admin_total on public.proveedores for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
drop policy if exists productos_admin_total on public.productos;
create policy productos_admin_total on public.productos for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
drop policy if exists pagos_admin_total on public.pagos;
create policy pagos_admin_total on public.pagos for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
drop policy if exists gastos_admin_total on public.gastos;
create policy gastos_admin_total on public.gastos for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
drop policy if exists movimientos_cuenta_admin_total on public.movimientos_cuenta;
create policy movimientos_cuenta_admin_total on public.movimientos_cuenta for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());

grant select, insert, update, delete on public.proveedores, public.productos, public.pagos, public.gastos, public.movimientos_cuenta to authenticated;
revoke all on function public.obtener_resumen_comercial(date,date) from public, anon;
grant execute on function public.obtener_resumen_comercial(date,date) to authenticated;

commit;
