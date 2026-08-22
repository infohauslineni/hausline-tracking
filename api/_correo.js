import nodemailer from 'nodemailer'
import { facturaPdfBuffer } from './_factura-pdf.js'

// Lógica de correo compartida por las funciones /api (aviso al crear el pedido y al
// cambiar de estado). Vercel no convierte los archivos con "_" en endpoints, pero sí
// permite importarlos. Es JavaScript independiente del build de la app.

// Etiqueta pública de cada estado (espejo de las 6 etapas de src/constants/orders.ts).
// Las etapas viejas de bodega se agrupan en "En tránsito" para que el cliente reciba
// UN solo correo de tránsito. La deduplicación por etiqueta (en notificar-estado.js)
// evita correos repetidos cuando dos estados comparten etiqueta.
export const ESTADO_LABEL = {
  pedido_confirmado: 'Orden confirmada',
  en_preparacion: 'En preparación',
  control_calidad: 'En preparación',
  etiqueta_creada: 'En tránsito',
  despachado: 'En tránsito',
  transito_internacional: 'En tránsito',
  recibido_estados_unidos: 'En tránsito',
  transito_nicaragua: 'En tránsito',
  llego_nicaragua: 'País de destino',
  disponible_entrega: 'Disponible para entrega',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  incidencia: 'Requiere atención',
}

export const ESTADO_NOTA = {
  pedido_confirmado: 'Gracias por tu compra. Confirmamos tu pedido y ya comenzamos a prepararlo. Te avisaremos en cada etapa.',
  en_preparacion: 'Estamos preparando y revisando tu pedido antes de enviarlo.',
  control_calidad: 'Estamos preparando y revisando tu pedido antes de enviarlo.',
  etiqueta_creada: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  despachado: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  transito_internacional: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  recibido_estados_unidos: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  transito_nicaragua: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  llego_nicaragua: 'Tu pedido llegó a Nicaragua. Pronto estará disponible para entrega.',
  disponible_entrega: 'Tu pedido ya está disponible para entrega. Escríbenos para coordinar el envío o retiro.',
  entregado: 'Tu pedido fue entregado. Gracias por confiar en Hausline.',
  cancelado: 'Tu pedido fue cancelado. Si tienes dudas, escríbenos.',
  incidencia: 'Tenemos una novedad con tu pedido y ya la estamos gestionando. Te contactaremos pronto.',
}

// Escapa texto que viene de la base (nombres de producto, etc.) para el HTML del correo.
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function montoUSD(valor) {
  return `USD ${(Number(valor) || 0).toFixed(2)}`
}

// Tabla de factura dentro del correo (estilo recibo). Se muestra solo cuando llegan
// los productos: en la creación del pedido (variante 'compra', con saldo) y al
// entregarlo (variante 'pago', marcado como PAGADO).
export function bloqueFactura(factura) {
  if (!factura || !Array.isArray(factura.items) || factura.items.length === 0) return ''
  const esPago = factura.variante === 'pago'

  const filas = factura.items.map((item) => {
    const codigo = item.codigo
      ? `<div style="font-size:11px;color:#9aa0ab;margin-top:3px;letter-spacing:.3px;">Código: ${esc(item.codigo)}</div>`
      : ''
    const detalle = item.detalle
      ? `<div style="font-size:12px;color:#8b93a7;margin-top:2px;">${esc(item.detalle)}</div>`
      : ''
    // Miniatura de la foto del producto (si el pedido la guardó). Tamaño fijo para
    // que se vea igual en todos los clientes de correo.
    const foto = item.imagen
      ? `<img src="${esc(item.imagen)}" width="52" height="52" alt="" style="display:block;width:52px;height:52px;border-radius:8px;object-fit:cover;border:1px solid #eef0f2;background-color:#f6f7f9;">`
      : `<div style="width:52px;height:52px;border-radius:8px;border:1px solid #eef0f2;background-color:#f6f7f9;"></div>`
    return `<tr>
      <td style="padding:13px 0;border-bottom:1px solid #eef0f2;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="padding:0 12px 0 0;vertical-align:top;width:52px;">${foto}</td>
          <td style="vertical-align:top;font-size:14px;color:#0b0f19;line-height:1.4;">${esc(item.producto)}${codigo}${detalle}</td>
        </tr></table>
      </td>
      <td style="padding:13px 0;border-bottom:1px solid #eef0f2;font-size:14px;color:#4b5563;text-align:center;white-space:nowrap;vertical-align:top;">${Number(item.cantidad) || 1}</td>
      <td style="padding:13px 0;border-bottom:1px solid #eef0f2;font-size:14px;color:#4b5563;text-align:right;white-space:nowrap;vertical-align:top;">${montoUSD(item.precioUnitario)}</td>
      <td style="padding:13px 0 13px 14px;border-bottom:1px solid #eef0f2;font-size:14px;font-weight:600;color:#0b0f19;text-align:right;white-space:nowrap;vertical-align:top;">${montoUSD(item.subtotal)}</td>
    </tr>`
  }).join('')

  const totalFila = (label, valor, { strong = false, color = '#0b0f19' } = {}) => `<tr>
    <td colspan="2" style="border:0;"></td>
    <td style="padding:5px 0;font-size:13px;color:#6b7280;text-align:right;white-space:nowrap;">${label}</td>
    <td style="padding:5px 0 5px 14px;font-size:${strong ? '17px' : '13px'};font-weight:${strong ? 800 : 600};color:${color};text-align:right;white-space:nowrap;">${valor}</td>
  </tr>`

  const saldoFila = esPago
    ? totalFila('Saldo pendiente', 'PAGADO', { strong: true, color: '#2f8f2f' })
    : totalFila('Saldo pendiente', montoUSD(factura.saldo), { strong: true, color: (Number(factura.saldo) || 0) > 0.01 ? '#b26a00' : '#2f8f2f' })

  return `
          <!-- Factura -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px;">
            <tr><td style="border:1px solid #e6e8ec;border-radius:12px;padding:22px 22px 18px;">
              <div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b93a7;margin-bottom:14px;">${esPago ? 'Comprobante de pago' : 'Detalle de tu compra'}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8b93a7;">Producto</td>
                  <td style="padding:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8b93a7;text-align:center;">Cant.</td>
                  <td style="padding:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8b93a7;text-align:right;">Precio</td>
                  <td style="padding:0 0 10px 14px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8b93a7;text-align:right;">Subtotal</td>
                </tr>
                ${filas}
                <tr><td colspan="4" style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>
                ${totalFila('Total del pedido', montoUSD(factura.total))}
                ${totalFila(esPago ? 'Pago recibido' : 'Abono recibido', montoUSD(factura.abono))}
                ${saldoFila}
              </table>
            </td></tr>
          </table>`
}

export function plantillaCorreo({ nombre, codigo, estadoLabel, nota, urlSeguimiento, esNuevo, factura }) {
  const saludo = nombre ? `Hola, ${nombre}` : 'Hola'
  // En la creación del pedido el texto confirma el registro; en los cambios de estado, la actualización.
  const intro = esNuevo
    ? `Gracias por tu compra. Confirmamos tu pedido y ya comenzamos a gestionarlo.`
    : `Tu pedido tiene una nueva actualización.`
  // Texto de previsualización (lo que se ve en la bandeja antes de abrir el correo).
  const preheader = esNuevo
    ? `Confirmamos tu pedido ${codigo}. Sigue cada etapa desde aquí.`
    : `${codigo}: ${estadoLabel}. Revisa el detalle del seguimiento.`
  const anio = new Date().getFullYear()

  // El recuadro de "Estado actual" (píldora) solo aparece en los avisos de estado
  // intermedios, donde el estado es lo importante. En los correos con factura
  // (compra o comprobante de pago) se omite: manda el detalle de la compra.
  const conFactura = factura && Array.isArray(factura.items) && factura.items.length
  const bloqueEstado = conFactura ? '' : `
          <!-- Estado actual -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px;">
            <tr><td style="border:1px solid #e6e8ec;border-radius:12px;padding:24px 22px;text-align:center;">
              <div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b93a7;margin-bottom:10px;">Estado actual</div>
              <div style="display:inline-block;background-color:#0b0f19;color:#ffffff;font-size:15px;font-weight:700;letter-spacing:.3px;padding:9px 22px;border-radius:999px;">${estadoLabel}</div>
              <div style="font-size:14px;line-height:1.6;color:#4b5563;margin-top:16px;">${nota}</div>
            </td></tr>
          </table>`
  return `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>Pedido ${codigo}</title>
  <!--[if mso]><style>body,table,td,a{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#ececed;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#ececed;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ececed;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(17,24,39,.08);">

        <!-- Encabezado -->
        <tr><td style="background-color:#0b0f19;padding:34px 24px;text-align:center;">
          <div style="color:#ffffff;font-size:26px;font-weight:800;letter-spacing:5px;line-height:1;">HAUSLINE</div>
          <div style="color:#8b93a7;font-size:10px;font-weight:600;letter-spacing:4px;text-transform:uppercase;margin-top:8px;">King of Shoes</div>
        </td></tr>

        <!-- Barra de acento -->
        <tr><td style="height:4px;background-color:#c8a24b;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Cuerpo -->
        <tr><td style="padding:38px 36px 12px;">
          <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#0b0f19;">${saludo}</p>
          <p style="margin:0 0 26px;font-size:15px;line-height:1.6;color:#4b5563;">${intro}</p>

          <!-- Número de pedido -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
            <tr><td style="background-color:#f6f7f9;border:1px solid #e6e8ec;border-radius:10px;padding:16px 20px;">
              <span style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b93a7;">Número de pedido</span><br>
              <span style="font-size:19px;font-weight:800;color:#0b0f19;letter-spacing:1px;">${codigo}</span>
            </td></tr>
          </table>

${bloqueEstado}${bloqueFactura(factura)}
          <!-- Botón -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
            <a href="${urlSeguimiento}" target="_blank" style="display:inline-block;background-color:#c8a24b;color:#0b0f19;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.3px;padding:15px 38px;border-radius:10px;">Ver seguimiento del pedido</a>
          </td></tr></table>
          <p style="margin:16px 0 0;font-size:12px;line-height:1.5;text-align:center;color:#9aa0ab;">O copia este enlace:<br><a href="${urlSeguimiento}" target="_blank" style="color:#6b7280;text-decoration:underline;word-break:break-all;">${urlSeguimiento}</a></p>
        </td></tr>

        <!-- Pie -->
        <tr><td style="padding:28px 36px 34px;border-top:1px solid #eef0f2;text-align:center;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0b0f19;letter-spacing:2px;">HAUSLINE</p>
          <p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:#9aa0ab;">Este es un aviso automático de tu pedido.<br>¿Tienes dudas? Responde a este mismo correo y te ayudamos.</p>
          <p style="margin:0;font-size:11px;color:#b7bcc5;">© ${anio} Hausline · King of Shoes</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`
}

// Envía el correo del pedido (creación o cambio de estado). Lanza si el SMTP falla.
// `factura` es opcional: cuando llega, el correo incluye la tabla de la compra
// (al crear el pedido) o del pago (al entregarlo).
export async function enviarCorreoPedido({ correo, nombre, codigo, estado, esNuevo, factura }) {
  const estadoLabel = ESTADO_LABEL[estado]
  const nota = ESTADO_NOTA[estado] ?? 'Tu pedido fue actualizado.'
  const appUrl = (process.env.APP_URL ?? process.env.VITE_PUBLIC_APP_URL ?? 'https://hausline-tracking.vercel.app').replace(/\/$/, '')
  const urlSeguimiento = `${appUrl}/tracking/${codigo}`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  // Cuando hay factura (creación o entrega), se adjunta también en PDF. Si el PDF
  // falla por lo que sea, el correo se envía igual con la tabla en el cuerpo.
  const attachments = []
  if (factura && Array.isArray(factura.items) && factura.items.length) {
    try {
      const pdf = await facturaPdfBuffer({ codigo, nombre, fecha: factura.fecha, factura })
      const tipo = factura.variante === 'pago' ? 'comprobante' : 'factura'
      attachments.push({ filename: `Hausline-${codigo}-${tipo}.pdf`, content: pdf, contentType: 'application/pdf' })
    } catch {
      // Sin PDF adjunto: el cuerpo del correo ya lleva el detalle.
    }
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`,
    to: correo,
    subject: esNuevo ? `Pedido ${codigo}: Orden confirmada` : `Pedido ${codigo}: ${estadoLabel}`,
    html: plantillaCorreo({ nombre, codigo, estadoLabel, nota, urlSeguimiento, esNuevo, factura }),
    attachments,
  })
}
