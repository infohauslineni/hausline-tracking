// Archiva las facturas en PDF en tu Google Drive, vía un Google Apps Script publicado
// como "app web" (se ejecuta con TU cuenta, así los archivos quedan en tu Drive sin
// necesidad de Google Cloud ni claves de API). El guion bajo evita que Vercel lo
// publique como endpoint. Config por variables de entorno:
//   DRIVE_WEBHOOK_URL    = URL de la app web del Apps Script
//   DRIVE_WEBHOOK_SECRET = secreto compartido (debe coincidir con el del script)
// Si falta la config, no hace nada (así el correo nunca se rompe por esto).

// POST al Apps Script. Estricto: si Google responde con una página (p. ej. pide volver a
// autorizar el script, o la implementación dejó de ser pública) en vez de JSON, es un ERROR.
// Antes eso contaba como "archivado" y el archivo no aparecía en Drive sin dejar rastro.
async function enviarADrive(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'follow', // Apps Script responde con un redirect a googleusercontent
  })
  const texto = await res.text().catch(() => '')
  let json = null
  try { json = JSON.parse(texto) } catch { /* no es JSON */ }
  if (!res.ok || !json || typeof json !== 'object' || json.ok === false) {
    const detalle = json ? JSON.stringify(json) : texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    throw new Error(`Drive HTTP ${res.status}: ${detalle.slice(0, 200) || 'respuesta vacía'}`)
  }
  console.log(`drive: archivado ${body.mes} / ${body.codigo} / ${body.filename}`)
  return json
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// "Agosto 2026" a partir de la fecha del pedido (así las dos facturas del mismo pedido
// caen en el mismo mes, aunque el pago se registre semanas después).
export function mesCarpeta(fecha) {
  const raw = String(fecha ?? '').trim()
  const d = raw ? new Date(raw.length <= 10 ? `${raw}T12:00:00` : raw) : new Date()
  if (Number.isNaN(d.getTime())) return 'Sin fecha'
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`
}

// Sube un archivo cualquiera (PDF, imagen, …) a Drive bajo:
//   HAUSLINE Facturas / <mes> / <codigo> / <filename>
// Es la misma carpeta del pedido, así la factura y las fotos de control de calidad
// quedan juntas. Devuelve el JSON del script, o { skipped } si no hay config o data.
// `carpeta` reemplaza al mes (p. ej. "RESPALDOS", fuera de las carpetas de cada mes, fuera de los meses).
export async function subirArchivoDrive({ codigo, fecha, filename, data, mime, carpeta }) {
  const url = process.env.DRIVE_WEBHOOK_URL
  const secret = process.env.DRIVE_WEBHOOK_SECRET
  if (!url || !secret) return { skipped: 'Falta configuración de Drive' }
  if (!data) return { skipped: 'Sin datos' }

  const body = {
    secret,
    mes: carpeta || mesCarpeta(fecha),
    codigo: String(codigo ?? 'SIN-CODIGO').trim() || 'SIN-CODIGO',
    filename: filename || String(codigo ?? 'archivo'),
    mime: mime || 'application/octet-stream',
    dataBase64: Buffer.from(data).toString('base64'),
  }

  return enviarADrive(url, body)
}

// Sube un PDF a Drive bajo:  HAUSLINE Facturas / <mes> / <codigo> / <filename>
// Devuelve el JSON del script, o { skipped } si no hay config. Lanza si el POST falla.
export async function subirFacturaDrive({ codigo, fecha, filename, pdf }) {
  const url = process.env.DRIVE_WEBHOOK_URL
  const secret = process.env.DRIVE_WEBHOOK_SECRET
  if (!url || !secret) return { skipped: 'Falta configuración de Drive' }
  if (!pdf) return { skipped: 'Sin PDF' }

  const body = {
    secret,
    mes: mesCarpeta(fecha),
    codigo: String(codigo ?? 'SIN-CODIGO').trim() || 'SIN-CODIGO',
    filename: filename || `${codigo}.pdf`,
    mime: 'application/pdf',
    dataBase64: Buffer.from(pdf).toString('base64'),
  }

  return enviarADrive(url, body)
}
