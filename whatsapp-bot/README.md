# HAUSLINE · Vendedor virtual de WhatsApp (integrado con Hausline Tracking)

Automatización en **n8n** que atiende WhatsApp, vende con datos reales del catálogo y
registra/consulta pedidos **directamente en Hausline Tracking** (Supabase). **Sin Google
Sheets** y **sin base de datos paralela de pedidos**: los pedidos siguen viviendo en
`public.pedidos` de Tracking; el bot solo agrega tablas de infraestructura con prefijo `wa_`.

> Vive en `whatsapp-bot/` dentro del repo de Hausline Tracking porque depende de su base de
> datos. La app y su UI **no se modifican**.

---

## 1. Arquitectura

```
Cliente WhatsApp
   │
   ▼
WhatsApp Cloud API (Meta)  ──GET verificación / POST mensajes──►  n8n
                                                                   │
   ┌───────────────────────────── n8n ─────────────────────────────┐
   │ WF1 Cerebro:                                                    │
   │  Webhook (verifica firma) → anti-duplicados → carga            │
   │  conversación → ¿atención humana? → Claude clasifica (JSON) →  │
   │  catálogo real + tracking real → Claude redacta → responde →   │
   │  guarda memoria. Rutas: normal · confirmar · comprobante · humano│
   │                                                                 │
   │ WF2 Confirmar abono  (el admin aprueba → crea el pedido real)  │
   │ WF3 Notificaciones   (cron: avisa cambios de estado, sin repetir)│
   │ WF5 Reactivar IA     (termina la atención humana)              │
   └─────────────────────────────────────────────────────────────────┘
        │ service_role (REST/RPC)              ▲ pull cada 5 min
        ▼                                      │
   Supabase / Hausline Tracking  ──────────────┘
   pedidos · pedido_items · clientes · pagos · movimientos_cuenta ·
   historial_pedidos · RPCs wa_* (nuevas) + obtener_pedido_publico (existente)
```

**Decisiones clave** (acordadas contigo):
1. **Se respeta el sistema.** El pedido se crea (nace `pedido_confirmado`, con el abono
   registrado en `pagos` + `movimientos_cuenta`) **cuando el admin verifica el abono**. El bot
   recopila, muestra el resumen y crea un *borrador*; nadie confirma un pago por ver una imagen.
2. **n8n habla directo con Supabase** con la `service_role`, pero toda la lógica sensible está
   en **RPCs `SECURITY DEFINER`** (no se duplica lógica en los workflows ni se descuadran finanzas).
3. **Sin Google Sheets.** Memoria del bot, anti-duplicados, borradores y bitácora de avisos
   son tablas `wa_*` nuevas (infraestructura, no un segundo sistema de pedidos).

---

## 2. Qué se REUTILIZA de Hausline Tracking (nada duplicado)

| Función del bot | Pieza existente reutilizada |
|---|---|
| Código de pedido | RPC `generar_codigo_pedido()` (default de `pedidos.codigo`, `HS`+6 dígitos) |
| Crear pedido / totales / saldo / historial | tablas `pedidos`, `pedido_items` + triggers existentes |
| Registrar abono sin descuadrar | tablas `pagos`, `movimientos_cuenta` + trigger `sincronizar_abono_desde_pagos` |
| Cliente por teléfono | tabla `clientes`, normalización `505`+8 dígitos |
| Estados del pedido | enum `estado_pedido` (12 estados reales) + `historial_pedidos` |
| Tracking público seguro | RPC `obtener_pedido_publico(codigo)` |
| Página pública de seguimiento | `TrackingPage.tsx` (`TRACKING_BASE_URL`) |
| Etiquetas públicas de estado | RPC `etiqueta_estado_publico(estado)` |

## 3. Qué se AGREGA (migración aditiva)

`supabase/migrations/202607260001_whatsapp_bot.sql` — no toca ninguna tabla/función existente:

- **Tablas** `wa_conversaciones`, `wa_mensajes_procesados`, `wa_borradores_pedido`, `wa_notificaciones`.
- **RPCs** (todas `SECURITY DEFINER`, permiso solo a `service_role`/`authenticated`):
  `wa_marcar_mensaje`, `wa_obtener_conversacion`, `wa_guardar_conversacion`,
  `wa_atencion_humana`, `wa_reactivar_ia`, `wa_buscar_o_crear_cliente`, `wa_crear_pedido`,
  `wa_confirmar_borrador`, `wa_registrar_borrador`, `wa_registrar_comprobante`,
  `wa_consultar_pedido`, `wa_pedidos_pendientes_notificacion`, `wa_registrar_notificacion`,
  `wa_normalizar_telefono`, `wa_hoy`.
- **Bucket** privado `wa-comprobantes` (área temporal de comprobantes).

> Estas RPCs son "la API" que pediste: en vez de endpoints HTTP nuevos, se exponen como
> funciones seguras de Supabase que n8n llama por REST (`/rest/v1/rpc/...`). Si más adelante
> prefieres endpoints en `api/` (mismo patrón que `cron-estimaciones.js`), son un envoltorio directo.

---

## 4. Estructura de la entrega

```
whatsapp-bot/
├── README.md                       ← este archivo
├── .env.example                    ← variables de entorno de n8n
├── n8n/
│   ├── WF1-cerebro.json            ← recepción + intención + catálogo + respuesta + rutas
│   ├── WF2-confirmar-pedido.json   ← aprobación de abono → crea el pedido real
│   ├── WF3-notificaciones-estados.json ← cron de avisos de estado (anti-repetidos)
│   ├── WF5-reactivar-ia.json       ← reactivar IA tras atención humana
│   └── lib/catalogo-search.js      ← lógica de búsqueda (referencia del nodo Code)
├── prompts/
│   ├── 01-clasificador.md          ← system prompt de intención (JSON)
│   └── 02-redactor.md              ← system prompt de ventas (texto)
└── docs/
    ├── 01-meta-whatsapp.md         ← configuración de Meta + webhooks
    ├── 02-plantillas-whatsapp.md   ← plantillas (ventana de 24h)
    └── 03-pruebas.md               ← pruebas paso a paso
```

Mapa con los "9 workflows" del brief: WF1 concentra recepción, intención, catálogo y respuestas
(los ex-WF1–WF4 y WF8); **WF2** = creación de pedido (ex-WF5); **WF3** = cambios de estado
(ex-WF7); el manejo de **comprobante** (ex-WF6) y **atención humana** (ex-WF9) son rutas dentro
del WF1; **WF5** reactiva la IA. Menos archivos, mismo alcance.

---

## 5. Despliegue (orden recomendado)

1. **Supabase**: abre el SQL Editor del proyecto de Tracking y ejecuta
   `supabase/migrations/202607260001_whatsapp_bot.sql` (una vez, es idempotente).
2. **n8n**: importa los 4 archivos de `n8n/`. Copia `.env.example` a las Variables de n8n y
   complétalas. Consulta [docs/01-meta-whatsapp.md](docs/01-meta-whatsapp.md).
3. **Meta**: crea la app, el número, el token permanente y configura el webhook apuntando al
   *Production URL* del **WF1** (`.../webhook/hausline-wa`). Suscríbete al campo `messages`.
4. **Activa** WF1, WF2, WF3 y WF5. WF3 corre solo por cron cada 5 min.
5. Prueba con [docs/03-pruebas.md](docs/03-pruebas.md).

**Seguridad**: credenciales solo en Variables de n8n (nunca en los JSON). La `service_role`
vive solo en el servidor de n8n. La firma `X-Hub-Signature-256` debe validarse (ver doc Meta).
`anon` no tiene acceso a ninguna tabla/función `wa_`. El enlace de aprobación (WF2) exige el
secreto `ADMIN_APPROVAL_SECRET`. `wa_consultar_pedido` no revela datos de pedidos ajenos.

---

## 6. Flujo de un pedido (resumen)

1. Cliente escribe → **WF1** vende con datos reales y recopila nombre, código, talla, color,
   cantidad. El teléfono se toma solo de WhatsApp.
2. Cuando están todos los datos y el cliente confirma → WF1 crea un **borrador**
   (`wa_registrar_borrador`), envía instrucciones de pago y **avisa al admin** con un enlace de
   aprobación seguro.
3. Cliente envía el **comprobante** → se marca `pendiente_revision` y se avisa al admin (la IA
   nunca da el pago por bueno).
4. El admin verifica el abono y abre el **enlace de aprobación** → **WF2** llama a
   `wa_confirmar_borrador` → se crea el pedido real (`HS######`, abono en `pagos` +
   `movimientos_cuenta`, historial inicial) y el cliente recibe su código + enlace de seguimiento.
5. Cada cambio de estado en Tracking (desde la app admin) lo detecta **WF3** y envía el aviso
   una sola vez (bitácora `wa_notificaciones`).

---

## 7. Cambiar de Claude a OpenAI
En los nodos `Claude · Clasificar/Redactar` (WF1) cambia la URL a
`https://api.openai.com/v1/chat/completions`, el header a `Authorization: Bearer {{$env.AI_API_KEY}}`
y el cuerpo al formato de OpenAI. Pon `AI_MODEL=gpt-4o`. El resto no cambia.
