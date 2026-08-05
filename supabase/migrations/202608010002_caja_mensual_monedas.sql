-- Hausline · Caja mensual (apertura por mes) + soporte de dos monedas (córdoba/dólar)
-- El campo `monto` sigue siendo el valor NORMALIZADO a USD (para no romper cálculos
-- existentes). Se agregan columnas para conservar la moneda y el monto original.
begin;

-- 1) Columnas de moneda en pagos, gastos y movimientos de cuenta.
alter table public.pagos              add column if not exists moneda text not null default 'USD' check (moneda in ('USD','NIO'));
alter table public.pagos              add column if not exists monto_original numeric(12,2);
alter table public.pagos              add column if not exists tipo_cambio numeric(12,4);
alter table public.gastos             add column if not exists moneda text not null default 'USD' check (moneda in ('USD','NIO'));
alter table public.gastos             add column if not exists monto_original numeric(12,2);
alter table public.gastos             add column if not exists tipo_cambio numeric(12,4);
alter table public.movimientos_cuenta add column if not exists moneda text not null default 'USD' check (moneda in ('USD','NIO'));
alter table public.movimientos_cuenta add column if not exists monto_original numeric(12,2);
alter table public.movimientos_cuenta add column if not exists tipo_cambio numeric(12,4);

-- Rellena el monto original de registros previos (estaban en USD).
update public.pagos              set monto_original = monto where monto_original is null;
update public.gastos             set monto_original = monto where monto_original is null;
update public.movimientos_cuenta set monto_original = monto where monto_original is null;

-- 2) Tipo de cambio por defecto (editable desde Configuración). Córdobas por 1 USD.
insert into public.configuracion (clave, valor_json) values ('moneda', '{"tipo_cambio": 36.60}'::jsonb)
on conflict (clave) do nothing;

-- 3) Apertura de caja por mes. Una fila por mes con el flujo con el que arranca.
create table if not exists public.aperturas_caja (
  id uuid primary key default gen_random_uuid(),
  periodo date not null unique,             -- siempre el primer día del mes
  monto numeric(12,2) not null default 0,   -- flujo con el que comienza la caja (USD)
  nota text,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.aperturas_caja enable row level security;
drop policy if exists aperturas_caja_admin_total on public.aperturas_caja;
create policy aperturas_caja_admin_total on public.aperturas_caja for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());
drop trigger if exists aperturas_caja_updated_at on public.aperturas_caja;
create trigger aperturas_caja_updated_at before update on public.aperturas_caja for each row execute function public.set_updated_at();

-- 4) Estado de la caja de un mes: apertura sugerida (arrastre), apertura confirmada y saldo del mes.
create or replace function public.obtener_apertura_caja(p_periodo date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_inicio date := date_trunc('month', p_periodo)::date;
  v_fin date := (date_trunc('month', p_periodo) + interval '1 month')::date;
  v_sugerido numeric;
  v_apertura numeric;
  v_mov_mes numeric;
  v_opening numeric;
begin
  if not public.usuario_activo() then raise exception 'No autorizado'; end if;
  -- Arrastre: saldo acumulado hasta antes de que empiece el mes.
  select coalesce(sum(case when tipo in ('ingreso','ajuste_entrada') then monto else -monto end), 0)
    into v_sugerido from public.movimientos_cuenta where fecha < v_inicio::timestamptz;
  select monto into v_apertura from public.aperturas_caja where periodo = v_inicio;
  select coalesce(sum(case when tipo in ('ingreso','ajuste_entrada') then monto else -monto end), 0)
    into v_mov_mes from public.movimientos_cuenta where fecha >= v_inicio::timestamptz and fecha < v_fin::timestamptz;
  v_opening := coalesce(v_apertura, v_sugerido);
  return jsonb_build_object(
    'periodo', v_inicio,
    'sugerido', v_sugerido,
    'apertura', v_apertura,
    'opening', v_opening,
    'movimientos_mes', v_mov_mes,
    'saldo_mes', v_opening + v_mov_mes,
    'confirmada', v_apertura is not null
  );
end;
$$;

-- 5) Confirmar / editar la apertura de un mes.
create or replace function public.guardar_apertura_caja(p_periodo date, p_monto numeric, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inicio date := date_trunc('month', p_periodo)::date;
begin
  if not public.usuario_activo() then raise exception 'No autorizado'; end if;
  insert into public.aperturas_caja (periodo, monto, nota) values (v_inicio, coalesce(p_monto, 0), p_nota)
  on conflict (periodo) do update set monto = excluded.monto, nota = excluded.nota, updated_at = now();
  return public.obtener_apertura_caja(v_inicio);
end;
$$;

grant execute on function public.obtener_apertura_caja(date) to authenticated;
grant execute on function public.guardar_apertura_caja(date, numeric, text) to authenticated;

commit;
