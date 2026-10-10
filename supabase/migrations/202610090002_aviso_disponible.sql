-- "Ya le avisé": cuándo se le mandó al cliente el WhatsApp de que su pedido está disponible.
-- Lo anota el panel al tocar "Avisar disponibilidad" (en el pedido o en la pantalla Entregas),
-- para saber a quién falta escribirle.
alter table public.pedidos
  add column if not exists aviso_disponible_at timestamptz;
