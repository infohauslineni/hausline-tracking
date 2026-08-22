-- Encargos desde la web (catálogo público) → bandeja "Encargos por confirmar".
--
-- El cliente crea una SOLICITUD desde el catálogo (sin gastar código HS y sin tocar
-- la tabla pedidos). La solicitud vive aparte, con un contador de vencimiento: si no
-- se confirma en 24 h, se marca "vencida" y deja de mostrarse. Cuando el admin
-- verifica la transferencia y la CONFIRMA, recién ahí se crea el pedido real (HS######)
-- y el cliente/ítem correspondientes. Así no quedan pedidos fantasma.
--
-- Seguridad: el catálogo es público (rol anon). Nunca puede escribir directo en las
-- tablas; solo puede llamar a la función controlada crear_solicitud_publica().

begin;

-- Estado de una solicitud.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'estado_solicitud') then
    create type public.estado_solicitud as enum ('pendiente', 'confirmada', 'descartada', 'vencida');
  end if;
end $$;

-- Un producto por solicitud (equivale al botón "Encargar este producto").
create table if not exists public.solicitudes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  cliente_nombre text not null check (char_length(trim(cliente_nombre)) between 2 and 160),
  cliente_whatsapp text not null check (cliente_whatsapp ~ '^[0-9+ ()-]{7,25}$'),
  cliente_correo text,
  cliente_ciudad text,
  cliente_direccion text,
  producto text not null check (char_length(trim(producto)) between 2 and 200),
  producto_codigo text,
  marca text,
  talla text,
  color text,
  cantidad integer not null default 1 check (cantidad between 1 and 50),
  precio_unitario numeric(12,2) not null default 0 check (precio_unitario >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  tipo_cambio numeric(12,4),
  total_nio numeric(12,2),
  comprobante_url text,
  estado public.estado_solicitud not null default 'pendiente',
  notas text,
  vence_at timestamptz not null default now() + interval '24 hours',
  pedido_id uuid references public.pedidos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists solicitudes_estado_idx on public.solicitudes (estado, created_at desc);

-- Código legible SOL-#### (con reintento por si colisiona), al estilo de generar_codigo_pedido.
create or replace function public.generar_codigo_solicitud()
returns text language plpgsql volatile set search_path = public, pg_temp as $$
declare
  candidato text;
begin
  loop
    candidato := 'SOL-' || lpad(floor(random() * 10000)::integer::text, 4, '0');
    exit when not exists (select 1 from public.solicitudes where codigo = candidato);
  end loop;
  return candidato;
end;
$$;
alter table public.solicitudes alter column codigo set default public.generar_codigo_solicitud();

-- updated_at automático (reusa el trigger genérico ya existente).
drop trigger if exists solicitudes_updated_at on public.solicitudes;
create trigger solicitudes_updated_at before update on public.solicitudes
  for each row execute function public.set_updated_at();

-- RLS: el admin (usuario activo) puede todo; nadie más toca la tabla directo.
alter table public.solicitudes enable row level security;
drop policy if exists solicitudes_admin_total on public.solicitudes;
create policy solicitudes_admin_total on public.solicitudes for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());

-- ── Crear solicitud desde el catálogo (rol anon) ────────────────────────────
-- Calcula el total y su equivalente en córdobas con el tipo de cambio guardado en
-- configuracion (clave 'moneda'). Devuelve el código SOL-#### para mostrárselo al cliente.
create or replace function public.crear_solicitud_publica(
  p_nombre text,
  p_whatsapp text,
  p_correo text default null,
  p_ciudad text default null,
  p_direccion text default null,
  p_producto text default null,
  p_producto_codigo text default null,
  p_marca text default null,
  p_talla text default null,
  p_color text default null,
  p_cantidad integer default 1,
  p_precio_unitario numeric default 0
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cant integer;
  v_precio numeric(12,2);
  v_total numeric(12,2);
  v_rate numeric(12,4);
  v_codigo text;
begin
  if p_whatsapp is null or trim(p_whatsapp) !~ '^[0-9+ ()-]{7,25}$' then
    raise exception 'WhatsApp inválido';
  end if;
  if p_nombre is null or char_length(trim(p_nombre)) < 2 then
    raise exception 'Nombre inválido';
  end if;
  if p_producto is null or char_length(trim(p_producto)) < 2 then
    raise exception 'Producto inválido';
  end if;

  v_cant := least(50, greatest(1, coalesce(p_cantidad, 1)));
  v_precio := round(greatest(0, coalesce(p_precio_unitario, 0)), 2);
  v_total := round(v_precio * v_cant, 2);
  select (valor_json->>'tipo_cambio')::numeric into v_rate
    from public.configuracion where clave = 'moneda';

  insert into public.solicitudes (
    cliente_nombre, cliente_whatsapp, cliente_correo, cliente_ciudad, cliente_direccion,
    producto, producto_codigo, marca, talla, color, cantidad, precio_unitario, total,
    tipo_cambio, total_nio
  ) values (
    trim(p_nombre), trim(p_whatsapp), nullif(trim(p_correo), ''), nullif(trim(p_ciudad), ''), nullif(trim(p_direccion), ''),
    trim(p_producto), nullif(trim(p_producto_codigo), ''), nullif(trim(p_marca), ''), nullif(trim(p_talla), ''), nullif(trim(p_color), ''),
    -- Córdobas "cerrados": redondeados HACIA ARRIBA al múltiplo de 10 (ej. 2964 → 2970).
    v_cant, v_precio, v_total, v_rate, case when v_rate is not null then ceil(v_total * v_rate / 10.0) * 10 end
  ) returning codigo into v_codigo;

  return v_codigo;
end;
$$;

-- ── Confirmar solicitud (admin) → crea el pedido real HS###### ───────────────
-- Reusa el cliente si ya existe (por WhatsApp) o lo crea. Devuelve el código HS.
create or replace function public.confirmar_solicitud(p_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.solicitudes;
  v_cliente uuid;
  v_pedido uuid;
  v_codigo text;
begin
  if not public.usuario_activo() then
    raise exception 'No autorizado';
  end if;
  select * into s from public.solicitudes where id = p_id and estado = 'pendiente' for update;
  if not found then
    raise exception 'Solicitud no encontrada o ya procesada';
  end if;

  select id into v_cliente from public.clientes where whatsapp = s.cliente_whatsapp limit 1;
  if v_cliente is null then
    insert into public.clientes (nombre, whatsapp, correo, ciudad, direccion)
    values (s.cliente_nombre, s.cliente_whatsapp, s.cliente_correo, s.cliente_ciudad, s.cliente_direccion)
    returning id into v_cliente;
  end if;

  insert into public.pedidos (cliente_id, estado, total, abono, saldo, notas_internas)
  values (v_cliente, 'pedido_confirmado', s.total, 0, s.total, 'Encargo web ' || s.codigo)
  returning id, codigo into v_pedido, v_codigo;

  insert into public.pedido_items (pedido_id, producto, marca, talla, color, cantidad, precio_unitario)
  values (v_pedido, s.producto, s.marca, s.talla, s.color, s.cantidad, s.precio_unitario);

  update public.solicitudes set estado = 'confirmada', pedido_id = v_pedido, updated_at = now()
  where id = s.id;

  return v_codigo;
end;
$$;

-- ── Vencer solicitudes viejas (lo llama el cron diario) ──────────────────────
create or replace function public.vencer_solicitudes()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  update public.solicitudes
    set estado = 'vencida', updated_at = now()
    where estado = 'pendiente' and vence_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric) from public;
grant execute on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric) to anon, authenticated;
grant execute on function public.confirmar_solicitud(uuid) to authenticated;
grant execute on function public.vencer_solicitudes() to authenticated, service_role;
grant execute on function public.generar_codigo_solicitud() to authenticated;

commit;
