# Plantillas de WhatsApp y la ventana de 24 horas

## Regla de Meta (importante)
- Dentro de **24 h** desde el último mensaje del cliente, puedes responder con **texto libre**.
  (Aplica a todo el WF1, al WF2 y a las respuestas de comprobante: el cliente acaba de escribir.)
- **Fuera de esas 24 h**, Meta **solo** permite enviar **plantillas aprobadas**. Esto afecta al
  **WF3 (avisos de cambio de estado)**, que es iniciado por el negocio y puede caer fuera de la ventana.

## Recomendación para WF3
Crea y aprueba una plantilla y, en producción, cambia el nodo **Enviar WhatsApp** del WF3 para
enviar `type: "template"` en lugar de `type: "text"`.

### Plantilla sugerida: `actualizacion_pedido`
- **Categoría**: Utility · **Idioma**: Spanish (es)
- **Cuerpo**:
  ```
  Hola {{1}}. 📦 Actualización de tu pedido HAUSLINE {{2}}.
  Estado actual: {{3}}.
  Puedes consultar el progreso aquí: {{4}}
  ```
- **Variables**: {{1}} nombre · {{2}} código · {{3}} estado · {{4}} enlace de seguimiento.

Cuerpo del nodo HTTP (WF3) en modo plantilla:
```json
{
  "messaging_product": "whatsapp",
  "to": "{{$json.whatsapp}}",
  "type": "template",
  "template": {
    "name": "actualizacion_pedido",
    "language": { "code": "es" },
    "components": [
      { "type": "body", "parameters": [
        { "type": "text", "text": "{{$json.nombre || 'cliente'}}" },
        { "type": "text", "text": "{{$json.codigo}}" },
        { "type": "text", "text": "{{$json.estado_label}}" },
        { "type": "text", "text": "{{ ($env.TRACKING_BASE_URL||'') + '?codigo=' + $json.codigo }}" }
      ] }
    ]
  }
}
```

### Plantilla sugerida: `pedido_disponible`
Para el estado **Disponible para entrega** (incluye el saldo). Cuerpo:
```
✅ Hola {{1}}. Tu pedido HAUSLINE {{2}} ya está disponible.
Saldo pendiente: USD {{3}}. Detalles: {{4}}
Escríbenos para coordinar la entrega o retiro.
```

> En pruebas (respondiendo dentro de 24 h) el texto libre del WF3 funciona. Cambia a plantillas
> antes de depender de avisos que lleguen días después.
