-- Hausline · Correo POR PRODUCTO cuando cambia su etapa (seguimiento por producto).
--
-- Crea un trigger sobre pedido_items que, cuando cambia `estado_item`, llama al endpoint
-- /api/notificar-item para avisarle al cliente por correo sobre ESE producto (el de
-- "recibido" adjunta su foto de control de calidad).
--
-- Reutiliza el MISMO secreto (NOTIFY_SECRET) que el trigger de estados del pedido, que está
-- "hardcodeado" (sensible) dentro de la función notificar_cambio_estado creada a mano en
-- Supabase. El DO block lo extrae de ahí y lo reinyecta, para no tener que escribirlo.
do $$
declare
  v_def text;
  v_secret text;
begin
  v_def := pg_get_functiondef('public.notificar_cambio_estado'::regproc);
  v_secret := (regexp_match(v_def, 'Bearer ([^"''\s\\}]+)'))[1];
  if v_secret is null then raise exception 'No se pudo extraer NOTIFY_SECRET de notificar_cambio_estado'; end if;

  drop trigger if exists notificar_item_estado on public.pedido_items;
  execute format(
    $f$create trigger notificar_item_estado
        after update of estado_item on public.pedido_items
        for each row when (new.estado_item is distinct from old.estado_item)
        execute function supabase_functions.http_request(%L, 'POST', %L, '{}', '5000')$f$,
    'https://hausline-tracking.vercel.app/api/notificar-item',
    '{"Content-Type":"application/json","Authorization":"Bearer ' || v_secret || '"}'
  );
end $$;
