-- Hausline · (1) Cuentas de pago que ven los clientes, elegidas desde el panel
--           · (2) Solicitudes de cancelación / reembolso hechas por el cliente desde Mi cuenta
-- (APLICADA 2026-09-25. Los motivos se reformularon en 202609250003.)
--
-- (1) Cada tarjeta de "Mis cuentas" tiene el botón "Visible a clientes": las encendidas salen
--     en el checkout, en la pantalla de pago del encargo y en los mensajes de WhatsApp. Si
--     ninguna está encendida, la tienda usa la lista de respaldo de config.js.
--
-- (2) El cliente NO cancela directo: deja una SOLICITUD con motivo + detalle + cuenta para el
--     reembolso. Los motivos dependen de la etapa del pedido (solo motivos verificables). El
--     admin la revisa: aprobada → se cancela y se reembolsa; rechazada → el cliente elige
--     seguir con su pedido o cancelarlo SIN reembolso.
begin;

-- ─────────────────────────── (1) Cuentas visibles a clientes ───────────────────────────
alter table public.cuentas_bancarias add column if not exists mostrar_clientes boolean not null default false;

update public.cuentas_bancarias set mostrar_clientes = true
 where activo and regexp_replace(coalesce(numero, ''), '[^0-9]', '', 'g')
       in ('133254039', '138038710', '374570968', '374570869');

create or replace function public.cuentas_pago_publicas()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'configurado', exists (select 1 from public.cuentas_bancarias where activo and mostrar_clientes),
    'cuentas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'banco', coalesce(nullif(trim(c.banco), ''), c.nombre),
        'moneda', case when c.moneda = 'USD' then 'Dólares' else 'Córdobas' end,
        'numero', trim(c.numero),
        'titular', coalesce(trim(c.titular), '')
      ) order by c.orden, c.created_at)
      from public.cuentas_bancarias c
      where c.activo and c.mostrar_clientes and nullif(trim(c.numero), '') is not null
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.cuentas_pago_publicas() from public;
grant execute on function public.cuentas_pago_publicas() to anon, authenticated;

-- ─────────────────────────── (2) Solicitudes de reembolso ───────────────────────────
create table if not exists public.solicitudes_reembolso (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  codigo text not null,
  user_id uuid references auth.users(id) on delete set null,
  correo_cliente text,
  nombre_cliente text,
  whatsapp_cliente text,
  etapa text not null,
  estado_pedido text not null,
  motivo text not null,
  motivo_label text not null,
  detalle text not null,
  banco text not null,
  numero_cuenta text not null,
  titular text not null,
  monto_pagado numeric(14,2) not null default 0,
  moneda text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobada', 'rechazada', 'retirada', 'cancelada_sin_reembolso')),
  respuesta text,
  monto_reembolso numeric(14,2),
  resuelto_por uuid references public.perfiles(id) on delete set null,
  resuelto_at timestamptz,
  decision_cliente_at timestamptz,
  aviso_admin_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists solicitudes_reembolso_pedido_idx on public.solicitudes_reembolso (pedido_id, created_at desc);
create index if not exists solicitudes_reembolso_estado_idx on public.solicitudes_reembolso (estado, created_at desc);
create unique index if not exists solicitudes_reembolso_una_abierta on public.solicitudes_reembolso (pedido_id) where estado = 'pendiente';

drop trigger if exists solicitudes_reembolso_updated_at on public.solicitudes_reembolso;
create trigger solicitudes_reembolso_updated_at before update on public.solicitudes_reembolso
  for each row execute function public.set_updated_at();

alter table public.solicitudes_reembolso enable row level security;
drop policy if exists solicitudes_reembolso_admin on public.solicitudes_reembolso;
create policy solicitudes_reembolso_admin on public.solicitudes_reembolso for all to authenticated
  using (public.usuario_admin()) with check (public.usuario_admin());
grant select, update on public.solicitudes_reembolso to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'solicitudes_reembolso') then
    alter publication supabase_realtime add table public.solicitudes_reembolso;
  end if;
end $$;

create or replace function public.motivo_reembolso_label(p_motivo text)
returns text language sql immutable as $$
  select case p_motivo
    when 'no_quiero'            then 'Ya no quiero el producto'
    when 'error_pedido'         then 'Me equivoqué de talla, color o modelo'
    when 'demora_preparacion'   then 'La preparación está tardando más de lo indicado'
    when 'calidad_no_coincide'  then 'El producto de las fotos de control de calidad no es el que pedí'
    when 'calidad_defecto'      then 'Las fotos de control de calidad muestran un defecto o daño'
    when 'calidad_expectativas' then 'La calidad en las fotos no cumple mis expectativas'
    when 'retraso_excesivo'     then 'Mi pedido superó por mucho el tiempo de entrega estimado'
    when 'paquete_perdido'      then 'La paquetería reporta el paquete perdido o dañado'
    when 'llego_danado'         then 'Las fotos de recibido muestran el producto dañado'
    when 'no_coincide'          then 'El producto recibido no coincide con lo que pedí'
    when 'otro'                 then 'Otro motivo (con explicación)'
  end;
$$;

create or replace function public.etapa_reembolso_pedido(p_pedido_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_estado text;
  v_qc timestamptz;
  v_etapa text;
begin
  select case when p.estado = 'incidencia' then coalesce((
           select h.estado_nuevo::text from public.historial_pedidos h
            where h.pedido_id = p.id and h.estado_nuevo <> 'incidencia'
            order by h.created_at desc limit 1), 'pedido_confirmado') else p.estado::text end
    into v_estado from public.pedidos p where p.id = p_pedido_id;
  if v_estado is null then return null; end if;

  select min(a.created_at) into v_qc from public.archivos_pedido a
   where a.pedido_id = p_pedido_id and a.tipo = 'control_calidad' and a.visible_cliente;

  v_etapa := case
    when v_estado in ('entregado', 'cancelado') then 'no_permitida'
    when v_estado in ('pedido_confirmado', 'en_preparacion') then case when v_qc is not null and now() <= v_qc + interval '24 hours' then 'calidad' else 'antes_envio' end
    when v_estado = 'control_calidad' then case when v_qc is null then 'antes_envio' when now() <= v_qc + interval '24 hours' then 'calidad' else 'transito' end
    when v_estado in ('disponible_entrega', 'pagado', 'empaquetado') then 'disponible'
    else 'transito'
  end;

  return jsonb_build_object(
    'etapa', v_etapa, 'estado_pedido', v_estado,
    'qc_desde', v_qc, 'qc_vence', case when v_qc is not null then v_qc + interval '24 hours' end,
    'motivos', to_jsonb(case v_etapa
      when 'antes_envio' then array['no_quiero', 'error_pedido', 'demora_preparacion', 'otro']
      when 'calidad'     then array['calidad_no_coincide', 'calidad_defecto', 'calidad_expectativas', 'no_quiero', 'otro']
      when 'transito'    then array['retraso_excesivo', 'paquete_perdido', 'otro']
      when 'disponible'  then array['llego_danado', 'no_coincide', 'otro']
      else array[]::text[] end)
  );
end;
$$;
revoke all on function public.etapa_reembolso_pedido(uuid) from public, anon, authenticated;

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
        'id', s.id, 'estado', s.estado, 'motivo', s.motivo, 'motivo_label', s.motivo_label, 'detalle', s.detalle,
        'banco', s.banco, 'numero_cuenta', s.numero_cuenta, 'titular', s.titular, 'respuesta', s.respuesta,
        'monto_reembolso', s.monto_reembolso, 'created_at', s.created_at, 'resuelto_at', s.resuelto_at)
      from public.solicitudes_reembolso s where s.pedido_id = v_id order by s.created_at desc limit 1),
    'intentos', (select count(*) from public.solicitudes_reembolso s where s.pedido_id = v_id)
  );
end;
$$;

create or replace function public.solicitar_reembolso_pedido(
  p_codigo text, p_motivo text, p_detalle text, p_banco text, p_numero_cuenta text, p_titular text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pedido public.pedidos%rowtype;
  v_etapa jsonb;
  v_ultima text;
  v_intentos int;
  v_correo text;
  v_cliente public.clientes%rowtype;
  v_detalle text := trim(coalesce(p_detalle, ''));
  v_numero text := regexp_replace(coalesce(p_numero_cuenta, ''), '[^0-9]', '', 'g');
  v_nueva public.solicitudes_reembolso%rowtype;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para continuar.' using errcode = '42501'; end if;
  select * into v_pedido from public.pedidos where codigo = upper(trim(p_codigo)) and activo;
  if v_pedido.id is null or not public.pedido_de_cuenta(v_pedido.id) then
    raise exception 'No encontramos ese pedido en tu cuenta.' using errcode = 'P0002';
  end if;

  v_etapa := public.etapa_reembolso_pedido(v_pedido.id);
  if v_etapa->>'etapa' = 'no_permitida' then
    raise exception 'Este pedido ya no se puede cancelar.' using errcode = 'P0001';
  end if;
  if not ((v_etapa->'motivos') ? coalesce(p_motivo, '')) then
    raise exception 'Ese motivo no aplica en la etapa actual de tu pedido.' using errcode = 'P0001';
  end if;
  if char_length(v_detalle) < 15 then
    raise exception 'Contanos con más detalle por qué querés cancelar (mínimo 15 caracteres).' using errcode = 'P0001';
  end if;
  if char_length(trim(coalesce(p_banco, ''))) < 2 then raise exception 'Indicá el banco para el reembolso.' using errcode = 'P0001'; end if;
  if char_length(v_numero) < 6 or char_length(v_numero) > 30 then raise exception 'Revisá el número de cuenta (solo números).' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_titular, ''))) < 5 then raise exception 'Escribí el nombre completo del titular de la cuenta.' using errcode = 'P0001'; end if;

  select estado into v_ultima from public.solicitudes_reembolso where pedido_id = v_pedido.id order by created_at desc limit 1;
  if v_ultima = 'pendiente' then raise exception 'Ya tenés una solicitud en revisión para este pedido.' using errcode = 'P0001'; end if;
  if v_ultima in ('aprobada', 'cancelada_sin_reembolso') then raise exception 'Este pedido ya tiene una cancelación resuelta.' using errcode = 'P0001'; end if;
  if v_ultima = 'rechazada' then raise exception 'Tu solicitud anterior no fue aprobada: elegí si seguís con tu pedido o lo cancelás sin reembolso.' using errcode = 'P0001'; end if;
  select count(*) into v_intentos from public.solicitudes_reembolso where pedido_id = v_pedido.id;
  if v_intentos >= 3 then raise exception 'Ya hiciste varias solicitudes para este pedido. Escribinos por WhatsApp.' using errcode = 'P0001'; end if;

  select email into v_correo from auth.users where id = auth.uid();
  select * into v_cliente from public.clientes where id = v_pedido.cliente_id;

  insert into public.solicitudes_reembolso (
    pedido_id, codigo, user_id, correo_cliente, nombre_cliente, whatsapp_cliente, etapa, estado_pedido,
    motivo, motivo_label, detalle, banco, numero_cuenta, titular, monto_pagado, moneda
  ) values (
    v_pedido.id, v_pedido.codigo, auth.uid(), coalesce(nullif(trim(v_cliente.correo), ''), v_correo), v_cliente.nombre, v_cliente.whatsapp,
    v_etapa->>'etapa', v_etapa->>'estado_pedido', p_motivo, public.motivo_reembolso_label(p_motivo), left(v_detalle, 1000),
    left(trim(p_banco), 60), v_numero, left(trim(p_titular), 120), coalesce(v_pedido.abono, 0), v_pedido.moneda::text
  ) returning * into v_nueva;

  return jsonb_build_object('ok', true, 'id', v_nueva.id, 'estado', v_nueva.estado);
end;
$$;

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

  if p_decision = 'seguir' and v_sol.estado in ('pendiente', 'rechazada') then
    update public.solicitudes_reembolso set estado = 'retirada', decision_cliente_at = now() where id = v_sol.id;
  elsif p_decision = 'cancelar_sin_reembolso' and v_sol.estado = 'rechazada' then
    update public.solicitudes_reembolso set estado = 'cancelada_sin_reembolso', decision_cliente_at = now() where id = v_sol.id;
  else
    raise exception 'Esa opción ya no está disponible.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reembolso_pedido_cliente(text) from public, anon;
revoke all on function public.solicitar_reembolso_pedido(text, text, text, text, text, text) from public, anon;
revoke all on function public.decidir_reembolso_pedido(text, text) from public, anon;
grant execute on function public.reembolso_pedido_cliente(text) to authenticated;
grant execute on function public.solicitar_reembolso_pedido(text, text, text, text, text, text) to authenticated;
grant execute on function public.decidir_reembolso_pedido(text, text) to authenticated;

commit;
