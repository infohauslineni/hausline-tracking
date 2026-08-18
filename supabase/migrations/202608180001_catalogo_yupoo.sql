-- Catálogo de links de Yupoo por marca/modelo.
--
-- Sirve para guardar en un solo lugar todos los álbumes de Yupoo (organizados por
-- marca) y encontrar un modelo al instante cuando un cliente pide fotos. Misma
-- seguridad que el resto de tablas privadas: solo usuarios autenticados y activos
-- (public.usuario_activo()). Idempotente: se puede correr más de una vez sin romper.
begin;

create table if not exists public.catalogo_yupoo (
  id uuid primary key default gen_random_uuid(),
  marca text not null check (char_length(trim(marca)) between 1 and 80),
  modelo text not null check (char_length(trim(modelo)) between 1 and 160),
  categoria text,
  link text not null check (char_length(trim(link)) between 3 and 600),
  proveedor text,
  precio numeric(12,2) check (precio is null or precio >= 0),
  notas text,
  foto_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.catalogo_yupoo is
  'Links de Yupoo por marca/modelo para buscar y compartir fotos rápido con el cliente.';

create index if not exists catalogo_yupoo_marca_idx on public.catalogo_yupoo (marca);

drop trigger if exists catalogo_yupoo_updated_at on public.catalogo_yupoo;
create trigger catalogo_yupoo_updated_at before update on public.catalogo_yupoo
  for each row execute function public.set_updated_at();

alter table public.catalogo_yupoo enable row level security;

drop policy if exists catalogo_yupoo_admin_total on public.catalogo_yupoo;
create policy catalogo_yupoo_admin_total on public.catalogo_yupoo for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());

grant select, insert, update, delete on public.catalogo_yupoo to authenticated;

commit;
