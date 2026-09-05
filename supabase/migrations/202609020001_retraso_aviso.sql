-- Aviso automático de RETRASO (más de 27 días en tránsito internacional).
-- El cron diario (api/cron-estimaciones) manda UN correo de disculpa por la demora y marca
-- aquí la fecha, para no repetirlo. Null = todavía no se avisó de retraso a ese pedido.
alter table public.pedidos add column if not exists retraso_aviso_at timestamptz;

comment on column public.pedidos.retraso_aviso_at is
  'Cuándo se envió el aviso automático de retraso (>27 días en tránsito). Null = aún no avisado.';
