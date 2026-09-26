-- Salud de la experiencia del cliente (Mi cuenta, checkout, seguimiento público).
--
--   1. eventos_cliente: la tienda y el seguimiento anotan SOLOS lo que le pasa al cliente
--      (errores que vio en pantalla, fallas de JavaScript, ingresos/registros ok o fallidos).
--      Así el admin se entera de un problema aunque el cliente no lo reporte.
--      · Se escribe SOLO por la RPC registrar_evento_cliente (anon/authenticated), que recorta
--        los textos, limita por visita y por día (anti-spam) y nunca guarda contraseñas.
--      · Solo el personal activo del panel puede leerla.
--      · Se borra sola a los 60 días.
--   2. cuentas_clientes_resumen(): lista de cuentas de clientes con confirmación de correo,
--      último ingreso (auth.users, que el panel no puede leer directo) y pedidos vinculados.

-- 1) Registro de eventos --------------------------------------------------------------------
create table if not exists public.eventos_cliente (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  origen text not null default 'tienda' check (origen in ('tienda', 'cuenta', 'checkout', 'seguimiento')),
  tipo text not null check (tipo in ('error', 'evento')),
  nombre text not null check (nombre ~ '^[a-z0-9_]{2,40}$'),
  pagina text,
  mensaje text,
  detalle jsonb,
  visita text,
  dispositivo text,
  user_id uuid references auth.users(id) on delete set null
);
create index if not exists eventos_cliente_fecha_idx on public.eventos_cliente (created_at desc);
create index if not exists eventos_cliente_visita_idx on public.eventos_cliente (visita, created_at desc);

alter table public.eventos_cliente enable row level security;
drop policy if exists "Personal lee eventos de clientes" on public.eventos_cliente;
create policy "Personal lee eventos de clientes" on public.eventos_cliente for select
  using (public.usuario_activo());
revoke all on public.eventos_cliente from anon, authenticated;
grant select on public.eventos_cliente to authenticated;

create or replace function public.registrar_evento_cliente(
  p_origen text, p_tipo text, p_nombre text, p_pagina text default null, p_mensaje text default null,
  p_detalle jsonb default null, p_visita text default null, p_dispositivo text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_visita text := left(nullif(trim(coalesce(p_visita, '')), ''), 40);
  v_detalle jsonb := p_detalle;
begin
  if p_tipo not in ('error', 'evento') or coalesce(p_nombre, '') !~ '^[a-z0-9_]{2,40}$' then return; end if;
  if coalesce(p_origen, '') not in ('tienda', 'cuenta', 'checkout', 'seguimiento') then return; end if;
  -- El personal del panel no cuenta como cliente (sus pruebas no ensucian el registro).
  if public.usuario_activo() then return; end if;
  -- Anti-spam: máx. 40 eventos por visita en una hora y 5000 en total por día.
  if v_visita is not null and (select count(*) from public.eventos_cliente
       where visita = v_visita and created_at > now() - interval '1 hour') >= 40 then return; end if;
  if (select count(*) from public.eventos_cliente where created_at > now() - interval '1 day') >= 5000 then return; end if;
  if v_detalle is not null and (jsonb_typeof(v_detalle) <> 'object' or length(v_detalle::text) > 2000) then v_detalle := null; end if;

  insert into public.eventos_cliente (origen, tipo, nombre, pagina, mensaje, detalle, visita, dispositivo, user_id)
  values (p_origen, p_tipo, p_nombre, left(p_pagina, 300), left(p_mensaje, 500), v_detalle, v_visita, left(p_dispositivo, 200), auth.uid());

  -- Limpieza ocasional (≈1 de cada 50 inserciones): se conservan 60 días.
  if random() < 0.02 then
    delete from public.eventos_cliente where created_at < now() - interval '60 days';
  end if;
end;
$$;
revoke all on function public.registrar_evento_cliente(text, text, text, text, text, jsonb, text, text) from public;
grant execute on function public.registrar_evento_cliente(text, text, text, text, text, jsonb, text, text) to anon, authenticated;

-- 2) Resumen de cuentas de clientes (solo personal del panel) ------------------------------
create or replace function public.cuentas_clientes_resumen()
returns table (
  user_id uuid, nombre text, correo text, telefono text, creada_at timestamptz,
  confirmada_at timestamptz, ultimo_ingreso_at timestamptz, pedidos integer
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.usuario_activo() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select cc.user_id, cc.nombre, coalesce(nullif(u.email, ''), cc.correo), cc.telefono, cc.created_at,
           u.email_confirmed_at, u.last_sign_in_at,
           (select count(*)::integer from public.pedidos p
              join public.clientes c on c.id = p.cliente_id
             where c.user_id = cc.user_id
                or (u.email_confirmed_at is not null and nullif(lower(trim(c.correo)), '') = lower(u.email)))
      from public.cuentas_cliente cc
      join auth.users u on u.id = cc.user_id
     order by coalesce(u.last_sign_in_at, cc.created_at) desc;
end;
$$;
revoke all on function public.cuentas_clientes_resumen() from public, anon;
grant execute on function public.cuentas_clientes_resumen() to authenticated;
