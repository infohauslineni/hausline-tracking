-- Base de suscriptores para email marketing, CON consentimiento explícito. Se llena
-- desde el checkout (checkbox opt-in) y desde un formulario de newsletter. La tabla
-- está cerrada por RLS; el alta pública entra por la RPC suscribir_publico. El envío
-- de campañas se hace aparte (ESP tipo Brevo) leyendo esta tabla; lo transaccional
-- (estados del pedido) sigue por el sistema de correo actual.

begin;

create table if not exists public.suscriptores (
  id             uuid primary key default gen_random_uuid(),
  correo         text not null unique,
  nombre         text,
  consentimiento boolean not null default true,   -- solo se crea cuando el cliente acepta
  fuente         text,                            -- 'checkout' | 'newsletter' | ...
  activo         boolean not null default true,   -- false = dado de baja (unsubscribe)
  ultima_compra  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists suscriptores_activo_idx on public.suscriptores (activo) where activo;

alter table public.suscriptores enable row level security;

-- Nadie (anon) toca la tabla directo; solo el admin autenticado la administra.
drop policy if exists suscriptores_admin_todo on public.suscriptores;
create policy suscriptores_admin_todo on public.suscriptores
  for all to authenticated using (true) with check (true);

-- ── Alta pública con consentimiento (checkout / newsletter) ──────────────────
-- Upsert por correo: si ya existe, lo reactiva y actualiza nombre. Normaliza el
-- correo a minúsculas. Devuelve ok/error sin exponer la tabla.
create or replace function public.suscribir_publico(
  p_correo text,
  p_nombre text default null,
  p_fuente text default 'web'
) returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  if v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return json_build_object('ok', false, 'error', 'correo_invalido');
  end if;

  insert into public.suscriptores (correo, nombre, consentimiento, fuente)
  values (v_correo, nullif(trim(coalesce(p_nombre,'')), ''), true, coalesce(nullif(trim(p_fuente),''), 'web'))
  on conflict (correo) do update
    set nombre         = coalesce(excluded.nombre, public.suscriptores.nombre),
        consentimiento = true,
        activo         = true,
        updated_at     = now();

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.suscribir_publico(text, text, text) from public;
grant execute on function public.suscribir_publico(text, text, text) to anon, authenticated;

commit;
