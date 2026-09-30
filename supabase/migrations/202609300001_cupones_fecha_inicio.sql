-- Cupones con FECHA DE INICIO (además del vencimiento que ya existía).
--   · inicia_el: desde ese día el cupón funciona (vacío = desde ya).
--   · vence_el:  último día que funciona (vacío = no vence).
-- Las fechas se evalúan en hora de NICARAGUA: antes se usaba current_date (UTC), así que un
-- cupón dejaba de servir a las 6 p. m. de su último día.
--
-- Varias funciones del checkout revisan el cupón (validar_cupon y las que crean/confirman el
-- encargo). En vez de reescribirlas (su versión en vivo puede tener arreglos posteriores),
-- se parchea el texto de la definición ACTUAL de cada una. Si algo no calza, falla todo y no
-- se cambia nada. Se puede correr más de una vez.

alter table public.cupones add column if not exists inicia_el date;

do $$
declare
  f record; def text; nuevo text; hoy constant text := '(now() at time zone ''America/Managua'')::date';
  n int := 0;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosrc like '%c.vence_el%' and p.prosrc not like '%c.inicia_el%'
  loop
    def := pg_get_functiondef(f.oid);
    nuevo := replace(def,
      'c.vence_el is null or c.vence_el >= current_date',
      'c.vence_el is null or c.vence_el >= ' || hoy || ') and (c.inicia_el is null or c.inicia_el <= ' || hoy);
    -- validar_cupon (lo que ve el cliente al escribir el código): mensaje propio si aún no empieza.
    nuevo := replace(nuevo, 'c.vence_el < current_date', 'c.vence_el < ' || hoy);
    nuevo := replace(nuevo,
      '''Este cupón venció.''); end if;',
      '''Este cupón venció.''); end if;' || chr(10)
      || '  if c.inicia_el is not null and c.inicia_el > ' || hoy
      || ' then return jsonb_build_object(''valido'', false, ''motivo'', ''Este cupón todavía no está activo: empieza el '' || to_char(c.inicia_el, ''DD/MM/YYYY'') || ''.''); end if;');
    if nuevo <> def then
      execute nuevo;
      n := n + 1;
      raise notice 'Actualizada: %', f.proname;
    end if;
  end loop;
  raise notice 'Funciones actualizadas: %', n;
end $$;

-- Comprobación: funciones que revisan vencimiento de cupón pero NO la fecha de inicio (debe salir vacío).
select p.proname as sin_fecha_inicio
from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public' and p.prosrc like '%c.vence_el%' and p.prosrc not like '%c.inicia_el%';
