-- ENTREGA INMEDIATA: devolver la talla al CANCELAR un pedido (correr DESPUÉS del SQL del catálogo
-- hausline-web/admin/entrega-inmediata-devolver.sql).
-- · La clave compartida pasa a vivir en config_privada (no escrita dentro de las funciones).
-- · Al vender se manda también el pedido (p_pedido) para que el catálogo anote qué talla quitó.
-- · Al pasar un pedido a "cancelado" se le pide al catálogo que devuelva lo anotado de ese pedido.
-- La clave __SECRETO__ es la misma del catálogo (no se guarda en el repositorio).

insert into public.config_privada (clave, valor) values ('secreto_entrega_inmediata', '__SECRETO__')
on conflict (clave) do update set valor = excluded.valor;

create or replace function public.avisar_venta_entrega_inmediata()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_codigo text := upper(btrim(coalesce(new.codigo_producto, ''))); v_talla text := btrim(coalesce(new.talla, '')); v_id bigint;
begin
  if v_codigo = '' then return new; end if;
  if not exists (select 1 from public.pedidos p where p.id = new.pedido_id and p.created_at > now() - interval '6 hours') then return new; end if;
  insert into public.entrega_inmediata_descuentos (pedido_id, codigo, talla, cantidad)
  values (new.pedido_id, v_codigo, v_talla, greatest(1, coalesce(new.cantidad, 1)::int))
  on conflict do nothing;
  if not found then return new; end if;
  select net.http_post(
    url := 'https://xgdijumnmaqfirmckugw.supabase.co/rest/v1/rpc/descontar_entrega_inmediata',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw", "Authorization": "Bearer sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw"}'::jsonb,
    body := jsonb_build_object('p_secreto', (select valor from public.config_privada where clave = 'secreto_entrega_inmediata'),
      'p_codigo', v_codigo, 'p_talla', v_talla, 'p_cantidad', greatest(1, coalesce(new.cantidad, 1)::int), 'p_pedido', new.pedido_id::text),
    timeout_milliseconds := 15000
  ) into v_id;
  update public.entrega_inmediata_descuentos set peticion_id = v_id where pedido_id = new.pedido_id and codigo = v_codigo and talla = v_talla;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.avisar_venta_entrega_inmediata() from public, anon, authenticated;

create or replace function public.devolver_venta_entrega_inmediata()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.estado = 'cancelado' and old.estado is distinct from 'cancelado'
     and exists (select 1 from public.entrega_inmediata_descuentos where pedido_id = new.id) then
    perform net.http_post(
      url := 'https://xgdijumnmaqfirmckugw.supabase.co/rest/v1/rpc/devolver_entrega_inmediata',
      headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw", "Authorization": "Bearer sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw"}'::jsonb,
      body := jsonb_build_object('p_secreto', (select valor from public.config_privada where clave = 'secreto_entrega_inmediata'), 'p_pedido', new.id::text),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
exception when others then
  return new; -- nunca frena la cancelación
end;
$$;
revoke all on function public.devolver_venta_entrega_inmediata() from public, anon, authenticated;

drop trigger if exists pedidos_devolver_entrega_inmediata on public.pedidos;
create trigger pedidos_devolver_entrega_inmediata
  after update of estado on public.pedidos
  for each row execute function public.devolver_venta_entrega_inmediata();

select (select count(*) from pg_trigger where tgname in ('pedido_items_entrega_inmediata', 'pedidos_devolver_entrega_inmediata')) as triggers,
       (select count(*) from public.config_privada where clave = 'secreto_entrega_inmediata') as clave;
