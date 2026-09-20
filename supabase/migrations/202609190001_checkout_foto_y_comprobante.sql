-- Hausline · Mejoras del checkout de pago (/checkout) del sitio.
--
-- 1) Las lecturas públicas de encargos (obtener_solicitud_publica / _grupo) ahora
--    devuelven la FOTO del producto y si el cliente YA subió su comprobante, para que
--    el checkout muestre las miniaturas y el estado "comprobante recibido".
-- 2) El cliente puede SUBIR su comprobante desde el checkout: se guarda en el bucket
--    privado `comprobantes` (anon solo puede subir, no leer) y la ruta se registra en
--    la solicitud con `registrar_comprobante_publico`. El admin (tracking) lo abre con
--    una URL firmada. La columna `solicitudes.comprobante_url` ya existe; ahí guardamos
--    la RUTA del archivo en el bucket.
begin;

-- ── 1) Lecturas públicas con imagen + comprobante ───────────────────────────────
create or replace function public.obtener_solicitud_publica(p_codigo text)
returns json
language sql security definer stable
set search_path = public, pg_temp
as $$
  select json_build_object(
    'codigo',          s.codigo,
    'producto',        s.producto,
    'producto_codigo', s.producto_codigo,
    'marca',           s.marca,
    'talla',           s.talla,
    'color',           s.color,
    'cantidad',        s.cantidad,
    'precio_unitario', s.precio_unitario,
    'total',           s.total,
    'abono',           s.abono,
    'saldo',           greatest(0, s.total - coalesce(s.abono, 0)),
    'pago_tipo',       s.pago_tipo,
    'envio',           s.envio,
    'tipo_cambio',     s.tipo_cambio,
    'total_nio',       s.total_nio,
    'abono_nio',       case when s.tipo_cambio is not null
                            then ceil(coalesce(s.abono, 0) * s.tipo_cambio / 10.0) * 10
                            else null end,
    'estado',          s.estado,
    'imagen',          s.imagen,
    'comprobante',     (s.comprobante_url is not null),
    'cliente_nombre',  s.cliente_nombre,
    'created_at',      s.created_at,
    'vence_at',        s.vence_at
  )
  from public.solicitudes s
  where s.codigo = upper(trim(p_codigo))
  limit 1;
$$;

create or replace function public.obtener_solicitud_grupo(p_codigo text)
returns json
language sql security definer stable
set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_object(
    'codigo', s.codigo,
    'grupo_codigo', s.grupo_codigo,
    'producto', s.producto,
    'producto_codigo', s.producto_codigo,
    'marca', s.marca, 'talla', s.talla, 'color', s.color,
    'cantidad', s.cantidad, 'precio_unitario', s.precio_unitario,
    'total', s.total, 'abono', s.abono,
    'saldo', greatest(0, s.total - coalesce(s.abono, 0)),
    'pago_tipo', s.pago_tipo, 'envio', s.envio,
    'tipo_cambio', s.tipo_cambio, 'total_nio', s.total_nio,
    'abono_nio', case when s.tipo_cambio is not null then ceil(coalesce(s.abono,0) * s.tipo_cambio / 10.0) * 10 else null end,
    'estado', s.estado, 'cliente_nombre', s.cliente_nombre,
    'imagen', s.imagen,
    'comprobante', (s.comprobante_url is not null),
    'created_at', s.created_at, 'vence_at', s.vence_at
  ) order by s.created_at), '[]'::json)
  from public.solicitudes s
  where upper(trim(p_codigo)) in (upper(coalesce(s.grupo_codigo, '')), upper(s.codigo));
$$;

revoke all on function public.obtener_solicitud_publica(text) from public;
revoke all on function public.obtener_solicitud_grupo(text) from public;
grant execute on function public.obtener_solicitud_publica(text) to anon, authenticated;
grant execute on function public.obtener_solicitud_grupo(text)   to anon, authenticated;

-- ── 2) Bucket privado para los comprobantes ─────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- anon SOLO puede subir (no leer/listar/borrar); authenticated (admin) puede leer.
drop policy if exists "comprobantes_anon_insert" on storage.objects;
create policy "comprobantes_anon_insert" on storage.objects
  for insert to anon with check (bucket_id = 'comprobantes');

drop policy if exists "comprobantes_auth_read" on storage.objects;
create policy "comprobantes_auth_read" on storage.objects
  for select to authenticated using (bucket_id = 'comprobantes');

-- ── 3) Registrar el comprobante subido en la solicitud ──────────────────────────
-- Guarda la ruta del archivo en solicitudes.comprobante_url. Solo afecta encargos
-- PENDIENTES cuyo código/grupo coincide, y exige que la ruta cuelgue de la carpeta
-- del código (evita apuntar a archivos de otro pedido).
create or replace function public.registrar_comprobante_publico(p_codigo text, p_ruta text)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_n integer; v_cod text;
begin
  if p_codigo is null or p_ruta is null or btrim(p_codigo) = '' or btrim(p_ruta) = '' then
    return false;
  end if;
  v_cod := upper(btrim(p_codigo));
  -- La ruta debe empezar con "<CODIGO>/" (la carpeta del propio pedido).
  if left(upper(p_ruta), length(v_cod) + 1) <> v_cod || '/' then
    return false;
  end if;
  update public.solicitudes
     set comprobante_url = p_ruta
   where upper(trim(p_codigo)) in (upper(coalesce(grupo_codigo, '')), upper(codigo))
     and estado = 'pendiente';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.registrar_comprobante_publico(text, text) from public;
grant execute on function public.registrar_comprobante_publico(text, text) to anon, authenticated;

commit;
