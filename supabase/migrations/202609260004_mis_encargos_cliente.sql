-- Mi cuenta: los encargos web que el cliente hizo y que TODAVÍA no se confirmaron (solicitudes),
-- + aviso por correo 3 horas antes de que venzan.
--
-- 1) mis_encargos_cliente(): el cliente los ve al instante como "Esperando tu pago" / "Pago en
--    revisión". Un encargo dura 24 h (vence_at): pasado ese plazo sin pago, desaparece de su
--    cuenta. Si ya avisó que pagó, sigue visible ("Pago en revisión") hasta que el admin lo
--    confirme, aunque haya pasado el plazo. Son suyos si los hizo con la sesión abierta
--    (solicitudes.user_id) o con el MISMO correo ya verificado. Un carrito (grupo_codigo) = UN encargo.
-- 2) solicitudes.aviso_vence_at + tarea programada (pg_cron, cada 15 min) que llama a
--    /api/notificar-estado {tarea:"recordatorios_encargos"} con el mismo secreto de los avisos
--    de estado: manda UNA vez el correo "tu encargo vence en ~3 horas" a los que no pagaron.
-- Es seguro correrlo de nuevo.

-- 1) Encargos por confirmar del cliente -------------------------------------------------
create or replace function public.mis_encargos_cliente()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with yo as (
    select u.id, lower(u.email) as correo, u.email_confirmed_at is not null as verificado
      from auth.users u where u.id = auth.uid()
  ), mias as (
    select s.* from public.solicitudes s, yo
     where (
             (s.estado = 'pendiente' and s.vence_at > now())
             or (s.estado in ('pendiente', 'vencida') and s.pago_reportado_at is not null)
           )
       and s.created_at > now() - interval '30 days'
       and (s.user_id = yo.id or (yo.verificado and nullif(lower(trim(s.cliente_correo)), '') = yo.correo))
  )
  select coalesce(jsonb_agg(e order by e->>'creado' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'codigo', coalesce(m.grupo_codigo, m.codigo),
      'creado', min(m.created_at),
      'vence', min(m.vence_at),
      'estado', case when bool_or(m.estado = 'pendiente' and m.vence_at > now()) then 'pendiente' else 'vencida' end,
      'total', sum(m.total),
      'abono', sum(m.abono),
      'pago_tipo', max(m.pago_tipo),
      'pago_reportado', bool_or(m.pago_reportado_at is not null),
      'comprobante', bool_or(m.comprobante_url is not null),
      'envio', max(m.envio),
      'productos', jsonb_agg(jsonb_build_object(
        'producto', m.producto, 'marca', m.marca, 'talla', m.talla, 'color', m.color,
        'cantidad', m.cantidad, 'imagen', m.imagen, 'total', m.total
      ) order by m.created_at)
    ) as e
    from mias m
    group by coalesce(m.grupo_codigo, m.codigo)
  ) x;
$$;
revoke all on function public.mis_encargos_cliente() from public, anon;
grant execute on function public.mis_encargos_cliente() to authenticated;

-- 2) Aviso por correo 3 h antes de vencer ------------------------------------------------
alter table public.solicitudes add column if not exists aviso_vence_at timestamptz;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Programa la tarea con el MISMO secreto de los avisos de estado (se extrae de
-- notificar_cambio_estado, igual que 202609240001), así no queda escrito en este archivo.
do $$
declare
  v_def text;
  v_secret text;
begin
  v_def := pg_get_functiondef('public.notificar_cambio_estado'::regproc);
  v_secret := (regexp_match(v_def, 'Bearer ([^"''\s\\}]+)'))[1];
  if v_secret is null then raise exception 'No se pudo extraer NOTIFY_SECRET de notificar_cambio_estado'; end if;
  if exists (select 1 from cron.job where jobname = 'recordatorios-encargos') then
    perform cron.unschedule('recordatorios-encargos');
  end if;
  perform cron.schedule('recordatorios-encargos', '*/15 * * * *', format(
    $job$select net.http_post(url := 'https://hausline-tracking.vercel.app/api/notificar-estado', headers := %L::jsonb, body := '{"tarea":"recordatorios_encargos"}'::jsonb, timeout_milliseconds := 10000)$job$,
    json_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret)::text
  ));
end $$;
