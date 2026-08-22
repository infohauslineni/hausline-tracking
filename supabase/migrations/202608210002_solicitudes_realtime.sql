-- Habilita el tiempo real (Realtime) para la tabla `solicitudes`, para que el panel
-- suene la campanita y muestre el aviso apenas cae un encargo web nuevo (INSERT).
-- El panel ya se suscribe a postgres_changes de public.solicitudes (PrivateLayout),
-- pero sin la tabla en la publicación `supabase_realtime` el evento nunca llega.
-- La RLS ya permite que el admin (usuario_activo) lea la tabla, así que el aviso solo
-- le llega a la sesión del panel, no al público.

begin;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'solicitudes'
  ) then
    alter publication supabase_realtime add table public.solicitudes;
  end if;
end $$;

commit;
