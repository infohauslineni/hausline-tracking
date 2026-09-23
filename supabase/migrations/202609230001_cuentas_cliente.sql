-- Hausline Tracking · CUENTAS DE CLIENTE (panel "Mi cuenta" del cliente)
--
-- Fase 2 del portal del cliente: el cliente crea su cuenta (correo + contraseña) y ve en un
-- solo lugar sus pedidos, lista de deseos, datos personales y direcciones. Cuando el admin
-- marca un pedido "Disponible para entrega", el cliente elige la dirección, ve el costo de
-- delivery configurado y solicita el envío (queda registrado + se abre WhatsApp).
--
-- ⚠️ SEGURIDAD (lo más importante de esta migración):
-- Hasta hoy el trigger crear_perfil_nuevo_usuario creaba un perfil ACTIVO (rol operador) a
-- TODO usuario nuevo de auth, y usuario_activo() abre pedidos/clientes a cualquier perfil
-- activo. Si se habilita el registro público sin cambiar eso, un cliente vería todos los
-- pedidos. Ahora:
--   · registro con metadata tipo=cliente  → NO se crea perfil (solo cuenta_cliente).
--   · cualquier otro usuario nuevo         → perfil INACTIVO (sin acceso) salvo que venga con
--     app_metadata.staff = true (solo la llave de servicio puede ponerlo: /api/crear-usuario).
--   · los perfiles que ya existen no se tocan.
-- El endpoint /api/crear-usuario además deja activo al empleado que crea el admin.

begin;

-- 1) Cuentas de cliente ------------------------------------------------------------------
create table if not exists public.cuentas_cliente (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '' check (char_length(nombre) <= 160),
  telefono text check (telefono is null or telefono ~ '^[0-9+ ()-]{7,25}$'),
  correo text not null default '',
  avatar_path text,
  idioma text not null default 'es' check (idioma in ('es','en')),
  moneda text not null default 'USD' check (moneda in ('USD','NIO')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cuentas_cliente enable row level security;
drop policy if exists cuentas_cliente_propia on public.cuentas_cliente;
create policy cuentas_cliente_propia on public.cuentas_cliente for select to authenticated
  using (user_id = auth.uid() or public.usuario_activo());
drop policy if exists cuentas_cliente_editar on public.cuentas_cliente;
create policy cuentas_cliente_editar on public.cuentas_cliente for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.cuentas_cliente from anon, authenticated;
grant select on public.cuentas_cliente to authenticated;
-- El correo lo maneja auth (no se edita aquí); la fila la crea el trigger/RPC.
grant update (nombre, telefono, avatar_path, idioma, moneda, updated_at) on public.cuentas_cliente to authenticated;

-- 2) Trigger de usuarios nuevos: staff solo si lo dice el servidor ----------------------
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'tipo', '') = 'cliente' then
    insert into public.cuentas_cliente (user_id, nombre, correo, telefono)
    values (
      new.id,
      left(coalesce(new.raw_user_meta_data ->> 'nombre', ''), 160),
      coalesce(new.email, ''),
      nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefono', ''), '[^0-9+ ()-]', '', 'g'), '')
    )
    on conflict (user_id) do nothing;
    return new;
  end if;
  -- Personal del panel: nace SIN acceso salvo que el servidor (llave de servicio) lo marque.
  insert into public.perfiles (id, nombre, correo, activo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_app_meta_data ->> 'staff', '') = 'true'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- registrar_uso_cupon era security definer sin candado: una cuenta de cliente podría gastar
-- usos de un cupón. Solo el personal (o el servidor, sin auth.uid()) puede llamarla.
create or replace function public.registrar_uso_cupon(p_cupon_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.usuario_activo() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_cupon_id is null then return; end if;
  update public.cupones
     set usos_confirmados = usos_confirmados + 1,
         activo = case when usos_max is not null and usos_confirmados + 1 >= usos_max then false else activo end
   where id = p_cupon_id;
end;
$$;

-- 3) Direcciones -------------------------------------------------------------------------
create table if not exists public.direcciones_cliente (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null check (char_length(trim(nombre)) between 1 and 60),
  direccion text not null check (char_length(trim(direccion)) between 3 and 300),
  referencia text check (referencia is null or char_length(referencia) <= 300),
  ciudad text not null check (char_length(trim(ciudad)) between 1 and 100),
  departamento text check (departamento is null or char_length(departamento) <= 100),
  pais text not null default 'Nicaragua' check (char_length(trim(pais)) between 2 and 80),
  codigo_postal text check (codigo_postal is null or char_length(codigo_postal) <= 20),
  tipo text not null default 'residencial' check (tipo in ('residencial','trabajo','otro')),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  predeterminada boolean not null default false,
  -- Costo de delivery fijado por el ADMIN para esta dirección (tiene prioridad sobre la tarifa
  -- de la zona). El cliente no lo puede escribir (sin grant de columna).
  costo_delivery numeric(12,2) check (costo_delivery is null or costo_delivery >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists direcciones_cliente_user_idx on public.direcciones_cliente (user_id, predeterminada desc, created_at);

alter table public.direcciones_cliente enable row level security;
drop policy if exists direcciones_propias on public.direcciones_cliente;
create policy direcciones_propias on public.direcciones_cliente for all to authenticated
  using (user_id = auth.uid() or public.usuario_activo())
  with check (user_id = auth.uid() or public.usuario_activo());
revoke all on public.direcciones_cliente from anon, authenticated;
grant select, delete on public.direcciones_cliente to authenticated;
grant insert (nombre, direccion, referencia, ciudad, departamento, pais, codigo_postal, tipo, lat, lng, predeterminada)
  on public.direcciones_cliente to authenticated;
grant update (nombre, direccion, referencia, ciudad, departamento, pais, codigo_postal, tipo, lat, lng, predeterminada, costo_delivery, updated_at)
  on public.direcciones_cliente to authenticated;

-- El cliente no puede tocar costo_delivery (el grant de columna incluye costo_delivery solo
-- para que el ADMIN lo edite desde el panel): este trigger lo revierte si no es personal.
create or replace function public.direcciones_cliente_guardar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_total integer;
begin
  if not public.usuario_activo() then
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
      new.costo_delivery := null;
      select count(*) into v_total from public.direcciones_cliente where user_id = new.user_id;
      if v_total >= 10 then
        raise exception 'Podés guardar hasta 10 direcciones.' using errcode = 'P0001';
      end if;
      if v_total = 0 then new.predeterminada := true; end if;
    else
      new.user_id := old.user_id;
      new.costo_delivery := old.costo_delivery;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists direcciones_cliente_guardar on public.direcciones_cliente;
create trigger direcciones_cliente_guardar before insert or update on public.direcciones_cliente
  for each row execute function public.direcciones_cliente_guardar();

-- Una sola predeterminada por cliente; si se borra la predeterminada, pasa a la más reciente.
create or replace function public.direcciones_cliente_unica_predeterminada()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.predeterminada then
      update public.direcciones_cliente set predeterminada = true
       where id = (select id from public.direcciones_cliente where user_id = old.user_id order by created_at desc limit 1);
    end if;
    return old;
  end if;
  if new.predeterminada then
    update public.direcciones_cliente set predeterminada = false
     where user_id = new.user_id and id <> new.id and predeterminada;
  end if;
  return new;
end;
$$;
drop trigger if exists direcciones_cliente_predeterminada on public.direcciones_cliente;
create trigger direcciones_cliente_predeterminada after insert or update of predeterminada or delete on public.direcciones_cliente
  for each row execute function public.direcciones_cliente_unica_predeterminada();

-- 4) Tarifas de delivery por zona (departamento de Nicaragua) --------------------------
create table if not exists public.tarifas_delivery (
  zona text primary key check (char_length(trim(zona)) between 2 and 100),
  costo numeric(12,2) not null check (costo >= 0),
  moneda text not null default 'USD' check (moneda in ('USD','NIO')),
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.tarifas_delivery enable row level security;
drop policy if exists tarifas_delivery_leer on public.tarifas_delivery;
create policy tarifas_delivery_leer on public.tarifas_delivery for select to anon, authenticated using (activo or public.usuario_activo());
drop policy if exists tarifas_delivery_admin on public.tarifas_delivery;
create policy tarifas_delivery_admin on public.tarifas_delivery for all to authenticated
  using (public.usuario_admin()) with check (public.usuario_admin());
grant select on public.tarifas_delivery to anon, authenticated;
grant insert, update, delete on public.tarifas_delivery to authenticated;
-- Tarifa inicial de Managua (la del diseño). El dueño la ajusta en Configuración → Delivery.
insert into public.tarifas_delivery (zona, costo, moneda) values ('Managua', 8, 'USD') on conflict (zona) do nothing;

-- 5) Lista de deseos -------------------------------------------------------------------
create table if not exists public.favoritos_cliente (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  codigo text not null check (char_length(trim(codigo)) between 1 and 40),
  nombre text not null check (char_length(trim(nombre)) between 1 and 200),
  marca text check (marca is null or char_length(marca) <= 80),
  precio numeric(12,2) check (precio is null or precio >= 0),
  imagen text check (imagen is null or char_length(imagen) <= 600),
  created_at timestamptz not null default now(),
  primary key (user_id, codigo)
);
alter table public.favoritos_cliente enable row level security;
drop policy if exists favoritos_propios on public.favoritos_cliente;
create policy favoritos_propios on public.favoritos_cliente for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.favoritos_cliente from anon, authenticated;
grant select, delete on public.favoritos_cliente to authenticated;
grant insert (codigo, nombre, marca, precio, imagen) on public.favoritos_cliente to authenticated;
drop policy if exists favoritos_personal on public.favoritos_cliente;
create policy favoritos_personal on public.favoritos_cliente for select to authenticated using (public.usuario_activo());

-- 6) Pedidos agregados por código a la cuenta -----------------------------------------
-- El código HS###### ya es la llave del seguimiento público, así que agregarlo a la cuenta
-- no abre nada nuevo. Además se enlazan solos los pedidos cuyo cliente tiene el mismo
-- correo VERIFICADO que la cuenta.
create table if not exists public.cuenta_pedidos (
  user_id uuid not null references auth.users(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, pedido_id)
);
alter table public.cuenta_pedidos enable row level security;
drop policy if exists cuenta_pedidos_personal on public.cuenta_pedidos;
create policy cuenta_pedidos_personal on public.cuenta_pedidos for select to authenticated using (public.usuario_activo());
revoke all on public.cuenta_pedidos from anon, authenticated;
grant select on public.cuenta_pedidos to authenticated;

-- 7) Solicitud de entrega (desde el panel del cliente) -----------------------------------
alter table public.pedidos
  add column if not exists entrega_solicitada_at timestamptz,
  add column if not exists entrega_direccion jsonb,
  add column if not exists entrega_costo numeric(12,2);

-- ¿El usuario actual puede ver este pedido desde su cuenta?
create or replace function public.pedido_de_cuenta(p_pedido_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    exists (select 1 from public.cuenta_pedidos cp where cp.user_id = auth.uid() and cp.pedido_id = p_pedido_id)
    or exists (
      select 1 from public.pedidos p
        join public.clientes c on c.id = p.cliente_id
        join auth.users u on u.id = auth.uid()
       where p.id = p_pedido_id and u.email_confirmed_at is not null
         and nullif(lower(trim(c.correo)), '') = lower(u.email)
    )
  );
$$;

-- Asegura la fila de la cuenta (por si el usuario entró con otro método o existía antes).
create or replace function public.mi_cuenta_cliente()
returns public.cuentas_cliente language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.cuentas_cliente;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  insert into public.cuentas_cliente (user_id, nombre, correo)
  select u.id, left(coalesce(u.raw_user_meta_data ->> 'nombre', ''), 160), coalesce(u.email, '')
    from auth.users u where u.id = auth.uid()
  on conflict (user_id) do update set correo = excluded.correo;
  select * into v_row from public.cuentas_cliente where user_id = auth.uid();
  return v_row;
end;
$$;

-- Lista de pedidos de la cuenta. "incidencia" es interna: se muestra el último estado normal.
create or replace function public.mis_pedidos_cliente()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(fila order by (fila ->> 'fecha_pedido') desc, fila ->> 'codigo' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'codigo', p.codigo,
      'estado_codigo', case when p.estado = 'incidencia' then coalesce((
          select h.estado_nuevo::text from public.historial_pedidos h
           where h.pedido_id = p.id and h.estado_nuevo not in ('incidencia')
           order by h.created_at desc limit 1), 'pedido_confirmado') else p.estado::text end,
      'fecha_pedido', p.fecha_pedido,
      'fecha_estimada', p.fecha_estimada,
      'total', p.total, 'saldo', p.saldo, 'moneda', p.moneda,
      'entrega_solicitada_at', p.entrega_solicitada_at,
      'items', (select count(*) from public.pedido_items i where i.pedido_id = p.id),
      'producto', i1.producto, 'marca', i1.marca, 'talla', i1.talla, 'color', i1.color,
      'imagen', coalesce(i1.imagen, p.imagen_principal)
    ) as fila
    from public.pedidos p
    left join lateral (
      select i.producto, i.marca, i.talla, i.color, i.imagen from public.pedido_items i
       where i.pedido_id = p.id order by i.created_at limit 1
    ) i1 on true
    where p.activo and public.pedido_de_cuenta(p.id)
  ) t;
$$;

create or replace function public.vincular_pedido_cliente(p_codigo text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  select id into v_id from public.pedidos where codigo = upper(trim(p_codigo)) and activo;
  if v_id is null then return false; end if;
  insert into public.cuenta_pedidos (user_id, pedido_id) values (auth.uid(), v_id) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.desvincular_pedido_cliente(p_codigo text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.cuenta_pedidos cp using public.pedidos p
   where cp.pedido_id = p.id and cp.user_id = auth.uid() and p.codigo = upper(trim(p_codigo));
$$;

-- Datos de entrega del pedido para la cuenta (lo que el cliente ya solicitó).
create or replace function public.entrega_pedido_cliente(p_codigo text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('solicitada_at', p.entrega_solicitada_at, 'direccion', p.entrega_direccion, 'costo', p.entrega_costo)
    from public.pedidos p
   where p.codigo = upper(trim(p_codigo)) and public.pedido_de_cuenta(p.id);
$$;

-- El cliente solicita el envío de un pedido "Disponible para entrega" a una de SUS direcciones.
-- Guarda la dirección (foto fija) y el costo de delivery vigente, deja una alerta al panel y
-- una nota en el historial (no visible al cliente). El WhatsApp lo abre el navegador.
create or replace function public.solicitar_entrega_pedido(p_codigo text, p_direccion_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pedido public.pedidos;
  v_dir public.direcciones_cliente;
  v_costo numeric(12,2);
  v_snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  select * into v_pedido from public.pedidos where codigo = upper(trim(p_codigo)) and activo;
  if v_pedido.id is null or not public.pedido_de_cuenta(v_pedido.id) then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if v_pedido.estado not in ('disponible_entrega', 'pagado') then
    raise exception 'Este pedido todavía no está disponible para entrega.' using errcode = 'P0001';
  end if;
  select * into v_dir from public.direcciones_cliente where id = p_direccion_id and user_id = auth.uid();
  if v_dir.id is null then raise exception 'Dirección no encontrada' using errcode = 'P0002'; end if;

  v_costo := coalesce(v_dir.costo_delivery, (
    select t.costo from public.tarifas_delivery t
     where t.activo and lower(t.zona) = lower(coalesce(nullif(v_dir.departamento, ''), v_dir.ciudad))
       and lower(v_dir.pais) = 'nicaragua'));
  v_snapshot := jsonb_build_object(
    'id', v_dir.id, 'nombre', v_dir.nombre, 'direccion', v_dir.direccion, 'referencia', v_dir.referencia,
    'ciudad', v_dir.ciudad, 'departamento', v_dir.departamento, 'pais', v_dir.pais,
    'codigo_postal', v_dir.codigo_postal, 'lat', v_dir.lat, 'lng', v_dir.lng);

  update public.pedidos
     set entrega_solicitada_at = now(), entrega_direccion = v_snapshot, entrega_costo = v_costo
   where id = v_pedido.id;

  insert into public.historial_pedidos (pedido_id, estado_anterior, estado_nuevo, nota, visible_cliente, usuario_id)
  values (v_pedido.id, v_pedido.estado, v_pedido.estado,
          'El cliente solicitó el envío a "' || v_dir.nombre || '": ' || v_dir.direccion || ', ' || v_dir.ciudad
          || coalesce(' · Delivery US$' || v_costo::text, ' · Delivery a cotizar'), false, null);

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  values (v_pedido.id, 'entrega_solicitada', 'Cliente solicitó envío · ' || v_pedido.codigo,
          v_dir.direccion || ', ' || v_dir.ciudad || coalesce(' (' || v_dir.departamento || ')', ''), 'alta');

  return jsonb_build_object('solicitada_at', now(), 'direccion', v_snapshot, 'costo', v_costo);
end;
$$;

-- 8) Fotos de perfil (bucket público; cada cliente escribe solo en su carpeta) --------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists avatares_leer on storage.objects;
create policy avatares_leer on storage.objects for select to public using (bucket_id = 'avatares');
drop policy if exists avatares_subir on storage.objects;
create policy avatares_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatares_actualizar on storage.objects;
create policy avatares_actualizar on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatares_borrar on storage.objects;
create policy avatares_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

-- Permisos de las funciones -------------------------------------------------------------
revoke all on function public.pedido_de_cuenta(uuid) from public, anon;
revoke all on function public.mi_cuenta_cliente() from public, anon;
revoke all on function public.mis_pedidos_cliente() from public, anon;
revoke all on function public.vincular_pedido_cliente(text) from public, anon;
revoke all on function public.desvincular_pedido_cliente(text) from public, anon;
revoke all on function public.entrega_pedido_cliente(text) from public, anon;
revoke all on function public.solicitar_entrega_pedido(text, uuid) from public, anon;
revoke all on function public.direcciones_cliente_guardar() from public, anon, authenticated;
revoke all on function public.direcciones_cliente_unica_predeterminada() from public, anon, authenticated;
grant execute on function public.pedido_de_cuenta(uuid) to authenticated;
grant execute on function public.mi_cuenta_cliente() to authenticated;
grant execute on function public.mis_pedidos_cliente() to authenticated;
grant execute on function public.vincular_pedido_cliente(text) to authenticated;
grant execute on function public.desvincular_pedido_cliente(text) to authenticated;
grant execute on function public.entrega_pedido_cliente(text) to authenticated;
grant execute on function public.solicitar_entrega_pedido(text, uuid) to authenticated;

commit;
