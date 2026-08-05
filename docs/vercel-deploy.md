# Despliegue de Hausline Tracking en Vercel

## 1. Supabase

Ejecuta las migraciones de `supabase/migrations` en orden. La última migración agrega la estimación dinámica y la función segura que Vercel ejecutará cada día.

## 2. Variables públicas

Configura en Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_APP_URL`
- `VITE_WHATSAPP_NUMBER`

## 3. Variables privadas del servidor

Configura únicamente en Vercel y nunca las expongas con el prefijo `VITE_`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`: cadena aleatoria de al menos 16 caracteres.

El trabajo programado se ejecuta diariamente. La computadora del administrador puede permanecer apagada.

## 4. Importación

Importa el repositorio en Vercel. Usa `npm run build` como comando y `dist` como directorio de salida. Después del primer despliegue de producción, revisa **Settings → Cron Jobs** para confirmar que `/api/cron-estimaciones` está activo.

## 5. Dominio

Primero puede utilizarse el dominio de Vercel. Más adelante agrega `tracking.hauslineshopni.es` y actualiza `VITE_PUBLIC_APP_URL` con el dominio definitivo.

## Importante

La estimación se basa en los estados y eventos guardados en Hausline. No consulta USPS, Everest ni otra paquetería mientras no exista una integración real configurada.
