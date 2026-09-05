-- Nuevo estado "pagado" entre "disponible_entrega" y "entregado".
--
-- Sirve para el flujo de bodega: cuando el cliente paga, se marca "Pagado" (se registra
-- el pago y se congela el cargo por bodega, porque el pedido deja de estar en
-- "disponible_entrega"); la entrega física se marca después como "Entregado".
--
-- ADD VALUE es idempotente con IF NOT EXISTS y se puede correr solo (no usa el valor en
-- la misma sentencia). En Postgres 15 (Supabase) puede ir dentro de transacción.
alter type public.estado_pedido add value if not exists 'pagado' before 'entregado';
