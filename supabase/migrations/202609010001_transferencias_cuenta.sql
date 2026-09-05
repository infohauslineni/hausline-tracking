-- Hausline · Registrar las transferencias entre cuentas propias.
--
-- Antes, transferir de una cuenta a otra solo ajustaba los saldos (dos llamadas sueltas a
-- ajustar_saldo_cuenta) y no dejaba rastro. Por eso, al pasar plata de córdobas a dólares,
-- la barra de "recibido este mes" de la cuenta destino NO subía: esa barra se alimenta de
-- lo que ENTRA a la cuenta en el mes, y una transferencia no quedaba registrada.
--
-- Esta migración crea una bitácora de transferencias y una función atómica que baja el
-- origen, sube el destino y deja el registro, todo en una sola transacción. La barra de
-- recepción del destino ahora cuenta también estas entradas. NO toca la caja (es plata que
-- ya tenías, solo cambió de cuenta), así que la caja mensual sigue igual.
begin;

create table if not exists public.transferencias_cuenta (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  origen_id uuid references public.cuentas_bancarias(id) on delete set null,
  destino_id uuid references public.cuentas_bancarias(id) on delete set null,
  monto_origen numeric(14,2) not null check (monto_origen > 0),   -- en la moneda del origen
  monto_destino numeric(14,2) not null check (monto_destino > 0), -- en la moneda del destino
  nota text,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists transferencias_cuenta_fecha_idx on public.transferencias_cuenta(fecha desc);
create index if not exists transferencias_cuenta_destino_idx on public.transferencias_cuenta(destino_id);

alter table public.transferencias_cuenta enable row level security;
drop policy if exists transferencias_cuenta_admin_total on public.transferencias_cuenta;
create policy transferencias_cuenta_admin_total on public.transferencias_cuenta for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());
grant select, insert, update, delete on public.transferencias_cuenta to authenticated;

-- Transferencia atómica: baja el saldo del origen, sube el del destino y deja el registro.
-- Los montos van en la moneda de cada cuenta (si son monedas distintas, monto_destino es el
-- equivalente que realmente llega). No afecta la caja.
create or replace function public.transferir_entre_cuentas(
  p_origen uuid, p_destino uuid, p_monto_origen numeric, p_monto_destino numeric, p_nota text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public.usuario_activo() then raise exception 'No autorizado'; end if;
  if p_origen is null or p_destino is null then raise exception 'Elegí la cuenta de origen y la de destino.'; end if;
  if p_origen = p_destino then raise exception 'Elegí dos cuentas distintas.'; end if;
  if coalesce(p_monto_origen, 0) <= 0 or coalesce(p_monto_destino, 0) <= 0 then raise exception 'Indicá un monto válido.'; end if;
  perform public.ajustar_saldo_cuenta(p_origen, -abs(p_monto_origen));
  perform public.ajustar_saldo_cuenta(p_destino, abs(p_monto_destino));
  insert into public.transferencias_cuenta (origen_id, destino_id, monto_origen, monto_destino, nota)
    values (p_origen, p_destino, abs(p_monto_origen), abs(p_monto_destino), nullif(btrim(p_nota), ''))
    returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.transferir_entre_cuentas(uuid, uuid, numeric, numeric, text) to authenticated;

commit;
