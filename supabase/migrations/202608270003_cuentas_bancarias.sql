-- Hausline · Cuentas bancarias con saldo (tarjetas tipo app del banco)
--
-- Cada cuenta (LAFISE córdobas, LAFISE dólares, BAC, Billetera, la nueva que se abra…)
-- se muestra como una tarjeta con su saldo. El saldo es un número guardado que:
--   • sube solo cuando se registra un pago de cliente hacia esa cuenta (cobro/abono),
--   • baja cuando se registra un reembolso desde esa cuenta,
--   • se puede corregir a mano en cualquier momento (para cuadrar con el banco real).
-- Así el admin ve de un vistazo cuánto tiene en cada cuenta sin abrir cada app.
begin;

create table if not exists public.cuentas_bancarias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,                 -- ej: "Cuenta Digital", "LAFISE Córdobas"
  banco text,                           -- ej: "LAFISE", "BAC"
  numero text,                          -- número de cuenta (referencia visual)
  titular text,
  moneda text not null default 'NIO' check (moneda in ('USD','NIO')),
  emoji text not null default '🏦',
  saldo numeric(14,2) not null default 0,
  orden int not null default 0,
  activo boolean not null default true,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cuentas_bancarias_orden_idx on public.cuentas_bancarias(activo, orden);

drop trigger if exists cuentas_bancarias_updated_at on public.cuentas_bancarias;
create trigger cuentas_bancarias_updated_at before update on public.cuentas_bancarias for each row execute function public.set_updated_at();

alter table public.cuentas_bancarias enable row level security;
drop policy if exists cuentas_bancarias_admin_total on public.cuentas_bancarias;
create policy cuentas_bancarias_admin_total on public.cuentas_bancarias for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
grant select, insert, update, delete on public.cuentas_bancarias to authenticated;

-- Deja rastro de a qué cuenta entró/salió cada movimiento (opcional, para referencia).
alter table public.movimientos_cuenta add column if not exists cuenta_id uuid references public.cuentas_bancarias(id) on delete set null;

-- Motivo de cancelación del pedido (cliente canceló / no entregado-devolución / otro).
alter table public.pedidos add column if not exists motivo_cancelacion text;

-- Suma (o resta, con delta negativo) al saldo de una cuenta de forma atómica y devuelve
-- el saldo nuevo. Se usa al registrar pagos y reembolsos hacia/desde una cuenta.
create or replace function public.ajustar_saldo_cuenta(p_id uuid, p_delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare nuevo numeric;
begin
  if p_id is null then return null; end if;
  update public.cuentas_bancarias
     set saldo = round(saldo + coalesce(p_delta, 0), 2)
   where id = p_id
  returning saldo into nuevo;
  return nuevo;
end;
$$;
grant execute on function public.ajustar_saldo_cuenta(uuid, numeric) to authenticated;

commit;
