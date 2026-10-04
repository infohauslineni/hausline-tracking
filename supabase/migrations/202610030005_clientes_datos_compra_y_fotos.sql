-- Clientes:
--   1) La ficha se ACTUALIZA con los datos que el cliente puso en su última compra (nombre,
--      correo, departamento/ciudad, dirección). Antes solo se llenaban si estaban vacíos, así
--      que un correo o una dirección nueva no llegaba a la ficha.
--   2) avatares_clientes(): foto de perfil de "Mi cuenta" de cada cliente para el panel
--      (por cuenta vinculada, o por el mismo correo / teléfono de la cuenta).
begin;

create or replace function public.solicitud_direccion_a_cliente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cliente uuid;
  v_lugar text := nullif(btrim(coalesce(new.cliente_ciudad, '')), '');
  v_dep text;
begin
  select cliente_id into v_cliente from public.pedidos where id = new.pedido_id;
  if v_cliente is null then return new; end if;
  -- "Ciudad, País" = envío internacional: no es un departamento de Nicaragua.
  v_dep := case when v_lugar is not null and position(',' in v_lugar) = 0 then v_lugar end;
  update public.clientes c set
    nombre       = coalesce(nullif(btrim(new.cliente_nombre), ''), c.nombre),
    correo       = coalesce(nullif(lower(btrim(new.cliente_correo)), ''), c.correo),
    direccion    = coalesce(nullif(btrim(new.cliente_direccion), ''), c.direccion),
    departamento = coalesce(v_dep, c.departamento),
    ciudad       = coalesce(v_lugar, c.ciudad),
    user_id      = coalesce(c.user_id, new.user_id),
    costo_envio  = coalesce(c.costo_envio, public.tarifa_envio_usd(coalesce(v_dep, c.departamento, c.ciudad))),
    updated_at   = now()
  where c.id = v_cliente;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.solicitud_direccion_a_cliente() from public, anon, authenticated;

create or replace function public.avatares_clientes()
returns table (cliente_id uuid, user_id uuid, avatar_path text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.usuario_activo() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select distinct on (c.id) c.id, cc.user_id, cc.avatar_path
      from public.clientes c
      join public.cuentas_cliente cc on cc.avatar_path is not null and (
           cc.user_id = c.user_id
        or (nullif(lower(btrim(c.correo)), '') is not null and lower(btrim(c.correo)) = lower(btrim(cc.correo)))
        or (length(regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g')) >= 8
            and right(regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g'), 8) = right(regexp_replace(coalesce(cc.telefono, ''), '[^0-9]', '', 'g'), 8)))
     order by c.id, (cc.user_id = c.user_id) desc;
end;
$$;
revoke all on function public.avatares_clientes() from public, anon;
grant execute on function public.avatares_clientes() to authenticated;

commit;

notify pgrst, 'reload schema';
