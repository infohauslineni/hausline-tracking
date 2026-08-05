begin;
insert into public.transportistas (nombre, codigo, url_tracking, tipo_integracion, activo)
values ('Everest Logistic Services', 'EVEREST', 'https://everest.cargotrack.net/m/track.asp', 'manual', true)
on conflict (nombre) do update set codigo = excluded.codigo, url_tracking = excluded.url_tracking, tipo_integracion = 'manual', activo = true;
commit;
