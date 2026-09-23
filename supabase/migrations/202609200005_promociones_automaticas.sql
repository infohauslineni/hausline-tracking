-- Hausline · PROMOCIONES AUTOMÁTICAS (sin código).
--
-- A diferencia de los cupones (código que el cliente escribe/recibe), estas se aplican SOLAS
-- en el checkout cuando el carrito cumple una condición:
--   • por CANTIDAD  → "si hay N productos o más, X% (o US$X)"
--   • por MONTO     → "si el total pasa de US$X, X% (o US$X)"
-- Regla: un CUPÓN por código tiene prioridad; si no hay cupón válido, se aplica la MEJOR promo
-- automática que cumpla la condición (la que dé más descuento). No se acumulan.
-- El descuento se calcula SIEMPRE del lado servidor (autoritativo) en crear_solicitud_*.
begin;

create table if not exists public.promociones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 60),
  condicion_tipo text not null check (condicion_tipo in ('cantidad','monto')),
  condicion_valor numeric(12,2) not null check (condicion_valor > 0), -- N productos, o US$ del total
  tipo text not null default 'porcentaje' check (tipo in ('porcentaje','monto')),
  valor numeric(12,2) not null check (valor > 0),                     -- % (1–100) o US$ de descuento
  activo boolean not null default true,
  vence_el date,
  nota text,
  created_by uuid references public.perfiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tipo <> 'porcentaje' or valor <= 100)
);
create index if not exists promociones_activas_idx on public.promociones (activo) where activo;

alter table public.promociones enable row level security;
drop policy if exists promociones_admin_total on public.promociones;
create policy promociones_admin_total on public.promociones for all to authenticated
  using (public.usuario_activo()) with check (public.usuario_activo());
grant select, insert, update, delete on public.promociones to authenticated;

drop trigger if exists promociones_updated_at on public.promociones;
create trigger promociones_updated_at before update on public.promociones for each row execute function public.set_updated_at();

-- Promos activas para la TIENDA (mostrar el descuento en el checkout). Pública (anon).
-- El front la usa solo para PINTAR; el descuento real lo aplica el servidor al crear el pedido.
create or replace function public.promociones_activas()
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_object(
    'id', p.id, 'nombre', p.nombre,
    'condicion_tipo', p.condicion_tipo, 'condicion_valor', p.condicion_valor,
    'tipo', p.tipo, 'valor', p.valor
  ) order by p.condicion_valor), '[]'::json)
  from public.promociones p
  where p.activo and (p.vence_el is null or p.vence_el >= current_date);
$$;
grant execute on function public.promociones_activas() to anon, authenticated;

-- ── crear_solicitud_carrito v5: + promo automática cuando NO hay cupón ──────────────────
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

  v_envio := case when p_envio = 'rapido' then 'rapido' else 'estandar' end;
  v_pago := case when p_pago = '50' then '50' else 'total' end;
  select (valor_json->>'tipo_cambio')::numeric into v_rate from public.configuracion where clave = 'moneda';
  v_grupo := public.generar_codigo_solicitud();

  -- Totales del carrito (para evaluar las promos por cantidad/monto).
  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := least(50, greatest(1, coalesce((it->>'cantidad')::integer, 1)));
    v_tot_cant := v_tot_cant + v_cant;
    v_tot_bruto := v_tot_bruto + round(greatest(0, coalesce((it->>'precio_unitario')::numeric, 0)) * v_cant + greatest(0, coalesce((it->>'recargo')::numeric, 0)), 2);
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
    v_precio := round(greatest(0, coalesce((it->>'precio_unitario')::numeric, 0)), 2);
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

-- ── crear_solicitud_publica v5: + promo automática cuando NO hay cupón (producto único) ──
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

  v_cant := least(50, greatest(1, coalesce(p_cantidad, 1)));
  v_precio := round(greatest(0, coalesce(p_precio_unitario, 0)), 2);
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
