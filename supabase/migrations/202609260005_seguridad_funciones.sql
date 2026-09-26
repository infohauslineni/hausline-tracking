-- Diagnóstico de seguridad 2026-09-26: probando TODAS las funciones como visitante anónimo
-- (sin iniciar sesión) aparecieron funciones que cualquiera podía ejecutar. En Supabase toda
-- función nueva queda ejecutable por anon/authenticated salvo que se revoque a mano.
--
--   1. ajustar_saldo_cuenta: la versión viva NO tenía el candado de admin (se volvió a correr la
--      migración vieja 202608270003 después de 202609040001). Cualquiera —incluso sin sesión o con
--      una cuenta de cliente de la tienda— podía cambiar los saldos de las cuentas bancarias.
--      Esa misma re-ejecución recreó la política amplia cuentas_bancarias_admin_total (personal
--      activo) → los operadores también veían/editaban las cuentas. Se deja SOLO admin.
--   2. registrar_uso_cupon: dejaba pasar a cualquiera sin sesión (auth.uid() nulo) → alguien podía
--      "gastar" los usos de un cupón. Ahora: personal activo o el servidor (service_role).
--   3. vencer_solicitudes, wa_registrar_notificacion, obtener_archivos_pedido_publicos: se cierran
--      a quien las usa de verdad (panel / servidor / bot con service_role).
--   4. obtener_solicitud_publica / obtener_solicitud_grupo (página de pago /checkout/?c=SOL-####):
--      devolvían el NOMBRE COMPLETO del cliente con un código de solo 4 números (adivinable). El
--      checkout no lo usa: se quita.
-- Es seguro correrlo de nuevo.

begin;

-- 1) Saldos de cuentas bancarias: solo admin ------------------------------------------------
create or replace function public.ajustar_saldo_cuenta(p_id uuid, p_delta numeric)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare nuevo numeric;
begin
  if not public.usuario_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_id is null then return null; end if;
  update public.cuentas_bancarias
     set saldo = round(saldo + coalesce(p_delta, 0), 2)
   where id = p_id
  returning saldo into nuevo;
  return nuevo;
end;
$$;
revoke all on function public.ajustar_saldo_cuenta(uuid, numeric) from public, anon;
grant execute on function public.ajustar_saldo_cuenta(uuid, numeric) to authenticated;

drop policy if exists cuentas_bancarias_admin_total on public.cuentas_bancarias;
drop policy if exists cuentas_bancarias_admin_solo on public.cuentas_bancarias;
create policy cuentas_bancarias_admin_solo on public.cuentas_bancarias for all to authenticated
  using (public.usuario_admin()) with check (public.usuario_admin());

-- 2) Cupones: solo personal o servidor ----------------------------------------------------
create or replace function public.registrar_uso_cupon(p_cupon_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (public.usuario_activo() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_cupon_id is null then return; end if;
  update public.cupones
     set usos_confirmados = usos_confirmados + 1,
         activo = case when usos_max is not null and usos_confirmados + 1 >= usos_max then false else activo end
   where id = p_cupon_id;
end;
$$;
revoke all on function public.registrar_uso_cupon(uuid) from public, anon;
grant execute on function public.registrar_uso_cupon(uuid) to authenticated, service_role;

-- 3) Funciones internas: fuera del público --------------------------------------------------
revoke all on function public.vencer_solicitudes() from public, anon;
grant execute on function public.vencer_solicitudes() to authenticated, service_role;

revoke all on function public.wa_registrar_notificacion(uuid, public.estado_pedido, text, text, text, text) from public, anon, authenticated;
grant execute on function public.wa_registrar_notificacion(uuid, public.estado_pedido, text, text, text, text) to service_role;

revoke all on function public.obtener_archivos_pedido_publicos(text) from public, anon, authenticated;
grant execute on function public.obtener_archivos_pedido_publicos(text) to service_role;

-- 4) Página de pago: sin el nombre del cliente ----------------------------------------------
create or replace function public.obtener_solicitud_publica(p_codigo text)
returns json language sql security definer stable set search_path = public, pg_temp as $$
  select json_build_object(
    'codigo', s.codigo, 'producto', s.producto, 'producto_codigo', s.producto_codigo,
    'marca', s.marca, 'talla', s.talla, 'color', s.color,
    'cantidad', s.cantidad, 'precio_unitario', s.precio_unitario,
    'total', s.total, 'abono', s.abono,
    'saldo', greatest(0, s.total - coalesce(s.abono, 0)),
    'pago_tipo', s.pago_tipo, 'envio', s.envio,
    'tipo_cambio', s.tipo_cambio, 'total_nio', s.total_nio,
    'abono_nio', case when s.tipo_cambio is not null then ceil(coalesce(s.abono,0)*s.tipo_cambio/10.0)*10 else null end,
    'estado', s.estado, 'imagen', s.imagen,
    'comprobante', (s.comprobante_url is not null),
    'pago_reportado', (s.pago_reportado_at is not null),
    'pedido_estado', (select p.estado from public.pedidos p where p.id = s.pedido_id),
    'created_at', s.created_at, 'vence_at', s.vence_at
  ) from public.solicitudes s where s.codigo = upper(trim(p_codigo)) limit 1;
$$;

create or replace function public.obtener_solicitud_grupo(p_codigo text)
returns json language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_object(
    'codigo', s.codigo, 'grupo_codigo', s.grupo_codigo,
    'producto', s.producto, 'producto_codigo', s.producto_codigo,
    'marca', s.marca, 'talla', s.talla, 'color', s.color,
    'cantidad', s.cantidad, 'precio_unitario', s.precio_unitario,
    'total', s.total, 'abono', s.abono,
    'saldo', greatest(0, s.total - coalesce(s.abono, 0)),
    'pago_tipo', s.pago_tipo, 'envio', s.envio,
    'tipo_cambio', s.tipo_cambio, 'total_nio', s.total_nio,
    'abono_nio', case when s.tipo_cambio is not null then ceil(coalesce(s.abono,0)*s.tipo_cambio/10.0)*10 else null end,
    'estado', s.estado,
    'imagen', s.imagen,
    'comprobante', (s.comprobante_url is not null),
    'pago_reportado', (s.pago_reportado_at is not null),
    'pedido_estado', (select p.estado from public.pedidos p where p.id = s.pedido_id),
    'created_at', s.created_at, 'vence_at', s.vence_at
  ) order by s.created_at), '[]'::json)
  from public.solicitudes s
  where upper(trim(p_codigo)) in (upper(coalesce(s.grupo_codigo, '')), upper(s.codigo));
$$;
grant execute on function public.obtener_solicitud_publica(text) to anon, authenticated;
grant execute on function public.obtener_solicitud_grupo(text) to anon, authenticated;

commit;
