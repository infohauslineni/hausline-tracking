-- =====================================================================
--  Hausline Tracking · Integración con el vendedor virtual de WhatsApp
--  Migración ADITIVA. No modifica ninguna tabla ni función existente.
--
--  Qué agrega:
--   1. Tablas de infraestructura del bot (prefijo wa_): memoria de
--      conversación, anti-duplicados, borradores de pedido y bitácora
--      de notificaciones. NO son una estructura paralela de pedidos:
--      los pedidos reales siguen viviendo en public.pedidos.
--   2. Funciones RPC SECURITY DEFINER que n8n invoca con la service_role.
--      Encapsulan la MISMA lógica que src/services/pedidos.service.ts
--      (pedido -> items -> pagos(abono_inicial) -> movimientos_cuenta)
--      para no descuadrar las finanzas y no duplicar reglas en n8n.
--
--  Ejecutar una sola vez (idempotente) en Supabase SQL Editor o CLI.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. TABLAS DE INFRAESTRUCTURA DEL BOT (prefijo wa_)
-- ---------------------------------------------------------------------

-- Memoria por número de WhatsApp: nombre, contexto libre de la charla,
-- último producto mostrado (para no volver a preguntar) y bandera de
-- atención humana (pausa la IA para ese cliente).
create table if not exists public.wa_conversaciones (
  wa_id           text primary key,
  nombre          text,
  contexto        jsonb not null default '{}'::jsonb,
  ultimo_producto jsonb,
  atencion_humana boolean not null default false,
  motivo_atencion text,
  cliente_id      uuid references public.clientes(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Idempotencia del webhook de Meta: un message_id se procesa una sola vez.
create table if not exists public.wa_mensajes_procesados (
  message_id text primary key,
  wa_id      text,
  created_at timestamptz not null default now()
);

-- Borrador / intención de pedido. El pedido REAL en public.pedidos se
-- crea únicamente cuando el administrador verifica el abono (respeta el
-- flujo actual del sistema). Aquí se retienen los datos mientras tanto.
create table if not exists public.wa_borradores_pedido (
  id               uuid primary key default gen_random_uuid(),
  wa_id            text not null,
  nombre           text,
  payload          jsonb not null,          -- {items:[...], abono, metodo_pago, ...}
  comprobante_path text,                     -- ruta temporal en storage (wa-comprobantes)
  estado           text not null default 'recopilando'
                     check (estado in ('recopilando','esperando_comprobante','pendiente_revision','confirmado','descartado')),
  pedido_id        uuid references public.pedidos(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists wa_borradores_wa_id_idx on public.wa_borradores_pedido (wa_id, created_at desc);
create index if not exists wa_borradores_estado_idx on public.wa_borradores_pedido (estado) where estado in ('esperando_comprobante','pendiente_revision');

-- Bitácora de avisos de estado enviados. La UNIQUE evita notificar dos
-- veces el mismo (pedido, estado): es la garantía anti-repetidos.
create table if not exists public.wa_notificaciones (
  id         uuid primary key default gen_random_uuid(),
  pedido_id  uuid not null references public.pedidos(id) on delete cascade,
  codigo     text not null,
  wa_id      text,
  estado     public.estado_pedido not null,
  mensaje    text,
  message_id text,
  resultado  text not null default 'enviado' check (resultado in ('enviado','error','omitido')),
  created_at timestamptz not null default now(),
  unique (pedido_id, estado)
);
create index if not exists wa_notificaciones_pedido_idx on public.wa_notificaciones (pedido_id, created_at desc);

create trigger wa_conversaciones_updated_at before update on public.wa_conversaciones
  for each row execute function public.set_updated_at();
create trigger wa_borradores_updated_at before update on public.wa_borradores_pedido
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 2. RLS: solo administradores autenticados y la service_role.
--    anon NO tiene acceso a ninguna tabla wa_.
-- ---------------------------------------------------------------------
alter table public.wa_conversaciones      enable row level security;
alter table public.wa_mensajes_procesados enable row level security;
alter table public.wa_borradores_pedido   enable row level security;
alter table public.wa_notificaciones      enable row level security;

drop policy if exists wa_conversaciones_admin on public.wa_conversaciones;
create policy wa_conversaciones_admin on public.wa_conversaciones for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());
drop policy if exists wa_mensajes_admin on public.wa_mensajes_procesados;
create policy wa_mensajes_admin on public.wa_mensajes_procesados for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());
drop policy if exists wa_borradores_admin on public.wa_borradores_pedido;
create policy wa_borradores_admin on public.wa_borradores_pedido for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());
drop policy if exists wa_notificaciones_admin on public.wa_notificaciones;
create policy wa_notificaciones_admin on public.wa_notificaciones for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());

grant select, insert, update, delete on
  public.wa_conversaciones, public.wa_mensajes_procesados,
  public.wa_borradores_pedido, public.wa_notificaciones
  to authenticated;

-- ---------------------------------------------------------------------
-- 3. UTILIDADES
-- ---------------------------------------------------------------------

-- Normaliza el teléfono igual que src/utils/whatsapp.ts:
-- quita no-dígitos, quita 00 inicial, y si quedan 8 dígitos antepone 505.
create or replace function public.wa_normalizar_telefono(p_valor text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v text;
begin
  v := regexp_replace(coalesce(p_valor,''), '\D', '', 'g');
  if left(v, 2) = '00' then v := substring(v from 3); end if;
  if length(v) = 8 then v := '505' || v; end if;
  return v;
end;
$$;

-- Fecha "de hoy" en la zona horaria del negocio (America/Managua).
create or replace function public.wa_hoy()
returns date language sql stable set search_path = public, pg_temp as $$
  select (now() at time zone 'America/Managua')::date;
$$;

-- Marca un message_id como procesado. Devuelve true si es NUEVO
-- (se debe procesar) y false si ya existía (duplicado -> ignorar).
create or replace function public.wa_marcar_mensaje(p_message_id text, p_wa_id text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_nuevo boolean;
begin
  insert into public.wa_mensajes_procesados (message_id, wa_id)
  values (p_message_id, p_wa_id)
  on conflict (message_id) do nothing;
  get diagnostics v_nuevo = row_count;   -- 1 = insertado (nuevo), 0 = duplicado
  return v_nuevo > 0;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. CONVERSACIÓN / ATENCIÓN HUMANA
-- ---------------------------------------------------------------------

-- Devuelve (y crea si no existe) el estado de conversación de un número.
create or replace function public.wa_obtener_conversacion(p_wa_id text)
returns public.wa_conversaciones language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.wa_conversaciones;
begin
  insert into public.wa_conversaciones (wa_id) values (p_wa_id)
  on conflict (wa_id) do nothing;
  select * into v_row from public.wa_conversaciones where wa_id = p_wa_id;
  return v_row;
end;
$$;

-- Guarda memoria de la conversación (merge de contexto + último producto).
create or replace function public.wa_guardar_conversacion(
  p_wa_id text, p_nombre text default null,
  p_contexto jsonb default null, p_ultimo_producto jsonb default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.wa_conversaciones (wa_id, nombre, contexto, ultimo_producto)
  values (p_wa_id, p_nombre, coalesce(p_contexto,'{}'::jsonb), p_ultimo_producto)
  on conflict (wa_id) do update set
    nombre = coalesce(excluded.nombre, public.wa_conversaciones.nombre),
    contexto = case when p_contexto is null then public.wa_conversaciones.contexto
                    else public.wa_conversaciones.contexto || p_contexto end,
    ultimo_producto = coalesce(excluded.ultimo_producto, public.wa_conversaciones.ultimo_producto),
    updated_at = now();
end;
$$;

create or replace function public.wa_atencion_humana(p_wa_id text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.wa_conversaciones (wa_id, atencion_humana, motivo_atencion)
  values (p_wa_id, true, p_motivo)
  on conflict (wa_id) do update set
    atencion_humana = true, motivo_atencion = coalesce(excluded.motivo_atencion, public.wa_conversaciones.motivo_atencion),
    updated_at = now();
end;
$$;

create or replace function public.wa_reactivar_ia(p_wa_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.wa_conversaciones
  set atencion_humana = false, motivo_atencion = null, updated_at = now()
  where wa_id = p_wa_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. CLIENTE
-- ---------------------------------------------------------------------

-- Busca por teléfono (comparando solo dígitos) o crea el cliente.
create or replace function public.wa_buscar_o_crear_cliente(p_nombre text, p_whatsapp text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tel text := public.wa_normalizar_telefono(p_whatsapp);
  v_id  uuid;
begin
  select id into v_id from public.clientes
  where regexp_replace(whatsapp, '\D', '', 'g') = v_tel
  order by created_at limit 1;

  if v_id is null then
    insert into public.clientes (nombre, whatsapp)
    values (coalesce(nullif(trim(p_nombre), ''), 'Cliente WhatsApp'), v_tel)
    returning id into v_id;
  elsif p_nombre is not null and trim(p_nombre) <> '' then
    update public.clientes set nombre = p_nombre
    where id = v_id and (nombre is null or nombre = '' or nombre = 'Cliente WhatsApp');
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. CREAR PEDIDO (réplica exacta de crearPedido del front)
--    payload: {
--      nombre, whatsapp, abono, metodo_pago, fecha_estimada,
--      notas_internas, notas_publicas,
--      items: [ {producto, marca, categoria, talla, color,
--                cantidad, precio_unitario, codigo_producto} ]
--    }
--    Nace en 'pedido_confirmado' con el abono ya registrado.
--    Devuelve: { pedido_id, codigo, total, abono, saldo, estado }
-- ---------------------------------------------------------------------
create or replace function public.wa_crear_pedido(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cliente   uuid;
  v_pedido    uuid;
  v_codigo    text;
  v_abono     numeric(12,2) := round(coalesce((payload->>'abono')::numeric, 0), 2);
  v_metodo    text := nullif(payload->>'metodo_pago','');
  v_fecha_est date := (payload->>'fecha_estimada')::date;
  v_item      jsonb;
  v_total     numeric(12,2);
  v_saldo     numeric(12,2);
begin
  if payload->'items' is null or jsonb_array_length(payload->'items') = 0 then
    raise exception 'wa_crear_pedido: se requiere al menos un item';
  end if;

  v_cliente := public.wa_buscar_o_crear_cliente(payload->>'nombre', payload->>'whatsapp');

  -- Pedido base: abono en 0; el trigger de pagos lo ajustará al insertar el pago.
  insert into public.pedidos (cliente_id, estado, fecha_pedido, fecha_estimada, abono, metodo_pago, notas_internas, notas_publicas)
  values (
    v_cliente, 'pedido_confirmado', public.wa_hoy(), v_fecha_est, 0, v_metodo,
    nullif(payload->>'notas_internas',''),
    coalesce(nullif(payload->>'notas_publicas',''), public.etiqueta_estado_publico('pedido_confirmado'))
  )
  returning id, codigo into v_pedido, v_codigo;

  -- Items (el trigger recalcula el total del pedido).
  for v_item in select * from jsonb_array_elements(payload->'items') loop
    insert into public.pedido_items (
      pedido_id, producto, marca, categoria, talla, color, cantidad, precio_unitario, codigo_producto
    ) values (
      v_pedido,
      trim(v_item->>'producto'),
      nullif(v_item->>'marca',''),
      nullif(v_item->>'categoria',''),
      nullif(v_item->>'talla',''),
      nullif(v_item->>'color',''),
      greatest(1, coalesce((v_item->>'cantidad')::int, 1)),
      round(coalesce((v_item->>'precio_unitario')::numeric, 0), 2),
      nullif(v_item->>'codigo_producto','')
    );
  end loop;

  -- Abono inicial: pago + movimiento de cuenta (igual que el front).
  if v_abono > 0 then
    with nuevo_pago as (
      insert into public.pagos (pedido_id, cliente_id, fecha, tipo, monto, metodo_pago, observaciones)
      values (v_pedido, v_cliente, public.wa_hoy(), 'abono_inicial', v_abono, v_metodo, 'Abono inicial registrado por el vendedor virtual de WhatsApp')
      returning id
    )
    insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, metodo, pedido_id, pago_id)
    select (public.wa_hoy())::timestamptz + interval '12 hours', 'ingreso', 'Abono inicial ' || v_codigo, v_abono, v_metodo, v_pedido, id
    from nuevo_pago;
  end if;

  select total, saldo into v_total, v_saldo from public.pedidos where id = v_pedido;

  return jsonb_build_object(
    'pedido_id', v_pedido, 'codigo', v_codigo,
    'total', v_total, 'abono', v_abono, 'saldo', v_saldo,
    'estado', 'pedido_confirmado'
  );
end;
$$;

-- Confirma un borrador (llamado tras verificar el abono) -> crea el pedido
-- real y marca el borrador como 'confirmado'. Devuelve lo mismo que wa_crear_pedido.
create or replace function public.wa_confirmar_borrador(p_borrador_id uuid, p_metodo_pago text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_borrador public.wa_borradores_pedido;
  v_payload  jsonb;
  v_res      jsonb;
begin
  select * into v_borrador from public.wa_borradores_pedido where id = p_borrador_id for update;
  if v_borrador.id is null then raise exception 'Borrador no encontrado'; end if;
  if v_borrador.estado = 'confirmado' then
    return jsonb_build_object('ya_confirmado', true, 'pedido_id', v_borrador.pedido_id,
      'wa_id', v_borrador.wa_id, 'nombre', v_borrador.nombre);
  end if;

  v_payload := v_borrador.payload;
  if p_metodo_pago is not null then v_payload := v_payload || jsonb_build_object('metodo_pago', p_metodo_pago); end if;

  v_res := public.wa_crear_pedido(v_payload);

  update public.wa_borradores_pedido
  set estado = 'confirmado', pedido_id = (v_res->>'pedido_id')::uuid, updated_at = now()
  where id = p_borrador_id;

  return v_res || jsonb_build_object('wa_id', v_borrador.wa_id, 'nombre', v_borrador.nombre);
end;
$$;

-- Registra / actualiza el borrador activo de un número. Devuelve el id.
create or replace function public.wa_registrar_borrador(p_wa_id text, p_nombre text, payload jsonb, p_estado text default 'esperando_comprobante')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from public.wa_borradores_pedido
  where wa_id = p_wa_id and estado in ('recopilando','esperando_comprobante','pendiente_revision')
  order by created_at desc limit 1;

  if v_id is null then
    insert into public.wa_borradores_pedido (wa_id, nombre, payload, estado)
    values (p_wa_id, p_nombre, payload, p_estado)
    returning id into v_id;
  else
    update public.wa_borradores_pedido
    set nombre = coalesce(p_nombre, nombre), payload = payload, estado = p_estado, updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end;
$$;

-- Asocia el comprobante recibido al borrador y lo deja pendiente de revisión.
create or replace function public.wa_registrar_comprobante(p_wa_id text, p_comprobante_path text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from public.wa_borradores_pedido
  where wa_id = p_wa_id and estado in ('recopilando','esperando_comprobante','pendiente_revision')
  order by created_at desc limit 1;
  if v_id is null then return null; end if;
  update public.wa_borradores_pedido
  set comprobante_path = p_comprobante_path, estado = 'pendiente_revision', updated_at = now()
  where id = v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. CONSULTA DE PEDIDO (tracking por WhatsApp, con validación de dueño)
--    Reutiliza obtener_pedido_publico y añade saldo/nombre SOLO si el
--    teléfono coincide con el dueño del pedido. Nunca expone pedidos ajenos.
-- ---------------------------------------------------------------------
create or replace function public.wa_consultar_pedido(p_codigo text, p_whatsapp text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_codigo  text := upper(trim(p_codigo));
  v_tel     text := public.wa_normalizar_telefono(p_whatsapp);
  v_ped     record;
  v_publico jsonb;
begin
  if v_codigo !~ '^HS[0-9]{6}$' then return null; end if;

  select p.id, p.saldo, p.estado, c.nombre,
         regexp_replace(c.whatsapp, '\D', '', 'g') as tel
  into v_ped
  from public.pedidos p join public.clientes c on c.id = p.cliente_id
  where p.codigo = v_codigo and p.activo;

  if v_ped.id is null then return null; end if;

  v_publico := public.obtener_pedido_publico(v_codigo);

  -- Datos sensibles (nombre, saldo) solo si el número coincide.
  if p_whatsapp is not null and v_tel = v_ped.tel then
    v_publico := v_publico || jsonb_build_object(
      'coincide_cliente', true, 'nombre', v_ped.nombre, 'saldo', v_ped.saldo);
  else
    v_publico := v_publico || jsonb_build_object('coincide_cliente', false);
  end if;

  return v_publico;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. NOTIFICACIONES DE CAMBIO DE ESTADO (modelo pull para n8n)
--    Devuelve los pedidos cuyo estado ACTUAL aún no fue notificado por
--    WhatsApp. n8n envía el aviso y luego llama a wa_registrar_notificacion.
-- ---------------------------------------------------------------------
create or replace function public.wa_pedidos_pendientes_notificacion()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'pedido_id', p.id,
    'codigo', p.codigo,
    'estado', p.estado,
    'estado_label', public.etiqueta_estado_publico(p.estado),
    'nombre', c.nombre,
    'whatsapp', regexp_replace(c.whatsapp, '\D', '', 'g'),
    'saldo', p.saldo,
    'fecha_estimada', p.fecha_estimada,
    'actualizado', p.updated_at
  ) order by p.updated_at), '[]'::jsonb)
  from public.pedidos p
  join public.clientes c on c.id = p.cliente_id
  where p.activo
    and p.estado not in ('cancelado','incidencia')
    and not exists (
      select 1 from public.wa_notificaciones n
      where n.pedido_id = p.id and n.estado = p.estado
    );
$$;

-- Registra el resultado del aviso (dedup por UNIQUE(pedido_id, estado)).
create or replace function public.wa_registrar_notificacion(
  p_pedido_id uuid, p_estado public.estado_pedido, p_wa_id text,
  p_mensaje text default null, p_message_id text default null, p_resultado text default 'enviado')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_codigo text;
begin
  select codigo into v_codigo from public.pedidos where id = p_pedido_id;
  insert into public.wa_notificaciones (pedido_id, codigo, wa_id, estado, mensaje, message_id, resultado)
  values (p_pedido_id, v_codigo, p_wa_id, p_estado, p_mensaje, p_message_id, p_resultado)
  on conflict (pedido_id, estado) do update set
    resultado = excluded.resultado, message_id = coalesce(excluded.message_id, public.wa_notificaciones.message_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 9. PERMISOS: ejecutar solo para service_role (n8n) y authenticated.
--    anon queda sin acceso a nada de esto.
-- ---------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'wa_normalizar_telefono(text)', 'wa_hoy()',
    'wa_marcar_mensaje(text,text)', 'wa_obtener_conversacion(text)',
    'wa_guardar_conversacion(text,text,jsonb,jsonb)', 'wa_atencion_humana(text,text)',
    'wa_reactivar_ia(text)', 'wa_buscar_o_crear_cliente(text,text)',
    'wa_crear_pedido(jsonb)', 'wa_confirmar_borrador(uuid,text)',
    'wa_registrar_borrador(text,text,jsonb,text)', 'wa_registrar_comprobante(text,text)',
    'wa_consultar_pedido(text,text)', 'wa_pedidos_pendientes_notificacion()',
    'wa_registrar_notificacion(uuid,public.estado_pedido,text,text,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to service_role, authenticated;', fn);
  end loop;
end $$;

commit;

-- =====================================================================
--  BUCKET PRIVADO para comprobantes temporales recibidos por WhatsApp.
--  (El comprobante se re-registra en archivos_pedido cuando el pedido
--   se crea, por lo que aquí solo es un área de paso.)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wa-comprobantes', 'wa-comprobantes', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false;
