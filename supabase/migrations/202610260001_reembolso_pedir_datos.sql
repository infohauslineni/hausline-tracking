-- PROTOCOLO DE CANCELACIÓN CON DEVOLUCIÓN (2026-10-26).
-- Cuando HAUSLINE cancela un pedido que el cliente ya pagó, se le PIDE su número de cuenta:
--   1. El panel crea una solicitud de reembolso "esperando_datos" (origen 'admin') con un token.
--   2. El correo de cancelación (y el WhatsApp) llevan el enlace hauslineshopni.es/reembolso/?t=…
--   3. El cliente llena banco, moneda, número de cuenta y titular → la solicitud pasa a
--      "pendiente" y le llega aviso al admin.
--   4. En Reembolsos el admin transfiere y la marca como reembolsada (sale de la caja).
-- Usa la misma tabla solicitudes_reembolso que las cancelaciones que pide el cliente.

alter table public.solicitudes_reembolso add column if not exists origen text not null default 'cliente';
alter table public.solicitudes_reembolso add column if not exists token uuid not null default gen_random_uuid();
alter table public.solicitudes_reembolso add column if not exists datos_at timestamptz;
create unique index if not exists solicitudes_reembolso_token_idx on public.solicitudes_reembolso (token);

alter table public.solicitudes_reembolso drop constraint if exists solicitudes_reembolso_estado_check;
alter table public.solicitudes_reembolso add constraint solicitudes_reembolso_estado_check
  check (estado in ('esperando_datos', 'pendiente', 'aprobada', 'rechazada', 'retirada', 'cancelada_sin_reembolso'));
alter table public.solicitudes_reembolso drop constraint if exists solicitudes_reembolso_origen_check;
alter table public.solicitudes_reembolso add constraint solicitudes_reembolso_origen_check check (origen in ('cliente', 'admin'));

-- 1. El admin pide los datos (antes de cancelar). Si ya había una pedida para ese pedido, la reusa.
create or replace function public.pedir_datos_reembolso(p_pedido uuid, p_monto numeric, p_motivo text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p record; v_token uuid; v_motivo text := coalesce(nullif(btrim(p_motivo), ''), 'otro');
begin
  if not public.usuario_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select p.id, p.codigo, p.estado, p.abono, c.nombre, c.correo, c.whatsapp into v_p
    from public.pedidos p left join public.clientes c on c.id = p.cliente_id where p.id = p_pedido;
  if not found then raise exception 'No se encontró el pedido'; end if;
  select token into v_token from public.solicitudes_reembolso
   where pedido_id = p_pedido and origen = 'admin' and estado = 'esperando_datos' order by created_at desc limit 1;
  if v_token is not null then
    update public.solicitudes_reembolso set monto_pagado = greatest(0, coalesce(p_monto, 0)), motivo = v_motivo where token = v_token;
    return v_token;
  end if;
  insert into public.solicitudes_reembolso (pedido_id, codigo, correo_cliente, nombre_cliente, whatsapp_cliente, etapa, estado_pedido,
    motivo, motivo_label, detalle, banco, numero_cuenta, titular, monto_pagado, estado, origen)
  values (v_p.id, v_p.codigo, v_p.correo, v_p.nombre, v_p.whatsapp, 'antes_envio', v_p.estado,
    v_motivo, 'Cancelado por HAUSLINE', 'HAUSLINE canceló el pedido y le pidió al cliente su cuenta para devolverle lo pagado.',
    '', '', '', greatest(0, coalesce(p_monto, 0)), 'esperando_datos', 'admin')
  returning token into v_token;
  return v_token;
end;
$$;
revoke all on function public.pedir_datos_reembolso(uuid, numeric, text) from public, anon;
grant execute on function public.pedir_datos_reembolso(uuid, numeric, text) to authenticated;

-- 2. La página pública lee qué devolución es (sin datos sensibles).
create or replace function public.reembolso_datos_publico(p_token uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('codigo', s.codigo, 'nombre', split_part(coalesce(s.nombre_cliente, ''), ' ', 1),
    'monto', s.monto_pagado, 'estado', s.estado, 'enviado', s.estado <> 'esperando_datos')
    from public.solicitudes_reembolso s where s.token = p_token and s.origen = 'admin';
$$;
revoke all on function public.reembolso_datos_publico(uuid) from public;
grant execute on function public.reembolso_datos_publico(uuid) to anon, authenticated;

-- 3. El cliente manda sus datos (una sola vez).
create or replace function public.enviar_datos_reembolso(p_token uuid, p_banco text, p_moneda text, p_numero text, p_titular text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if char_length(btrim(coalesce(p_banco, ''))) not between 2 and 60
     or char_length(regexp_replace(coalesce(p_numero, ''), '\s', '', 'g')) not between 4 and 40
     or char_length(btrim(coalesce(p_titular, ''))) not between 3 and 120 then
    raise exception 'Datos incompletos';
  end if;
  update public.solicitudes_reembolso
     set banco = btrim(p_banco), moneda = nullif(btrim(coalesce(p_moneda, '')), ''), numero_cuenta = regexp_replace(btrim(p_numero), '\s+', ' ', 'g'),
         titular = btrim(p_titular), estado = 'pendiente', datos_at = now()
   where token = p_token and origen = 'admin' and estado = 'esperando_datos';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public.enviar_datos_reembolso(uuid, text, text, text, text) from public;
grant execute on function public.enviar_datos_reembolso(uuid, text, text, text, text) to anon, authenticated;

select (select count(*) from information_schema.columns where table_name = 'solicitudes_reembolso' and column_name in ('origen', 'token', 'datos_at')) as columnas_nuevas;
