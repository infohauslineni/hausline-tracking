# Configuración de Supabase

## 1. Crear el proyecto

1. Crea un proyecto nuevo en Supabase. No reutilices la base de datos de la tienda actual.
2. En **SQL Editor**, ejecuta completo `supabase/migrations/202607140001_initial_schema.sql`.
3. Confirma que finalice sin errores y muestre `COMMIT`.

La migración crea tablas, relaciones, enums, índices, triggers, funciones, políticas RLS, transportistas iniciales y el bucket privado `pedidos`.

## 2. Crear el primer administrador

En **Authentication → Users**, crea el usuario manualmente. No habilites registro público. Después ejecuta:

```sql
update public.perfiles
set nombre = 'Administrador Hausline', rol = 'admin', activo = true
where correo = 'TU_CORREO_AQUI';
```

El trigger crea el perfil automáticamente. Los usuarios nuevos reciben el rol `operador`; solo un administrador puede modificar perfiles.

## 3. Conectar la aplicación

Copia `.env.example` como `.env` y completa:

```env
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_ANON
VITE_PUBLIC_APP_URL=http://localhost:5173
VITE_WHATSAPP_NUMBER=505XXXXXXXX
```

La clave `anon` puede estar en el navegador porque RLS protege los datos. Nunca coloques la `service_role` ni claves de tracking en variables `VITE_*`.

## 4. Verificar la seguridad

- `anon` no tiene permisos directos sobre tablas privadas.
- Los usuarios autenticados y activos administran clientes, pedidos y logística.
- Solo el rol `admin` puede modificar perfiles.
- El bucket `pedidos` es privado y acepta JPG, PNG y WEBP de hasta 10 MB.
- Los archivos deben seguir `pedidos/{pedido_id}/{tipo}/{archivo}`.
- La función pública acepta únicamente un código exacto `HS000000`.
- La respuesta pública excluye cliente, WhatsApp, correo, proveedor, costos, abonos, saldo y notas internas.

Prueba desde SQL Editor:

```sql
select public.obtener_pedido_publico('HS483682');
```

Sin datos devuelve `null`. Con la demostración devuelve únicamente el JSON público.

## 5. Datos de demostración opcionales

Ejecuta `supabase/seed.demo.sql` solo en un proyecto local o de pruebas. Para retirarlos usa `supabase/cleanup.demo.sql`. No ejecutes ninguno en producción.

## 6. Alertas y sugerencias

```sql
select public.generar_alertas_operativas();
```

Genera alertas por atraso, falta de tracking y falta de actualización. `sugerir_estado_pedido(uuid)` propone un estado según los trayectos, pero no lo aplica: los cambios críticos requieren revisión administrativa.

## 7. Supabase CLI opcional

Si utilizas Supabase CLI, enlaza el proyecto y ejecuta `supabase db push`. La migración ya está en la carpeta esperada por la CLI.
