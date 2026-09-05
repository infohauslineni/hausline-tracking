-- Hausline · Guardar cuánto tocó cada movimiento al saldo de su cuenta bancaria.
--
-- Con "obligar cuenta en cada movimiento", la caja y las tarjetas se mueven juntas al
-- REGISTRAR. Pero al BORRAR un movimiento hay que devolverle ese monto a la cuenta, y para
-- hacerlo exacto (incluye córdobas redondeados o montos corregidos a mano) necesitamos saber
-- cuánto se aplicó realmente. `monto_cuenta` guarda ese delta CON SIGNO y en la MONEDA de la
-- cuenta (positivo = entró a la cuenta, negativo = salió). Al borrar, se revierte con el signo
-- contrario. Null = el movimiento no tocó ninguna cuenta.
begin;

alter table public.movimientos_cuenta
  add column if not exists monto_cuenta numeric(14,2);

-- Rellena los movimientos previos que YA estaban ligados a una cuenta (cobros/gastos/
-- reembolsos), para que si se borran después se revierta el saldo. Aproximado: usa el monto
-- original del movimiento con el signo según su tipo (entrada suma, el resto resta).
update public.movimientos_cuenta
   set monto_cuenta = (case when tipo in ('ingreso','ajuste_entrada') then 1 else -1 end)
                      * coalesce(monto_original, monto)
 where cuenta_id is not null and monto_cuenta is null;

commit;
