-- Hausline · Propósito y límite de cada cuenta bancaria.
--
-- El usuario quiere dedicar cuentas: unas SOLO para COMPRAR (pagar proveedores/inversión) y
-- otras SOLO para RECIBIR (cobros/abonos), porque LAFISE tiene tope de recepción (US$1500 /
-- C$100k). `proposito` filtra qué cuentas aparecen en cada formulario de dinero. `limite` es
-- el tope opcional de la cuenta; cuando el saldo se le acerca, la tarjeta avisa.
begin;

alter table public.cuentas_bancarias
  add column if not exists proposito text not null default 'ambos'
    check (proposito in ('comprar', 'recibir', 'ambos'));

alter table public.cuentas_bancarias
  add column if not exists limite numeric(14,2);

commit;
