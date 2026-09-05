-- Control de dedup para el correo automático de cargo por bodega. El cron diario
-- (api/cron-estimaciones) le avisa al cliente cuánto se sumó a su factura por los días
-- extra en bodega, y guarda aquí cuándo fue el último aviso para no repetirlo (máx. 1
-- correo por pedido cada ~20 h). Nullable: los pedidos viejos empiezan sin aviso.
alter table public.pedidos add column if not exists bodega_aviso_at timestamptz;
