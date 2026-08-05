# Configuración de Meta / WhatsApp Cloud API

## 1. App de Meta
1. developers.facebook.com → **Crear app** → tipo **Business**.
2. Agrega el producto **WhatsApp**.

## 2. Número y credenciales
1. **WhatsApp → API Setup**: registra tu número. Copia el **Phone Number ID**
   (`WHATSAPP_PHONE_NUMBER_ID`) y el **WhatsApp Business Account ID** (`WHATSAPP_BUSINESS_ACCOUNT_ID`).
2. **Token permanente**: Business Settings → **System users** → crea uno con rol admin, asígnale
   la app y genera un token con permisos `whatsapp_business_messaging` y
   `whatsapp_business_management` → `WHATSAPP_TOKEN`.
3. **App Secret**: App → Settings → Basic → **App Secret** → `META_APP_SECRET`.
4. `WHATSAPP_VERIFY_TOKEN`: invéntalo (cadena secreta). Lo usarás en Meta y en el WF1.

## 3. Webhook
1. **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL**: el *Production URL* del **WF1** (webhook GET/POST), por ejemplo
   `https://tu-n8n.com/webhook/hausline-wa`.
3. **Verify token**: el mismo valor de `WHATSAPP_VERIFY_TOKEN`.
   - Meta hará un `GET` de verificación → el WF1 responde el `hub.challenge` si el token coincide.
4. **Suscríbete al campo `messages`.**

## 4. Validar la firma X-Hub (recomendado)
Meta firma cada POST con `X-Hub-Signature-256` usando el `META_APP_SECRET`. Para validarla en n8n:
1. En el nodo **Webhook mensajes (POST)** del WF1, activa en *Options* → **Raw Body**.
2. Agrega un nodo **Crypto** (HMAC SHA256, clave `{{$env.META_APP_SECRET}}`, datos = raw body) y
   compáralo con el header `x-hub-signature-256` (`sha256=<hmac>`) antes de procesar. Si no
   coincide, detén el flujo. (El flujo funciona sin esto en pruebas, pero actívalo en producción.)

## 5. Números de prueba
Mientras la app esté en modo desarrollo, solo puedes escribir a los números agregados como
*testers* en WhatsApp → API Setup. Publica la app para atender a cualquier número.
