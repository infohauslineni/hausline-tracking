import { ESTADO_LABEL, enviarCorreoPedido } from './_correo.js'
import { facturaPdfBuffer } from './_factura-pdf.js'
import { subirFacturaDrive, subirArchivoDrive } from './_drive.js'

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
async function obtenerFotosCalidad(codigo) {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key || !codigo) return { fotos: [], fecha: null }
  const root = base.replace(/\/$/, '')

  const url = `${root}/rest/v1/pedidos`
    + `?codigo=eq.${encodeURIComponent(codigo)}`
    + `&select=fecha_pedido,archivos_pedido(storage_path,nombre,mime_type,orden,tipo,visible_cliente)`
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
    .filter((a) => a.tipo === 'control_calidad' && a.visible_cliente)
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
        cid: `calidad-${i + 1}@hausline`,
        filename: `${codigo} - Control de calidad ${i + 1}.${ext}`,
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
    + `&select=abono,fecha_pedido,pedido_items(producto,codigo_producto,imagen,talla,color,cantidad,precio_unitario,subtotal)`
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

  const total = items.reduce((sum, it) => sum + it.subtotal, 0)
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
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })

  // Solo Supabase (con el secreto compartido) puede disparar este envío.
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization')
  if (!process.env.NOTIFY_SECRET || authorization !== `Bearer ${process.env.NOTIFY_SECRET}`) {
    return response.status(401).json({ ok: false })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
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

  // Factura dentro del correo: al confirmar el pedido (INSERT → tabla de compra con
  // producto, precio, abono y saldo) y al cobrar (comprobante PAGADO). El pago ahora se
  // marca en el estado "Pagado", así que el comprobante sale ahí. Si el pedido va directo
  // a "Entregado" sin pasar por "Pagado" (pagó al recibir), el comprobante sale en
  // "Entregado"; si ya venía de "Pagado", no se repite el comprobante.
  const yaPagado = oldRecord.estado === 'pagado'
  const conFactura = esNuevo || estado === 'pagado' || (estado === 'entregado' && !yaPagado)
  const factura = conFactura ? await obtenerFactura(record.codigo, esNuevo) : null

  // Fotos de control de calidad: al avisarle al cliente que su pedido está en control
  // de calidad, el correo lleva las fotos de revisión (ya con la marca de agua grabada).
  const { fotos, fecha: fechaFotos } = estado === 'control_calidad'
    ? await obtenerFotosCalidad(record.codigo)
    : { fotos: [], fecha: null }

  // La reseña se pide SOLO al "Entregado" (cuando el cliente ya tiene el producto en mano).
  // El correo de "Pagado" va sin reseña, solo con el agradecimiento.
  const pedirResena = estado === 'entregado'

  try {
    await enviarCorreoPedido({ correo, nombre, codigo: record.codigo, estado, esNuevo, factura, fotos, pedirResena })
  } catch (sendError) {
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }

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
