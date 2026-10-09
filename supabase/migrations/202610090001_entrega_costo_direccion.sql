-- Correo "Disponible" y página /entrega/: el costo de envío sigue el MISMO orden que el panel:
--   1. línea "Envío / delivery" del pedido (ya está en el saldo → se devuelve el saldo SIN ella),
--   2. el que confirmó el cliente (pedidos.entrega_costo),
--   3. el fijado para su dirección principal de Mi cuenta (direcciones_cliente.costo_delivery),
--   4. el predeterminado de su ficha (clientes.costo_envio),
--   5. la tarifa de su departamento.
-- La dirección: la confirmada en el pedido > la principal de Mi cuenta > la de la ficha.
create or replace function public.entrega_pedido_publico(p_codigo text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p public.pedidos; c public.clientes; d public.direcciones_cliente; v_user uuid; v_linea numeric; v_costo numeric; v_saldo numeric;
begin
  if p_token is null or p_token <> public.token_entrega_pedido(p_codigo) then return jsonb_build_object('ok', false, 'motivo', 'enlace'); end if;
  select * into p from public.pedidos where upper(codigo) = upper(btrim(p_codigo));
  if not found then return jsonb_build_object('ok', false, 'motivo', 'pedido'); end if;
  select * into c from public.clientes where id = p.cliente_id;
  v_user := c.user_id;
  if v_user is null and nullif(btrim(coalesce(c.correo, '')), '') is not null then
    select cc.user_id into v_user from public.cuentas_cliente cc
     where lower(cc.correo) = lower(btrim(c.correo)) and cc.verificada_at is not null limit 1;
  end if;
  if v_user is not null then
    select * into d from public.direcciones_cliente where user_id = v_user order by predeterminada desc, created_at limit 1;
  end if;
  select sum(i.cantidad * i.precio_unitario) into v_linea from public.pedido_items i where i.pedido_id = p.id and i.producto = 'Envío / delivery';
  v_saldo := greatest(0, coalesce(p.saldo, 0) - coalesce(v_linea, 0));
  v_costo := coalesce(nullif(v_linea, 0), p.entrega_costo, d.costo_delivery, c.costo_envio,
    public.tarifa_envio_usd(coalesce(p.entrega_direccion->>'departamento', d.departamento, c.departamento, c.ciudad)));
  return jsonb_build_object('ok', true, 'codigo', p.codigo, 'estado', p.estado, 'nombre', split_part(coalesce(c.nombre, ''), ' ', 1),
    'direccion', coalesce(p.entrega_direccion->>'direccion', d.direccion, c.direccion),
    'referencia', coalesce(p.entrega_direccion->>'referencia', d.referencia),
    'departamento', coalesce(p.entrega_direccion->>'departamento', d.departamento, d.ciudad, c.departamento, c.ciudad),
    'costo_envio', v_costo, 'saldo', v_saldo, 'confirmada', p.entrega_solicitada_at is not null,
    'tipo_cambio', coalesce((select nullif(valor_json->>'tipo_cambio', '')::numeric from public.configuracion where clave = 'moneda'), 37));
end;
$$;
revoke all on function public.entrega_pedido_publico(text, text) from public, anon, authenticated;
grant execute on function public.entrega_pedido_publico(text, text) to anon, authenticated;
