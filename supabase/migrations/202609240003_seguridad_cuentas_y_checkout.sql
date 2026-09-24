-- Hausline Tracking · SEGURIDAD (2026-09-24)
--
-- Desde que los clientes tienen cuenta ("Mi cuenta" de la tienda) en ESTE proyecto, estar
-- logueado ya no significa ser del equipo. Esta migración cierra lo que quedaba abierto a
-- "cualquier usuario con sesión" y valida en el servidor lo que antes se creía al navegador:
--
--   1) resenas: solo el personal activo modera (antes cualquier cuenta podía aprobar/borrar).
--   2) suscriptores: solo el personal activo ve/edita la lista de correos (era una fuga).
--   3) banners (si existe en este proyecto): solo el personal activo.
--   4) Precios del checkout: si el precio que manda el navegador es mucho menor que el del
--      catálogo (menos del 60%), se usa el del catálogo. Ofertas y cupones reales no se ven
--      afectados (los cupones/promos se calculan aparte, aquí en el servidor).
--   5) Anti-spam de encargos: máx. 60 productos por hora por WhatsApp y 300 en 10 min en total.
--
-- Re-ejecutable. Los permisos del bucket "comprobantes" (storage) NO se pueden cambiar por SQL
-- (error "must be owner of table objects"): ver los pasos del dashboard al final.

begin;

-- 1) Reseñas ─────────────────────────────────────────────────────────────────────────────
drop policy if exists resenas_admin_todo on public.resenas;
create policy resenas_admin_todo on public.resenas
  for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());

-- 2) Suscriptores ────────────────────────────────────────────────────────────────────────
drop policy if exists suscriptores_admin_todo on public.suscriptores;
create policy suscriptores_admin_todo on public.suscriptores
  for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());

-- 3) Banners (la tabla vive en el proyecto del catálogo; aquí solo si existe) ───────────────
do $$
begin
  if to_regclass('public.banners') is not null then
    execute 'drop policy if exists banners_admin on public.banners';
    execute 'create policy banners_admin on public.banners for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo())';
  end if;
end $$;

-- 4) Precio confiable ────────────────────────────────────────────────────────────────────
-- Precio del catálogo sincronizado (productos.precio_venta ya trae la oferta vigente).
create or replace function public.precio_confiable(p_codigo text, p_precio numeric)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_precio numeric(12,2) := round(greatest(0, coalesce(p_precio, 0)), 2);
  v_catalogo numeric(12,2);
begin
  if p_codigo is null or btrim(p_codigo) = '' then return v_precio; end if;
  select pr.precio_venta into v_catalogo
  from public.productos pr
  where upper(btrim(pr.codigo)) = upper(btrim(p_codigo)) and pr.activo
  limit 1;
  -- Sin precio en catálogo (p. ej. "cotizar") → se respeta lo enviado; lo revisa el admin.
  if v_catalogo is null or v_catalogo <= 0 then return v_precio; end if;
  if v_precio < round(v_catalogo * 0.6, 2) then return v_catalogo; end if;
  return v_precio;
end;
$$;
revoke all on function public.precio_confiable(text, numeric) from public, anon, authenticated;

-- 5) Anti-spam ───────────────────────────────────────────────────────────────────────────
create or replace function public.limitar_solicitudes(p_whatsapp text, p_nuevos integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.solicitudes
      where cliente_whatsapp = btrim(p_whatsapp) and created_at > now() - interval '1 hour') + coalesce(p_nuevos, 1) > 60 then
    raise exception 'Demasiados pedidos seguidos. Escríbenos por WhatsApp.' using errcode = '54000';
  end if;
  if (select count(*) from public.solicitudes where created_at > now() - interval '10 minutes') > 300 then
    raise exception 'El sistema está recibiendo demasiados pedidos. Intenta en unos minutos.' using errcode = '54000';
  end if;
end;
$$;
revoke all on function public.limitar_solicitudes(text, integer) from public, anon, authenticated;

-- ── Checkout con precio confiable + anti-spam (mismo código que v5, ver 202609200005) ────
create or replace function public.crear_solicitud_carrito(
  p_nombre text,
  p_whatsapp text,
  p_correo text default null,
  p_ciudad text default null,
  p_direccion text default null,
  p_envio text default 'estandar',
  p_pago text default 'total',
  p_cupon_codigo text default null,
  p_items jsonb default '[]'::jsonb
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_grupo text;
  v_rate numeric(12,4);
  v_envio text;
  v_pago text;
  c public.cupones;
  it jsonb;
  idx integer := 0;
  v_cant integer;
  v_precio numeric(12,2);
  v_recargo numeric(12,2);
  v_bruto numeric(12,2);
  v_desc numeric(12,2);
  v_total numeric(12,2);
  v_abono numeric(12,2);
  v_item_envio text;
  v_n integer;
  v_tot_cant integer := 0;
  v_tot_bruto numeric(12,2) := 0;
  -- Fuente del descuento (cupón o promo): tipo/valor + etiqueta y cupon_id (null si es promo).
  v_dtipo text := null;
  v_dvalor numeric(12,2) := 0;
  v_dlabel text := null;
  v_dcid uuid := null;
begin
  if p_whatsapp is null or trim(p_whatsapp) !~ '^[0-9+ ()-]{7,25}$' then raise exception 'WhatsApp inválido'; end if;
  if p_nombre is null or char_length(trim(p_nombre)) < 2 then raise exception 'Nombre inválido'; end if;
  v_n := coalesce(jsonb_array_length(p_items), 0);
  if v_n < 1 then raise exception 'Carrito vacío'; end if;
  if v_n > 30 then raise exception 'Demasiados productos en un solo pedido'; end if;
  perform public.limitar_solicitudes(p_whatsapp, v_n);

  v_envio := case when p_envio = 'rapido' then 'rapido' else 'estandar' end;
  v_pago := case when p_pago = '50' then '50' else 'total' end;
  select (valor_json->>'tipo_cambio')::numeric into v_rate from public.configuracion where clave = 'moneda';
  v_grupo := public.generar_codigo_solicitud();

  -- Totales del carrito (para evaluar las promos por cantidad/monto).
  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := least(50, greatest(1, coalesce((it->>'cantidad')::integer, 1)));
    v_tot_cant := v_tot_cant + v_cant;
    v_tot_bruto := v_tot_bruto + round(public.precio_confiable(it->>'producto_codigo', (it->>'precio_unitario')::numeric) * v_cant + greatest(0, coalesce((it->>'recargo')::numeric, 0)), 2);
  end loop;

  -- 1) CUPÓN (prioridad): validación autoritativa, una vez para todo el carrito.
  if p_cupon_codigo is not null and btrim(p_cupon_codigo) <> '' then
    select * into c from public.cupones where upper(btrim(codigo)) = upper(btrim(p_cupon_codigo)) limit 1;
    if found and c.activo and (c.vence_el is null or c.vence_el >= current_date)
       and (c.usos_max is null or c.usos_confirmados < c.usos_max) then
      v_dtipo := c.tipo; v_dvalor := c.valor; v_dlabel := c.codigo; v_dcid := c.id;
    end if;
  end if;
  -- 2) Sin cupón → la MEJOR promo automática que cumpla la condición (más descuento primero).
  if v_dtipo is null then
    select p.tipo, p.valor, 'Promo: ' || p.nombre
      into v_dtipo, v_dvalor, v_dlabel
    from public.promociones p
    where p.activo and (p.vence_el is null or p.vence_el >= current_date)
      and ((p.condicion_tipo = 'cantidad' and v_tot_cant  >= p.condicion_valor)
        or (p.condicion_tipo = 'monto'    and v_tot_bruto >= p.condicion_valor))
    order by (case when p.tipo = 'porcentaje' then round(v_tot_bruto * p.valor / 100.0, 2) else least(p.valor, v_tot_bruto) end) desc
    limit 1;
    -- v_dcid queda null: la promo no es un cupón, no se "quema".
  end if;

  for it in select * from jsonb_array_elements(p_items)
  loop
    idx := idx + 1;
    v_cant := least(50, greatest(1, coalesce((it->>'cantidad')::integer, 1)));
    v_precio := public.precio_confiable(it->>'producto_codigo', (it->>'precio_unitario')::numeric);
    v_recargo := round(greatest(0, coalesce((it->>'recargo')::numeric, 0)), 2);
    v_bruto := round(v_precio * v_cant + v_recargo, 2);
    -- Descuento (cupón o promo): porcentaje en cada ítem; monto fijo solo en el primero.
    v_desc := 0;
    if v_dtipo is not null then
      if v_dtipo = 'porcentaje' then v_desc := round(v_bruto * v_dvalor / 100.0, 2);
      elsif idx = 1 then v_desc := least(v_dvalor, v_bruto);
      end if;
    end if;
    v_total := greatest(0, round(v_bruto - v_desc, 2));
    v_abono := case when v_pago = '50' then round(v_total * 0.5, 2) else v_total end;
    v_item_envio := case when coalesce(it->>'envio', v_envio) = 'rapido' then 'rapido' else 'estandar' end;

    insert into public.solicitudes (
      cliente_nombre, cliente_whatsapp, cliente_correo, cliente_ciudad, cliente_direccion,
      producto, producto_codigo, marca, talla, color, cantidad, precio_unitario, total,
      tipo_cambio, total_nio, envio, recargo, pago_tipo, abono, imagen,
      cupon_id, cupon_codigo, descuento, grupo_codigo
    ) values (
      trim(p_nombre), trim(p_whatsapp), nullif(trim(p_correo), ''), nullif(trim(p_ciudad), ''), nullif(trim(p_direccion), ''),
      trim(coalesce(it->>'producto', 'Producto')), nullif(trim(coalesce(it->>'producto_codigo','')), ''),
      nullif(trim(coalesce(it->>'marca','')), ''), nullif(trim(coalesce(it->>'talla','')), ''), nullif(trim(coalesce(it->>'color','')), ''),
      v_cant, v_precio, v_total, v_rate,
      case when v_rate is not null then ceil(v_total * v_rate / 10.0) * 10 end,
      v_item_envio, v_recargo, v_pago, v_abono, nullif(trim(coalesce(it->>'imagen','')), ''),
      case when v_desc > 0 then v_dcid else null end, case when v_desc > 0 then v_dlabel else null end, v_desc,
      v_grupo
    );
  end loop;

  return v_grupo;
end;
$$;
revoke all on function public.crear_solicitud_carrito(text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.crear_solicitud_carrito(text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;


-- ── crear_solicitud_publica v6: precio confiable + anti-spam ────────────────────────────
create or replace function public.crear_solicitud_publica(
  p_nombre text,
  p_whatsapp text,
  p_correo text default null,
  p_ciudad text default null,
  p_direccion text default null,
  p_producto text default null,
  p_producto_codigo text default null,
  p_marca text default null,
  p_talla text default null,
  p_color text default null,
  p_cantidad integer default 1,
  p_precio_unitario numeric default 0,
  p_envio text default 'estandar',
  p_recargo numeric default 0,
  p_pago text default 'total',
  p_imagen text default null,
  p_cupon_codigo text default null
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cant integer;
  v_precio numeric(12,2);
  v_recargo numeric(12,2);
  v_bruto numeric(12,2);
  v_total numeric(12,2);
  v_abono numeric(12,2);
  v_rate numeric(12,4);
  v_pago text;
  v_envio text;
  v_codigo text;
  c public.cupones;
  v_desc numeric(12,2) := 0;
  v_dtipo text := null;
  v_dvalor numeric(12,2) := 0;
  v_dlabel text := null;
  v_dcid uuid := null;
begin
  if p_whatsapp is null or trim(p_whatsapp) !~ '^[0-9+ ()-]{7,25}$' then raise exception 'WhatsApp inválido'; end if;
  if p_nombre is null or char_length(trim(p_nombre)) < 2 then raise exception 'Nombre inválido'; end if;
  if p_producto is null or char_length(trim(p_producto)) < 2 then raise exception 'Producto inválido'; end if;

  perform public.limitar_solicitudes(p_whatsapp, 1);
  v_cant := least(50, greatest(1, coalesce(p_cantidad, 1)));
  v_precio := public.precio_confiable(p_producto_codigo, p_precio_unitario);
  v_recargo := round(greatest(0, coalesce(p_recargo, 0)), 2);
  v_bruto := round(v_precio * v_cant + v_recargo, 2);
  v_envio := case when p_envio = 'rapido' then 'rapido' else 'estandar' end;
  v_pago := case when p_pago = '50' then '50' else 'total' end;

  -- 1) CUPÓN (prioridad).
  if p_cupon_codigo is not null and btrim(p_cupon_codigo) <> '' then
    select * into c from public.cupones where upper(btrim(codigo)) = upper(btrim(p_cupon_codigo)) limit 1;
    if found and c.activo
       and (c.vence_el is null or c.vence_el >= current_date)
       and (c.usos_max is null or c.usos_confirmados < c.usos_max) then
      v_dtipo := c.tipo; v_dvalor := c.valor; v_dlabel := c.codigo; v_dcid := c.id;
    end if;
  end if;
  -- 2) Sin cupón → mejor promo automática que cumpla la condición.
  if v_dtipo is null then
    select p.tipo, p.valor, 'Promo: ' || p.nombre
      into v_dtipo, v_dvalor, v_dlabel
    from public.promociones p
    where p.activo and (p.vence_el is null or p.vence_el >= current_date)
      and ((p.condicion_tipo = 'cantidad' and v_cant  >= p.condicion_valor)
        or (p.condicion_tipo = 'monto'    and v_bruto >= p.condicion_valor))
    order by (case when p.tipo = 'porcentaje' then round(v_bruto * p.valor / 100.0, 2) else least(p.valor, v_bruto) end) desc
    limit 1;
  end if;

  if v_dtipo = 'porcentaje' then v_desc := round(v_bruto * v_dvalor / 100.0, 2);
  elsif v_dtipo = 'monto' then v_desc := least(v_dvalor, v_bruto);
  end if;

  v_total := greatest(0, round(v_bruto - v_desc, 2));
  v_abono := case when v_pago = '50' then round(v_total * 0.5, 2) else v_total end;

  select (valor_json->>'tipo_cambio')::numeric into v_rate from public.configuracion where clave = 'moneda';

  insert into public.solicitudes (
    cliente_nombre, cliente_whatsapp, cliente_correo, cliente_ciudad, cliente_direccion,
    producto, producto_codigo, marca, talla, color, cantidad, precio_unitario, total,
    tipo_cambio, total_nio, envio, recargo, pago_tipo, abono, imagen,
    cupon_id, cupon_codigo, descuento
  ) values (
    trim(p_nombre), trim(p_whatsapp), nullif(trim(p_correo), ''), nullif(trim(p_ciudad), ''), nullif(trim(p_direccion), ''),
    trim(p_producto), nullif(trim(p_producto_codigo), ''), nullif(trim(p_marca), ''), nullif(trim(p_talla), ''), nullif(trim(p_color), ''),
    v_cant, v_precio, v_total, v_rate, case when v_rate is not null then ceil(v_total * v_rate / 10.0) * 10 end,
    v_envio, v_recargo, v_pago, v_abono, nullif(trim(p_imagen), ''),
    case when v_desc > 0 then v_dcid else null end, case when v_desc > 0 then v_dlabel else null end, v_desc
  ) returning codigo into v_codigo;

  return v_codigo;
end;
$$;
revoke all on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text, text, text) from public;
grant execute on function public.crear_solicitud_publica(text, text, text, text, text, text, text, text, text, text, integer, numeric, text, numeric, text, text, text) to anon, authenticated;

commit;

-- ═══════════════════════ PASOS EN EL DASHBOARD (storage) ═══════════════════════════════
-- Storage → Policies → bucket "comprobantes":
--   • Editar "comprobantes_auth_read" (SELECT, authenticated) → USING:
--       bucket_id = 'comprobantes' and public.usuario_activo()
--     (antes cualquier cuenta de cliente podía ver TODOS los comprobantes de pago).
-- Storage → Buckets → "comprobantes" → Edit bucket:
--   • Restrict file size: 10 MB · Allowed MIME types: image/*, application/pdf
