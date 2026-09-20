-- Hausline · El aviso al ADMIN se manda SOLO cuando el cliente reporta el pago.
--
-- Problema: el correo interno de "nuevo encargo" se dispara con el webhook de INSERT en
-- `solicitudes` (al terminar el paso 1 del checkout). Como mucha gente rellena los datos y
-- NUNCA paga, el buzón del admin se llena de encargos que se vencen solos. Sí queremos que el
-- CLIENTE reciba su correo de "esperamos tu pago" (empuja la conversión), pero al ADMIN solo
-- le interesa cuando hay un pago que verificar.
--
-- Solución: marcamos `pago_reportado_at` cuando el cliente sube el comprobante o toca
-- "Ya realicé mi pago". El webhook (api/notificar-encargo) manda el correo al admin recién en
-- ese momento (evento UPDATE), no en el INSERT.
begin;

alter table public.solicitudes add column if not exists pago_reportado_at timestamptz;
-- Marca (para deduplicar) que YA se avisó al admin del pago reportado de este grupo.
alter table public.solicitudes add column if not exists aviso_pago_at timestamptz;
create index if not exists solicitudes_pago_reportado_idx on public.solicitudes(cliente_whatsapp, pago_reportado_at, aviso_pago_at);

-- El cliente reporta que ya hizo el pago (aunque no suba comprobante). Marca todo su grupo.
create or replace function public.reportar_pago_publico(p_codigo text)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if p_codigo is null or btrim(p_codigo) = '' then return false; end if;
  update public.solicitudes
     set pago_reportado_at = coalesce(pago_reportado_at, now())
   where upper(trim(p_codigo)) in (upper(coalesce(grupo_codigo, '')), upper(codigo))
     and estado = 'pendiente';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public.reportar_pago_publico(text) from public;
grant execute on function public.reportar_pago_publico(text) to anon, authenticated;

-- Subir comprobante TAMBIÉN cuenta como "pago reportado" (además de guardar la ruta).
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
  if left(upper(p_ruta), length(v_cod) + 1) <> v_cod || '/' then
    return false;
  end if;
  update public.solicitudes
     set comprobante_url = p_ruta,
         pago_reportado_at = coalesce(pago_reportado_at, now())
   where upper(trim(p_codigo)) in (upper(coalesce(grupo_codigo, '')), upper(codigo))
     and estado = 'pendiente';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public.registrar_comprobante_publico(text, text) from public;
grant execute on function public.registrar_comprobante_publico(text, text) to anon, authenticated;

-- Las lecturas públicas del checkout devuelven también si el cliente ya reportó el pago,
-- para pintar la línea de estados en la pantalla de confirmación.
create or replace function public.obtener_solicitud_grupo(p_codigo text)
returns json
language sql security definer stable
set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_object(
    'codigo', s.codigo, 'grupo_codigo', s.grupo_codigo,
    'producto', s.producto, 'producto_codigo', s.producto_codigo,
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
    'pago_reportado', (s.pago_reportado_at is not null),
    'created_at', s.created_at, 'vence_at', s.vence_at
  ) order by s.created_at), '[]'::json)
  from public.solicitudes s
  where upper(trim(p_codigo)) in (upper(coalesce(s.grupo_codigo, '')), upper(s.codigo));
$$;

create or replace function public.obtener_solicitud_publica(p_codigo text)
returns json
language sql security definer stable
set search_path = public, pg_temp as $$
  select json_build_object(
    'codigo', s.codigo, 'producto', s.producto, 'producto_codigo', s.producto_codigo,
    'marca', s.marca, 'talla', s.talla, 'color', s.color,
    'cantidad', s.cantidad, 'precio_unitario', s.precio_unitario,
    'total', s.total, 'abono', s.abono,
    'saldo', greatest(0, s.total - coalesce(s.abono, 0)),
    'pago_tipo', s.pago_tipo, 'envio', s.envio,
    'tipo_cambio', s.tipo_cambio, 'total_nio', s.total_nio,
    'abono_nio', case when s.tipo_cambio is not null then ceil(coalesce(s.abono, 0) * s.tipo_cambio / 10.0) * 10 else null end,
    'estado', s.estado, 'imagen', s.imagen,
    'comprobante', (s.comprobante_url is not null),
    'pago_reportado', (s.pago_reportado_at is not null),
    'cliente_nombre', s.cliente_nombre, 'created_at', s.created_at, 'vence_at', s.vence_at
  )
  from public.solicitudes s where s.codigo = upper(trim(p_codigo)) limit 1;
$$;
grant execute on function public.obtener_solicitud_grupo(text) to anon, authenticated;
grant execute on function public.obtener_solicitud_publica(text) to anon, authenticated;

commit;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO MANUAL en Supabase (Dashboard → Database → Webhooks), en el webhook que
-- llama a api/notificar-encargo sobre `solicitudes`:
--   • Marcá también el evento UPDATE (además de INSERT).
-- El endpoint ya distingue: INSERT → correo solo al CLIENTE; UPDATE con
-- pago_reportado_at → correo al ADMIN. Así el admin recibe correo SOLO cuando el
-- cliente reporta el pago, no cuando abandona el checkout.
-- ────────────────────────────────────────────────────────────────────────────
