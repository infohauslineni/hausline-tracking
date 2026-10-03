-- DIRECCIÓN + ENVÍO PREDETERMINADO DEL CLIENTE
--   · El checkout pide la dirección de entrega (Nicaragua). Al confirmar el encargo, esa dirección
--     queda guardada en la ficha del cliente (la más reciente gana) junto con su departamento.
--   · Cada cliente tiene un COSTO DE ENVÍO PREDETERMINADO (clientes.costo_envio, en US$): se llena
--     solo con la tarifa de su departamento (Configuración → Delivery) y se puede cambiar a mano.
--   · Cuando el pedido está "Disponible para entrega", el correo le muestra el total CON envío y un
--     botón para CONFIRMAR o corregir la dirección (página hauslineshopni.es/entrega/). Al confirmar
--     queda como "Envío solicitado por el cliente" en el pedido (entrega_direccion / entrega_costo).

alter table public.clientes add column if not exists costo_envio numeric(12,2) check (costo_envio is null or costo_envio >= 0);

-- Tarifa de envío (US$) de un departamento según Configuración → Delivery. null = a cotizar.
create or replace function public.tarifa_envio_usd(p_departamento text)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when t.moneda = 'NIO'
              then round(t.costo / greatest(coalesce((select nullif(valor_json->>'tipo_cambio', '')::numeric from public.configuracion where clave = 'moneda'), 37), 1), 2)
              else t.costo end
    from public.tarifas_delivery t
   where t.activo and lower(btrim(t.zona)) = lower(btrim(coalesce(p_departamento, '')))
   limit 1;
$$;
revoke all on function public.tarifa_envio_usd(text) from public, anon, authenticated;
grant execute on function public.tarifa_envio_usd(text) to authenticated, service_role;

-- Al confirmar un encargo (la solicitud queda con pedido): guarda dirección/departamento en el
-- cliente y, si todavía no tiene, su costo de envío predeterminado.
create or replace function public.solicitud_direccion_a_cliente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cliente uuid; v_dep text := nullif(btrim(coalesce(new.cliente_ciudad, '')), '');
begin
  select cliente_id into v_cliente from public.pedidos where id = new.pedido_id;
  if v_cliente is null then return new; end if;
  -- "Ciudad, País" = envío internacional: no es un departamento de Nicaragua.
  if v_dep is not null and position(',' in v_dep) > 0 then v_dep := null; end if;
  update public.clientes c set
    direccion    = coalesce(nullif(btrim(new.cliente_direccion), ''), c.direccion),
    departamento = coalesce(v_dep, c.departamento),
    ciudad       = coalesce(nullif(btrim(c.ciudad), ''), v_dep),
    costo_envio  = coalesce(c.costo_envio, public.tarifa_envio_usd(coalesce(v_dep, c.departamento, c.ciudad))),
    updated_at   = now()
  where c.id = v_cliente;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.solicitud_direccion_a_cliente() from public, anon, authenticated;
drop trigger if exists solicitudes_direccion_cliente on public.solicitudes;
create trigger solicitudes_direccion_cliente
  after update of pedido_id on public.solicitudes
  for each row when (new.pedido_id is not null and old.pedido_id is null)
  execute function public.solicitud_direccion_a_cliente();

-- Clientes que ya existen: costo de envío según su departamento (si no tienen).
update public.clientes c set costo_envio = public.tarifa_envio_usd(coalesce(c.departamento, c.ciudad))
 where c.costo_envio is null and public.tarifa_envio_usd(coalesce(c.departamento, c.ciudad)) is not null;

-- Código del enlace "Confirmar dirección" (lo arma el servidor; nadie puede adivinarlo).
create or replace function public.token_entrega_pedido(p_codigo text)
returns text language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select encode(extensions.hmac('entrega:' || upper(btrim(p_codigo)), (select valor from public.config_privada where clave = 'secreto_baja'), 'sha256'), 'hex');
$$;
revoke all on function public.token_entrega_pedido(text) from public, anon, authenticated;
grant execute on function public.token_entrega_pedido(text) to service_role;

-- Datos para la página de confirmación (pública, con el código del enlace).
create or replace function public.entrega_pedido_publico(p_codigo text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p public.pedidos; c public.clientes; v_costo numeric;
begin
  if p_token is null or p_token <> public.token_entrega_pedido(p_codigo) then return jsonb_build_object('ok', false, 'motivo', 'enlace'); end if;
  select * into p from public.pedidos where upper(codigo) = upper(btrim(p_codigo));
  if not found then return jsonb_build_object('ok', false, 'motivo', 'pedido'); end if;
  select * into c from public.clientes where id = p.cliente_id;
  v_costo := coalesce(p.entrega_costo, c.costo_envio, public.tarifa_envio_usd(coalesce(c.departamento, c.ciudad)));
  return jsonb_build_object('ok', true, 'codigo', p.codigo, 'estado', p.estado, 'nombre', split_part(coalesce(c.nombre, ''), ' ', 1),
    'direccion', coalesce(p.entrega_direccion->>'direccion', c.direccion), 'referencia', p.entrega_direccion->>'referencia',
    'departamento', coalesce(p.entrega_direccion->>'departamento', c.departamento, c.ciudad),
    'costo_envio', v_costo, 'saldo', greatest(0, coalesce(p.saldo, 0)), 'confirmada', p.entrega_solicitada_at is not null,
    'tipo_cambio', coalesce((select nullif(valor_json->>'tipo_cambio', '')::numeric from public.configuracion where clave = 'moneda'), 37));
end;
$$;
revoke all on function public.entrega_pedido_publico(text, text) from public, anon, authenticated;
grant execute on function public.entrega_pedido_publico(text, text) to anon, authenticated;

-- El cliente confirma (o corrige) la dirección desde el enlace del correo.
create or replace function public.confirmar_entrega_publica(p_codigo text, p_token text, p_direccion text, p_referencia text, p_departamento text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.pedidos; c public.clientes; v_dir text := left(btrim(coalesce(p_direccion, '')), 300);
  v_ref text := nullif(left(btrim(coalesce(p_referencia, '')), 200), ''); v_dep text := nullif(left(btrim(coalesce(p_departamento, '')), 60), ''); v_costo numeric;
begin
  if p_token is null or p_token <> public.token_entrega_pedido(p_codigo) then return jsonb_build_object('ok', false, 'motivo', 'enlace'); end if;
  if char_length(v_dir) < 5 then return jsonb_build_object('ok', false, 'motivo', 'direccion'); end if;
  select * into p from public.pedidos where upper(codigo) = upper(btrim(p_codigo)) for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'pedido'); end if;
  if p.estado in ('entregado', 'cancelado') then return jsonb_build_object('ok', false, 'motivo', 'cerrado'); end if;
  select * into c from public.clientes where id = p.cliente_id;
  -- Si cambió de departamento, el envío se recalcula con la tarifa del nuevo; si no, su costo de siempre.
  v_costo := case when v_dep is not null and lower(v_dep) <> lower(coalesce(c.departamento, c.ciudad, ''))
                  then coalesce(public.tarifa_envio_usd(v_dep), c.costo_envio)
                  else coalesce(c.costo_envio, public.tarifa_envio_usd(coalesce(v_dep, c.departamento, c.ciudad))) end;
  update public.pedidos set
    entrega_direccion = jsonb_build_object('nombre', coalesce(c.nombre, ''), 'direccion', v_dir, 'referencia', v_ref,
                          'ciudad', coalesce(v_dep, c.departamento, c.ciudad, ''), 'departamento', coalesce(v_dep, c.departamento, c.ciudad), 'pais', 'Nicaragua'),
    entrega_solicitada_at = now(),
    entrega_costo = v_costo
  where id = p.id;
  update public.clientes set direccion = v_dir || coalesce(' · Ref: ' || v_ref, ''), departamento = coalesce(v_dep, departamento), updated_at = now() where id = c.id;
  return jsonb_build_object('ok', true, 'costo_envio', v_costo);
end;
$$;
revoke all on function public.confirmar_entrega_publica(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.confirmar_entrega_publica(text, text, text, text, text) to anon, authenticated;

select (select count(*) from pg_trigger where tgname = 'solicitudes_direccion_cliente') as trigger_creado,
       (select count(*) from public.clientes where costo_envio is not null) as clientes_con_envio,
       public.tarifa_envio_usd('Managua') as envio_managua;
