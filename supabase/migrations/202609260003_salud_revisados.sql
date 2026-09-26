-- Salud de clientes: "Marcar como revisado" sin borrar nada.
--   · eventos_cliente.revisado_at / revisado_por: el error (o código no encontrado) sale de la
--     lista, del contador del menú y del correo diario, pero queda guardado. Si vuelve a pasar,
--     el evento NUEVO aparece de nuevo (no se oculta para siempre).
--   · salud_cuentas_revisadas: "Ya lo contacté" en las listas de cuentas que necesitan ayuda
--     (sin confirmar el correo / sin pedidos vinculados).
-- Solo el personal activo del panel puede marcar o desmarcar. Es seguro correrlo de nuevo.

alter table public.eventos_cliente add column if not exists revisado_at timestamptz;
alter table public.eventos_cliente add column if not exists revisado_por uuid references public.perfiles(id) on delete set null;
create index if not exists eventos_cliente_pendientes_idx on public.eventos_cliente (created_at desc) where revisado_at is null;

create or replace function public.marcar_eventos_revisados(p_ids bigint[], p_revisado boolean default true)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  if not public.usuario_activo() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  update public.eventos_cliente
     set revisado_at = case when p_revisado then now() else null end,
         revisado_por = case when p_revisado then auth.uid() else null end
   where id = any(coalesce(p_ids, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.marcar_eventos_revisados(bigint[], boolean) from public, anon;
grant execute on function public.marcar_eventos_revisados(bigint[], boolean) to authenticated;

create table if not exists public.salud_cuentas_revisadas (
  user_id uuid not null references auth.users(id) on delete cascade,
  motivo text not null check (motivo in ('sin_confirmar', 'sin_pedidos')),
  revisado_at timestamptz not null default now(),
  revisado_por uuid references public.perfiles(id) on delete set null default auth.uid(),
  primary key (user_id, motivo)
);
alter table public.salud_cuentas_revisadas enable row level security;
drop policy if exists "Personal gestiona cuentas revisadas" on public.salud_cuentas_revisadas;
create policy "Personal gestiona cuentas revisadas" on public.salud_cuentas_revisadas for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());
revoke all on public.salud_cuentas_revisadas from anon, authenticated;
grant select, insert, delete on public.salud_cuentas_revisadas to authenticated;
