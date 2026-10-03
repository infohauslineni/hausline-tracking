import { createClient } from '@supabase/supabase-js'
import { ESTADO_LABEL, enviarCorreoPedido, enviarCorreoCancelacion, enviarCorreoBienvenida, enviarCorreoReembolsoAdmin, enviarCorreoReembolsoRechazado, enviarCorreoReembolsoRecibido, enviarCorreoReembolsoAprobado, enviarCorreoReembolsoDecisionAdmin, enviarCorreoEncargoPorVencer } from './_correo.js'
import { facturaPdfBuffer } from './_factura-pdf.js'
import { subirFacturaDrive, subirArchivoDrive, mesCarpeta } from './_drive.js'
import { cerrarEmail, reservarEmail } from './_email-eventos.js'
import { automatizaciones } from './_automatico.js'
import { hacerRespaldo } from './_respaldo.js'

// La tarea de cada 15 min hace varias cosas (avisos, recordatorios, reporte): le damos margen.
export const config = { maxDuration: 60 }

// Reenvío manual (panel): cada tipo de foto corresponde a la etapa/correo que la lleva.
const TIPO_A_ESTADO = {
  recibido_hausline: 'disponible_entrega',
  empaque: 'empaquetado',
  control_calidad: 'control_calidad',
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Extensión de archivo según el tipo MIME de la foto (para nombrarla en Drive/correo).
function extPorMime(mime) {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  return 'webp'
}

// Trae las fotos de CONTROL DE CALIDAD visibles al cliente de un pedido (por código),
// ya con su marca de agua HAUSLINE.NI grabada (se aplicó al subirlas). Descarga los
// bytes desde el Storage privado con la llave de servicio. Devuelve también la fecha
// del pedido para archivarlas en la carpeta del mes correcto. Si algo falla, [] sin fecha.
// El mismo mecanismo sirve para las fotos de "control de calidad" y para las del paquete
// empacado ("empaque"): cambia solo el tipo que se filtra y el nombre del archivo. Por eso
// recibe `tipo` (por defecto 'control_calidad', para no tocar las llamadas existentes).
export async function obtenerFotosCalidad(codigo, tipo = 'control_calidad') {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key || !codigo) return { fotos: [], fecha: null }
  const root = base.replace(/\/$/, '')
  const etiqueta = tipo === 'empaque' ? 'Empaque' : tipo === 'recibido_hausline' ? 'Producto' : 'Control de calidad'

  const url = `${root}/rest/v1/pedidos`
    + `?codigo=eq.${encodeURIComponent(codigo)}`
    + `&select=fecha_pedido,archivos_pedido(storage_path,nombre,mime_type,orden,tipo,visible_cliente,pedido_item_id)`
    + `&limit=1`

  let pedido = null
  try {
    const res = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } })
    if (res.ok) { const data = await res.json(); pedido = Array.isArray(data) ? data[0] : null }
    else console.error('obtenerFotosCalidad: fetch no ok', res.status)
  } catch (error) {
    console.error('obtenerFotosCalidad: error', error?.message)
    return { fotos: [], fecha: null }
  }
  if (!pedido) return { fotos: [], fecha: null }

  const archivos = (Array.isArray(pedido.archivos_pedido) ? pedido.archivos_pedido : [])
    // Las fotos de control de calidad YA asignadas a un producto se envían en el correo POR
    // PRODUCTO (notificar-item), no acá, para no mandarlas todas amontonadas en un solo correo.
    .filter((a) => a.tipo === tipo && a.visible_cliente && !(tipo === 'control_calidad' && a.pedido_item_id))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))

  const fotos = []
  for (let i = 0; i < archivos.length; i++) {
    const a = archivos[i]
    try {
      // storage_path ya incluye el prefijo "pedidos/…" (la clave dentro del bucket
      // "pedidos"), de ahí el "pedidos/pedidos/…" en la ruta de descarga.
      const objUrl = `${root}/storage/v1/object/pedidos/${a.storage_path.split('/').map(encodeURIComponent).join('/')}`
      const res = await fetch(objUrl, { headers: { apikey: key, authorization: `Bearer ${key}` } })
      if (!res.ok) { console.error('obtenerFotosCalidad: descarga no ok', res.status, a.storage_path); continue }
      const content = Buffer.from(await res.arrayBuffer())
      const ext = extPorMime(a.mime_type)
      fotos.push({
        cid: `${tipo === 'empaque' ? 'empaque' : tipo === 'recibido_hausline' ? 'producto' : 'calidad'}-${i + 1}@hausline`,
        filename: `${codigo} - ${etiqueta} ${i + 1}.${ext}`,
        content,
        contentType: a.mime_type || 'image/webp',
      })
    } catch (error) {
      console.error('obtenerFotosCalidad: error descarga', error?.message)
    }
  }
  return { fotos, fecha: pedido.fecha_pedido || null }
}

// Rellena la foto de cada ítem de la factura desde el catálogo (tabla productos) cuando
// el ítem no trae imagen propia, emparejando por CÓDIGO y, si no, por NOMBRE. Espejo del
// backfill del frontend (adjuntarFotosCatalogo): sin esto, un encargo confirmado o un
// producto agregado al catálogo DESPUÉS de crear el pedido saldría sin foto en el correo
// y en el PDF. Las rutas del catálogo son relativas; el correo/PDF las absolutiza aparte.
async function rellenarFotosCatalogo(items) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return
  const root = base.replace(/\/$/, '')
  const norm = (v) => String(v ?? '').trim().toUpperCase()
  const sinFoto = items.filter((it) => !it.imagen)
  if (!sinFoto.length) return
  const codigos = [...new Set(sinFoto.map((it) => it.codigo).filter(Boolean))]
  const nombres = [...new Set(sinFoto.map((it) => it.producto).filter(Boolean))]
  const headers = { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' }
  const inList = (arr) => encodeURIComponent(`(${arr.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(',')})`)
  const porCodigo = new Map()
  const porNombre = new Map()
  try {
    if (codigos.length) {
      const res = await fetch(`${root}/rest/v1/productos?select=codigo,imagen&codigo=in.${inList(codigos)}`, { headers })
      if (res.ok) for (const p of await res.json()) if (p.imagen) porCodigo.set(norm(p.codigo), p.imagen)
    }
    if (nombres.length) {
      const res = await fetch(`${root}/rest/v1/productos?select=nombre,imagen&nombre=in.${inList(nombres)}`, { headers })
      if (res.ok) for (const p of await res.json()) if (p.imagen) porNombre.set(norm(p.nombre), p.imagen)
    }
  } catch (error) {
    console.error('rellenarFotosCatalogo: error', error?.message)
    return
  }
  for (const it of sinFoto) {
    const foto = porCodigo.get(norm(it.codigo)) ?? porNombre.get(norm(it.producto))
    if (foto) it.imagen = foto
  }
}

// Trae el pedido + sus productos para armar la factura del correo. Usa la llave de
// servicio (ya configurada en Vercel para el cron) porque las tablas están con RLS.
//
// Se busca por CÓDIGO (siempre viene en el payload del webhook), no por id: el
// trigger que dispara el aviso manda un record reducido que puede no traer el id.
//
// OJO con la creación: la app inserta primero el pedido (aquí dispara el webhook)
// y JUSTO DESPUÉS los productos, así que al crear puede que los ítems todavía no
// estén. Por eso reintentamos unos segundos. El total se calcula sumando los
// subtotales de los ítems. Si aun así no hay ítems, devuelve null y va sin tabla.
// modo 'auto' (aviso de "Disponible para entrega"): usa el abono REAL; si ya no debe nada sale
// como comprobante PAGADO, si debe sale como "saldo pendiente" con el monto a pagar.
async function obtenerFactura(codigo, esNuevo, modo) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key || !codigo) return null

  const url = `${base.replace(/\/$/, '')}/rest/v1/pedidos`
    + `?codigo=eq.${encodeURIComponent(codigo)}`
    + `&select=abono,fecha_pedido,descuento,cupon_codigo,pedido_items(producto,codigo_producto,imagen,talla,color,cantidad,precio_unitario,subtotal)`
    + `&limit=1`

  const intentos = esNuevo ? 6 : 1
  let pedido = null
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' } })
      if (res.ok) {
        const data = await res.json()
        const p = Array.isArray(data) ? data[0] : null
        if (p && Array.isArray(p.pedido_items) && p.pedido_items.length) { pedido = p; break }
      } else {
        console.error('obtenerFactura: fetch no ok', res.status)
      }
    } catch (error) {
      console.error('obtenerFactura: error', error?.message)
    }
    if (i < intentos - 1) await sleep(500)
  }
  if (!pedido) { console.error('obtenerFactura: sin items para', codigo); return null }

  const items = pedido.pedido_items.map((r) => ({
    producto: r.producto,
    codigo: r.codigo_producto || '',
    imagen: r.imagen || '',
    detalle: [r.talla ? `Talla ${r.talla}` : '', r.color || ''].filter(Boolean).join(' · '),
    cantidad: Number(r.cantidad) || 1,
    precioUnitario: Number(r.precio_unitario) || 0,
    subtotal: Number(r.subtotal) || 0,
  }))
  // Completa la foto de los ítems que no la traen, buscándola en el catálogo por código/nombre.
  await rellenarFotosCatalogo(items)

  // Cupón/descuento del pedido: va como línea negativa para que la factura muestre qué
  // cupón usó y el total cuadre con el total real (neto) del pedido.
  const descuento = Math.round((Number(pedido.descuento) || 0) * 100) / 100
  if (descuento > 0) {
    items.push({
      producto: pedido.cupon_codigo ? `Cupón ${pedido.cupon_codigo}` : 'Descuento',
      codigo: '', imagen: '', detalle: '', cantidad: 1,
      precioUnitario: -descuento, subtotal: -descuento, esDescuento: true,
    })
  }

  const total = Math.max(0, items.reduce((sum, it) => sum + it.subtotal, 0))
  // Al entregar (comprobante) se da por pagado el total; al crear (y en 'auto') se usa el abono real.
  const real = esNuevo || modo === 'auto'
  const abono = real ? Math.min(total, Number(pedido.abono) || 0) : total
  const saldo = Math.max(0, Math.round((total - abono) * 100) / 100)
  return {
    items,
    total,
    abono,
    saldo,
    fecha: pedido.fecha_pedido || null,
    variante: esNuevo ? 'compra' : (modo === 'auto' && saldo > 0.01) ? 'saldo' : 'pago',
  }
}

// Respaldo MANUAL (el automático corre los lunes 5 a. m.). Solo administrador.
// Pone una compra de "Compras libres" como Entrega inmediata en la tienda: el catálogo (otro
// proyecto Supabase) agrega sus tallas a "Tallas disponibles ahora". La clave compartida vive en
// config_privada (solo la lee el servidor). Solo administrador.
async function entregaInmediataDesdeCompra(response, body, authorization) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false, error: 'Falta configuración del servidor.' })
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await admin.auth.getUser(token).catch(() => ({ data: { user: null } }))
  if (!userData?.user) return response.status(401).json({ ok: false })
  const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', userData.user.id).maybeSingle()
  if (!perfil || !perfil.activo || perfil.rol !== 'admin') return response.status(403).json({ ok: false, error: 'Solo el administrador puede hacerlo.' })

  const { data: secretoQ } = await admin.from('config_privada').select('valor').eq('clave', 'secreto_entrega_inmediata').maybeSingle()
  // QUITAR de Entrega inmediata (por código de producto): deja de salir en esa sección de la tienda.
  if (body.quitar) {
    const codigo = String(body.codigo ?? '').trim()
    if (!codigo) return response.status(400).json({ ok: false, error: 'Falta el código del producto.' })
    if (!secretoQ?.valor) return response.status(200).json({ ok: false, error: 'Falta la clave de entrega inmediata en el sistema.' })
    const rq = await fetch('https://xgdijumnmaqfirmckugw.supabase.co/rest/v1/rpc/quitar_entrega_inmediata', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: CATALOGO_KEY, authorization: `Bearer ${CATALOGO_KEY}` },
      body: JSON.stringify({ p_secreto: secretoQ.valor, p_codigo: codigo }),
    }).catch(() => null)
    const vq = rq ? await rq.json().catch(() => null) : null
    if (vq === 'ok') return response.status(200).json({ ok: true })
    return response.status(200).json({ ok: false, error: vq === 'sin fila en el catálogo' ? `El producto ${codigo} no está en el admin de la tienda.` : (rq && !rq.ok ? 'Falta aplicar el SQL del catálogo (quitar_entrega_inmediata).' : 'No se pudo conectar con la tienda.') })
  }

  const id = String(body.inversionId ?? '').trim()
  const tallas = (Array.isArray(body.tallas) ? body.tallas : []).map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 20)
  const colores = (Array.isArray(body.colores) ? body.colores : []).map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 10)
  if (!id) return response.status(400).json({ ok: false, error: 'Falta la compra.' })
  const { data: compra } = await admin.from('inversiones').select('id, codigo, estado').eq('id', id).maybeSingle()
  if (!compra) return response.status(404).json({ ok: false, error: 'No se encontró la compra.' })
  if (!String(compra.codigo ?? '').trim()) return response.status(200).json({ ok: false, error: 'Esta compra no tiene código de producto: ponele el código de la tienda (Editar) y volvé a intentar.' })
  const { data: secreto } = await admin.from('config_privada').select('valor').eq('clave', 'secreto_entrega_inmediata').maybeSingle()
  if (!secreto?.valor) return response.status(200).json({ ok: false, error: 'Falta la clave de entrega inmediata en el sistema (SQL 202610020004).' })

  const res = await fetch('https://xgdijumnmaqfirmckugw.supabase.co/rest/v1/rpc/marcar_entrega_inmediata', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: CATALOGO_KEY, authorization: `Bearer ${CATALOGO_KEY}` },
    body: JSON.stringify({ p_secreto: secreto.valor, p_codigo: compra.codigo, p_tallas: tallas, p_ref: compra.id, p_colores: colores }),
  }).catch(() => null)
  const r = res ? await res.json().catch(() => null) : null
  if (r === 'ok') return response.status(200).json({ ok: true })
  if (r === 'colores actualizados') return response.status(200).json({ ok: true, soloColores: true })
  const MOTIVO = {
    'ya estaba agregada': 'Esta compra ya está en Entrega inmediata en la tienda. Si llegaron más unidades, registralas como otra compra.',
    'sin fila en el catálogo': `El producto ${compra.codigo} no está en el admin de la tienda: abrilo en admin.html y tocá Guardar una vez, después volvé a intentar.`,
    'no autorizado': 'La clave de entrega inmediata no coincide entre el panel y la tienda.',
  }
  return response.status(200).json({ ok: false, error: MOTIVO[r] || (res && !res.ok ? 'Falta aplicar el SQL del catálogo (marcar_entrega_inmediata).' : 'No se pudo conectar con la tienda.') })
}
const CATALOGO_KEY = 'sb_publishable_NwpQth6G3qhpvtnRan3Xfg_8EqPM4Pw' // clave PÚBLICA del catálogo (la protección es la clave secreta)

async function respaldoManual(response, authorization) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false, error: 'Falta configuración del servidor.' })
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await admin.auth.getUser(token).catch(() => ({ data: { user: null } }))
  if (!userData?.user) return response.status(401).json({ ok: false })
  const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', userData.user.id).maybeSingle()
  if (!perfil || !perfil.activo || perfil.rol !== 'admin') return response.status(403).json({ ok: false, error: 'Solo el administrador puede hacer respaldos.' })
  try {
    return response.status(200).json({ ok: true, ...(await hacerRespaldo(admin)) })
  } catch (e) {
    console.error('respaldo manual: falló', e?.message)
    return response.status(200).json({ ok: false, error: e?.message || 'No se pudo hacer el respaldo.' })
  }
}

// Archivado MANUAL en Drive desde el panel (botón "Archivar en Drive" del pedido): sube
// "Orden confirmada" y, si el pedido ya está pagado/entregado, "Comprobante pagado", a
// HAUSLINE Facturas / <mes del pedido> / <código>. A diferencia del archivado automático
// (best-effort, solo log), aquí se devuelve el error REAL para mostrarlo en el panel.
async function archivarDriveManual(response, body, authorization) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Falta configuración del servidor.' })
  }
  if (!process.env.DRIVE_WEBHOOK_URL || !process.env.DRIVE_WEBHOOK_SECRET) {
    return response.status(200).json({ ok: false, error: 'Drive no está configurado en Vercel (DRIVE_WEBHOOK_URL / DRIVE_WEBHOOK_SECRET).' })
  }
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await admin.auth.getUser(token).catch(() => ({ data: { user: null } }))
  if (!userData?.user) return response.status(401).json({ ok: false })
  const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', userData.user.id).maybeSingle()
  if (!perfil || !perfil.activo || (perfil.rol !== 'admin' && perfil.rol !== 'operador')) {
    return response.status(403).json({ ok: false, error: 'No autorizado.' })
  }

  const codigo = String(body.codigo ?? '').trim()
  if (!codigo) return response.status(400).json({ ok: false, error: 'Falta el código.' })
  const { data: pedido } = await admin.from('pedidos').select('codigo, estado, saldo, fecha_pedido, clientes(nombre)').eq('codigo', codigo).maybeSingle()
  if (!pedido) return response.status(404).json({ ok: false, error: 'No se encontró el pedido.' })
  const cli = Array.isArray(pedido.clientes) ? pedido.clientes[0] : pedido.clientes
  const nombre = cli?.nombre ?? null
  const pagado = ['pagado', 'entregado'].includes(pedido.estado) || Number(pedido.saldo) <= 0

  const archivos = []
  for (const esNuevo of pagado ? [true, false] : [true]) {
    const factura = await obtenerFactura(codigo, esNuevo)
    if (!factura) return response.status(200).json({ ok: false, error: 'No se pudo armar la factura (el pedido no tiene productos).', archivos })
    const tipo = factura.variante === 'pago' ? 'Comprobante pagado' : 'Orden confirmada'
    try {
      const pdf = await facturaPdfBuffer({ codigo, nombre, fecha: factura.fecha, factura })
      await subirFacturaDrive({ codigo, fecha: factura.fecha, filename: `${codigo} - ${tipo}.pdf`, pdf })
      archivos.push(`${codigo} - ${tipo}.pdf`)
    } catch (driveError) {
      console.error('archivar-drive manual: falló', driveError?.message)
      return response.status(200).json({ ok: false, error: driveError?.message || 'No se pudo subir a Drive.', archivos })
    }
  }
  return response.status(200).json({ ok: true, archivos, carpeta: `HAUSLINE Facturas / ${mesCarpeta(pedido.fecha_pedido)} / ${codigo}` })
}

// Aviso por correo del pedido. Lo dispara SIEMPRE el webhook de Supabase (con el
// secreto compartido). Al CREAR el pedido (INSERT) —sea manual o al confirmar un
// encargo web— el pedido nace en 'pedido_confirmado', así que el cliente recibe el
// correo de "Orden confirmada" CON la factura (producto, precio, abono, saldo + PDF),
// ya NO uno titulado "pedido registrado". Al cambiar de estado (UPDATE) se envía el
// aviso de esa etapa, y el comprobante PAGADO al entregar.
// La app NO envía correos por su cuenta, así que no hay envíos duplicados.
// Reenvío MANUAL desde el panel: manda el correo de una etapa (recibido / empaque) con sus
// fotos actuales, aunque el pedido ya haya pasado esa etapa (el aviso por transición ya no
// dispara). Lo llama el panel con el JWT del usuario; se valida que sea admin/operador activo.
// Va dentro de este endpoint (no en uno propio) para no pasarnos del límite de funciones.
async function reenviarFotosEtapa(request, response, body, authorization) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }
  // Bienvenida a Mi cuenta (trigger notificar_cuenta_verificada → /api/notificar-cuenta, que
  // vercel.json reescribe aquí: el plan Hobby permite máximo 12 funciones).
  if (body.table === 'cuentas_cliente') return enviarBienvenida(body, response)
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await admin.auth.getUser(token).catch(() => ({ data: { user: null } }))
  const solicitante = userData?.user
  if (!solicitante) return response.status(401).json({ ok: false })
  const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', solicitante.id).maybeSingle()
  if (!perfil || !perfil.activo || (perfil.rol !== 'admin' && perfil.rol !== 'operador')) {
    return response.status(403).json({ ok: false, error: 'No autorizado.' })
  }

  const codigo = String(body.codigo ?? '').trim()
  const tipo = String(body.tipo ?? '').trim()
  const estado = TIPO_A_ESTADO[tipo]
  if (!codigo || !estado) return response.status(400).json({ ok: false, error: 'Datos inválidos.' })

  const { data: pedido, error: pedidoError } = await admin
    .from('pedidos').select('codigo, clientes(correo, nombre)').eq('codigo', codigo).maybeSingle()
  if (pedidoError) return response.status(502).json({ ok: false, error: 'No se pudo leer el pedido.' })
  const cli = Array.isArray(pedido?.clientes) ? pedido.clientes[0] : pedido?.clientes
  const correo = (cli?.correo ?? '').trim()
  const nombre = cli?.nombre ?? null
  if (!correo) return response.status(200).json({ ok: false, error: 'El cliente no tiene correo.' })

  const { fotos, fecha: fechaFotos } = await obtenerFotosCalidad(codigo, tipo)
  if (!fotos.length) return response.status(200).json({ ok: false, error: 'No hay fotos para enviar en esta etapa.' })

  try {
    await enviarCorreoPedido({ correo, nombre, codigo, estado, esNuevo: false, factura: null, fotos, pedirResena: false })
  } catch (sendError) {
    console.error('reenviar-fotos: no se pudo enviar', sendError?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo.' })
  }

  // Archiva las MISMAS fotos en la carpeta del pedido en Drive (igual que el flujo normal).
  // Best-effort: si falla, no rompe el envío del correo.
  let fotosArchivadas = 0
  for (const f of fotos) {
    try {
      await subirArchivoDrive({ codigo, fecha: fechaFotos, filename: f.filename, data: f.content, mime: f.contentType })
      fotosArchivadas++
    } catch (driveError) {
      console.error('reenviar-fotos: no se pudo archivar en Drive', driveError?.message)
    }
  }

  // Deja guardado que las fotos de control de calidad del pedido ya se enviaron, para que el
  // botón del panel quede en "ya enviadas" aunque se recargue. Best-effort: si la columna aún
  // no existe (migración sin aplicar), no rompe el envío.
  if (tipo === 'control_calidad') {
    try { await admin.from('pedidos').update({ qc_general_enviado_at: new Date().toISOString() }).eq('codigo', codigo) }
    catch (markError) { console.error('reenviar-fotos: no se pudo marcar qc_general_enviado_at', markError?.message) }
  }
  return response.status(200).json({ ok: true, sent: correo, fotos: fotos.length, fotosArchivadas })
}

// Correo de CANCELACIÓN al cliente. Lo dispara el panel (JWT del usuario) al confirmar la
// cancelación, con el motivo y —si hubo devolución— el monto. Va acá (no por el webhook)
// para llevar el motivo real. Valida que quien llama sea admin/operador activo, igual que el
// reenvío de fotos. Lee el correo del cliente con la llave de servicio (RLS).
async function enviarCancelacion(request, response, body, authorization) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await admin.auth.getUser(token).catch(() => ({ data: { user: null } }))
  const solicitante = userData?.user
  if (!solicitante) return response.status(401).json({ ok: false })
  const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', solicitante.id).maybeSingle()
  if (!perfil || !perfil.activo || (perfil.rol !== 'admin' && perfil.rol !== 'operador')) {
    return response.status(403).json({ ok: false, error: 'No autorizado.' })
  }

  const codigo = String(body.codigo ?? '').trim()
  const motivo = String(body.motivo ?? '').trim()
  const monto = Math.max(0, Number(body.monto || 0))
  if (!codigo) return response.status(400).json({ ok: false, error: 'Datos inválidos.' })

  const { data: pedido, error: pedidoError } = await admin
    .from('pedidos').select('codigo, clientes(correo, nombre)').eq('codigo', codigo).maybeSingle()
  if (pedidoError) return response.status(502).json({ ok: false, error: 'No se pudo leer el pedido.' })
  const cli = Array.isArray(pedido?.clientes) ? pedido.clientes[0] : pedido?.clientes
  const correo = (cli?.correo ?? '').trim()
  const nombre = cli?.nombre ?? null
  if (!correo) return response.status(200).json({ ok: false, error: 'El cliente no tiene correo.' })

  try {
    await enviarCorreoCancelacion({ correo, nombre, codigo, motivo, monto })
  } catch (sendError) {
    console.error('cancelacion: no se pudo enviar', sendError?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo.' })
  }
  return response.status(200).json({ ok: true, sent: correo })
}

// Solicitudes de cancelación / reembolso (Mi cuenta de la tienda → panel).
//   • 'nuevo'     → lo llama el CLIENTE (su JWT) justo después de crearla: correo al ADMIN
//                   ("revisar") y al CLIENTE ("en revisión"). Solo para una solicitud SUYA y una
//                   sola vez (candado aviso_admin_at).
//   • 'decision'  → lo llama el CLIENTE cuando, tras el rechazo, elige cancelar SIN reembolso:
//                   correo al admin para que cancele el pedido (una vez, candado aviso_decision_at).
//   • 'aprobada'  → lo llama el ADMIN desde el panel: correo al cliente con el reembolso.
//   • 'rechazada' → lo llama el ADMIN desde el panel: correo al cliente para que elija
//                   seguir con el pedido o cancelarlo sin reembolso.
async function avisoReembolso(response, body, authorization) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await admin.auth.getUser(token).catch(() => ({ data: { user: null } }))
  const usuario = userData?.user
  if (!usuario) return response.status(401).json({ ok: false })
  const id = String(body.id ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return response.status(400).json({ ok: false, error: 'Datos inválidos.' })

  if (body.reembolso === 'nuevo') {
    // Candado atómico: solo la primera llamada "reclama" la fila y manda el correo.
    const { data: filas, error } = await admin.from('solicitudes_reembolso')
      .update({ aviso_admin_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', usuario.id).is('aviso_admin_at', null).select('*, pedidos(estado)')
    if (error) return response.status(502).json({ ok: false })
    const s = filas?.[0]
    if (!s) return response.status(200).json({ ok: true, skipped: 'ya avisado' })
    const destino = (process.env.AVISO_ADMIN || process.env.SMTP_USER || '').trim()
    try { await enviarCorreoReembolsoAdmin({ to: destino, s }) } catch (e) {
      console.error('reembolso: aviso admin falló', e?.message)
      await admin.from('solicitudes_reembolso').update({ aviso_admin_at: null }).eq('id', id)
      return response.status(502).json({ ok: false })
    }
    // Confirmación al cliente (best-effort: el admin ya quedó avisado).
    const correoCli = String(s.correo_cliente ?? '').trim()
    if (correoCli) {
      const ped = Array.isArray(s.pedidos) ? s.pedidos[0] : s.pedidos
      try { await enviarCorreoReembolsoRecibido({ correo: correoCli, nombre: s.nombre_cliente, codigo: s.codigo, estado: ped?.estado ?? 'en_preparacion', s }) }
      catch (e) { console.error('reembolso: correo al cliente falló', e?.message) }
    }
    return response.status(200).json({ ok: true })
  }

  if (body.reembolso === 'decision') {
    const { data: filas, error } = await admin.from('solicitudes_reembolso')
      .update({ aviso_decision_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', usuario.id).eq('estado', 'cancelada_sin_reembolso').is('aviso_decision_at', null).select('*')
    if (error) return response.status(502).json({ ok: false })
    const s = filas?.[0]
    if (!s) return response.status(200).json({ ok: true, skipped: 'no aplica o ya avisado' })
    const destino = (process.env.AVISO_ADMIN || process.env.SMTP_USER || '').trim()
    try { await enviarCorreoReembolsoDecisionAdmin({ to: destino, s }) } catch (e) {
      console.error('reembolso: aviso de decisión falló', e?.message)
      await admin.from('solicitudes_reembolso').update({ aviso_decision_at: null }).eq('id', id)
      return response.status(502).json({ ok: false })
    }
    return response.status(200).json({ ok: true })
  }

  if (body.reembolso === 'aprobada' || body.reembolso === 'rechazada') {
    const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', usuario.id).maybeSingle()
    if (!perfil || !perfil.activo || perfil.rol !== 'admin') return response.status(403).json({ ok: false, error: 'No autorizado.' })
  }

  if (body.reembolso === 'aprobada') {
    const { data: s } = await admin.from('solicitudes_reembolso').select('*').eq('id', id).maybeSingle()
    if (!s || s.estado !== 'aprobada') return response.status(200).json({ ok: false, error: 'La solicitud no está aprobada.' })
    const correo = String(s.correo_cliente ?? '').trim()
    if (!correo) return response.status(200).json({ ok: false, error: 'El cliente no tiene correo.' })
    try {
      await enviarCorreoReembolsoAprobado({ correo, nombre: s.nombre_cliente, codigo: s.codigo, monto: s.monto_reembolso, banco: s.banco, numeroCuenta: s.numero_cuenta, titular: s.titular, respuesta: s.respuesta })
    } catch (e) {
      console.error('reembolso: correo aprobación falló', e?.message)
      return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo.' })
    }
    return response.status(200).json({ ok: true, sent: correo })
  }

  if (body.reembolso === 'rechazada') {
    const { data: s } = await admin.from('solicitudes_reembolso').select('*, pedidos(estado)').eq('id', id).maybeSingle()
    if (!s || s.estado !== 'rechazada') return response.status(200).json({ ok: false, error: 'La solicitud no está rechazada.' })
    const correo = String(s.correo_cliente ?? '').trim()
    if (!correo) return response.status(200).json({ ok: false, error: 'El cliente no tiene correo.' })
    const pedido = Array.isArray(s.pedidos) ? s.pedidos[0] : s.pedidos
    try {
      await enviarCorreoReembolsoRechazado({ correo, nombre: s.nombre_cliente, codigo: s.codigo, estado: pedido?.estado ?? 'en_preparacion', respuesta: s.respuesta, montoPagado: s.monto_pagado })
    } catch (e) {
      console.error('reembolso: correo rechazo falló', e?.message)
      return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo.' })
    }
    return response.status(200).json({ ok: true, sent: correo })
  }
  return response.status(400).json({ ok: false })
}

// Correo de bienvenida cuando el cliente verifica su correo. Uno solo por cuenta (candado).
async function enviarBienvenida(body, response) {
  const record = body.record ?? {}
  if (body.table !== 'cuentas_cliente' || !record.verificada_at) return response.status(200).json({ ok: true, skipped: 'no aplica' })
  const correo = String(record.correo ?? '').trim()
  if (!correo) return response.status(200).json({ ok: true, skipped: 'sin correo' })

  const reserva = await reservarEmail({ clave: `bienvenida:${record.user_id}`, tipo: 'bienvenida', destinatario: correo, userId: record.user_id ?? null })
  if (reserva.duplicado) return response.status(200).json({ ok: true, skipped: 'ya enviado' })
  try {
    await enviarCorreoBienvenida({ correo, nombre: record.nombre })
  } catch (error) {
    await cerrarEmail(reserva.id, error?.message || 'error de envío')
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }
  await cerrarEmail(reserva.id)
  return response.status(200).json({ ok: true, sent: correo })
}

// Fotos del seguimiento público (/api/fotos-pedido → aquí; límite de 12 funciones en Hobby).
// El navegador ya NO firma las fotos del bucket privado "pedidos" como anónimo (eso permitía
// listar las fotos de TODOS los pedidos). Aquí se firman solo las del pedido cuyo código se
// conoce, y solo las marcadas visibles para el cliente.
async function fotosPedidoPublico(response, body) {
  const codigo = String(body.codigo ?? '').trim().toUpperCase()
  if (!/^HS\d{6}$/.test(codigo)) return response.status(400).json({ ok: false, error: 'Código inválido' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false })
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: archivos, error } = await client.rpc('obtener_archivos_pedido_publicos', { p_codigo: codigo })
  if (error) return response.status(502).json({ ok: false })
  const lista = Array.isArray(archivos) ? archivos : []
  if (!lista.length) return response.status(200).json({ ok: true, imagenes: [] })
  const { data: firmadas } = await client.storage.from('pedidos').createSignedUrls(lista.map((a) => a.storage_path), 3600)
  response.setHeader('Cache-Control', 'no-store')
  return response.status(200).json({ ok: true, imagenes: lista.map((a, i) => ({ ...a, url: firmadas?.[i]?.signedUrl ?? undefined })) })
}

// Encargos web que vencen en las próximas 3 horas y todavía no tienen pago reportado: se le
// manda al cliente UN correo de aviso (aviso_vence_at evita repetirlo). Un carrito (grupo)
// recibe un solo correo. Se marca ANTES de enviar para que dos corridas seguidas no dupliquen;
// si el envío falla, se desmarca y lo reintenta la próxima corrida.
async function recordatoriosEncargos(response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false })
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const ahora = Date.now()
  const { data, error } = await client.from('solicitudes')
    .select('id, codigo, grupo_codigo, cliente_nombre, cliente_correo, producto, vence_at')
    .eq('estado', 'pendiente').is('pago_reportado_at', null).is('aviso_vence_at', null)
    .not('cliente_correo', 'is', null)
    .gt('vence_at', new Date(ahora).toISOString()).lte('vence_at', new Date(ahora + 3 * 3_600_000).toISOString())
    .limit(300)
  if (error) return response.status(502).json({ ok: false, error: error.message })

  const grupos = new Map()
  for (const s of data ?? []) {
    const clave = s.grupo_codigo || s.codigo
    grupos.set(clave, [...(grupos.get(clave) ?? []), s])
  }
  let enviados = 0
  for (const [codigo, filas] of grupos) {
    const correo = String(filas.find((f) => String(f.cliente_correo ?? '').trim())?.cliente_correo ?? '').trim()
    if (!correo) continue
    const ids = filas.map((f) => f.id)
    const { error: marcaError } = await client.from('solicitudes').update({ aviso_vence_at: new Date().toISOString() }).in('id', ids).is('aviso_vence_at', null)
    if (marcaError) { console.error('recordatorio vencimiento: no se pudo marcar', codigo, marcaError.message); continue }
    try {
      const vence = filas.map((f) => f.vence_at).sort()[0]
      await enviarCorreoEncargoPorVencer({ correo, nombre: filas[0].cliente_nombre ?? null, codigo, productos: filas.map((f) => f.producto).filter(Boolean), vence })
      enviados++
    } catch (e) {
      console.error('recordatorio vencimiento: correo falló', codigo, e?.message)
      await client.from('solicitudes').update({ aviso_vence_at: null }).in('id', ids)
    }
  }
  return response.status(200).json({ ok: true, enviados })
}

const ORIGEN_TIENDA = 'https://hauslineshopni.es'

export default async function handler(request, response) {
  // CORS solo para la tienda (Mi cuenta avisa aquí de una solicitud de cancelación).
  if ((request.headers?.origin ?? '') === ORIGEN_TIENDA) {
    response.setHeader('Access-Control-Allow-Origin', ORIGEN_TIENDA)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  }
  if (request.method === 'OPTIONS') return response.status(204).end()
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization') ?? ''

  // Fotos del seguimiento público (sin sesión: basta el código del pedido).
  if (body.fotosPublicas) return fotosPedidoPublico(response, body)

  // Reenvío manual desde el panel (JWT del usuario, no el secreto del webhook).
  if (body.resend) return reenviarFotosEtapa(request, response, body, authorization)
  // "Archivar en Drive" desde el pedido (JWT del usuario): vuelve a subir las facturas.
  if (body.archivarDrive) return archivarDriveManual(response, body, authorization)
  // "Hacer respaldo ahora" desde Configuración (JWT del admin): Excel completo a Drive.
  if (body.respaldoAhora) return respaldoManual(response, authorization)
  // "Poner en Entrega inmediata" desde Compras libres (JWT del admin).
  if (body.entregaInmediataCompra) return entregaInmediataDesdeCompra(response, body, authorization)
  // Correo de cancelación desde el panel (también con JWT del usuario).
  if (body.cancelacion) return enviarCancelacion(request, response, body, authorization)
  // Solicitud de cancelación / reembolso (cliente → aviso al admin; admin → rechazo al cliente).
  if (body.reembolso) return avisoReembolso(response, body, authorization)

  // Solo Supabase (con el secreto compartido) puede disparar el aviso automático.
  if (!process.env.NOTIFY_SECRET || authorization !== `Bearer ${process.env.NOTIFY_SECRET}`) {
    return response.status(401).json({ ok: false })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }
  // Tarea programada de Supabase (pg_cron cada 15 min, migración 202609260004).
  if (body.tarea === 'recordatorios_encargos') {
    // Misma vuelta de 15 min: también salen los avisos de "Disponible para entrega" con 1 h de espera.
    await disponiblesProgramados().catch((e) => console.error('disponibles programados:', e?.message))
    // Saldo, reporte diario, carrito abandonado, volver a comprar y reseña (api/_automatico.js).
    const auto = await automatizaciones().catch((e) => { console.error('automatizaciones:', e?.message); return null })
    if (auto && Object.values(auto).some((v) => v && v !== 0 && !(typeof v === 'object' && !Object.values(v).some(Boolean)))) console.log('automatizaciones:', JSON.stringify(auto))
    return recordatoriosEncargos(response)
  }

  return procesarAvisoPedido(body, response)
}

// "Disponible para entrega" NO se avisa al instante: la tarea de cada 15 min lo manda cuando ya
// pasó 1 HORA (así hay tiempo de corregir si se marcó por error, o de registrar el pago antes).
// El correo lleva la factura con el saldo real: PAGADA si ya no debe, o con el SALDO PENDIENTE.
// Si en esa hora el pedido pasó a "Pagado", no se manda (ya le llegó el comprobante de pago).
const recolector = () => ({ status: () => ({ json: (o) => o }) })
async function disponiblesProgramados() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return 0
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const ahora = Date.now()
  const { data, error } = await client.from('historial_pedidos')
    .select('estado_anterior, created_at, pedidos!inner(codigo, estado, clientes(correo, nombre))')
    .eq('estado_nuevo', 'disponible_entrega')
    .lte('created_at', new Date(ahora - 3_600_000).toISOString())
    .gte('created_at', new Date(ahora - 48 * 3_600_000).toISOString())
    .order('created_at', { ascending: false }).limit(100)
  if (error) { console.error('disponibles programados:', error.message); return 0 }
  const vistos = new Set()
  let enviados = 0
  for (const h of data ?? []) {
    const p = Array.isArray(h.pedidos) ? h.pedidos[0] : h.pedidos
    if (!p || p.estado !== 'disponible_entrega' || vistos.has(p.codigo)) continue
    vistos.add(p.codigo)
    const cli = Array.isArray(p.clientes) ? p.clientes[0] : p.clientes
    if (!String(cli?.correo ?? '').trim()) continue
    // El candado anti-duplicados (email_eventos) evita mandarlo otra vez en la próxima vuelta.
    const r = await procesarAvisoPedido({
      type: 'UPDATE', table: 'pedidos', programado: true,
      record: { codigo: p.codigo, estado: 'disponible_entrega' }, old_record: { estado: h.estado_anterior },
      cliente_correo: cli.correo, cliente_nombre: cli.nombre ?? null,
    }, recolector()).catch((e) => { console.error('disponible programado falló', p.codigo, e?.message); return null })
    if (r?.sent) { enviados++; console.log(`disponible programado: enviado ${p.codigo} (${r.factura ?? 'sin factura'})`) }
  }
  return enviados
}

// Bloque de ENTREGA del correo "Disponible para entrega": la dirección que tenemos del cliente, su
// envío predeterminado, el total a pagar con envío y el enlace para confirmar/corregir la dirección
// (hauslineshopni.es/entrega/). Datos vía RPC pública entrega_pedido_publico (migración 202610020006).
async function datosEntregaCorreo(codigo, factura) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: token } = await admin.rpc('token_entrega_pedido', { p_codigo: codigo })
  if (!token) return null
  const { data: d } = await admin.rpc('entrega_pedido_publico', { p_codigo: codigo, p_token: token })
  if (!d?.ok) return null
  const base = (process.env.CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')
  const url = `${base}/entrega/?c=${encodeURIComponent(codigo)}&t=${token}`
  const tc = Number(d.tipo_cambio) > 0 ? Number(d.tipo_cambio) : 37
  const cs = (usd) => `C$ ${(Math.ceil((Number(usd) * tc) / 10) * 10).toLocaleString('es-NI')}`
  const us = (usd) => `US$${Number(usd).toFixed(2)}`
  const envio = d.costo_envio != null ? Number(d.costo_envio) : null
  const saldo = factura?.variante === 'saldo' ? Number(factura.saldo) || 0 : Number(d.saldo) || 0
  const lugar = [d.direccion, d.departamento].filter(Boolean).join(', ')
  const filas = [
    lugar ? `📍 <strong>Entrega en:</strong> ${esc(lugar)}${d.referencia ? ` (${esc(d.referencia)})` : ''}` : '📍 <strong>Todavía no tenemos tu dirección de entrega.</strong>',
    envio != null ? `🚚 <strong>Envío:</strong> ${us(envio)} (${cs(envio)})` : '🚚 <strong>Envío:</strong> a cotizar',
    envio != null ? `💵 <strong>Total a pagar con envío:</strong> ${us(saldo + envio)} (${cs(saldo + envio)})` : null,
  ].filter(Boolean)
  return {
    html: `<br><br>${filas.join('<br>')}<br><br>${lugar ? '¿Te lo enviamos a esta dirección? Confirmala (o corregila) con el botón de abajo y coordinamos la entrega.' : 'Dejanos tu dirección con el botón de abajo y te confirmamos el envío.'}`,
    ctaTexto: lugar ? 'Confirmar dirección de entrega' : 'Dejar mi dirección de entrega',
    ctaUrl: url,
  }
}
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

async function procesarAvisoPedido(body, response) {
  const record = body.record ?? {}
  const oldRecord = body.old_record ?? {}

  // Notificamos al crear el pedido (INSERT) y cuando cambia su estado (UPDATE).
  const tipo = body.type
  if (body.table !== 'pedidos' || (tipo !== 'UPDATE' && tipo !== 'INSERT')) return response.status(200).json({ ok: true, skipped: 'no aplica' })
  const esNuevo = tipo === 'INSERT'
  const estado = record.estado
  // En INSERT no hay estado anterior: se avisa que el pedido quedó registrado.
  // En UPDATE solo se avisa si el estado realmente cambió.
  if (!estado) return response.status(200).json({ ok: true, skipped: 'sin estado' })
  if (!esNuevo && estado === oldRecord.estado) return response.status(200).json({ ok: true, skipped: 'sin cambio de estado' })
  if (!ESTADO_LABEL[estado]) return response.status(200).json({ ok: true, skipped: 'estado no notificable' })
  // Estados que se manejan a mano: NO se envía correo automático al cliente.
  const SIN_CORREO = new Set(['cancelado', 'incidencia'])
  if (SIN_CORREO.has(estado)) return response.status(200).json({ ok: true, skipped: 'estado sin correo' })
  // Evita correos repetidos cuando el cliente ve la MISMA etiqueta pública: las etapas de
  // bodega (recibido_estados_unidos / transito_nicaragua) se muestran como "En tránsito
  // internacional", igual que transito_internacional → así manda UN solo correo de tránsito.
  if (!esNuevo && ESTADO_LABEL[estado] === ESTADO_LABEL[oldRecord.estado]) return response.status(200).json({ ok: true, skipped: 'misma etiqueta pública' })
  if (!esNuevo && estado === 'disponible_entrega' && !body.programado) return response.status(200).json({ ok: true, skipped: 'programado: sale 1 hora después' })

  // El correo y el nombre del cliente vienen dentro del aviso (los agrega el trigger de Supabase),
  // así no hace falta la llave de servicio de Supabase en el servidor.
  const correo = (body.cliente_correo ?? '').trim()
  const nombre = body.cliente_nombre ?? null
  if (!correo) return response.status(200).json({ ok: true, skipped: 'cliente sin correo' })

  // Candado anti-duplicados + registro (email_eventos): un correo por pedido y estado. Si el
  // admin vuelve a poner el mismo estado (o el webhook se reintenta), no se manda otra vez.
  const reserva = await reservarEmail({ clave: `estado:${record.codigo}:${esNuevo ? 'nuevo' : estado}`, tipo: 'estado', estado, codigo: record.codigo, destinatario: correo })
  if (reserva.duplicado) return response.status(200).json({ ok: true, skipped: 'correo ya enviado para este estado' })

  // Factura dentro del correo: al confirmar el pedido (INSERT → tabla de compra con
  // producto, precio, abono y saldo) y al cobrar (comprobante PAGADO). El pago ahora se
  // marca en el estado "Pagado", así que el comprobante sale ahí. Si el pedido va directo
  // a "Entregado" sin pasar por "Pagado" (pagó al recibir), el comprobante sale en
  // "Entregado"; si ya venía de "Pagado", no se repite el comprobante.
  const yaPagado = oldRecord.estado === 'pagado'
  const conFactura = esNuevo || estado === 'pagado' || estado === 'disponible_entrega' || (estado === 'entregado' && !yaPagado)
  const factura = !conFactura ? null
    : estado === 'disponible_entrega' ? await obtenerFactura(record.codigo, false, 'auto')
      : await obtenerFactura(record.codigo, esNuevo)

  // Fotos dentro del correo, según la etapa (todas ya con su marca grabada al subirlas):
  //   • Control de calidad          → fotos de revisión (tipo control_calidad)
  //   • Disponible para entrega     → fotos reales del producto recibido en HAUSLINE (recibido_hausline)
  //   • Empaquetado, listo p/ envío → foto del paquete empacado (empaque)
  // En cualquier otra etapa no se adjuntan fotos.
  const { fotos, fecha: fechaFotos } = estado === 'control_calidad'
    ? await obtenerFotosCalidad(record.codigo, 'control_calidad')
    : estado === 'disponible_entrega'
      ? await obtenerFotosCalidad(record.codigo, 'recibido_hausline')
      : estado === 'empaquetado'
        ? await obtenerFotosCalidad(record.codigo, 'empaque')
        : { fotos: [], fecha: null }

  // La reseña se pide SOLO al "Entregado" (cuando el cliente ya tiene el producto en mano).
  // El correo de "Pagado" va sin reseña, solo con el agradecimiento.
  const pedirResena = estado === 'entregado'

  try {
    // Disponible: dirección guardada + envío predeterminado + total con envío y botón para confirmar.
    const entrega = estado === 'disponible_entrega' ? await datosEntregaCorreo(record.codigo, factura).catch((e) => { console.error('entrega correo:', e?.message); return null }) : null
    await enviarCorreoPedido({ correo, nombre, codigo: record.codigo, estado, esNuevo, factura, fotos, pedirResena, entrega })
  } catch (sendError) {
    await cerrarEmail(reserva.id, sendError?.message || 'error de envío')
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }
  await cerrarEmail(reserva.id)

  // Archiva las MISMAS fotos de control de calidad en la carpeta del pedido en Drive,
  // junto a las facturas. Best-effort: si falla, no rompe el aviso.
  let fotosArchivadas = 0
  for (const f of fotos) {
    try {
      await subirArchivoDrive({ codigo: record.codigo, fecha: fechaFotos, filename: f.filename, data: f.content, mime: f.contentType })
      fotosArchivadas++
    } catch (driveError) {
      console.error('drive: no se pudo archivar la foto de calidad', driveError?.message)
    }
  }

  // Si este correo llevó las fotos de control de calidad del pedido, deja guardado que ya se
  // enviaron (para que el botón del panel quede en "ya enviadas"). Best-effort vía REST con la
  // llave de servicio; si la columna aún no existe (migración sin aplicar), no rompe el aviso.
  if (estado === 'control_calidad' && fotos.length && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const root = process.env.SUPABASE_URL.replace(/\/$/, '')
      await fetch(`${root}/rest/v1/pedidos?codigo=eq.${encodeURIComponent(record.codigo)}`, {
        method: 'PATCH',
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ qc_general_enviado_at: new Date().toISOString() }),
      })
    } catch (markError) {
      console.error('notificar-estado: no se pudo marcar qc_general_enviado_at', markError?.message)
    }
  }

  // Archiva la MISMA factura del correo en tu Google Drive, en la carpeta del mes y del
  // código de pedido. Al confirmar → "Orden confirmada"; al pagar/entregar → "Comprobante
  // pagado", en la MISMA carpeta del pedido. Best-effort: si falla (o no está configurado
  // Drive), no rompe el aviso, solo se registra en el log.
  let archivado = false
  if (factura) {
    try {
      const pdf = await facturaPdfBuffer({ codigo: record.codigo, nombre, fecha: factura.fecha, factura })
      const tipo = factura.variante === 'pago' ? 'Comprobante pagado' : factura.variante === 'saldo' ? 'Saldo pendiente' : 'Orden confirmada'
      await subirFacturaDrive({ codigo: record.codigo, fecha: factura.fecha, filename: `${record.codigo} - ${tipo}.pdf`, pdf })
      archivado = true
    } catch (driveError) {
      console.error('drive: no se pudo archivar la factura', driveError?.message)
    }
  }

  return response.status(200).json({ ok: true, sent: correo, archivado, fotos: fotos.length, fotosArchivadas, factura: factura?.variante ?? null })
}
