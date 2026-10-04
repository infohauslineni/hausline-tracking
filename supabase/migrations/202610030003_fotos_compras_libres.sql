-- Compras libres: fotos de CONTROL DE CALIDAD por compra (en camino, en inventario, etc.).
-- Si después se aparta a un cliente, las fotos se copian al pedido (control de calidad,
-- visibles para el cliente) y le salen en su seguimiento como en cualquier pedido.
--   · Tabla archivos_inversion: una fila por foto (bucket "pedidos", carpeta
--     inversiones/<id>/control-calidad/).
--   · Políticas del Storage para esa carpeta (solo personal del panel).
begin;

create table if not exists public.archivos_inversion (
  id uuid primary key default gen_random_uuid(),
  inversion_id uuid not null references public.inversiones(id) on delete cascade,
  storage_path text not null unique,
  nombre text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  tamano_bytes bigint not null check (tamano_bytes > 0 and tamano_bytes <= 10485760),
  created_at timestamptz not null default now()
);
create index if not exists archivos_inversion_inv_idx on public.archivos_inversion (inversion_id, created_at);

alter table public.archivos_inversion enable row level security;
drop policy if exists archivos_inversion_personal on public.archivos_inversion;
create policy archivos_inversion_personal on public.archivos_inversion for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());
revoke all on public.archivos_inversion from anon;
grant select, insert, update, delete on public.archivos_inversion to authenticated;

drop policy if exists storage_inversiones_leer on storage.objects;
create policy storage_inversiones_leer on storage.objects for select to authenticated
using (bucket_id = 'pedidos' and name ~ '^inversiones/[0-9a-f-]{36}/control-calidad/' and public.usuario_activo());

drop policy if exists storage_inversiones_insertar on storage.objects;
create policy storage_inversiones_insertar on storage.objects for insert to authenticated
with check (bucket_id = 'pedidos' and name ~ '^inversiones/[0-9a-f-]{36}/control-calidad/' and public.usuario_activo());

drop policy if exists storage_inversiones_eliminar on storage.objects;
create policy storage_inversiones_eliminar on storage.objects for delete to authenticated
using (bucket_id = 'pedidos' and name ~ '^inversiones/[0-9a-f-]{36}/control-calidad/' and public.usuario_activo());

commit;
