-- Hausline · Aviso de encargo web AGRUPADO por cliente.
--
-- Un carrito de la web crea un encargo (solicitud) por producto. Antes el webhook mandaba un
-- correo por cada uno (38 productos = 38 correos). Esta columna marca cuáles encargos ya se
-- avisaron, para que el endpoint (api/notificar-encargo) "reclame" de forma atómica todos los
-- del mismo cliente y mande UN solo correo con todos sus productos.
begin;

alter table public.solicitudes add column if not exists aviso_admin_at timestamptz;
create index if not exists solicitudes_aviso_admin_idx on public.solicitudes(cliente_whatsapp, aviso_admin_at);

commit;
