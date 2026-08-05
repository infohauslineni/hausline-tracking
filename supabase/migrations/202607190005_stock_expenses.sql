-- Permite asociar envíos, delivery y otros gastos al stock inmediato.
alter table public.gastos
  add column if not exists inversion_id uuid references public.inversiones(id) on delete set null;

create index if not exists gastos_inversion_id_idx on public.gastos(inversion_id);

-- Un gasto puede pertenecer a un pedido o a un producto de stock, pero no a ambos.
alter table public.gastos drop constraint if exists gastos_un_destino_check;
alter table public.gastos add constraint gastos_un_destino_check
  check (pedido_id is null or inversion_id is null);

grant select, insert, update, delete on public.gastos to authenticated;
