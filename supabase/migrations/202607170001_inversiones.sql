-- Hausline · Inventario de prueba e inversiones
begin;

create table if not exists public.inversiones (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  producto_id uuid references public.productos(id) on delete set null,
  codigo text,
  producto text not null,
  marca text,
  talla_color text,
  cantidad integer not null default 1 check (cantidad > 0),
  costo_unitario numeric(12,2) not null default 0 check (costo_unitario >= 0),
  gastos_adicionales numeric(12,2) not null default 0 check (gastos_adicionales >= 0),
  precio_venta_estimado numeric(12,2) not null default 0 check (precio_venta_estimado >= 0),
  estado text not null default 'en_inventario' check (estado in ('en_inventario','reservado','vendido','descartado')),
  notas text,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.movimientos_cuenta add column if not exists inversion_id uuid references public.inversiones(id) on delete set null;
alter table public.movimientos_cuenta drop constraint if exists movimientos_cuenta_tipo_check;
alter table public.movimientos_cuenta add constraint movimientos_cuenta_tipo_check
  check (tipo in ('ingreso','retiro','pago_proveedor','gasto','inversion','ajuste_entrada','ajuste_salida'));

create index if not exists inversiones_fecha_idx on public.inversiones(fecha desc);
create index if not exists inversiones_estado_idx on public.inversiones(estado);
drop trigger if exists inversiones_updated_at on public.inversiones;
create trigger inversiones_updated_at before update on public.inversiones
for each row execute function public.set_updated_at();

alter table public.inversiones enable row level security;
drop policy if exists inversiones_admin_total on public.inversiones;
create policy inversiones_admin_total on public.inversiones for all to authenticated
using (public.usuario_activo()) with check (public.usuario_activo());

grant select, insert, update, delete on public.inversiones to authenticated;
commit;
