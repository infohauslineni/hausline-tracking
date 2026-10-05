-- Mi cuenta: el cliente ve sus cupones personales vigentes (p. ej. el de "volver a comprar"),
-- así no depende solo del correo. Solo los suyos: ficha de cliente ligada a su cuenta, o con el
-- mismo correo verificado. Solo lectura, sin datos de otros clientes.
create or replace function public.mis_cupones_cliente()
returns table (codigo text, tipo text, valor numeric, inicia_el date, vence_el date)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.codigo, c.tipo, c.valor, c.inicia_el, c.vence_el
    from public.cupones c
   where c.activo
     and c.cliente_id in (
       select cl.id from public.clientes cl
        where cl.user_id = auth.uid()
           or (nullif(lower(btrim(cl.correo)), '') is not null
               and lower(btrim(cl.correo)) = (select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null))
     )
     and (c.vence_el is null or c.vence_el >= (now() at time zone 'America/Managua')::date)
     and (c.inicia_el is null or c.inicia_el <= (now() at time zone 'America/Managua')::date)
     and (c.usos_max is null or c.usos_confirmados < c.usos_max)
   order by c.vence_el nulls last
   limit 5;
$$;
revoke all on function public.mis_cupones_cliente() from public, anon;
grant execute on function public.mis_cupones_cliente() to authenticated;

notify pgrst, 'reload schema';
