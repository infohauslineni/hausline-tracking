-- Hausline · FIX: el cliente no podía subir el comprobante desde el checkout.
-- Error real: "new row violates row-level security policy" al hacer POST al bucket
-- `comprobantes` con la anon key. Faltaba (o no quedó aplicada) la política de INSERT
-- para el rol anon en storage.objects. Este archivo la deja garantizada (re-ejecutable).
--
-- ⚠️ OJO: en el SQL editor esto DA ERROR "42501: must be owner of table objects" porque
-- storage.objects pertenece a supabase_storage_admin. Por eso HAY QUE HACERLO DESDE EL
-- DASHBOARD (Storage → Policies), no por SQL. Pasos:
--   1) Storage → Buckets → confirmá que existe "comprobantes" (Private). Si no, crealo.
--   2) Storage → Policies → en la tabla objects, bucket comprobantes → New policy →
--      "For full customization":
--      • Política 1: nombre comprobantes_anon_insert · Operation: INSERT ·
--        Target roles: anon, authenticated · WITH CHECK: bucket_id = 'comprobantes'
--      • Política 2: nombre comprobantes_auth_read · Operation: SELECT ·
--        Target roles: authenticated · USING: bucket_id = 'comprobantes'
-- El SQL de abajo queda solo de referencia (falla por permisos en el editor).

-- 1) El bucket existe (privado).
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- 2) RLS activa en storage.objects (por defecto lo está; lo dejamos explícito).
alter table storage.objects enable row level security;

-- 3) El público (anon) y los admin pueden SUBIR al bucket comprobantes (solo insertar).
drop policy if exists "comprobantes_anon_insert" on storage.objects;
create policy "comprobantes_anon_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'comprobantes');

-- 4) Solo los admin (authenticated) pueden LEER los comprobantes (para verlos en el panel).
drop policy if exists "comprobantes_auth_read" on storage.objects;
create policy "comprobantes_auth_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes');
