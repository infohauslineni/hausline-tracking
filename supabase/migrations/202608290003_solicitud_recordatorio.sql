-- Marca de "recordatorio de abandono enviado" en las solicitudes (encargos). El cron
-- manda UN recordatorio al cliente que dejó su encargo pendiente (sin confirmar el
-- pago) y guarda aquí la fecha para no reenviarlo. Solo aplica a encargos con correo.

begin;

alter table public.solicitudes
  add column if not exists recordatorio_at timestamptz;

commit;
