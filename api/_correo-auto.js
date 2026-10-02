// Correos de las AUTOMATIZACIONES (api/_automatico.js): recordatorio de saldo, volver a comprar,
// recordatorio de reseña, carrito abandonado y el reporte diario al dueño. Reusan la plantilla
// y el SMTP de _correo.js (el guion bajo evita que Vercel lo publique como función).
import { absolutizarImagen, esc, montoUSDcorto, plantillaCorreo, transporteSmtp, urlPedidoCuenta } from './_correo.js'

const baseTienda = () => (process.env.CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')
const remitente = () => process.env.SMTP_FROM ?? `HAUSLINE <${process.env.SMTP_USER}>`
const primerNombre = (nombre) => String(nombre ?? '').trim().split(/\s+/)[0] || ''

// (1) SALDO: pedido disponible hace 2 días sin pagar. Mañana empieza el cargo por bodega, así
// que se le dice cuánto debe y a qué cuentas puede transferir.
export async function enviarCorreoRecordatorioSaldo({ correo, nombre, codigo, saldo, cordobas, cuentas }) {
  const lista = (cuentas ?? []).slice(0, 4)
    .map((c) => `<br>• <strong>${esc(c.banco)}</strong> (${esc(c.moneda)}): ${esc(c.numero)}${c.titular ? ` · ${esc(c.titular)}` : ''}`).join('')
  const nota = `Tu pedido <strong>${esc(codigo)}</strong> lleva 2 días disponible para entrega y tiene un saldo pendiente de <strong>US$${Number(saldo).toFixed(2)}</strong>`
    + `${cordobas ? ` (≈ C$ ${Number(cordobas).toLocaleString('es-NI')})` : ''}. <strong>A partir de mañana</strong> se suman US$5 por cada día en bodega, así que te recomendamos coordinar hoy tu pago y entrega.`
    + `${lista ? `<br><br>Podés transferir a:${lista}<br><br>Envianos el comprobante por WhatsApp y coordinamos la entrega.` : ''}`
  await transporteSmtp().sendMail({
    from: remitente(), to: correo,
    subject: `${codigo}: tu pedido te espera · saldo pendiente US$${Number(saldo).toFixed(2)}`,
    html: plantillaCorreo({ nombre, codigo, estado: 'disponible_entrega', estadoLabel: 'Tu pedido te espera', nota, urlSeguimiento: urlPedidoCuenta(codigo), esNuevo: false, factura: null, fotos: [], pedirResena: false }),
  })
}

// (7) VOLVER A COMPRAR: 30 días después de la entrega, cupón personal de un solo uso.
export async function enviarCorreoRecompra({ correo, nombre, cupon, porcentaje, vence }) {
  const url = `${baseTienda()}/?cupon=${encodeURIComponent(cupon)}`
  const venceTxt = vence ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${vence}T12:00:00Z`)) : null
  const nota = `¡Gracias por confiar en HAUSLINE! Como ya tenés tu pedido, te regalamos <strong>${porcentaje}% de descuento</strong> en tu próxima compra con el código `
    + `<strong style="font-size:16px;letter-spacing:1px">${esc(cupon)}</strong>${venceTxt ? ` (válido hasta el ${esc(venceTxt)})` : ''}. Tocá el botón y el descuento se aplica solo al pagar.`
  const n = primerNombre(nombre)
  await transporteSmtp().sendMail({
    from: remitente(), to: correo,
    subject: `${n ? `${n}, tenés` : 'Tenés'} ${porcentaje}% de descuento en tu próxima compra`,
    html: plantillaCorreo({ nombre, codigo: null, estado: null, estadoLabel: `Un regalo para vos: ${porcentaje}% OFF`, nota, urlSeguimiento: url, esNuevo: false, factura: null, fotos: [], ctaTexto: 'Ver la tienda con mi descuento', ctaUrl: url, pedirResena: false }),
  })
}

// (8) RESEÑA: 5 días después de la entrega, si todavía no dejó la suya.
export async function enviarCorreoRecordatorioResena({ correo, nombre, codigo }) {
  const url = `${baseTienda()}/resena/?c=${encodeURIComponent(codigo)}`
  const nota = `Esperamos que estés disfrutando tu pedido <strong>${esc(codigo)}</strong>. ¿Nos regalás un minuto para contarnos cómo te fue? Tu reseña (y si querés, una foto) ayuda muchísimo a otros clientes a comprar con confianza.`
  await transporteSmtp().sendMail({
    from: remitente(), to: correo,
    subject: `¿Cómo te fue con tu pedido ${codigo}? ★★★★★`,
    html: plantillaCorreo({ nombre, codigo, estado: null, estadoLabel: '¿Qué te pareció tu compra?', nota, urlSeguimiento: url, esNuevo: false, factura: null, fotos: [], ctaTexto: 'Dejar mi reseña', ctaUrl: url, pedirResena: false }),
  })
}

// (6) CARRITO ABANDONADO: llenó el checkout (dejó su correo) y no terminó el pedido.
export async function enviarCorreoCarritoAbandonado({ correo, nombre, items, total }) {
  const base = baseTienda()
  const lista = (Array.isArray(items) ? items : []).slice(0, 4)
  const urlDe = (it) => it?.codigo ? `${base}/p/${encodeURIComponent(it.codigo)}/` : base
  const filas = lista.map((it) => {
    const img = absolutizarImagen(it.imagen)
    const url = urlDe(it)
    return `<tr><td class="rowline" style="padding:10px 0;border-bottom:1px solid #eef0f2;width:64px;vertical-align:top">${img ? `<a href="${esc(url)}"><img src="${esc(img)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid #eef0f2"></a>` : ''}</td>`
      + `<td class="rowline" style="padding:10px 0 10px 12px;border-bottom:1px solid #eef0f2;vertical-align:top"><a class="t-primary" href="${esc(url)}" style="color:#0b0f19;text-decoration:none;font-size:14px;font-weight:600">${esc(it.nombre || 'Producto')}</a>${it.talla ? `<div style="font-size:12px;color:#8b93a7;margin-top:2px">Talla ${esc(it.talla)}</div>` : ''}</td>`
      + `<td class="rowline t-primary" style="padding:10px 0;border-bottom:1px solid #eef0f2;text-align:right;white-space:nowrap;vertical-align:top;font-size:13px;font-weight:600;color:#0b0f19">${Number(it.precio) > 0 ? montoUSDcorto(it.precio) : ''}</td></tr>`
  }).join('')
  const destino = urlDe(lista[0])
  const nota = `Dejaste ${lista.length === 1 ? 'un producto' : 'unos productos'} a un paso de encargar. Los guardamos para vos: completá tu pedido cuando quieras (las tallas se agotan rápido).`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${filas}</table>`
    + `${Number(total) > 0 ? `<p class="t-primary" style="margin:10px 0 0;text-align:right;font-size:14px;color:#0b0f19">Total: <strong>${montoUSDcorto(total)}</strong></p>` : ''}`
  const n = primerNombre(nombre)
  await transporteSmtp().sendMail({
    from: remitente(), to: correo,
    subject: `${n ? `${n}, tu` : 'Tu'} carrito te está esperando 🛒`,
    html: plantillaCorreo({ nombre, codigo: null, estado: null, estadoLabel: 'Te quedó algo en el carrito', nota, urlSeguimiento: destino, esNuevo: false, factura: null, fotos: [], ctaTexto: 'Terminar mi pedido', ctaUrl: destino, pedirResena: false }),
  })
}

// BAJÓ DE PRECIO: productos que el cliente guardó en favoritos (Mi cuenta) y ahora cuestan menos
// (oferta o precio rebajado). Un correo con todos los que bajaron.
export async function enviarCorreoBajaPrecio({ correo, nombre, items }) {
  const base = baseTienda()
  const lista = (Array.isArray(items) ? items : []).slice(0, 6)
  const urlDe = (it) => `${base}/p/${encodeURIComponent(it.codigo)}/`
  const filas = lista.map((it) => {
    const img = absolutizarImagen(it.imagen)
    const url = urlDe(it)
    const pct = it.antes > 0 ? Math.round((1 - it.ahora / it.antes) * 100) : 0
    return `<tr><td class="rowline" style="padding:10px 0;border-bottom:1px solid #eef0f2;width:64px;vertical-align:top">${img ? `<a href="${esc(url)}"><img src="${esc(img)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid #eef0f2"></a>` : ''}</td>`
      + `<td class="rowline" style="padding:10px 0 10px 12px;border-bottom:1px solid #eef0f2;vertical-align:top"><a class="t-primary" href="${esc(url)}" style="color:#0b0f19;text-decoration:none;font-size:14px;font-weight:600">${esc(it.nombre || 'Producto')}</a>${pct > 0 ? `<div style="margin-top:5px"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#dcfce7;color:#166534;font-size:11px;font-weight:700">−${pct}%</span></div>` : ''}</td>`
      + `<td class="rowline" style="padding:10px 0;border-bottom:1px solid #eef0f2;text-align:right;white-space:nowrap;vertical-align:top"><div style="font-size:12px;color:#9aa0ab;text-decoration:line-through">${montoUSDcorto(it.antes)}</div><div class="t-primary" style="font-size:15px;font-weight:800;color:#0b0f19">${montoUSDcorto(it.ahora)}</div></td></tr>`
  }).join('')
  const destino = lista.length === 1 ? urlDe(lista[0]) : `${base}/cuenta/favoritos/`
  const nota = `${lista.length === 1 ? 'Un producto que guardaste en tus favoritos <strong>bajó de precio</strong>' : `<strong>${lista.length} productos</strong> que guardaste en tus favoritos <strong>bajaron de precio</strong>`}. Las ofertas duran poco y las tallas se agotan: aprovechalo.`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${filas}</table>`
  const n = primerNombre(nombre)
  await transporteSmtp().sendMail({
    from: remitente(), to: correo,
    subject: lista.length === 1 ? `⬇️ Bajó de precio: ${lista[0].nombre}` : `⬇️ ${n ? `${n}, b` : 'B'}ajaron de precio ${lista.length} de tus favoritos`,
    html: plantillaCorreo({ nombre, codigo: null, estado: null, estadoLabel: lista.length === 1 ? '¡Bajó de precio!' : '¡Bajaron de precio!', nota, urlSeguimiento: destino, esNuevo: false, factura: null, fotos: [], ctaTexto: lista.length === 1 ? 'Verlo ahora' : 'Ver mis favoritos', ctaUrl: destino, pedirResena: false }),
  })
}

// NOVEDADES (suscriptores que aceptaron promociones): "Lo nuevo de la semana" cuando entraron
// productos nuevos, o "Lo más pedido" como mínimo una vez al mes. Pie con enlace para darse de baja.
export async function enviarCorreoNovedades({ correo, nombre, tipo, productos, urlBaja }) {
  const base = baseTienda()
  const lista = (Array.isArray(productos) ? productos : []).slice(0, 6)
  const tarjeta = (p) => {
    const url = `${base}/p/${encodeURIComponent(p.codigo)}/`
    const img = absolutizarImagen(p.imagen)
    return `<td width="50%" style="padding:6px;vertical-align:top"><a href="${esc(url)}" style="text-decoration:none;color:#0b0f19;display:block">`
      + (img ? `<img src="${esc(img)}" width="260" alt="" style="display:block;width:100%;max-width:260px;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:10px;border:1px solid #eef0f2;background:#f6f7f9">` : '')
      + `<div class="t-primary" style="margin-top:8px;font-size:13px;font-weight:600;line-height:1.35;color:#0b0f19">${esc(p.nombre)}</div>`
      + `<div class="t-primary" style="margin-top:3px;font-size:14px;font-weight:800;color:#0b0f19">${Number(p.precio) > 0 ? montoUSDcorto(p.precio) : 'Consultar precio'}</div></a></td>`
  }
  let filas = ''
  for (let i = 0; i < lista.length; i += 2) filas += `<tr>${tarjeta(lista[i])}${lista[i + 1] ? tarjeta(lista[i + 1]) : '<td width="50%"></td>'}</tr>`
  const nuevos = tipo === 'nuevos'
  const nota = (nuevos ? 'Esta semana entraron productos nuevos a la tienda. Mirá lo que llegó:' : 'Te dejamos lo que más están pidiendo nuestros clientes. ¡Las tallas vuelan!')
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${filas}</table>`
    + `<p style="margin:14px 0 0;font-size:11px;line-height:1.5;color:#9aa0ab">Recibís este correo porque aceptaste novedades de HAUSLINE. <a href="${esc(urlBaja)}" style="color:#9aa0ab">Darme de baja</a></p>`
  const n = primerNombre(nombre)
  await transporteSmtp().sendMail({
    from: remitente(), to: correo,
    subject: nuevos ? `🆕 ${n ? `${n}, m` : 'M'}irá lo nuevo en HAUSLINE esta semana` : `🔥 ${n ? `${n}, l` : 'L'}o más pedido en HAUSLINE`,
    headers: { 'List-Unsubscribe': `<${urlBaja}>` },
    html: plantillaCorreo({ nombre, codigo: null, estado: null, estadoLabel: nuevos ? 'Lo nuevo de la semana' : 'Lo más pedido del mes', nota, urlSeguimiento: base, esNuevo: false, factura: null, fotos: [], ctaTexto: 'Ver la tienda', ctaUrl: base, pedirResena: false }),
  })
}

// (3) REPORTE DIARIO al dueño (7 a. m. Nicaragua): lo de ayer + lo que hay que atender hoy.
export async function enviarCorreoReporteDiario({ to, r }) {
  const appUrl = (process.env.APP_URL ?? 'https://hausline-tracking.vercel.app').replace(/\/$/, '')
  const num = (n) => Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const m = (n) => `US$ ${num(n)}`
  const tarjeta = (titulo, valor, sub) => `<td style="padding:6px;width:50%;vertical-align:top"><div style="border:1px solid #e6e8ec;border-radius:10px;padding:12px"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8b93a7">${titulo}</div><div style="font-size:20px;font-weight:800;color:#0b0f19;margin-top:4px">${valor}</div>${sub ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${sub}</div>` : ''}</div></td>`
  const fila = (izq, der, sub) => `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f1f3;font-size:13px;color:#0b0f19">${izq}${sub ? `<div style="font-size:11px;color:#8b93a7">${sub}</div>` : ''}</td><td style="padding:8px 0;border-bottom:1px solid #f0f1f3;font-size:13px;font-weight:700;color:#0b0f19;text-align:right;white-space:nowrap">${der}</td></tr>`
  const seccion = (titulo, filas, vacio) => `<h2 style="margin:22px 0 8px;font-size:14px;color:#0b0f19">${titulo}</h2>`
    + (filas.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas.join('')}</table>` : `<p style="margin:0;font-size:13px;color:#8b93a7">${vacio}</p>`)
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#ececed;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececed"><tr><td align="center" style="padding:28px 14px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:14px;overflow:hidden">
      <tr><td style="background:#050505;padding:22px 24px;color:#fff;font-size:18px;font-weight:700;letter-spacing:3px;text-align:center">HAUSLINE</td></tr>
      <tr><td style="padding:24px">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#65a30d;font-weight:700">Reporte diario · ${esc(r.fechaTxt)}</p>
        <h1 style="margin:0 0 12px;font-size:20px;color:#0b0f19">Buenos días ☀️ Así quedó ayer</h1>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>${tarjeta('Cobrado ayer', m(r.cobrado), `${r.pagos} ${r.pagos === 1 ? 'pago' : 'pagos'}`)}${tarjeta('Pedidos nuevos', String(r.pedidosNuevos), `${m(r.vendido)} vendido`)}</tr>
          <tr>${tarjeta('Encargos web', String(r.encargos), `${r.encargosPendientes} esperando pago`)}${tarjeta('Por cobrar', m(r.porCobrar), `${r.conSaldo} pedidos con saldo`)}</tr>
        </table>
        ${seccion('💰 Disponibles con saldo pendiente', r.disponibles.map((p) => fila(`${esc(p.codigo)} · ${esc(p.cliente)}`, m(p.saldo), `${p.dias} ${p.dias === 1 ? 'día' : 'días'} disponible${p.dias > 2 ? ' · ya cobra bodega' : ''}`)), 'Ninguno: todos los disponibles están pagados.')}
        ${seccion('⏳ Pedidos sin movimiento (7+ días)', r.trabados.map((p) => fila(`${esc(p.codigo)} · ${esc(p.cliente)}`, `${p.dias} días`, esc(p.estado))), 'Ninguno: todo se está moviendo.')}
        ${seccion('🏦 Saldo de tus cuentas', r.cuentas.map((c) => fila(esc(c.nombre), `${c.moneda === 'USD' ? 'US$' : 'C$'} ${num(c.saldo)}`)), 'Sin cuentas registradas.')}
        ${(r.incompletos ?? []).length ? seccion(`🧩 Productos incompletos en la tienda (${r.incompletos.length})`, r.incompletos.slice(0, 12).map((p) => fila(`${esc(p.codigo)} · ${esc(p.nombre)}`, esc(p.faltas))).concat(r.incompletos.length > 12 ? [fila(`y ${r.incompletos.length - 12} más…`, '')] : []), '') : ''}
        ${r.automatico ? `<p style="margin:18px 0 0;font-size:12px;color:#8b93a7">Correos automáticos de ayer: ${esc(r.automatico)}</p>` : ''}
        <a href="${appUrl}/dashboard" style="display:block;margin-top:22px;background:#050505;color:#fff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;text-align:center;padding:15px;border-radius:6px">Abrir el panel</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
  await transporteSmtp().sendMail({ from: remitente(), to, subject: `☀️ HAUSLINE ayer: ${m(r.cobrado)} cobrado · ${r.pedidosNuevos} pedidos nuevos · ${m(r.porCobrar)} por cobrar`, html })
}
