-- 1) TIPO DE CAMBIO PÚBLICO: la tienda usa el mismo tipo de cambio que se guarda en el panel
--    (Configuración → Moneda y tipo de cambio). Antes la tienda tenía 37 fijo en config.js.
create or replace function public.tipo_cambio_publico()
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select nullif(valor_json->>'tipo_cambio', '')::numeric from public.configuracion where clave = 'moneda'
       and (valor_json->>'tipo_cambio') ~ '^[0-9]+(\.[0-9]+)?$'),
    37);
$$;
revoke all on function public.tipo_cambio_publico() from public, anon, authenticated;
grant execute on function public.tipo_cambio_publico() to anon, authenticated;

-- 2) NOVEDADES por correo (api/_automatico.js): enlace para DARSE DE BAJA en cada correo.
--    El enlace lleva un código firmado con un secreto que solo vive en la base (nadie puede dar
--    de baja a otro sin ese código).
create table if not exists public.config_privada (clave text primary key, valor text not null);
alter table public.config_privada enable row level security;
revoke all on public.config_privada from anon, authenticated;
insert into public.config_privada (clave, valor)
values ('secreto_baja', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (clave) do nothing;

-- Código de baja de un correo (solo el servidor, con la llave de servicio).
create or replace function public.token_baja_suscriptor(p_correo text)
returns text language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select encode(extensions.hmac(lower(btrim(p_correo)), (select valor from public.config_privada where clave = 'secreto_baja'), 'sha256'), 'hex');
$$;
revoke all on function public.token_baja_suscriptor(text) from public, anon, authenticated;
grant execute on function public.token_baja_suscriptor(text) to service_role;

-- Darse de baja desde el enlace del correo (página hauslineshopni.es/baja/).
create or replace function public.dar_de_baja_suscriptor(p_correo text, p_token text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_correo is null or p_token is null or p_token <> public.token_baja_suscriptor(p_correo) then return false; end if;
  update public.suscriptores set activo = false, updated_at = now() where lower(correo) = lower(btrim(p_correo));
  return true;
end;
$$;
revoke all on function public.dar_de_baja_suscriptor(text, text) from public, anon, authenticated;
grant execute on function public.dar_de_baja_suscriptor(text, text) to anon, authenticated;

-- Comprobación: tipo de cambio que verá la tienda y que el secreto existe.
select public.tipo_cambio_publico() as tipo_cambio_tienda,
       (select count(*) from public.config_privada where clave = 'secreto_baja') as secreto_baja;
