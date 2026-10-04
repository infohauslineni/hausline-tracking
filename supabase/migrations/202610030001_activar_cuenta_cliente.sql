-- Salud de clientes → "No confirmaron su correo": botón "Activar" en el panel.
-- Si al cliente no le llegó el correo de confirmación (spam, correo mal escrito y corregido,
-- etc.), el ADMIN puede confirmar su cuenta a mano. Solo aplica a cuentas de CLIENTE
-- (tabla cuentas_cliente): nunca a cuentas del personal del panel.

create or replace function public.activar_cuenta_cliente(p_user_id uuid)
returns timestamptz language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_fecha timestamptz;
begin
  if not public.usuario_admin() then raise exception 'Solo el administrador puede activar cuentas.' using errcode = '42501'; end if;
  if not exists (select 1 from public.cuentas_cliente where user_id = p_user_id) then
    raise exception 'No es una cuenta de cliente.' using errcode = 'P0002';
  end if;
  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now()),
         confirmation_token = '',
         updated_at = now()
   where id = p_user_id
  returning email_confirmed_at into v_fecha;
  if v_fecha is null then raise exception 'No se encontró la cuenta.' using errcode = 'P0002'; end if;
  return v_fecha;
end;
$$;

revoke all on function public.activar_cuenta_cliente(uuid) from public, anon, authenticated;
grant execute on function public.activar_cuenta_cliente(uuid) to authenticated;
