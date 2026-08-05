-- Rellena las webs de rastreo que quedaron en null, para que el botón "Abrir rastreo"
-- siempre abra una página con el número (antes UNI Express, YunExpress, China Post y
-- Cainiao no abrían nada porque url_tracking estaba vacío).
begin;

update public.transportistas set url_tracking = 'https://www.yuntrack.com/parcelTracking?id={tracking}'
  where codigo = 'YUNEXPRESS' and (url_tracking is null or url_tracking = '');

update public.transportistas set url_tracking = 'https://global.cainiao.com/detail.htm?mailNoList={tracking}'
  where codigo = 'CAINIAO' and (url_tracking is null or url_tracking = '');

-- 17track detecta el transportista automáticamente por el número de guía.
update public.transportistas set url_tracking = 'https://t.17track.net/en#nums={tracking}'
  where codigo in ('UNI', 'CHINA_POST', 'CASILLERO', 'AEREO', 'MARITIMO', 'OTRA')
    and (url_tracking is null or url_tracking = '');

commit;
