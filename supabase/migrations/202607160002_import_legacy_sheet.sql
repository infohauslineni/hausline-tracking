-- Importación única desde HAUSLINE DAHSBOARD.
-- Es idempotente: se puede ejecutar nuevamente sin duplicar códigos, pagos o movimientos.
begin;

insert into public.proveedores (nombre, activo) values ('WANYISHOES', true)
on conflict (nombre) do update set activo = true;

create temporary table import_clientes (nombre text, whatsapp text, ciudad text, direccion text) on commit drop;
insert into import_clientes values
('MATEO ACEVEDO','8363 5094','MANAGUA','X'),
('JOFELIT SOMARRIBA','8453 4663','MANAGUA','X'),
('DUNESQUI GONZALES','8518 5109','DEPARTAMENTO','X'),
('CARMEN PERALTA','8714 7545','MANAGUA','X'),
('NAVAS CAR','7740 1177','MANAGUA','X'),
('DARVIN VALDEZ','8525 5681','DEPARTAMENTO','X'),
('Kendrick Gomez','8688 2212','Managua','x'),
('David Mojica','8919 2669',null,'Z');

insert into public.clientes (nombre, whatsapp, ciudad, direccion, notas)
select i.nombre, i.whatsapp, i.ciudad, i.direccion, 'Importado desde Google Sheets'
from import_clientes i
where not exists (
  select 1 from public.clientes c
  where regexp_replace(c.whatsapp, '\D', '', 'g') = regexp_replace(i.whatsapp, '\D', '', 'g')
);

create temporary table import_productos (codigo text, nombre text, marca text, categoria text, talla text, costo numeric, venta numeric) on commit drop;
insert into import_productos values
('AMI-LEGACY','AMI PARIS','AMI PARIS','ROPA','L',24.50,48.00),
('BK002','BIRKENSTOCK','BIKRENSTOCK',null,'40',64.50,80.00),
('CL001','CHRISTIAN LOUBUTIN','LOUBUTIN',null,'42',79.50,144.00),
('FT','GOLDEN GOOSE','GG','ZAPATOS','35',89.50,140.00),
('PP','PHILIP MODEL','PPM','ZAPATOS','40',89.50,160.00),
('CL0012','CHRISTIAN LOUBUTIN','CL','ZAPATOS','43',79.50,144.00),
('CL0002','CHRISTIAN LOUBUTIN','CL','ZAPATOS','38',79.50,144.00),
('D&C007','DOLCE GABANNA','Dolce & Gabanna','Zapatos','40',79.50,160.00),
('GG008','Zapatos Golden Goose','Golden Goose','Zapatos','38',89.50,148.00);

insert into public.productos (codigo, nombre, marca, categoria, proveedor_id, tallas, precio_compra, precio_venta, activo, descripcion)
select i.codigo, i.nombre, i.marca, i.categoria, p.id, array[i.talla], i.costo, i.venta, true, 'Importado desde Google Sheets'
from import_productos i cross join public.proveedores p
where p.nombre = 'WANYISHOES'
on conflict (codigo) do update set
  nombre = excluded.nombre, marca = excluded.marca, categoria = excluded.categoria,
  proveedor_id = excluded.proveedor_id, tallas = excluded.tallas,
  precio_compra = excluded.precio_compra, precio_venta = excluded.precio_venta, activo = true;

create temporary table import_pedidos (
  fecha date, codigo text, cliente text, whatsapp text, ciudad text, direccion text,
  producto_codigo text, producto text, marca text, categoria text, talla text, cantidad integer,
  costo numeric, venta numeric, abono numeric, envio numeric, delivery numeric, otros numeric,
  estado public.estado_pedido, metodo text, fecha_estimada date
) on commit drop;

insert into import_pedidos values
('2026-06-22','HS483686','MATEO ACEVEDO','8363 5094','MANAGUA','X','AMI-LEGACY','AMI PARIS','AMI PARIS','ROPA','L',1,24.50,48.00,24.00,0,0,0,'transito_internacional','BAC TRANSFER',null),
('2026-06-28','HS483687','JOFELIT SOMARRIBA','8453 4663','MANAGUA','X','BK002','BIRKENSTOCK','BIKRENSTOCK',null,'40',1,64.50,80.00,45.00,0,0,0,'llego_nicaragua','LAFISE TRANSFER','2026-07-17'),
('2026-06-29','HS483688','DUNESQUI GONZALES','8518 5109','DEPARTAMENTO','X','CL001','CHRISTIAN LOUBUTIN','LOUBUTIN',null,'42',1,79.50,144.00,75.00,0,0,0,'llego_nicaragua','LAFISE TRANSFER','2026-07-17'),
('2026-06-29','HS483689','CARMEN PERALTA','8714 7545','MANAGUA','X','FT','GOLDEN GOOSE','GG','ZAPATOS','35',1,89.50,140.00,70.00,0,0,0,'transito_internacional','LAFISE TRANSFER',null),
('2026-07-04','HS483790','MATEO ACEVEDO','8363 5094','MANAGUA','X','PP','PHILIP MODEL','PPM','ZAPATOS','40',1,89.50,160.00,100.00,0,0,0,'en_preparacion','LAFISE TRANSFER',null),
('2026-07-06','HS483791','NAVAS CAR','7740 1177','MANAGUA','X','CL0012','CHRISTIAN LOUBUTIN','CL','ZAPATOS','43',1,79.50,144.00,72.00,0,0,0,'transito_internacional','LAFISE TRANSFER',null),
('2026-07-10','HS483792','DARVIN VALDEZ','8525 5681','DEPARTAMENTO','X','CL0002','CHRISTIAN LOUBUTIN','CL','ZAPATOS','38',1,79.50,144.00,72.00,0,0,0,'transito_internacional','LAFISE TRANSFER',null),
('2026-07-15','HS157840','Kendrick Gomez','8688 2212','Managua','x','D&C007','DOLCE GABANNA','Dolce & Gabanna','Zapatos','40',1,79.50,160.00,80.00,0,0,0,'en_preparacion','Transferencia',null),
('2026-07-16','HS173345','David Mojica','8919 2669',null,'Z','GG008','Zapatos Golden Goose','Golden Goose','Zapatos','38',1,89.50,148.00,75.00,0,0,0,'en_preparacion','Transferencia','2026-08-15');

insert into public.pedidos (codigo, cliente_id, estado, fecha_pedido, fecha_estimada, total, abono, metodo_pago, notas_internas, notas_publicas)
select i.codigo, c.id, i.estado, i.fecha, i.fecha_estimada, i.venta * i.cantidad, i.abono, i.metodo,
       'Importado desde Google Sheets', case i.estado
         when 'en_preparacion' then 'Estamos preparando tu pedido.'
         when 'transito_internacional' then 'Tu pedido se encuentra en tránsito.'
         when 'llego_nicaragua' then 'Tu pedido llegó al país de destino.'
         else 'Recibimos y confirmamos tu orden.'
       end
from import_pedidos i
join lateral (
  select id from public.clientes c
  where regexp_replace(c.whatsapp, '\D', '', 'g') = regexp_replace(i.whatsapp, '\D', '', 'g')
  order by c.created_at limit 1
) c on true
where not exists (select 1 from public.pedidos p where p.codigo = i.codigo);

insert into public.pedido_items (
  pedido_id, producto_id, codigo_producto, proveedor_id, producto, marca, categoria, talla,
  cantidad, precio_unitario, precio_compra, envio_internacional, costo_delivery, otros_gastos, notas
)
select p.id, pr.id, i.producto_codigo, pr.proveedor_id, i.producto, i.marca, i.categoria, i.talla,
       i.cantidad, i.venta, i.costo, i.envio, i.delivery, i.otros, 'Importado desde Google Sheets'
from import_pedidos i
join public.pedidos p on p.codigo = i.codigo
left join public.productos pr on pr.codigo = i.producto_codigo
where not exists (select 1 from public.pedido_items pi where pi.pedido_id = p.id);

insert into public.pagos (pedido_id, cliente_id, fecha, tipo, monto, metodo_pago, observaciones)
select p.id, p.cliente_id, i.fecha, 'abono_inicial', i.abono, i.metodo, 'Importado desde Google Sheets'
from import_pedidos i join public.pedidos p on p.codigo = i.codigo
where i.abono > 0 and not exists (select 1 from public.pagos pg where pg.pedido_id = p.id);

-- Movimientos copiados exactamente de la pestaña MOVIMIENTOS_CUENTA.
insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, metodo, pedido_id, observaciones)
select '2026-07-15 12:00:00-06', 'ingreso', 'Venta Golden Goose 44', 140, 'Transferencia', null, 'SHEET:CUENTA:1'
where not exists (select 1 from public.movimientos_cuenta where observaciones = 'SHEET:CUENTA:1');

insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, metodo, pedido_id, observaciones)
select v.fecha::timestamptz, 'pago_proveedor', v.descripcion, v.monto, 'Transferencia', p.id, v.marca
from (values
 ('2026-07-15'::date,'Pago proveedor · WANYISHOES · DOLCE GABANNA',79.50::numeric,'SHEET:CUENTA:2','HS157840'),
 ('2026-06-28'::date,'Pago proveedor · WANYISHOES · BIRKENSTOCK',64.50::numeric,'SHEET:CUENTA:3','HS483687'),
 ('2026-06-29'::date,'Pago proveedor · WANYISHOES · CHRISTIAN LOUBUTIN',79.50::numeric,'SHEET:CUENTA:4','HS483688'),
 ('2026-07-16'::date,'Pago proveedor · WANYISHOES · Zapatos Golden Goose',89.50::numeric,'SHEET:CUENTA:5','HS173345')
) as v(fecha,descripcion,monto,marca,codigo)
left join public.pedidos p on p.codigo = v.codigo
where not exists (select 1 from public.movimientos_cuenta m where m.observaciones = v.marca);

-- El Sheet mantenía un saldo manual de USD 170.60; se conserva como ajuste inicial verificable.
insert into public.movimientos_cuenta (fecha, tipo, descripcion, monto, metodo, observaciones)
select '2026-07-16 12:47:55-06', 'ajuste_entrada', 'Saldo inicial importado desde Google Sheets', 343.60, 'Ajuste de migración', 'SHEET:SALDO:170.60'
where not exists (select 1 from public.movimientos_cuenta where observaciones = 'SHEET:SALDO:170.60');

insert into public.configuracion (clave, valor_json)
values ('negocio_comercial', jsonb_build_object('nombre','HAUSLINE','moneda','USD','tasa_cambio',37,'origen','Google Sheets'))
on conflict (clave) do update set valor_json = excluded.valor_json, updated_at = now();

commit;
