# Pruebas paso a paso

Requisitos: la migración ejecutada, los 4 workflows importados y activos, las Variables de n8n
completas y el webhook verificado en Meta.

Sustituye `TU_N8N` por la base pública de n8n, `SR_KEY` por la `service_role`, y `SB` por la URL
de Supabase.

---

## 0. Migración aplicada
En Supabase → SQL Editor:
```sql
select count(*) from public.wa_conversaciones;      -- 0, sin error
select public.wa_normalizar_telefono('8688 2212');  -- 50586882212
select public.wa_hoy();                              -- fecha de hoy (Managua)
```

## 1. Verificación del webhook (Meta)
Al guardar el webhook, Meta muestra ✔. Si falla, revisa `WHATSAPP_VERIFY_TOKEN` (debe ser igual
en Meta y en n8n) y que el WF1 esté **activo**.

## 2. Saludo
Escribe **"hola"** al número. Debe llegar la bienvenida con el enlace del catálogo y una pregunta.

## 3. Consulta por código / marca (datos reales)
- "precio del CL0001" → precio real + enlace `hauslineshopni.es/?producto=CL0001` + pregunta de talla.
- "tenés Louboutin en 42" → hasta 3 opciones reales (usa alias de marca).
- "tenés AirPods" → respuesta honesta, sin inventar.

## 4. Consulta de seguimiento
- Envía un código real, p. ej. **HS483687**. El bot responde estado + enlace de seguimiento.
- Prueba de privacidad: desde un número que **no** es dueño del pedido, el estado se muestra
  (es público) pero **no** el nombre ni el saldo (`coincide_cliente=false`).

## 5. Crear pedido (flujo completo)
1. Conversa hasta dar producto, código, talla, color, cantidad y nombre; confirma.
2. El bot envía el **resumen con abono (50%)** e instrucciones de pago, y el admin recibe el
   aviso con el **enlace de aprobación**.
3. Verifica el borrador:
   ```sql
   select id, wa_id, estado, payload->'items' from public.wa_borradores_pedido order by created_at desc limit 1;
   ```
4. Envía una **imagen** como "comprobante" → el borrador pasa a `pendiente_revision` y el admin
   recibe el aviso. (La IA NO confirma el pago.)
5. Abre el **enlace de aprobación** del admin (WF2). Debe responder "Pedido HS###### confirmado".
6. Verifica que el pedido real quedó bien (¡sin descuadrar finanzas!):
   ```sql
   select codigo, estado, total, abono, saldo from public.pedidos order by created_at desc limit 1;
   select tipo, monto from public.pagos where pedido_id = (select id from public.pedidos order by created_at desc limit 1);
   select tipo, monto, descripcion from public.movimientos_cuenta order by created_at desc limit 2;
   select estado_anterior, estado_nuevo from public.historial_pedidos order by created_at desc limit 1;
   ```
   Esperado: `estado=pedido_confirmado`, `abono` = 50% y = suma de `pagos`, `saldo=total-abono`,
   un `pago` `abono_inicial`, un `movimiento` `ingreso`, e historial inicial.
7. El cliente recibe la confirmación con su **código** y **enlace de seguimiento**.

## 6. Cambio de estado (aviso automático)
1. En la app de Tracking, cambia el estado del pedido (p. ej. a *En tránsito*).
2. Espera al cron del **WF3** (≤5 min) o ejecútalo manualmente en n8n.
3. El cliente recibe el aviso **una sola vez**. Verifica la bitácora:
   ```sql
   select codigo, estado, resultado from public.wa_notificaciones order by created_at desc;
   ```

## 7. Anti-duplicados
- **Mensajes**: reenvía el mismo evento (o Meta reintenta) → `wa_marcar_mensaje` lo ignora la 2ª vez.
  ```sql
  select count(*) from public.wa_mensajes_procesados;   -- crece 1 por mensaje único
  ```
- **Avisos**: corre el WF3 dos veces seguidas → no se reenvía el mismo (pedido, estado)
  (garantizado por `unique(pedido_id, estado)` en `wa_notificaciones`).

## 8. Atención humana
- Escribe "quiero un reembolso" → el bot responde que transfiere a un asesor, marca
  `atencion_humana=true` y avisa al admin. A partir de ahí la IA **no responde** a ese número.
  ```sql
  select wa_id, atencion_humana, motivo_atencion from public.wa_conversaciones where atencion_humana;
  ```
- Reactivar: `GET https://TU_N8N/webhook/hausline-reactivar?wa_id=505XXXXXXXX` (WF5).

## 9. Prueba directa de las RPC (sin WhatsApp)
```bash
# Crear un pedido de prueba
curl -X POST "$SB/rest/v1/rpc/wa_crear_pedido" \
  -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" -H "Content-Type: application/json" \
  -d '{"payload":{"nombre":"Prueba QA","whatsapp":"88880000","abono":72,"items":[{"producto":"Louboutin Louis Junior","marca":"Christian Louboutin","categoria":"Zapatos","talla":"42","cantidad":1,"precio_unitario":144,"codigo_producto":"CL0001"}]}}'
# -> {"codigo":"HS######","total":144.00,"abono":72,"saldo":72.00,...}

# Consultar pendientes de notificación
curl -X POST "$SB/rest/v1/rpc/wa_pedidos_pendientes_notificacion" \
  -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" -H "Content-Type: application/json" -d '{}'
```
Borra el pedido de prueba desde la app o con `delete from public.pedidos where codigo='HS######';`.
