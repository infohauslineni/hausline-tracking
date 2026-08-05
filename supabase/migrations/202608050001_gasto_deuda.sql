begin;

-- Permite registrar un pago de deuda directamente como gasto (categoría "Deuda").
-- Ese gasto baja el saldo de caja (vía movimientos_cuenta) y también la ganancia
-- disponible (vía una asignación de ganancia tipo 'pago_deuda').
-- Enlazamos la asignación con el gasto para revertirla automáticamente al eliminarlo.
alter table public.asignaciones_ganancia
  add column if not exists gasto_id uuid references public.gastos(id) on delete cascade;

create index if not exists asignaciones_ganancia_gasto_id_idx
  on public.asignaciones_ganancia (gasto_id);

commit;
