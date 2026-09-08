-- Hausline · Botón "Enviar fotos de control de calidad" POR PRODUCTO.
--
-- El admin sube las fotos de calidad de UN producto (el que ya llegó), lo selecciona y toca
-- "Enviar fotos de control de calidad": eso marca `qc_enviado_at` en ese pedido_item, y este
-- trigger llama al endpoint que le manda al cliente el correo con las fotos de ESE producto.
-- El botón queda en gris (ya enviado). Días después, otro producto: se repite (reenviar =
-- vuelve a marcar qc_enviado_at con otra hora → el trigger dispara otra vez).
alter table public.pedido_items add column if not exists qc_enviado_at timestamptz;

do $$
declare
  v_def text;
  v_secret text;
begin
  v_def := pg_get_functiondef('public.notificar_cambio_estado'::regproc);
  v_secret := (regexp_match(v_def, 'Bearer ([^"''\s\\}]+)'))[1];
  if v_secret is null then raise exception 'No se pudo extraer NOTIFY_SECRET de notificar_cambio_estado'; end if;

  drop trigger if exists notificar_item_calidad on public.pedido_items;
  execute format(
    $f$create trigger notificar_item_calidad
        after update of qc_enviado_at on public.pedido_items
        for each row when (new.qc_enviado_at is distinct from old.qc_enviado_at and new.qc_enviado_at is not null)
        execute function supabase_functions.http_request(%L, 'POST', %L, '{}', '5000')$f$,
    'https://hausline-tracking.vercel.app/api/notificar-item-calidad',
    '{"Content-Type":"application/json","Authorization":"Bearer ' || v_secret || '"}'
  );
end $$;
