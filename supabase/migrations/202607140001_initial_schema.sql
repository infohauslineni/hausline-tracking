-- Hausline Tracking · Etapa 2
-- Ejecutar desde Supabase CLI o el SQL Editor en un proyecto nuevo.

begin;

create extension if not exists pgcrypto;

create type public.rol_usuario as enum ('admin', 'operador');
create type public.estado_pedido as enum (
  'pedido_confirmado', 'en_preparacion', 'control_calidad', 'despachado',
  'transito_internacional', 'recibido_estados_unidos', 'transito_nicaragua',
  'llego_nicaragua', 'disponible_entrega', 'entregado', 'cancelado', 'incidencia'
);
create type public.estado_trayecto as enum (
  'pendiente', 'etiqueta_creada', 'en_transito', 'aduana', 'entrega_fallida',
  'entregado', 'cancelado', 'incidencia'
);
create type public.prioridad_alerta as enum ('baja', 'media', 'alta', 'critica');
create type public.tipo_integracion as enum ('manual', 'aftership', 'ship24', 'track17');
create type public.tipo_archivo as enum ('producto', 'control_calidad', 'comprobante', 'entrega');

create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '',
  correo text not null,
  rol public.rol_usuario not null default 'operador',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(trim(nombre)) between 2 and 160),
  whatsapp text not null check (whatsapp ~ '^[0-9+ ()-]{7,25}$'),
  correo text,
  departamento text,
  ciudad text,
  direccion text,
  referencia text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^HS[0-9]{6}$'),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  estado public.estado_pedido not null default 'pedido_confirmado',
  fecha_pedido date not null default current_date,
  fecha_estimada date,
  fecha_entrega timestamptz,
  total numeric(12,2) not null default 0 check (total >= 0),
  abono numeric(12,2) not null default 0 check (abono >= 0),
  saldo numeric(12,2) not null default 0,
  imagen_principal text,
  notas_internas text,
  notas_publicas text,
  activo boolean not null default true,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fecha_estimada is null or fecha_estimada >= fecha_pedido),
  check (saldo = total - abono)
);

create table public.pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  producto text not null check (char_length(trim(producto)) between 2 and 200),
  marca text,
  categoria text,
  talla text,
  color text,
  cantidad integer not null default 1 check (cantidad > 0),
  precio_unitario numeric(12,2) not null default 0 check (precio_unitario >= 0),
  subtotal numeric(12,2) generated always as (cantidad * precio_unitario) stored,
  imagen text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transportistas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  codigo text unique,
  logo text,
  url_tracking text,
  tipo_integracion public.tipo_integracion not null default 'manual',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trayectos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  transportista_id uuid references public.transportistas(id) on delete set null,
  tipo_trayecto text not null,
  pais_origen text,
  pais_destino text,
  tracking text,
  url_tracking text,
  estado public.estado_trayecto not null default 'pendiente',
  ultima_ubicacion text,
  ultimo_evento text,
  fecha_envio timestamptz,
  fecha_estimada timestamptz,
  fecha_entrega timestamptz,
  peso numeric(10,3) check (peso is null or peso >= 0),
  costo_envio numeric(12,2) check (costo_envio is null or costo_envio >= 0),
  numero_paquete text,
  notas_internas text,
  visible_cliente boolean not null default true,
  orden smallint not null default 1 check (orden > 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pedido_id, orden)
);

create table public.tracking_eventos (
  id uuid primary key default gen_random_uuid(),
  trayecto_id uuid not null references public.trayectos(id) on delete cascade,
  codigo_evento text,
  estado_original text,
  estado_normalizado public.estado_trayecto,
  descripcion_original text,
  descripcion_publica text,
  ubicacion text,
  fecha_evento timestamptz not null,
  visible_cliente boolean not null default true,
  fuente text not null default 'manual' check (fuente in ('manual', 'aftership', 'ship24', 'track17', 'webhook')),
  data_original_json jsonb,
  created_at timestamptz not null default now()
);

create table public.historial_pedidos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  estado_anterior public.estado_pedido,
  estado_nuevo public.estado_pedido not null,
  nota text,
  ubicacion text,
  visible_cliente boolean not null default true,
  usuario_id uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.archivos_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  tipo public.tipo_archivo not null,
  storage_path text not null unique,
  nombre text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  tamano_bytes bigint not null check (tamano_bytes > 0 and tamano_bytes <= 10485760),
  orden smallint not null default 1 check (orden > 0),
  es_principal boolean not null default false,
  visible_cliente boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.alertas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  trayecto_id uuid references public.trayectos(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  descripcion text,
  prioridad public.prioridad_alerta not null default 'media',
  resuelta boolean not null default false,
  fecha_resuelta timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((resuelta and fecha_resuelta is not null) or (not resuelta))
);

create table public.configuracion (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  valor_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.perfiles(id) on delete set null default auth.uid()
);

create index clientes_nombre_idx on public.clientes using btree (lower(nombre));
create index clientes_whatsapp_idx on public.clientes (whatsapp);
create index pedidos_cliente_id_idx on public.pedidos (cliente_id);
create index pedidos_estado_idx on public.pedidos (estado);
create index pedidos_updated_at_idx on public.pedidos (updated_at desc);
create index pedidos_fecha_estimada_idx on public.pedidos (fecha_estimada) where activo;
create index pedido_items_pedido_id_idx on public.pedido_items (pedido_id);
create index trayectos_pedido_id_idx on public.trayectos (pedido_id);
create index trayectos_tracking_idx on public.trayectos (tracking) where tracking is not null;
create index trayectos_estado_idx on public.trayectos (estado);
create index tracking_eventos_trayecto_fecha_idx on public.tracking_eventos (trayecto_id, fecha_evento desc);
create index historial_pedidos_pedido_fecha_idx on public.historial_pedidos (pedido_id, created_at desc);
create index archivos_pedido_pedido_tipo_idx on public.archivos_pedido (pedido_id, tipo, orden);
create index alertas_pendientes_idx on public.alertas (prioridad, created_at desc) where not resuelta;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger perfiles_updated_at before update on public.perfiles for each row execute function public.set_updated_at();
create trigger clientes_updated_at before update on public.clientes for each row execute function public.set_updated_at();
create trigger pedidos_updated_at before update on public.pedidos for each row execute function public.set_updated_at();
create trigger pedido_items_updated_at before update on public.pedido_items for each row execute function public.set_updated_at();
create trigger transportistas_updated_at before update on public.transportistas for each row execute function public.set_updated_at();
create trigger trayectos_updated_at before update on public.trayectos for each row execute function public.set_updated_at();
create trigger alertas_updated_at before update on public.alertas for each row execute function public.set_updated_at();
create trigger configuracion_updated_at before update on public.configuracion for each row execute function public.set_updated_at();

create or replace function public.generar_codigo_pedido()
returns text language plpgsql volatile set search_path = public, pg_temp as $$
declare
  candidato text;
begin
  loop
    candidato := 'HS' || lpad(floor(random() * 1000000)::integer::text, 6, '0');
    exit when not exists (select 1 from public.pedidos where codigo = candidato);
  end loop;
  return candidato;
end;
$$;

alter table public.pedidos alter column codigo set default public.generar_codigo_pedido();

create or replace function public.recalcular_totales_pedido(p_pedido_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.pedidos p
  set total = coalesce((select sum(i.subtotal) from public.pedido_items i where i.pedido_id = p_pedido_id), 0),
      saldo = coalesce((select sum(i.subtotal) from public.pedido_items i where i.pedido_id = p_pedido_id), 0) - p.abono
  where p.id = p_pedido_id;
$$;

create or replace function public.actualizar_totales_desde_item()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.recalcular_totales_pedido(coalesce(new.pedido_id, old.pedido_id));
  return coalesce(new, old);
end;
$$;

create trigger pedido_items_recalcular_totales
after insert or update or delete on public.pedido_items
for each row execute function public.actualizar_totales_desde_item();

create or replace function public.sincronizar_saldo()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.saldo := new.total - new.abono;
  return new;
end;
$$;

create trigger pedidos_sincronizar_saldo before insert or update of total, abono on public.pedidos
for each row execute function public.sincronizar_saldo();

create or replace function public.registrar_historial_estado()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or old.estado is distinct from new.estado then
    insert into public.historial_pedidos (pedido_id, estado_anterior, estado_nuevo, usuario_id)
    values (new.id, case when tg_op = 'INSERT' then null else old.estado end, new.estado, auth.uid());
  end if;
  return new;
end;
$$;

create trigger pedidos_historial_estado_insert after insert on public.pedidos
for each row execute function public.registrar_historial_estado();
create trigger pedidos_historial_estado_update after update of estado on public.pedidos
for each row execute function public.registrar_historial_estado();

create or replace function public.crear_perfil_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.perfiles (id, nombre, correo)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nombre', ''), coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_usuario_creado
after insert on auth.users for each row execute function public.crear_perfil_nuevo_usuario();

insert into public.perfiles (id, nombre, correo)
select id, coalesce(raw_user_meta_data ->> 'nombre', ''), coalesce(email, '') from auth.users
on conflict (id) do nothing;

create or replace function public.usuario_activo()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.activo);
$$;

create or replace function public.usuario_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.activo and p.rol = 'admin');
$$;

revoke all on function public.usuario_activo() from public;
revoke all on function public.usuario_admin() from public;
grant execute on function public.usuario_activo() to authenticated;
grant execute on function public.usuario_admin() to authenticated;

alter table public.perfiles enable row level security;
alter table public.clientes enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;
alter table public.transportistas enable row level security;
alter table public.trayectos enable row level security;
alter table public.tracking_eventos enable row level security;
alter table public.historial_pedidos enable row level security;
alter table public.archivos_pedido enable row level security;
alter table public.alertas enable row level security;
alter table public.configuracion enable row level security;

create policy perfiles_leer on public.perfiles for select to authenticated
using (id = auth.uid() or public.usuario_admin());
create policy perfiles_actualizar_admin on public.perfiles for update to authenticated
using (public.usuario_admin()) with check (public.usuario_admin());

create policy clientes_admin_total on public.clientes for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy pedidos_admin_total on public.pedidos for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy pedido_items_admin_total on public.pedido_items for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy transportistas_admin_total on public.transportistas for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy trayectos_admin_total on public.trayectos for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy tracking_eventos_admin_total on public.tracking_eventos for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy historial_pedidos_admin_total on public.historial_pedidos for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy archivos_pedido_admin_total on public.archivos_pedido for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy alertas_admin_total on public.alertas for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
create policy configuracion_admin_total on public.configuracion for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

create or replace function public.etiqueta_estado_publico(p_estado public.estado_pedido)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_estado
    when 'pedido_confirmado' then 'Pedido confirmado'
    when 'en_preparacion' then 'En preparación'
    when 'control_calidad' then 'Control de calidad'
    when 'despachado' then 'Despachado'
    when 'transito_internacional' then 'En tránsito internacional'
    when 'recibido_estados_unidos' then 'Recibido en Estados Unidos'
    when 'transito_nicaragua' then 'En tránsito hacia Nicaragua'
    when 'llego_nicaragua' then 'Llegó a Nicaragua'
    when 'disponible_entrega' then 'Disponible para entrega'
    when 'entregado' then 'Entregado'
    when 'cancelado' then 'Cancelado'
    else 'Requiere atención'
  end;
$$;

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
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'producto', i.producto, 'marca', i.marca, 'categoria', i.categoria,
        'talla', i.talla, 'color', i.color, 'cantidad', i.cantidad, 'imagen', i.imagen
      ) order by i.created_at)
      from public.pedido_items i where i.pedido_id = p.id
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

revoke all on function public.obtener_pedido_publico(text) from public;
grant execute on function public.obtener_pedido_publico(text) to anon, authenticated;

create unique index alertas_abiertas_unicas_idx
on public.alertas (pedido_id, trayecto_id, tipo) nulls not distinct where not resuelta;

create or replace function public.detectar_tracking_duplicado()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.tracking is not null and trim(new.tracking) <> '' and exists (
    select 1 from public.trayectos t
    where lower(trim(t.tracking)) = lower(trim(new.tracking)) and t.id <> new.id and t.activo
  ) and not exists (
    select 1 from public.alertas a
    where a.pedido_id = new.pedido_id and a.trayecto_id = new.id
      and a.tipo = 'tracking_duplicado' and not a.resuelta
  ) then
    insert into public.alertas (pedido_id, trayecto_id, tipo, titulo, descripcion, prioridad)
    values (new.pedido_id, new.id, 'tracking_duplicado', 'Tracking duplicado',
      'El número de tracking también está registrado en otro trayecto.', 'alta');
  end if;
  return new;
end;
$$;

create trigger trayectos_tracking_duplicado_insert
after insert on public.trayectos for each row execute function public.detectar_tracking_duplicado();
create trigger trayectos_tracking_duplicado_update
after update of tracking on public.trayectos for each row execute function public.detectar_tracking_duplicado();

create or replace function public.generar_alertas_operativas()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  creadas integer := 0;
  dias_sin_actualizacion integer := 7;
begin
  if not public.usuario_activo() then raise exception 'No autorizado'; end if;

  select coalesce((valor_json ->> 'dias_sin_actualizacion')::integer, 7)
  into dias_sin_actualizacion from public.configuracion where clave = 'alertas';
  dias_sin_actualizacion := coalesce(dias_sin_actualizacion, 7);

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  select p.id, 'sin_tracking', 'Pedido sin tracking', 'El pedido no tiene trayectos activos.', 'media'
  from public.pedidos p where p.activo and p.estado not in ('pedido_confirmado', 'en_preparacion', 'control_calidad', 'cancelado', 'entregado')
    and not exists (select 1 from public.trayectos t where t.pedido_id = p.id and t.activo)
    and not exists (select 1 from public.alertas a where a.pedido_id = p.id and a.tipo = 'sin_tracking' and not a.resuelta);
  get diagnostics creadas = row_count;

  insert into public.alertas (pedido_id, tipo, titulo, descripcion, prioridad)
  select p.id, 'pedido_atrasado', 'Pedido atrasado', 'La fecha estimada ya fue superada.', 'alta'
  from public.pedidos p where p.activo and p.fecha_estimada < current_date
    and p.estado not in ('entregado', 'cancelado')
    and not exists (select 1 from public.alertas a where a.pedido_id = p.id and a.tipo = 'pedido_atrasado' and not a.resuelta);
  get diagnostics dias_sin_actualizacion = row_count;
  creadas := creadas + dias_sin_actualizacion;

  insert into public.alertas (pedido_id, trayecto_id, tipo, titulo, descripcion, prioridad)
  select t.pedido_id, t.id, 'sin_actualizacion', 'Tracking sin actualización',
    'El trayecto no recibe eventos recientes.', 'media'
  from public.trayectos t where t.activo and t.estado not in ('entregado', 'cancelado')
    and coalesce((select max(e.fecha_evento) from public.tracking_eventos e where e.trayecto_id = t.id), t.updated_at)
      < now() - make_interval(days => coalesce((select (valor_json ->> 'dias_sin_actualizacion')::integer from public.configuracion where clave = 'alertas'), 7))
    and not exists (select 1 from public.alertas a where a.trayecto_id = t.id and a.tipo = 'sin_actualizacion' and not a.resuelta);
  get diagnostics dias_sin_actualizacion = row_count;
  return creadas + dias_sin_actualizacion;
end;
$$;

create or replace function public.sugerir_estado_pedido(p_pedido_id uuid)
returns public.estado_pedido language sql stable set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from public.trayectos where pedido_id = p_pedido_id and activo and lower(tipo_trayecto) like '%estados unidos%nicaragua%' and estado in ('etiqueta_creada','en_transito')) then 'transito_nicaragua'::public.estado_pedido
    when exists (select 1 from public.trayectos where pedido_id = p_pedido_id and activo and pais_destino ilike '%nicaragua%' and estado = 'entregado') then 'llego_nicaragua'::public.estado_pedido
    when exists (select 1 from public.trayectos where pedido_id = p_pedido_id and activo and pais_destino ilike '%estados unidos%' and estado = 'entregado') then 'recibido_estados_unidos'::public.estado_pedido
    else null
  end;
$$;

create or replace function public.cerrar_trayectos_al_entregar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.estado = 'entregado' and old.estado is distinct from new.estado then
    update public.trayectos set estado = 'entregado', activo = false,
      fecha_entrega = coalesce(fecha_entrega, now())
    where pedido_id = new.id and activo;
    new.fecha_entrega := coalesce(new.fecha_entrega, now());
  end if;
  return new;
end;
$$;

create trigger pedidos_cerrar_trayectos
before update of estado on public.pedidos for each row execute function public.cerrar_trayectos_al_entregar();

insert into public.transportistas (nombre, codigo, url_tracking) values
  ('FedEx', 'FEDEX', 'https://www.fedex.com/fedextrack/?trknbr={tracking}'),
  ('DHL', 'DHL', 'https://www.dhl.com/global-en/home/tracking.html?tracking-id={tracking}'),
  ('UPS', 'UPS', 'https://www.ups.com/track?tracknum={tracking}'),
  ('USPS', 'USPS', 'https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}'),
  ('China Post', 'CHINA_POST', null), ('Cainiao', 'CAINIAO', null),
  ('YunExpress', 'YUNEXPRESS', null), ('UNI Express', 'UNI', null),
  ('17TRACK', '17TRACK', 'https://www.17track.net/en?nums={tracking}'),
  ('Agencia de casillero', 'CASILLERO', null), ('Transporte aéreo', 'AEREO', null),
  ('Transporte marítimo', 'MARITIMO', null), ('Otra', 'OTRA', null)
on conflict (nombre) do nothing;

insert into public.configuracion (clave, valor_json) values
  ('alertas', '{"dias_sin_actualizacion": 7, "dias_atraso": 1}'::jsonb),
  ('whatsapp', '{"plantilla_actualizacion": "Hola, [nombre]. Tu pedido [codigo] fue actualizado. Estado actual: [estado]."}'::jsonb)
on conflict (clave) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pedidos', 'pedidos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy storage_pedidos_leer on storage.objects for select to authenticated
using (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega)/' and public.usuario_activo());
create policy storage_pedidos_insertar on storage.objects for insert to authenticated
with check (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega)/' and public.usuario_activo());
create policy storage_pedidos_actualizar on storage.objects for update to authenticated
using (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega)/' and public.usuario_activo())
with check (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega)/' and public.usuario_activo());
create policy storage_pedidos_eliminar on storage.objects for delete to authenticated
using (bucket_id = 'pedidos' and name ~ '^pedidos/[0-9a-f-]{36}/(producto|control-calidad|comprobantes|entrega)/' and public.usuario_activo());

revoke execute on all functions in schema public from public, anon;
grant execute on function public.usuario_activo() to authenticated;
grant execute on function public.usuario_admin() to authenticated;
grant execute on function public.generar_codigo_pedido() to authenticated;
grant execute on function public.generar_alertas_operativas() to authenticated;
grant execute on function public.sugerir_estado_pedido(uuid) to authenticated;
grant execute on function public.obtener_pedido_publico(text) to anon, authenticated;

commit;
