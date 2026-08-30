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
  control_calidad: 'Control de calidad',
  etiqueta_creada: 'En tránsito',
  despachado: 'En tránsito',
  transito_internacional: 'En tránsito',
  recibido_estados_unidos: 'En tránsito',
  transito_nicaragua: 'En tránsito',
  llego_nicaragua: 'País de destino',
  disponible_entrega: 'Disponible para entrega',
  pagado: 'Pagado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  incidencia: 'Requiere atención',
}

export const ESTADO_NOTA = {
  pedido_confirmado: 'Gracias por tu compra. Confirmamos tu pedido y ya comenzamos a prepararlo. Te avisaremos en cada etapa.',
  en_preparacion: 'Estamos preparando y revisando tu pedido antes de enviarlo.',
  control_calidad: 'Tu pedido está pasando por control de calidad antes de despacharlo.',
  etiqueta_creada: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  despachado: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  transito_internacional: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  recibido_estados_unidos: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  transito_nicaragua: 'Tu pedido va en tránsito rumbo a Nicaragua.',
  llego_nicaragua: 'Tu pedido llegó a Nicaragua. Pronto estará disponible para entrega.',
  disponible_entrega: 'Tu pedido ya está disponible para entrega. Escríbenos para coordinar el envío o retiro.',
  pagado: 'Confirmamos el pago de tu pedido. Coordinamos la entrega y te avisamos.',
  entregado: 'Tu pedido fue entregado. Gracias por confiar en Hausline.',
  cancelado: 'Tu pedido fue cancelado. Si tienes dudas, escríbenos.',
  incidencia: 'Tenemos una novedad con tu pedido y ya la estamos gestionando. Te contactaremos pronto.',
}

// Las fotos del catálogo se guardan como RUTA RELATIVA (p.ej. "imgP/.../1.jpg"), no
// como URL. En el correo/PDF hay que volverlas absolutas contra el dominio del catálogo
// o el cliente de correo no las carga (sale la imagen rota). Deja intactas las que ya
// son absolutas (http/https) o data:. Base configurable con CATALOGO_BASE_URL.
export function absolutizarImagen(src) {
  const s = String(src ?? '').trim()
  if (!s) return ''
  if (/^(https?:|data:)/i.test(s)) return s
  const base = (process.env.CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')
  // Las rutas del catálogo traen espacios y acentos ("ZAPATOS MEN/Christian Loubutin/…").
  // El navegador los codifica solo, pero el PROXY de imágenes de Gmail/Outlook es estricto
  // y no carga una URL con espacios (sale la imagen rota). Codificamos cada segmento y
  // preservamos las barras. Si ya venía codificado (%20), no lo tocamos dos veces.
  const ruta = s
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => (/%[0-9a-f]{2}/i.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/')
  return `${base}/${ruta}`
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
    const fotoUrl = absolutizarImagen(item.imagen)
    const foto = fotoUrl
      ? `<img src="${esc(fotoUrl)}" width="52" height="52" alt="" style="display:block;width:52px;height:52px;border-radius:8px;object-fit:cover;border:1px solid #eef0f2;background-color:#f6f7f9;">`
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

// Foto(s) de control de calidad dentro del correo. Van inline (cid:) y ya traen la
// marca de agua HAUSLINE.NI grabada desde que se subieron. Solo aparece cuando el
// estado es "Control de calidad" y hay fotos visibles al cliente. Normalmente es UNA
// sola foto: en ese caso se muestra centrada y en buen tamaño; si hay varias, se
// acomodan en cuadrícula de 2 columnas para que se vean bien en el teléfono.
export function bloqueFotos(fotos) {
  if (!Array.isArray(fotos) || fotos.length === 0) return ''
  const img = (f, style) => `<img src="cid:${esc(f.cid)}" alt="Foto de control de calidad" style="${style}">`
  const varias = fotos.length > 1
  const titulo = varias ? 'Fotos de tu producto' : 'Foto de tu producto'
  const subtitulo = 'Así se ve tu pedido en nuestro control de calidad.'

  let galeria
  if (!varias) {
    // Una sola foto: centrada, ancho máximo cómodo.
    galeria = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="center" style="padding:0;">
                  ${img(fotos[0], 'display:block;width:100%;max-width:340px;height:auto;border-radius:10px;border:1px solid #e6e8ec;background-color:#f6f7f9;')}
                </td></tr></table>`
  } else {
    const filas = []
    for (let i = 0; i < fotos.length; i += 2) {
      const cel = (f) => f
        ? `<td width="50%" style="padding:5px;vertical-align:top;">${img(f, 'display:block;width:100%;height:auto;border-radius:10px;border:1px solid #e6e8ec;background-color:#f6f7f9;')}</td>`
        : '<td width="50%" style="padding:5px;"></td>'
      filas.push(`<tr>${cel(fotos[i])}${cel(fotos[i + 1])}</tr>`)
    }
    galeria = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas.join('')}</table>`
  }

  return `
          <!-- Foto(s) de control de calidad -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px;">
            <tr><td style="border:1px solid #e6e8ec;border-radius:12px;padding:20px 18px;">
              <div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b93a7;margin-bottom:6px;text-align:center;">${titulo}</div>
              <div style="font-size:13px;line-height:1.6;color:#4b5563;margin:0 0 14px;text-align:center;">${subtitulo}</div>
              ${galeria}
            </td></tr>
          </table>`
}

// Pipeline público de 8 etapas (espejo de ESTADOS_PEDIDO en src/constants/orders.ts).
// La barra de progreso del correo se pinta contra esta lista.
const TIMELINE = [
  { base: 'pedido_confirmado', label: 'Orden confirmada' },
  { base: 'en_preparacion', label: 'En preparación' },
  { base: 'control_calidad', label: 'Control de calidad' },
  { base: 'transito_internacional', label: 'En tránsito' },
  { base: 'llego_nicaragua', label: 'País de destino' },
  { base: 'disponible_entrega', label: 'Disponible para entrega' },
  { base: 'pagado', label: 'Pagado' },
  { base: 'entregado', label: 'Entregado' },
]
// Colapsa cualquier estado crudo (incl. sub-etapas de bodega/17TRACK) a una de las 8.
const ETAPA_BASE = {
  pedido_confirmado: 'pedido_confirmado', en_preparacion: 'en_preparacion', control_calidad: 'control_calidad',
  etiqueta_creada: 'transito_internacional', despachado: 'transito_internacional', transito_internacional: 'transito_internacional',
  recibido_estados_unidos: 'transito_internacional', transito_nicaragua: 'transito_internacional',
  llego_nicaragua: 'llego_nicaragua', disponible_entrega: 'disponible_entrega', pagado: 'pagado', entregado: 'entregado',
}
function indiceEtapa(estado) {
  const base = ETAPA_BASE[estado] || estado
  return TIMELINE.findIndex((t) => t.base === base)
}

// Barra/timeline de progreso: 8 segmentos, verde neón hasta la etapa actual y gris el
// resto, con el texto "Paso X de 8 · <etapa>". No se muestra en cancelado/incidencia
// (ni en avisos sin etapa, como el cargo por bodega): esos devuelven índice -1.
export function bloqueTimeline(estado) {
  const idx = indiceEtapa(estado)
  if (idx < 0) return ''
  const total = TIMELINE.length
  const celdas = TIMELINE.map((t, i) => {
    const on = i <= idx
    return `<td style="padding:0 3px;"><div style="height:7px;border-radius:4px;background-color:${on ? '#b7ff00' : '#e6e8ec'};font-size:0;line-height:0;">&nbsp;</div></td>`
  }).join('')
  return `
          <!-- Timeline de progreso -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
            <tr><td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${celdas}</tr></table>
              <div style="margin-top:11px;font-size:12px;color:#6b7280;text-align:center;">Paso <strong style="color:#0b0f19;">${idx + 1}</strong> de ${total} · <strong style="color:#0b0f19;">${esc(TIMELINE[idx].label)}</strong></div>
            </td></tr>
          </table>`
}

// Bloque de atención por WhatsApp (número configurable con WHATSAPP_NUMERO).
function bloqueWhatsapp() {
  const wa = String(process.env.WHATSAPP_NUMERO || '50578995116').replace(/[^0-9]/g, '')
  return `
          <!-- Atención por WhatsApp -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
            <tr><td style="border:1px solid #e6e8ec;border-radius:12px;padding:16px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="vertical-align:middle;font-size:13px;color:#4b5563;line-height:1.5;">¿Necesitas ayuda con tu pedido?<br><strong style="color:#0b0f19;">Atención por WhatsApp</strong></td>
                <td style="vertical-align:middle;text-align:right;white-space:nowrap;"><a href="https://wa.me/${wa}" target="_blank" style="display:inline-block;background-color:#25d366;color:#052012;text-decoration:none;font-weight:700;font-size:13px;padding:11px 18px;border-radius:9px;">Escribir por WhatsApp</a></td>
              </tr></table>
            </td></tr>
          </table>`
}

export function plantillaCorreo({ nombre, codigo, estado, estadoLabel, nota, urlSeguimiento, esNuevo, factura, fotos }) {
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
              <div style="display:inline-block;background-color:#050505;color:#b7ff00;font-size:15px;font-weight:700;letter-spacing:.3px;padding:9px 22px;border-radius:999px;">${estadoLabel}</div>
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
        <tr><td style="background-color:#050505;padding:34px 24px;text-align:center;">
          <div style="color:#ffffff;font-size:26px;font-weight:800;letter-spacing:5px;line-height:1;">HAUS<span style="color:#b7ff00;">LINE</span></div>
          <div style="color:#8b93a7;font-size:10px;font-weight:600;letter-spacing:4px;text-transform:uppercase;margin-top:8px;">King of Shoes</div>
        </td></tr>

        <!-- Barra de acento -->
        <tr><td style="height:4px;background-color:#b7ff00;font-size:0;line-height:0;">&nbsp;</td></tr>

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

${bloqueTimeline(estado)}${bloqueEstado}${bloqueFotos(fotos)}${bloqueFactura(factura)}
          <!-- Botón -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
            <a href="${urlSeguimiento}" target="_blank" style="display:inline-block;background-color:#b7ff00;color:#052012;text-decoration:none;font-weight:800;font-size:15px;letter-spacing:.4px;padding:16px 40px;border-radius:10px;">VER MI PEDIDO</a>
          </td></tr></table>
          <p style="margin:16px 0 0;font-size:12px;line-height:1.5;text-align:center;color:#9aa0ab;">O copia este enlace de seguimiento:<br><a href="${urlSeguimiento}" target="_blank" style="color:#6b7280;text-decoration:underline;word-break:break-all;">${urlSeguimiento}</a></p>
${bloqueWhatsapp()}
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

function montoNIO(valor) {
  if (valor === null || valor === undefined || valor === '') return ''
  return `C$ ${(Number(valor) || 0).toLocaleString('es-NI', { maximumFractionDigits: 0 })}`
}

// ── Aviso INTERNO (para ti) cuando cae un ENCARGO WEB nuevo ──────────────────
// No va al cliente: avisa al negocio que entró una solicitud desde el catálogo,
// con el resumen (cliente, producto, montos, envío) y un botón al panel de
// "Encargos por confirmar". El encargo vence en 24 h si no se confirma.
export function plantillaEncargoAdmin({ s, panelUrl }) {
  const anio = new Date().getFullYear()
  const wa = String(s.cliente_whatsapp || '').replace(/[^0-9]/g, '')
  const waLink = wa ? `https://wa.me/${wa}` : ''
  const detalle = [
    s.marca && `Marca: ${esc(s.marca)}`,
    s.talla && `Talla: ${esc(s.talla)}`,
    s.color && `Color: ${esc(s.color)}`,
    s.producto_codigo && `Código: ${esc(s.producto_codigo)}`,
  ].filter(Boolean).join(' · ')
  const envio = s.envio === 'rapido' ? 'Envío rápido (14-17 días)' : 'Envío estándar (20-25 días)'
  const pago = s.pago_tipo === '50' ? 'Abono 50%' : 'Pago total'
  const totalNio = montoNIO(s.total_nio)

  const fila = (label, valor) => valor
    ? `<tr>
        <td style="padding:7px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;width:130px;">${label}</td>
        <td style="padding:7px 0;font-size:14px;color:#0b0f19;font-weight:600;">${valor}</td>
      </tr>`
    : ''

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Encargo ${esc(s.codigo)}</title></head>
<body style="margin:0;padding:0;background-color:#ececed;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#ececed;">Nuevo encargo ${esc(s.codigo)}: ${esc(s.producto)}. Vence en 24 h.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ececed;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(17,24,39,.08);">
        <tr><td style="background-color:#050505;padding:30px 24px;text-align:center;">
          <div style="color:#ffffff;font-size:24px;font-weight:800;letter-spacing:5px;line-height:1;">HAUS<span style="color:#b7ff00;">LINE</span></div>
          <div style="color:#b7ff00;font-size:11px;font-weight:600;letter-spacing:3px;text-transform:uppercase;margin-top:8px;">Nuevo encargo web</div>
        </td></tr>
        <tr><td style="height:4px;background-color:#b7ff00;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:32px 36px 8px;">
          <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#0b0f19;">Entró un encargo desde el catálogo</p>
          <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#b26a00;">⏳ Vence en 24 h si no lo confirmas.</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
            <tr><td style="background-color:#f6f7f9;border:1px solid #e6e8ec;border-radius:10px;padding:14px 18px;">
              <span style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b93a7;">Código del encargo</span><br>
              <span style="font-size:18px;font-weight:800;color:#0b0f19;letter-spacing:1px;">${esc(s.codigo)}</span>
            </td></tr>
          </table>

          <div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8b93a7;margin:0 0 10px;">Producto</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
            <td style="vertical-align:top;padding-right:14px;width:88px;">${absolutizarImagen(s.imagen)
              ? `<img src="${esc(absolutizarImagen(s.imagen))}" width="88" height="88" alt="" style="display:block;width:88px;height:88px;border-radius:12px;object-fit:cover;border:1px solid #eef0f2;background-color:#f6f7f9;">`
              : `<div style="width:88px;height:88px;border-radius:12px;border:1px solid #eef0f2;background-color:#f6f7f9;"></div>`}</td>
            <td style="vertical-align:top;">
              <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#0b0f19;line-height:1.3;">${esc(s.producto)}${s.cantidad > 1 ? ` <span style="color:#6b7280;font-weight:600;">× ${Number(s.cantidad)}</span>` : ''}</p>
              ${s.producto_codigo ? `<div style="display:inline-block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;font-weight:700;letter-spacing:.4px;color:#0b0f19;background-color:#f2f4f6;border:1px solid #e6e8ec;border-radius:6px;padding:3px 9px;margin:0 0 6px;">${esc(s.producto_codigo)}</div>` : ''}
              ${detalle ? `<p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${detalle}</p>` : ''}
            </td>
          </tr></table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eef0f2;margin-top:8px;padding-top:8px;">
            ${fila('Total', `${montoUSD(s.total)}${totalNio ? ` &nbsp;·&nbsp; <span style="color:#6b7280;font-weight:600;">${totalNio}</span>` : ''}`)}
            ${fila('Pago', `${pago}${(Number(s.abono) || 0) > 0 ? ` — abona ${montoUSD(s.abono)}` : ''}`)}
            ${fila('Envío', envio)}
            ${fila('Cliente', esc(s.cliente_nombre))}
            ${fila('WhatsApp', waLink ? `<a href="${waLink}" target="_blank" style="color:#0b0f19;text-decoration:underline;">${esc(s.cliente_whatsapp)}</a>` : esc(s.cliente_whatsapp))}
            ${fila('Correo', s.cliente_correo ? esc(s.cliente_correo) : '')}
            ${fila('Ciudad', s.cliente_ciudad ? esc(s.cliente_ciudad) : '')}
            ${fila('Dirección', s.cliente_direccion ? esc(s.cliente_direccion) : '')}
            ${fila('Comprobante', s.comprobante_url ? `<a href="${esc(s.comprobante_url)}" target="_blank" style="color:#0b0f19;text-decoration:underline;">Ver comprobante</a>` : 'Aún sin subir')}
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;"><tr><td align="center">
            <a href="${panelUrl}" target="_blank" style="display:inline-block;background-color:#b7ff00;color:#052012;text-decoration:none;font-weight:800;font-size:15px;padding:15px 38px;border-radius:10px;">Abrir en el panel</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:26px 36px 32px;border-top:1px solid #eef0f2;text-align:center;">
          <p style="margin:0;font-size:11px;color:#b7bcc5;">© ${anio} Hausline · Aviso interno automático</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

// Envía el aviso interno del encargo web nuevo. `to` puede traer varias direcciones
// separadas por coma. Lanza si el SMTP falla.
export async function enviarCorreoEncargoAdmin({ to, solicitud }) {
  const appUrl = (process.env.APP_URL ?? process.env.VITE_PUBLIC_APP_URL ?? 'https://hausline-tracking.vercel.app').replace(/\/$/, '')
  const panelUrl = `${appUrl}/solicitudes`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`,
    to,
    // Asunto estilo Shopify: "Order SOL-0545 · $67.00 · chrome hearts T SHIRT".
    // Así, en la notificación del teléfono se lee corto y directo.
    subject: `Order ${solicitud.codigo} · ${montoUSD(solicitud.total).replace('USD ', '$')} · ${solicitud.producto}`,
    html: plantillaEncargoAdmin({ s: solicitud, panelUrl }),
  })
}

// Correo automático de CARGO POR BODEGA. Lo dispara el cron diario cuando un pedido
// lleva más de los días de gracia "disponible para entrega" sin retirarse. Le avisa al
// cliente cuántos días lleva y cuánto se sumó a su factura final, para presionar el pago.
// Reusa la plantilla base con una nota a medida (sin factura ni fotos).
export async function enviarCorreoBodega({ correo, nombre, codigo, dias, diasCobrados, cargo, cordobas }) {
  const appUrl = (process.env.APP_URL ?? process.env.VITE_PUBLIC_APP_URL ?? 'https://hausline-tracking.vercel.app').replace(/\/$/, '')
  const urlSeguimiento = `${appUrl}/tracking/${codigo}`
  const cargoTxt = montoUSD(cargo) + (cordobas ? ` (≈ C$ ${Number(cordobas).toLocaleString('es-NI')})` : '')
  const nota = `Tu pedido lleva <strong>${dias} días</strong> disponible para entrega. Pasados los 2 días de gracia, se cobran US$ 5 por cada día extra en bodega. Hasta hoy se han sumado <strong>${cargoTxt}</strong> (${diasCobrados} ${diasCobrados === 1 ? 'día' : 'días'}) a tu factura final. Coordiná tu entrega y pago para que no siga subiendo.`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`,
    to: correo,
    subject: `Pedido ${codigo}: cargo por bodega (${cargoTxt})`,
    html: plantillaCorreo({ nombre, codigo, estadoLabel: 'Cargo por bodega', nota, urlSeguimiento, esNuevo: false, factura: null, fotos: [] }),
  })
}

// Envía el correo del pedido (creación o cambio de estado). Lanza si el SMTP falla.
// `factura` es opcional: cuando llega, el correo incluye la tabla de la compra
// (al crear el pedido) o del pago (al entregarlo).
export async function enviarCorreoPedido({ correo, nombre, codigo, estado, esNuevo, factura, fotos }) {
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

  // Fotos de control de calidad: van inline (cid) para que se vean dentro del correo
  // sin depender de enlaces que caducan. Cada foto ya trae la marca de agua grabada.
  if (Array.isArray(fotos) && fotos.length) {
    for (const f of fotos) {
      attachments.push({ filename: f.filename, content: f.content, contentType: f.contentType || 'image/webp', cid: f.cid })
    }
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`,
    to: correo,
    subject: esNuevo ? `Pedido ${codigo}: Orden confirmada` : `Pedido ${codigo}: ${estadoLabel}`,
    html: plantillaCorreo({ nombre, codigo, estado, estadoLabel, nota, urlSeguimiento, esNuevo, factura, fotos }),
    attachments,
  })
}
