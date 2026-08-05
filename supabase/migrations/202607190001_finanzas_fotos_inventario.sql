begin;

-- Fotos reutilizables de catalogo e inversiones.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogo', 'catalogo', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists catalogo_lectura_publica on storage.objects;
create policy catalogo_lectura_publica on storage.objects for select to public using (bucket_id = 'catalogo');
drop policy if exists catalogo_admin_insertar on storage.objects;
create policy catalogo_admin_insertar on storage.objects for insert to authenticated with check (bucket_id = 'catalogo' and public.usuario_activo());
drop policy if exists catalogo_admin_actualizar on storage.objects;
create policy catalogo_admin_actualizar on storage.objects for update to authenticated using (bucket_id = 'catalogo' and public.usuario_activo()) with check (bucket_id = 'catalogo' and public.usuario_activo());
drop policy if exists catalogo_admin_eliminar on storage.objects;
create policy catalogo_admin_eliminar on storage.objects for delete to authenticated using (bucket_id = 'catalogo' and public.usuario_activo());

alter table public.inversiones add column if not exists imagen text;
alter table public.inversiones add column if not exists tracking text;
alter table public.inversiones add column if not exists transportista text;
alter table public.inversiones add column if not exists url_tracking text;
alter table public.inversiones add column if not exists estado_tracking text;
alter table public.inversiones add column if not exists pedido_id uuid references public.pedidos(id) on delete set null;
alter table public.pedido_items add column if not exists inversion_id uuid references public.inversiones(id) on delete set null;
update public.pedido_items i set imagen = p.imagen from public.productos p where i.producto_id = p.id and p.imagen is not null and (i.imagen is null or i.imagen = '');

create or replace function public.sincronizar_imagen_producto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.imagen is distinct from old.imagen then
    update public.pedido_items set imagen = new.imagen where producto_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists productos_sincronizar_imagen on public.productos;
create trigger productos_sincronizar_imagen after update of imagen on public.productos for each row execute function public.sincronizar_imagen_producto();

-- Fondos para compras futuras: iPad, equipo, mobiliario, etc.
create table if not exists public.metas_compra (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  monto_objetivo numeric(12,2) not null check (monto_objetivo > 0),
  monto_reservado numeric(12,2) not null default 0 check (monto_reservado >= 0),
  fecha_objetivo date,
  estado text not null default 'activa' check (estado in ('activa','completada','cancelada')),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asignaciones_ganancia (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  tipo text not null check (tipo in ('retiro_salario','pago_deuda','meta_compra','reintegro')),
  monto numeric(12,2) not null check (monto > 0),
  descripcion text not null,
  deuda_id uuid references public.deudas(id) on delete set null,
  meta_id uuid references public.metas_compra(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.pagos_deuda add column if not exists desde_ganancia numeric(12,2) not null default 0 check (desde_ganancia >= 0);
alter table public.pagos_deuda add column if not exists desde_negocio numeric(12,2) not null default 0 check (desde_negocio >= 0);

drop trigger if exists metas_compra_updated_at on public.metas_compra;
create trigger metas_compra_updated_at before update on public.metas_compra for each row execute function public.set_updated_at();

alter table public.metas_compra enable row level security;
alter table public.asignaciones_ganancia enable row level security;
drop policy if exists metas_compra_admin_total on public.metas_compra;
create policy metas_compra_admin_total on public.metas_compra for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
drop policy if exists asignaciones_ganancia_admin_total on public.asignaciones_ganancia;
create policy asignaciones_ganancia_admin_total on public.asignaciones_ganancia for all to authenticated using (public.usuario_activo()) with check (public.usuario_activo());
grant select, insert, update, delete on public.metas_compra, public.asignaciones_ganancia to authenticated;

insert into public.configuracion (clave, valor_json)
values ('finanzas', jsonb_build_object('dia_inicio_mes', 1, 'dia_retiro', 28, 'porcentaje_reserva_negocio', 30))
on conflict (clave) do nothing;

-- Resumen real: solo pedidos entregados y dinero efectivamente recibido.
create or replace function public.obtener_ganancia_realizada(p_desde date, p_hasta date)
returns jsonb language sql stable security definer set search_path = public as $$
  with entregados as (
    select p.id, p.total,
      coalesce((select sum(case when pa.tipo = 'reembolso' then -pa.monto else pa.monto end) from public.pagos pa where pa.pedido_id = p.id), 0) as cobrado,
      coalesce((select sum(g.monto) from public.gastos g where g.pedido_id = p.id), 0) as gastos,
      coalesce((select sum(i.cantidad * (i.precio_compra + i.envio_internacional + i.costo_delivery + i.otros_gastos)) from public.pedido_items i where i.pedido_id = p.id), 0) as costo_items
    from public.pedidos p
    where p.activo = true and p.estado = 'entregado'
      and p.updated_at::date between p_desde and p_hasta
  ), resumen as (
    select count(*)::int pedidos_entregados,
      coalesce(sum(least(total, greatest(0,cobrado))),0) cobrado,
      coalesce(sum(greatest(gastos,costo_items)),0) costos,
      coalesce(sum(greatest(0, least(total,greatest(0,cobrado)) - greatest(gastos,costo_items))),0) ganancia
    from entregados
  ), usado as (
    select coalesce(sum(case when tipo='reintegro' then -monto else monto end),0) monto
    from public.asignaciones_ganancia where fecha between p_desde and p_hasta
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'pedidos_entregados', r.pedidos_entregados,
    'cobrado', r.cobrado, 'costos', r.costos,
    'ganancia_realizada', r.ganancia,
    'ganancia_asignada', u.monto,
    'ganancia_disponible', greatest(0, r.ganancia-u.monto)
  ) from resumen r cross join usado u;
$$;
revoke all on function public.obtener_ganancia_realizada(date,date) from public, anon;
grant execute on function public.obtener_ganancia_realizada(date,date) to authenticated;

commit;
