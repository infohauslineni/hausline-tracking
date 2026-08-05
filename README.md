# Hausline Tracking

Aplicación web independiente para administración privada y seguimiento público de pedidos Hausline.

## Estado

Etapas 1 a 8 implementadas: base React/Vite responsive, autenticación, Supabase con RLS, clientes, pedidos, logística, rastreo público seguro, archivos, alertas, estimaciones dinámicas y preparación para Vercel.

No es una PWA: no contiene manifest, Service Worker, modo offline ni instalación.

## Configuración local

1. Copia `.env.example` como `.env`.
2. Agrega la URL y la clave anónima de tu proyecto Supabase.
3. Ejecuta `npm install` y después `npm run dev`.

Los administradores se crean manualmente en Supabase Auth. No existe registro público.

## Base de datos

- Migración principal: `supabase/migrations/202607140001_initial_schema.sql`
- Datos opcionales de prueba: `supabase/seed.demo.sql`
- Limpieza de la demostración: `supabase/cleanup.demo.sql`
- Guía detallada: `docs/supabase-setup.md`

## Módulos disponibles

- Clientes: búsqueda, alta, edición, eliminación y acceso a WhatsApp.
- Pedidos: listado, filtros, estados, detalle y resumen de pagos.
- Nuevo pedido: cliente existente o creación rápida, varios productos y cálculo de total, abono y saldo.
- Logística: varios trayectos por pedido, transportistas, estados, eventos manuales y consulta externa iniciada por el usuario.
- Archivos: imágenes privadas por categoría, carga múltiple, compresión WebP, visibilidad para el cliente e imagen principal.
- Alertas: detección manual o automática mediante RPC, prioridades, filtros, resolución, actualización en tiempo real y plazos configurables.
- Estimaciones: fecha pública recalculada según la etapa, margen configurable de uno o dos días, actualización inmediata al cambiar de estado y revisión diaria mediante Vercel Cron.
- Móvil: navegación inferior para las operaciones principales y vistas adaptadas a iPhone, Android y tablet.

La consulta de Everest abre su formulario público únicamente cuando el administrador pulsa el botón. No existe sincronización automática ni scraping.

- Rastreo público: consulta por código exacto, productos, progreso, historial, fechas, trayectos públicos y contacto por WhatsApp.
- La página pública consume únicamente la RPC segura y nunca recibe información privada del cliente o del negocio.

Sin credenciales, el servidor local utiliza datos de demostración en memoria para revisar la interfaz. Esta vista previa se desactiva automáticamente en la compilación de producción.

## Despliegue en Vercel

Consulta `docs/vercel-deploy.md`. El proyecto se despliega como una web tradicional y no contiene manifest, Service Worker, modo offline ni instalación.
