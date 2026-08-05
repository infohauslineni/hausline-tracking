-- Hausline · Control de deudas y abonos
begin;
create table if not exists public.deudas (
  id uuid primary key default gen_random_uuid(),
  acreedor text not null,
  concepto text not null,
  monto_total numeric(12,2) not null check (monto_total > 0),
  monto_pagado numeric(12,2) not null default 0 check (monto_pagado >= 0),
  fecha_deuda date not null default current_date,
  fecha_vencimiento date,
  estado text not null default 'pendiente' check (estado in ('pendiente','pagada','cancelada')),
  notas text,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.pagos_deuda (
  id uuid primary key default gen_random_uuid(),
  deuda_id uuid not null references public.deudas(id) on delete cascade,
  fecha date not null default current_date,
  monto numeric(12,2) not null check (monto > 0),
  metodo text,
  notas text,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists deudas_estado_idx on public.deudas(estado);
create index if not exists pagos_deuda_deuda_idx on public.pagos_deuda(deuda_id, fecha desc);
drop trigger if exists deudas_updated_at on public.deudas;
create trigger deudas_updated_at before update on public.deudas for each row execute function public.set_updated_at();
alter table public.deudas enable row level security;
alter table public.pagos_deuda enable row level security;
drop policy if exists deudas_admin_total on public.deudas;
create policy deudas_admin_total on public.deudas for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
drop policy if exists pagos_deuda_admin_total on public.pagos_deuda;
create policy pagos_deuda_admin_total on public.pagos_deuda for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
grant select, insert, update, delete on public.deudas, public.pagos_deuda to authenticated;
commit;
