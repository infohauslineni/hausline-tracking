-- Hausline · Solicitud de reembolso RECHAZADA: plazo de 48 h para que el cliente elija + aviso
--
-- • Al rechazarla, el cliente tiene 48 h para elegir "Seguir con mi pedido" o "Cancelar sin
--   reembolso". Si no elige, queda como "siguió con su pedido" (retirada): lo aplica el cron
--   diario (vencer_reembolsos_rechazados) y, mientras tanto, las funciones del cliente ya lo
--   tratan como vencido.
-- • aviso_decision_at: candado del correo al admin cuando el cliente elige cancelar sin
--   reembolso (lo manda /api/notificar-estado una sola vez).
begin;

alter table public.solicitudes_reembolso add column if not exists plazo_decision_at timestamptz;
alter table public.solicitudes_reembolso add column if not exists aviso_decision_at timestamptz;

-- Al pasar a "rechazada" se fija el plazo con la hora del servidor.
create or replace function public.reembolso_fijar_plazo()
returns trigger language plpgsql as $$
begin
  if new.estado = 'rechazada' and old.estado is distinct from 'rechazada' then
    new.plazo_decision_at := now() + interval '48 hours';
  end if;
  return new;
end;
$$;
drop trigger if exists solicitudes_reembolso_plazo on public.solicitudes_reembolso;
create trigger solicitudes_reembolso_plazo before update of estado on public.solicitudes_reembolso
  for each row execute function public.reembolso_fijar_plazo();

-- Cron diario: las rechazadas sin respuesta pasado el plazo quedan como "siguió con su pedido".
create or replace function public.vencer_reembolsos_rechazados()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.solicitudes_reembolso set estado = 'retirada', decision_cliente_at = now()
   where estado = 'rechazada' and plazo_decision_at is not null and plazo_decision_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.vencer_reembolsos_rechazados() from public, anon, authenticated;

-- Mi cuenta: igual que antes + plazo, y una rechazada vencida ya se muestra como retirada.
create or replace function public.reembolso_pedido_cliente(p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_abono numeric;
  v_moneda text;
begin
  if auth.uid() is null then return null; end if;
  select id, abono, moneda::text into v_id, v_abono, v_moneda from public.pedidos where codigo = upper(trim(p_codigo)) and activo;
  if v_id is null or not public.pedido_de_cuenta(v_id) then return null; end if;
  return public.etapa_reembolso_pedido(v_id) || jsonb_build_object(
    'monto_pagado', coalesce(v_abono, 0), 'moneda', v_moneda,
    'solicitud', (select jsonb_build_object(
        'id', s.id,
        'estado', case when s.estado = 'rechazada' and s.plazo_decision_at < now() then 'retirada' else s.estado end,
        'vencida', (s.estado = 'rechazada' and s.plazo_decision_at < now()) or (s.estado = 'retirada' and s.plazo_decision_at is not null and s.decision_cliente_at >= s.plazo_decision_at),
        'motivo', s.motivo, 'motivo_label', s.motivo_label, 'detalle', s.detalle,
        'banco', s.banco, 'numero_cuenta', s.numero_cuenta, 'titular', s.titular, 'respuesta', s.respuesta,
        'monto_reembolso', s.monto_reembolso, 'created_at', s.created_at, 'resuelto_at', s.resuelto_at,
        'plazo_decision_at', s.plazo_decision_at)
      from public.solicitudes_reembolso s where s.pedido_id = v_id order by s.created_at desc limit 1),
    'intentos', (select count(*) from public.solicitudes_reembolso s where s.pedido_id = v_id)
  );
end;
$$;

-- Decisión del cliente: respeta el plazo y devuelve el id (para el aviso al admin).
create or replace function public.decidir_reembolso_pedido(p_codigo text, p_decision text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_sol public.solicitudes_reembolso%rowtype;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para continuar.' using errcode = '42501'; end if;
  select id into v_id from public.pedidos where codigo = upper(trim(p_codigo)) and activo;
  if v_id is null or not public.pedido_de_cuenta(v_id) then raise exception 'No encontramos ese pedido en tu cuenta.' using errcode = 'P0002'; end if;
  select * into v_sol from public.solicitudes_reembolso where pedido_id = v_id order by created_at desc limit 1 for update;
  if v_sol.id is null then raise exception 'No hay ninguna solicitud para este pedido.' using errcode = 'P0002'; end if;

  -- Plazo vencido: queda como "siguió con su pedido" sin importar lo que eligió.
  if v_sol.estado = 'rechazada' and v_sol.plazo_decision_at < now() then
    update public.solicitudes_reembolso set estado = 'retirada', decision_cliente_at = now() where id = v_sol.id;
    return jsonb_build_object('ok', true, 'id', v_sol.id, 'vencido', true);
  end if;

  if p_decision = 'seguir' and v_sol.estado in ('pendiente', 'rechazada') then
    update public.solicitudes_reembolso set estado = 'retirada', decision_cliente_at = now() where id = v_sol.id;
  elsif p_decision = 'cancelar_sin_reembolso' and v_sol.estado = 'rechazada' then
    update public.solicitudes_reembolso set estado = 'cancelada_sin_reembolso', decision_cliente_at = now() where id = v_sol.id;
  else
    raise exception 'Esa opción ya no está disponible.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'id', v_sol.id, 'vencido', false);
end;
$$;

commit;
