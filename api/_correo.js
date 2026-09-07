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
  empaquetado: 'Empaquetado, listo para envío',
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
  pagado: '¡Recibimos tu pago! Tu pedido ya quedó apartado y está a la espera de ser entregado. Muy pronto coordinamos la entrega contigo. ¡Muchas gracias por tu compra!',
  empaquetado: '¡Buenas noticias! Tu pedido ya está empaquetado y listo para envío. Abajo puedes ver la foto de tu paquete: ya va en camino hacia vos. Pronto coordinamos la entrega.',
  entregado: '¡Tu pedido fue entregado! Esperamos que lo disfrutes muchísimo. Fue un gusto atenderte y te esperamos en tu próxima compra.',
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

// Versión corta ("$165.00") para las columnas de las líneas de la factura, donde el
// ancho importa en el teléfono. En los totales se sigue usando "USD …" (tienen espacio).
function montoUSDcorto(valor) {
  return `$${(Number(valor) || 0).toFixed(2)}`
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
      ? `<img src="${esc(fotoUrl)}" width="46" height="46" alt="" style="display:block;width:46px;height:46px;border-radius:8px;object-fit:cover;border:1px solid #eef0f2;background-color:#f6f7f9;">`
      : `<div style="width:46px;height:46px;border-radius:8px;border:1px solid #eef0f2;background-color:#f6f7f9;"></div>`
    return `<tr>
      <td class="rowline" style="padding:13px 0;border-bottom:1px solid #eef0f2;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="padding:0 10px 0 0;vertical-align:top;width:46px;">${foto}</td>
          <td class="t-primary" style="vertical-align:top;font-size:14px;color:#0b0f19;line-height:1.4;">${esc(item.producto)}${codigo}${detalle}</td>
        </tr></table>
      </td>
      <td class="rowline t-body" style="padding:13px 4px;border-bottom:1px solid #eef0f2;font-size:13px;color:#4b5563;text-align:center;white-space:nowrap;vertical-align:top;">${Number(item.cantidad) || 1}</td>
      <td class="rowline t-body" style="padding:13px 0;border-bottom:1px solid #eef0f2;font-size:13px;color:#4b5563;text-align:right;white-space:nowrap;vertical-align:top;">${montoUSDcorto(item.precioUnitario)}</td>
      <td class="rowline t-primary" style="padding:13px 0 13px 10px;border-bottom:1px solid #eef0f2;font-size:13px;font-weight:600;color:#0b0f19;text-align:right;white-space:nowrap;vertical-align:top;">${montoUSDcorto(item.subtotal)}</td>
    </tr>`
  }).join('')

  const totalFila = (label, valor, { strong = false, color = '#0b0f19', cls = '' } = {}) => `<tr>
    <td colspan="2" style="border:0;"></td>
    <td style="padding:5px 6px 5px 0;font-size:13px;color:#6b7280;text-align:right;line-height:1.3;">${label}</td>
    <td class="${cls}" style="padding:5px 0 5px 10px;font-size:${strong ? '17px' : '13px'};font-weight:${strong ? 800 : 600};color:${color};text-align:right;white-space:nowrap;">${valor}</td>
  </tr>`

  const pendiente = !esPago && (Number(factura.saldo) || 0) > 0.01
  const saldoFila = esPago
    ? totalFila('Saldo pendiente', 'PAGADO', { strong: true, cls: 't-primary' })
    : totalFila('Saldo pendiente', montoUSDcorto(factura.saldo), { strong: true, color: pendiente ? '#b26a00' : '#0b0f19', cls: pendiente ? '' : 't-primary' })

  return `
          <!-- Factura -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px;">
            <tr><td class="card" style="border:1px solid #e6e8ec;border-radius:12px;padding:20px 18px 16px;">
              <div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b93a7;margin-bottom:14px;">${esPago ? 'Comprobante de pago' : 'Detalle de tu compra'}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8b93a7;">Producto</td>
                  <td style="padding:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8b93a7;text-align:center;">Cant.</td>
                  <td style="padding:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8b93a7;text-align:right;">Precio</td>
                  <td style="padding:0 0 10px 10px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#8b93a7;text-align:right;">Subtotal</td>
                </tr>
                ${filas}
                <tr><td colspan="4" style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>
                ${totalFila('Total del pedido', montoUSDcorto(factura.total), { cls: 't-primary' })}
                ${totalFila(esPago ? 'Pago recibido' : 'Abono recibido', montoUSDcorto(factura.abono), { cls: 't-primary' })}
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
export function bloqueFotos(fotos, estado) {
  if (!Array.isArray(fotos) || fotos.length === 0) return ''
  const base = ETAPA_BASE[estado] || estado
  const esEmpaque = base === 'empaquetado'
  const esProducto = base === 'disponible_entrega'
  const alt = esEmpaque ? 'Foto de tu paquete empacado' : 'Foto de tu producto'
  const img = (f, style) => `<img src="cid:${esc(f.cid)}" alt="${alt}" style="${style}">`
  const varias = fotos.length > 1
  const titulo = esEmpaque
    ? (varias ? 'Fotos de tu paquete' : 'Foto de tu paquete')
    : (varias ? 'Fotos de tu producto' : 'Foto de tu producto')
  const subtitulo = esEmpaque
    ? 'Tu pedido ya quedó empaquetado y listo para envío. ¡Va en camino hacia vos!'
    : esProducto
      ? 'Tu pedido ya llegó a HAUSLINE. Estas son las fotos reales de tu producto.'
      : 'Así se ve tu pedido en nuestro control de calidad.'

  // La cuadrícula se adapta a la cantidad para verse bien incluso con muchas fotos:
  //   1 foto  → centrada y grande
  //   2-4     → 2 columnas
  //   5 o más → 3 columnas (miniaturas ordenadas; aguanta 6, 9, 12… sin romperse)
  const n = fotos.length
  const estiloFoto = 'display:block;width:100%;height:auto;border-radius:10px;border:1px solid #e6e8ec;background-color:#f6f7f9;'
  let galeria
  if (n === 1) {
    galeria = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="center" style="padding:0;">
                  ${img(fotos[0], 'display:block;width:100%;max-width:340px;height:auto;border-radius:10px;border:1px solid #e6e8ec;background-color:#f6f7f9;')}
                </td></tr></table>`
  } else {
    const cols = n <= 4 ? 2 : 3
    const anchoCel = `${Math.floor(100 / cols)}%`
    const filas = []
    for (let i = 0; i < n; i += cols) {
      const celdas = []
      for (let c = 0; c < cols; c++) {
        const f = fotos[i + c]
        celdas.push(f
          ? `<td width="${anchoCel}" style="padding:4px;vertical-align:top;">${img(f, estiloFoto)}</td>`
          : `<td width="${anchoCel}" style="padding:4px;"></td>`)
      }
      filas.push(`<tr>${celdas.join('')}</tr>`)
    }
    galeria = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas.join('')}</table>`
  }

  return `
          <!-- Foto(s) de control de calidad -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px;">
            <tr><td class="card" style="border:1px solid #e6e8ec;border-radius:12px;padding:20px 18px;">
              <div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8b93a7;margin-bottom:6px;text-align:center;">${titulo}</div>
              <div class="t-body" style="font-size:13px;line-height:1.6;color:#4b5563;margin:0 0 14px;text-align:center;">${subtitulo}</div>
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
  { base: 'empaquetado', label: 'Listo para envío' },
  { base: 'entregado', label: 'Entregado' },
]
// Colapsa cualquier estado crudo (incl. sub-etapas de bodega/17TRACK) a una de las 8.
const ETAPA_BASE = {
  pedido_confirmado: 'pedido_confirmado', en_preparacion: 'en_preparacion', control_calidad: 'control_calidad',
  etiqueta_creada: 'transito_internacional', despachado: 'transito_internacional', transito_internacional: 'transito_internacional',
  recibido_estados_unidos: 'transito_internacional', transito_nicaragua: 'transito_internacional',
  llego_nicaragua: 'llego_nicaragua', disponible_entrega: 'disponible_entrega', pagado: 'pagado', empaquetado: 'empaquetado', entregado: 'entregado',
}
function indiceEtapa(estado) {
  let base = ETAPA_BASE[estado] || estado
  // El pago no es un paso visible en la barra: un pedido "pagado" se ubica en "Disponible
  // para entrega" (el titular/label del correo de pago sí se conservan, ver tituloEstado).
  if (base === 'pagado') base = 'disponible_entrega'
  return TIMELINE.findIndex((t) => t.base === base)
}

// Titular editorial (serif) según la etapa. Se busca por la etapa base.
const HEADLINE = {
  pedido_confirmado: 'Tu orden está confirmada',
  en_preparacion: 'Estamos preparando tu pedido',
  control_calidad: 'Tu pedido está en control de calidad',
  transito_internacional: 'Tu pedido está en camino',
  llego_nicaragua: 'Tu pedido llegó al país de destino',
  disponible_entrega: 'Tu pedido está disponible para entrega',
  pagado: 'Confirmamos el pago de tu pedido',
  empaquetado: 'Tu pedido está empaquetado y listo para envío',
  entregado: 'Tu pedido fue entregado',
  cancelado: 'Tu pedido fue cancelado',
  incidencia: 'Tu pedido requiere atención',
}
export function tituloEstado(estado) {
  const base = ETAPA_BASE[estado] || estado
  return HEADLINE[base] || 'Actualización de tu pedido'
}

// Progreso del pedido como BARRA (no puntos): los clientes de correo (Gmail/iOS)
// deforman los puntos+líneas hechos con mini-tablas (salían óvalos torcidos). Una barra
// —track claro + relleno oscuro proporcional a la etapa— se renderiza bien en todos.
// Arriba: etiqueta de la etapa actual + "Etapa N / M". Los colores llevan clases para
// invertirse en modo oscuro (ver el <style>). Devuelve '' en cancelado/incidencia y
// cuando no hay etapa (p.ej. el aviso de bodega): índice -1.
export function bloqueTimeline(estado) {
  const idx = indiceEtapa(estado)
  if (idx < 0) return ''
  const total = TIMELINE.length
  const pasos = idx + 1
  const pct = Math.max(6, Math.round((pasos / total) * 100)) // mínimo visible en la 1.ª etapa
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td class="t-primary" style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#0b0f19;line-height:1.3;">${esc(TIMELINE[idx].label)}</td>
              <td style="text-align:right;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#aeb4bb;white-space:nowrap;vertical-align:bottom;">Etapa ${pasos} / ${total}</td>
            </tr>
            <tr><td colspan="2" style="padding-top:11px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td class="bar-track" style="background-color:#e8eaed;border-radius:99px;padding:0;font-size:0;line-height:0;">
                  <table role="presentation" width="${pct}%" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td class="bar-fill" height="9" style="height:9px;background-color:#0b0f19;border-radius:99px;font-size:0;line-height:0;">&nbsp;</td>
                  </tr></table>
                </td>
              </tr></table>
            </td></tr>
          </table>`
}

// Fila de ayuda por WhatsApp (número configurable con WHATSAPP_NUMERO).
function bloqueWhatsapp() {
  const wa = String(process.env.WHATSAPP_NUMERO || '50578995116').replace(/[^0-9]/g, '')
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td class="t-primary" style="vertical-align:middle;font-size:14px;font-weight:700;color:#0b0f19;line-height:1.5;">¿Necesitas ayuda?<br><span style="font-size:13px;font-weight:400;color:#8b93a7;">Habla con nosotros por WhatsApp</span></td>
            <td style="vertical-align:middle;text-align:right;white-space:nowrap;"><a class="t-primary underline-accent" href="https://wa.me/${wa}" target="_blank" style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#0b0f19;text-decoration:none;border-bottom:2px solid #0b0f19;padding-bottom:2px;">Escribir</a></td>
          </tr></table>`
}

// Caja de "deja tu reseña" (se muestra en el correo de pedido entregado). El link va a
// la tienda (/resena/?c=CODE), donde el cliente deja su reseña (queda pendiente de
// aprobación). Base del sitio en CATALOGO_BASE_URL (mismo dominio del catálogo).
function bloqueResena(codigo) {
  const base = (process.env.CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')
  const url = `${base}/resena/?c=${encodeURIComponent(codigo)}`
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td class="card" style="border:1px solid #e6e8ec;border-radius:8px;padding:20px;text-align:center;">
              <div class="t-primary" style="font-size:18px;letter-spacing:4px;color:#0b0f19;">★★★★★</div>
              <div class="t-primary" style="font-size:16px;font-weight:700;color:#0b0f19;margin-top:8px;">¿Cómo estuvo tu experiencia?</div>
              <div style="font-size:13px;line-height:1.6;color:#8b93a7;margin:6px 0 14px;">Tu opinión ayuda a otros clientes a comprar con confianza.</div>
              <a class="btn-outline" href="${url}" target="_blank" style="display:inline-block;border:1px solid #050505;color:#050505;text-decoration:none;font-weight:700;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;padding:12px 26px;border-radius:6px;">Dejar mi reseña</a>
            </td></tr>
          </table>`
}

export function plantillaCorreo({ nombre, codigo, estado, estadoLabel, nota, urlSeguimiento, esNuevo, factura, fotos, ctaTexto, ctaUrl, pedirResena }) {
  const btnUrl = ctaUrl || urlSeguimiento
  const btnTxt = ctaTexto || 'Ver seguimiento'
  const esEntregado = (ETAPA_BASE[estado] || estado) === 'entregado'
  // Caja "deja tu reseña": la decide quien llama (pagado y/o entregado); si no lo indica,
  // se conserva el comportamiento histórico de mostrarla al entregar.
  const mostrarResena = pedirResena ?? esEntregado
  const intro = esNuevo
    ? `Gracias por tu compra. Confirmamos tu pedido y ya comenzamos a gestionarlo.`
    : `Tu pedido tiene una nueva actualización.`
  // Texto de previsualización (lo que se ve en la bandeja antes de abrir el correo).
  const preheader = esNuevo
    ? `Confirmamos tu pedido ${codigo}. Sigue cada etapa desde aquí.`
    : `${codigo}: ${estadoLabel}. Revisa el detalle del seguimiento.`
  const anio = new Date().getFullYear()
  const titulo = tituloEstado(estado)
  const kicker = esNuevo ? 'Confirmación de pedido' : 'Actualización de pedido'
  const correoContacto = process.env.CONTACT_EMAIL || 'alerta@hauslineshopni.es'
  const telContacto = process.env.CONTACT_PHONE || '+505 7899 5116'

  const timeline = bloqueTimeline(estado)
  const datos = bloqueFactura(factura)          // datos del pedido: foto, talla, código, precio
  const fotosBloque = bloqueFotos(fotos, estado) // fotos de control de calidad o del paquete empacado (cuando aplica)
  const font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`
  const serif = `Georgia,'Times New Roman',Times,serif`

  return `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Pedido ${codigo}</title>
  <!--[if mso]><style>body,table,td,a{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    /* Modo oscuro: el correo sigue el tema del dispositivo (Apple Mail / iOS Mail lo
       respetan; Gmail lo ignora y se queda en claro, que también se ve bien). */
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color:#0a0c10 !important; }
      .shell { background-color:#111319 !important; }
      .edge { background-color:#f2f4f7 !important; }
      .brand, .t-primary { color:#f2f4f7 !important; }
      .t-body { color:#c7ccd4 !important; }
      .hr { background-color:#262a32 !important; }
      .card { background-color:#171a20 !important; border-color:#2b303a !important; }
      .note { background-color:#171a20 !important; border-color:#2b303a !important; }
      .note-accent { border-left-color:#f2f4f7 !important; }
      .rowline { border-bottom-color:#2b303a !important; }
      .btn { background-color:#f2f4f7 !important; color:#0a0c10 !important; }
      .btn-outline { border-color:#f2f4f7 !important; color:#f2f4f7 !important; }
      .underline-accent { border-bottom-color:#f2f4f7 !important; }
      .bar-track { background-color:#2b303a !important; }
      .bar-fill { background-color:#f2f4f7 !important; }
    }
    /* Teléfono: reduce los márgenes laterales para que la factura y todo el contenido
       quepan sin recortarse en pantallas angostas (Gmail Android, teléfonos de 360px). */
    @media only screen and (max-width:480px) {
      .pad { padding-left:16px !important; padding-right:16px !important; }
      .card { padding-left:14px !important; padding-right:14px !important; }
    }
  </style>
</head>
<body class="email-bg" style="margin:0;padding:0;background-color:#ffffff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;font-family:${font};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="background-color:#ffffff;">
    <tr><td align="center" style="padding:0;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="shell" style="width:100%;max-width:600px;background-color:#ffffff;">

        <!-- Filo superior -->
        <tr><td class="edge" style="height:4px;background-color:#050505;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Encabezado: marca + kicker -->
        <tr><td class="pad" style="padding:26px 24px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td class="brand" style="font-size:16px;font-weight:800;letter-spacing:4px;color:#0b0f19;">HAUSLINE</td>
            <td style="text-align:right;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#aeb4bb;">${esc(kicker)}</td>
          </tr></table>
        </td></tr>
        <tr><td class="pad" style="padding:0 24px;"><div class="hr" style="height:1px;background-color:#eef0f2;font-size:0;line-height:0;">&nbsp;</div></td></tr>

        <!-- Titular editorial -->
        <tr><td class="pad" style="padding:36px 24px 0;">
          <h1 class="t-primary" style="margin:0;font-family:${serif};font-weight:400;font-size:30px;line-height:1.18;color:#0b0f19;">${esc(titulo)}</h1>
          <p style="margin:14px 0 0;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#aeb4bb;">Pedido #${codigo}</p>
        </td></tr>

        <!-- Datos del pedido primero (foto, talla, código, precio) -->
        ${datos ? `<tr><td class="pad" style="padding:28px 24px 0;">${datos}</td></tr>` : ''}

        <!-- Línea de seguimiento horizontal -->
        ${timeline ? `<tr><td class="pad" style="padding:${datos ? '4px' : '30px'} 24px 0;">${timeline}</td></tr>` : ''}

        <!-- Nota del estado -->
        <tr><td class="pad" style="padding:${timeline || datos ? '30px' : '28px'} 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td class="note note-accent t-body" style="border:1px solid #e6e8ec;border-left:4px solid #0b0f19;border-radius:8px;padding:15px 18px;font-size:14px;line-height:1.6;color:#4b5563;">${nota || intro}</td></tr>
          </table>
        </td></tr>

        ${fotosBloque ? `<tr><td class="pad" style="padding:28px 24px 0;">${fotosBloque}</td></tr>` : ''}

        ${mostrarResena ? `<tr><td class="pad" style="padding:28px 24px 0;">${bloqueResena(codigo)}</td></tr>` : ''}

        <!-- Botón -->
        <tr><td class="pad" style="padding:28px 24px 0;">
          <a class="btn" href="${btnUrl}" target="_blank" style="display:block;background-color:#050505;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;text-align:center;padding:17px 20px;border-radius:6px;">${esc(btnTxt)}</a>
          <p style="margin:12px 0 0;font-size:11px;line-height:1.5;text-align:center;color:#b7bcc5;"><a href="${btnUrl}" target="_blank" style="color:#b7bcc5;text-decoration:underline;word-break:break-all;">${btnUrl}</a></p>
        </td></tr>

        <!-- Ayuda -->
        <tr><td class="pad" style="padding:26px 24px 0;"><div class="hr" style="height:1px;background-color:#eef0f2;font-size:0;line-height:0;">&nbsp;</div></td></tr>
        <tr><td class="pad" style="padding:22px 24px 0;">${bloqueWhatsapp()}</td></tr>

        <!-- Confianza -->
        <tr><td class="pad" style="padding:26px 24px 0;text-align:center;">
          <div style="font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#aeb4bb;">Compra segura&nbsp;&nbsp;·&nbsp;&nbsp;Seguimiento de pedido&nbsp;&nbsp;·&nbsp;&nbsp;Atención personalizada</div>
        </td></tr>

        <!-- Pie -->
        <tr><td class="pad" style="padding:26px 24px 36px;">
          <div class="hr" style="height:1px;background-color:#eef0f2;font-size:0;line-height:0;margin-bottom:20px;">&nbsp;</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td class="t-primary" style="font-size:13px;font-weight:800;letter-spacing:3px;color:#0b0f19;">HAUSLINE</td>
            <td style="text-align:right;font-size:11px;color:#9aa0ab;line-height:1.6;">${esc(correoContacto)}<br>${esc(telContacto)}</td>
          </tr></table>
          <p style="margin:14px 0 0;font-size:10px;color:#c4c9d0;">© ${anio} Hausline · King of Shoes · Aviso automático de tu pedido</p>
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

// Recordatorio de ABANDONO DE CHECKOUT. Lo dispara el cron cuando un encargo lleva
// varias horas "pendiente" (sin confirmar el pago) y aún no vence. Reusa la plantilla
// base con CTA propio hacia la página de pago (/checkout/?c=CODE) del sitio.
export async function enviarCorreoAbandono({ correo, nombre, codigo, producto }) {
  const base = (process.env.CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')
  const checkoutUrl = `${base}/checkout/?c=${encodeURIComponent(codigo)}`
  const nota = `Tu pedido ${codigo}${producto ? ` de <strong>${esc(producto)}</strong>` : ''} quedó a un paso de confirmarse. Completá tu pago y lo mandamos a pedir enseguida — recordá que el encargo se cancela solo a las 24 horas de creado.`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`,
    to: correo,
    subject: `${codigo}: completá tu pedido antes de que expire`,
    html: plantillaCorreo({
      nombre, codigo, estado: null, estadoLabel: 'Completa tu pedido', nota,
      urlSeguimiento: checkoutUrl, esNuevo: false, factura: null, fotos: [],
      ctaTexto: 'Completar mi pedido', ctaUrl: checkoutUrl,
    }),
  })
}

// Correo automático de "ESPERAMOS TU PAGO". Se dispara al instante en que el cliente
// crea un encargo desde la web (mismo webhook que avisa al admin). Le confirma su código
// temporal SOL-####, le dice que estamos esperando el pago y le da un botón para pagar y
// enviar el comprobante (la página /checkout/?c=CODE, que ya trae cuentas y WhatsApp).
// Así, aunque haya escrito mal su teléfono, el cliente tiene su código y cómo continuar.
export async function enviarCorreoEsperandoPago({ correo, nombre, codigo, producto }) {
  const base = (process.env.CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')
  const checkoutUrl = `${base}/checkout/?c=${encodeURIComponent(codigo)}`
  const nota = `¡Recibimos tu pedido <strong>${esc(codigo)}</strong>!${producto ? ` de <strong>${esc(producto)}</strong>` : ''} Estamos <strong>esperando tu pago</strong> para confirmarlo. Realizá la transferencia y enviá tu comprobante desde el botón de abajo. Guardá tu código: es tu referencia para cualquier consulta. Tenemos tu pedido en espera por <strong>24 horas</strong>; si no recibimos el pago, se cancela solo.<br><br><span style="font-size:12px;color:#8b93a7;">Importante: los pedidos por encargo <strong>no admiten devoluciones de dinero ni cambios</strong>.</span>`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`,
    to: correo,
    subject: `${codigo}: recibimos tu pedido — esperamos tu pago`,
    html: plantillaCorreo({
      nombre, codigo, estado: null, estadoLabel: 'Esperando tu pago', nota,
      urlSeguimiento: checkoutUrl, esNuevo: false, factura: null, fotos: [],
      ctaTexto: 'Pagar y enviar comprobante', ctaUrl: checkoutUrl,
    }),
  })
}

// Aviso automático de RETRASO: se manda solo (desde el cron) cuando un pedido lleva más
// de 27 días en tránsito internacional. Mensaje suave de disculpa; muestra el timeline en
// la etapa de tránsito y un botón al seguimiento. Sin factura ni reseña. Lanza si SMTP falla.
export async function enviarCorreoRetraso({ correo, nombre, codigo, estado }) {
  const appUrl = (process.env.APP_URL ?? process.env.VITE_PUBLIC_APP_URL ?? 'https://hausline-tracking.vercel.app').replace(/\/$/, '')
  const urlSeguimiento = `${appUrl}/tracking/${codigo}`
  const nota = `Queremos contarte que tu pedido <strong>${esc(codigo)}</strong> está tardando un poco más de lo habitual en su tránsito internacional. Los envíos internacionales a veces tienen demoras en aduana o transporte que no dependen de nosotros; ya le estamos dando seguimiento para que llegue lo antes posible. Gracias por tu paciencia y por confiar en nosotros — cualquier duda, escríbenos.`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`,
    to: correo,
    subject: `Pedido ${codigo}: tu envío está tardando un poco más`,
    html: plantillaCorreo({
      nombre, codigo, estado: estado ?? null, estadoLabel: 'Aviso de retraso', nota,
      urlSeguimiento, esNuevo: false, factura: null, fotos: [],
    }),
  })
}

// Envía el correo del pedido (creación o cambio de estado). Lanza si el SMTP falla.
// `factura` es opcional: cuando llega, el correo incluye la tabla de la compra
// (al crear el pedido) o del pago (al entregarlo).
export async function enviarCorreoPedido({ correo, nombre, codigo, estado, esNuevo, factura, fotos, pedirResena }) {
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
    html: plantillaCorreo({ nombre, codigo, estado, estadoLabel, nota, urlSeguimiento, esNuevo, factura, fotos, pedirResena }),
    attachments,
  })
}
