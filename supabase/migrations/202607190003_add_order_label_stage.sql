-- Nueva etapa entre control de calidad y tránsito.
alter type public.estado_pedido
  add value if not exists 'etiqueta_creada' after 'control_calidad';
