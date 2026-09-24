import { createClient } from '@supabase/supabase-js'
import { ESTADO_LABEL, enviarCorreoPedido, enviarCorreoCancelacion, enviarCorreoBienvenida } from './_correo.js'
import { facturaPdfBuffer } from './_factura-pdf.js'
import { subirFacturaDrive, subirArchivoDrive } from './_drive.js'
import { cerrarEmail, reservarEmail } from './_email-eventos.js'

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
async function obtenerFactura(codigo, esNuevo) {
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
  // Al entregar (comprobante) se da por pagado el total; al crear se usa el abono real.
  const abono = esNuevo ? (Number(pedido.abono) || 0) : total
  return {
    items,
    total,
    abono,
    saldo: Math.max(0, total - abono),
    fecha: pedido.fecha_pedido || null,
    variante: esNuevo ? 'compra' : 'pago',
  }
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

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization') ?? ''

  // Reenvío manual desde el panel (JWT del usuario, no el secreto del webhook).
  if (body.resend) return reenviarFotosEtapa(request, response, body, authorization)
  // Correo de cancelación desde el panel (también con JWT del usuario).
  if (body.cancelacion) return enviarCancelacion(request, response, body, authorization)

  // Solo Supabase (con el secreto compartido) puede disparar el aviso automático.
  if (!process.env.NOTIFY_SECRET || authorization !== `Bearer ${process.env.NOTIFY_SECRET}`) {
    return response.status(401).json({ ok: false })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }

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
  const conFactura = esNuevo || estado === 'pagado' || (estado === 'entregado' && !yaPagado)
  const factura = conFactura ? await obtenerFactura(record.codigo, esNuevo) : null

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
    await enviarCorreoPedido({ correo, nombre, codigo: record.codigo, estado, esNuevo, factura, fotos, pedirResena })
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
      const tipo = factura.variante === 'pago' ? 'Comprobante pagado' : 'Orden confirmada'
      await subirFacturaDrive({ codigo: record.codigo, fecha: factura.fecha, filename: `${record.codigo} - ${tipo}.pdf`, pdf })
      archivado = true
    } catch (driveError) {
      console.error('drive: no se pudo archivar la factura', driveError?.message)
    }
  }

  return response.status(200).json({ ok: true, sent: correo, archivado, fotos: fotos.length, fotosArchivadas })
}
