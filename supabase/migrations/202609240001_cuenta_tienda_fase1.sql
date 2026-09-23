-- Hausline · "Mi cuenta" en la TIENDA (hauslineshopni.es/cuenta) — Fase 1
--
-- Complementa 202609230001 (cuentas_cliente, trigger seguro de staff). Aquí:
--   1. Relación REAL cliente ↔ cuenta: clientes.user_id (y solicitudes.user_id cuando el
--      cliente compra con sesión abierta). Se deja de vincular pedidos por CÓDIGO (los códigos
--      HS###### se pueden adivinar): un pedido es de la cuenta si su cliente tiene ese user_id
--      o el MISMO correo verificado, o si el admin lo asocia desde el panel.
--   2. pedido_cliente(codigo): detalle completo SOLO para el dueño (sin costos, proveedor,
--      notas internas ni ganancias; esos viven en tablas que el cliente no puede leer).
--   3. Link público /pedido/HS###### SIN login con TODO el pedido (incluye montos, 202609210001).
--   4. historial_pedidos.nota_interna (la pública sigue siendo `nota`).
--   5. email_eventos: registro de cada correo (enviado / error) + candado anti-duplicados.
--   6. Aviso de bienvenida cuando el cliente verifica su correo (cuentas_cliente.verificada_at).
begin;

-- 1) Relación cliente ↔ cuenta ---------------------------------------------------------
alter table public.clientes add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists clientes_user_id_idx on public.clientes (user_id) where user_id is not null;
alter table public.solicitudes add column if not exists user_id uuid references auth.users(id) on delete set null;

-- El checkout de la tienda llama crear_solicitud_* con el JWT del cliente cuando tiene sesión:
-- guardamos quién compró sin tocar esas funciones.
create or replace function public.solicitud_marcar_cuenta()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.user_id is null and auth.uid() is not null and not public.usuario_activo() then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists solicitudes_marcar_cuenta on public.solicitudes;
create trigger solicitudes_marcar_cuenta before insert on public.solicitudes
  for each row execute function public.solicitud_marcar_cuenta();

-- Al confirmar el encargo (solicitud → pedido), el cliente del pedido queda asociado a la
-- cuenta que compró (si todavía no tenía una).
create or replace function public.solicitud_asociar_cliente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.user_id is not null and new.pedido_id is not null and new.pedido_id is distinct from old.pedido_id then
    update public.clientes c set user_id = new.user_id
      from public.pedidos p
     where p.id = new.pedido_id and c.id = p.cliente_id and c.user_id is null;
  end if;
  return new;
end;
$$;
drop trigger if exists solicitudes_asociar_cliente on public.solicitudes;
create trigger solicitudes_asociar_cliente after update of pedido_id on public.solicitudes
  for each row execute function public.solicitud_asociar_cliente();

-- ¿El pedido es de la cuenta actual? (reemplaza la versión que aceptaba "agregar por código")
create or replace function public.pedido_de_cuenta(p_pedido_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.pedidos p
      join public.clientes c on c.id = p.cliente_id
     where p.id = p_pedido_id and (
       c.user_id = auth.uid()
       or exists (select 1 from auth.users u
                   where u.id = auth.uid() and u.email_confirmed_at is not null
                     and nullif(lower(trim(c.correo)), '') = lower(u.email))
     )
  );
$$;
-- Ya no se enlazan pedidos por código desde la cuenta.
revoke execute on function public.vincular_pedido_cliente(text) from authenticated;
delete from public.cuenta_pedidos;

-- Panel (personal): asociar / desasociar un cliente con una cuenta por su correo.
create or replace function public.asociar_cliente_cuenta(p_cliente_id uuid, p_correo text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
begin
  if not public.usuario_activo() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_correo is null or trim(p_correo) = '' then
    update public.clientes set user_id = null where id = p_cliente_id;
    return jsonb_build_object('ok', true, 'correo', null);
  end if;
  select cc.user_id into v_user from public.cuentas_cliente cc
    join auth.users u on u.id = cc.user_id
   where lower(u.email) = lower(trim(p_correo));
  if v_user is null then raise exception 'No existe una cuenta de cliente con ese correo.' using errcode = 'P0002'; end if;
  update public.clientes set user_id = v_user where id = p_cliente_id;
  return jsonb_build_object('ok', true, 'correo', lower(trim(p_correo)));
end;
$$;

create or replace function public.cuenta_de_cliente(p_cliente_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.usuario_activo() then (
    select jsonb_build_object('correo', u.email, 'verificada', u.email_confirmed_at is not null, 'nombre', cc.nombre)
      from public.clientes c join auth.users u on u.id = c.user_id
      left join public.cuentas_cliente cc on cc.user_id = c.user_id
     where c.id = p_cliente_id) end;
$$;

-- 2) Detalle del pedido para su DUEÑO ---------------------------------------------------
create or replace function public.pedido_cliente(p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_codigo text := upper(trim(p_codigo));
  v_id uuid;
  resultado jsonb;
begin
  if auth.uid() is null or v_codigo !~ '^HS[0-9]{6}$' then return null; end if;
  select id into v_id from public.pedidos where codigo = v_codigo and activo;
  if v_id is null or not public.pedido_de_cuenta(v_id) then return null; end if;

  select jsonb_build_object(
    'codigo', p.codigo,
    -- "incidencia" es interna: el cliente ve el último estado normal.
    'estado_codigo', case when p.estado = 'incidencia' then coalesce((
        select h.estado_nuevo::text from public.historial_pedidos h
         where h.pedido_id = p.id and h.estado_nuevo <> 'incidencia'
         order by h.created_at desc limit 1), 'pedido_confirmado') else p.estado::text end,
    'fecha_pedido', p.fecha_pedido, 'fecha_estimada', p.fecha_estimada, 'fecha_entrega', p.fecha_entrega,
    'ultima_actualizacion', p.updated_at, 'notas_publicas', case when p.estado = 'incidencia' then null else p.notas_publicas end,
    'envio_rapido', p.envio_rapido,
    'total', p.total, 'abono', p.abono, 'saldo', p.saldo, 'moneda', p.moneda,
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'estado_item', i.estado_item, 'producto', i.producto, 'codigo', i.codigo_producto,
        'marca', i.marca, 'talla', i.talla, 'color', i.color, 'cantidad', i.cantidad,
        'precio_unitario', i.precio_unitario, 'imagen', coalesce(i.imagen, prod.imagen)
      ) order by i.created_at)
      from public.pedido_items i
      left join public.productos prod
        on upper(trim(prod.codigo)) = upper(trim(coalesce(nullif(i.codigo_producto, ''), i.producto)))
      where i.pedido_id = p.id
    ), '[]'::jsonb),
    'historial', coalesce((
      select jsonb_agg(jsonb_build_object('estado_codigo', h.estado_nuevo, 'nota', h.nota, 'ubicacion', h.ubicacion, 'fecha', h.created_at) order by h.created_at)
      from public.historial_pedidos h
      where h.pedido_id = p.id and h.visible_cliente and h.estado_nuevo <> 'incidencia'
    ), '[]'::jsonb),
    'trayectos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tipo', t.tipo_trayecto, 'origen', t.pais_origen, 'destino', t.pais_destino,
        'transportista', tr.nombre, 'tracking', t.tracking, 'url_tracking', t.url_tracking,
        'estado', t.estado, 'ultima_ubicacion', t.ultima_ubicacion, 'fecha_estimada', t.fecha_estimada,
        'eventos', coalesce((select jsonb_agg(jsonb_build_object('descripcion', e.descripcion_publica, 'ubicacion', e.ubicacion, 'fecha', e.fecha_evento) order by e.fecha_evento)
          from public.tracking_eventos e where e.trayecto_id = t.id and e.visible_cliente and e.descripcion_publica is not null), '[]'::jsonb)
      ) order by t.orden)
      from public.trayectos t left join public.transportistas tr on tr.id = t.transportista_id
      where t.pedido_id = p.id and t.visible_cliente
    ), '[]'::jsonb),
    'fotos', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', a.tipo, 'storage_path', a.storage_path, 'orden', a.orden, 'pedido_item_id', a.pedido_item_id) order by a.tipo, a.orden)
      from public.archivos_pedido a
      where a.pedido_id = p.id and a.visible_cliente and a.tipo in ('control_calidad', 'recibido_hausline', 'empaque', 'entrega')
    ), '[]'::jsonb)
  ) into resultado
  from public.pedidos p where p.id = v_id;
  return resultado;
end;
$$;

-- Fotos del pedido (bucket privado "pedidos"): el dueño puede generar URLs firmadas.
create or replace function public.archivo_pedido_de_cuenta(p_storage_path text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.archivos_pedido a
                  where a.storage_path = p_storage_path and a.visible_cliente and public.pedido_de_cuenta(a.pedido_id));
$$;
drop policy if exists storage_pedidos_cuenta_ver on storage.objects;
create policy storage_pedidos_cuenta_ver on storage.objects for select to authenticated
  using (bucket_id = 'pedidos' and public.archivo_pedido_de_cuenta(name));

-- 3) Link público /pedido/HS###### SIN login: muestra TODO el pedido (decisión del dueño:
--    el cliente no está obligado a crear cuenta). Es la versión de 202609210001 (con montos),
--    incluida aquí por si esa migración no se aplicó. Las fotos siguen igual (sin cambios).
create or replace function public.obtener_pedido_publico(p_codigo text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo text := upper(trim(p_codigo));
  resultado jsonb;
begin
  if v_codigo !~ '^HS[0-9]{6}$' then return null; end if;

  select jsonb_build_object(
    'codigo', p.codigo,
    'estado', public.etiqueta_estado_publico(p.estado),
    'estado_codigo', p.estado,
    'fecha_pedido', p.fecha_pedido,
    'fecha_estimada', p.fecha_estimada,
    'fecha_entrega', p.fecha_entrega,
    'ultima_actualizacion', p.updated_at,
    'imagen_principal', p.imagen_principal,
    'notas_publicas', p.notas_publicas,
    -- Montos del pedido (para el resumen de pago del portal público).
    'total', p.total,
    'abono', p.abono,
    'saldo', p.saldo,
    'moneda', p.moneda,
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'estado_item', i.estado_item,
        'producto', i.producto, 'codigo', i.codigo_producto, 'marca', i.marca, 'categoria', i.categoria,
        'talla', i.talla, 'color', i.color, 'cantidad', i.cantidad,
        'imagen', coalesce(i.imagen, prod.imagen)
      ) order by i.created_at)
      from public.pedido_items i
      left join public.productos prod
        on upper(trim(prod.codigo)) = upper(trim(coalesce(nullif(i.codigo_producto, ''), i.producto)))
      where i.pedido_id = p.id
    ), '[]'::jsonb),
    'historial', coalesce((
      select jsonb_agg(jsonb_build_object(
        'estado', public.etiqueta_estado_publico(h.estado_nuevo),
        'nota', h.nota, 'ubicacion', h.ubicacion, 'fecha', h.created_at
      ) order by h.created_at)
      from public.historial_pedidos h where h.pedido_id = p.id and h.visible_cliente
    ), '[]'::jsonb),
    'trayectos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tipo', t.tipo_trayecto, 'origen', t.pais_origen, 'destino', t.pais_destino,
        'transportista', tr.nombre, 'tracking', t.tracking, 'url_tracking', t.url_tracking,
        'estado', t.estado, 'ultima_ubicacion', t.ultima_ubicacion,
        'ultimo_evento', t.ultimo_evento, 'fecha_estimada', t.fecha_estimada,
        'eventos', coalesce((select jsonb_agg(jsonb_build_object(
          'descripcion', e.descripcion_publica, 'ubicacion', e.ubicacion, 'fecha', e.fecha_evento
        ) order by e.fecha_evento) from public.tracking_eventos e
          where e.trayecto_id = t.id and e.visible_cliente and e.descripcion_publica is not null), '[]'::jsonb)
      ) order by t.orden)
      from public.trayectos t left join public.transportistas tr on tr.id = t.transportista_id
      where t.pedido_id = p.id and t.visible_cliente
    ), '[]'::jsonb)
  ) into resultado
  from public.pedidos p where p.codigo = v_codigo and p.activo;

  return resultado;
end;
$$;

-- 4) Nota interna en el historial -------------------------------------------------------
alter table public.historial_pedidos add column if not exists nota_interna text;

-- 5) Registro de correos ----------------------------------------------------------------
create table if not exists public.email_eventos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete set null,
  cliente_id uuid references public.clientes(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  codigo text,                        -- código HS del pedido (el aviso del webhook no siempre trae el id)
  tipo text not null,                 -- estado | bienvenida | reenvio | …
  estado text,                        -- estado del pedido que originó el correo
  destinatario text,
  clave text unique,                  -- candado anti-duplicados (null = sin candado)
  enviado_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists email_eventos_pedido_idx on public.email_eventos (pedido_id, created_at desc);
alter table public.email_eventos enable row level security;
drop policy if exists email_eventos_personal on public.email_eventos;
create policy email_eventos_personal on public.email_eventos for select to authenticated using (public.usuario_activo());
revoke all on public.email_eventos from anon, authenticated;
grant select on public.email_eventos to authenticated;

-- 6) Bienvenida al verificar el correo --------------------------------------------------
alter table public.cuentas_cliente add column if not exists verificada_at timestamptz;
update public.cuentas_cliente cc set verificada_at = u.email_confirmed_at
  from auth.users u where u.id = cc.user_id and cc.verificada_at is null and u.email_confirmed_at is not null;

create or replace function public.cuenta_cliente_verificada()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.cuentas_cliente set verificada_at = new.email_confirmed_at, correo = coalesce(new.email, correo)
     where user_id = new.id and verificada_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists cuenta_cliente_verificada on auth.users;
create trigger cuenta_cliente_verificada after update of email_confirmed_at on auth.users
  for each row execute function public.cuenta_cliente_verificada();

-- Webhook de bienvenida → /api/notificar-cuenta, con el MISMO secreto del aviso de estados
-- (se extrae de notificar_cambio_estado, igual que 202609080002).
do $$
declare
  v_def text;
  v_secret text;
begin
  v_def := pg_get_functiondef('public.notificar_cambio_estado'::regproc);
  v_secret := (regexp_match(v_def, 'Bearer ([^"''\s\\}]+)'))[1];
  if v_secret is null then raise exception 'No se pudo extraer NOTIFY_SECRET de notificar_cambio_estado'; end if;
  drop trigger if exists notificar_cuenta_verificada on public.cuentas_cliente;
  execute format(
    $f$create trigger notificar_cuenta_verificada
        after update of verificada_at on public.cuentas_cliente
        for each row when (old.verificada_at is null and new.verificada_at is not null)
        execute function supabase_functions.http_request(%L, 'POST', %L, '{}', '5000')$f$,
    'https://hausline-tracking.vercel.app/api/notificar-cuenta',
    '{"Content-Type":"application/json","Authorization":"Bearer ' || v_secret || '"}'
  );
end $$;

-- Permisos ------------------------------------------------------------------------------
revoke all on function public.solicitud_marcar_cuenta() from public, anon, authenticated;
revoke all on function public.solicitud_asociar_cliente() from public, anon, authenticated;
revoke all on function public.cuenta_cliente_verificada() from public, anon, authenticated;
revoke all on function public.asociar_cliente_cuenta(uuid, text) from public, anon;
revoke all on function public.cuenta_de_cliente(uuid) from public, anon;
revoke all on function public.pedido_cliente(text) from public, anon;
revoke all on function public.archivo_pedido_de_cuenta(text) from public, anon;
grant execute on function public.asociar_cliente_cuenta(uuid, text) to authenticated;
grant execute on function public.cuenta_de_cliente(uuid) to authenticated;
grant execute on function public.pedido_cliente(text) to authenticated;
grant execute on function public.archivo_pedido_de_cuenta(text) to authenticated;

commit;
