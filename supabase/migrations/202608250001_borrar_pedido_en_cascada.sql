-- Al ELIMINAR un pedido, borrar TODO lo relacionado (abono, pago a proveedor, gastos y
-- sus movimientos de caja). Hoy `pagos` ya se borra en cascada, pero `movimientos_cuenta`
-- y `gastos` estaban en ON DELETE SET NULL: el pedido desaparecía pero sus movimientos
-- quedaban en la caja (inflando "Entradas del mes" y el saldo) y los gastos quedaban
-- sueltos. Los pasamos a ON DELETE CASCADE.
--
-- Seguro de repetir. No toca datos existentes salvo redefinir las llaves foráneas.

begin;

-- movimientos_cuenta.pedido_id  →  ON DELETE CASCADE
do $$ declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'public.movimientos_cuenta'::regclass and confrelid = 'public.pedidos'::regclass and contype = 'f';
  if c is not null then execute format('alter table public.movimientos_cuenta drop constraint %I', c); end if;
end $$;
alter table public.movimientos_cuenta
  add constraint movimientos_cuenta_pedido_id_fkey
  foreign key (pedido_id) references public.pedidos(id) on delete cascade;

-- gastos.pedido_id  →  ON DELETE CASCADE
do $$ declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'public.gastos'::regclass and confrelid = 'public.pedidos'::regclass and contype = 'f';
  if c is not null then execute format('alter table public.gastos drop constraint %I', c); end if;
end $$;
alter table public.gastos
  add constraint gastos_pedido_id_fkey
  foreign key (pedido_id) references public.pedidos(id) on delete cascade;

commit;
