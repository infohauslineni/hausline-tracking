-- Fix de 202609230001: la política de lectura de tarifas_delivery llamaba usuario_activo(),
-- que el rol anon no puede ejecutar → la lectura pública daba 401. Se separa en dos:
-- anon ve solo las activas; los usuarios con sesión ven activas (y el personal, todas).
begin;
drop policy if exists tarifas_delivery_leer on public.tarifas_delivery;
drop policy if exists tarifas_delivery_leer_anon on public.tarifas_delivery;
create policy tarifas_delivery_leer_anon on public.tarifas_delivery for select to anon using (activo);
drop policy if exists tarifas_delivery_leer_auth on public.tarifas_delivery;
create policy tarifas_delivery_leer_auth on public.tarifas_delivery for select to authenticated using (activo or public.usuario_activo());
commit;
