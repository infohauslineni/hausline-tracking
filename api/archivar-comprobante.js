import { createClient } from '@supabase/supabase-js'
import { subirArchivoDrive } from './_drive.js'

// Archiva el COMPROBANTE de pago de un pedido en su carpeta de Google Drive
// (la misma donde caen la factura y las fotos de control de calidad:
//  HAUSLINE Facturas / <mes> / <codigo> / …).
//
// Lo llama el panel al confirmar un encargo web (subir comprobante). La imagen ya
// viene comprimida a webp desde el navegador (base64), así el cuerpo es chico y no
// choca con el límite de tamaño de la función.
//
// Autorización: la sesión del admin (JWT) en Authorization: Bearer <token>, validada
// contra Supabase con la llave de servicio (igual que api/track17-poll.js).
export const config = { maxDuration: 30 }

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization') ?? ''
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await client.auth.getUser(token).catch(() => ({ data: { user: null } }))
  if (!userData?.user) return response.status(401).json({ ok: false })

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const codigo = String(body.codigo ?? '').trim()
  const dataBase64 = String(body.dataBase64 ?? '')
  if (!codigo || !dataBase64) return response.status(400).json({ ok: false, error: 'Falta código o archivo' })

  const mime = String(body.mime ?? 'image/webp')
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'
  const filename = String(body.filename ?? `${codigo} - Comprobante de pago.${ext}`)
  // Misma carpeta de mes que la factura (que se archiva al crear el pedido, hoy mismo).
  const fecha = body.fecha || new Date().toISOString().slice(0, 10)

  try {
    const data = Buffer.from(dataBase64, 'base64')
    if (!data.length) return response.status(400).json({ ok: false, error: 'Archivo vacío' })
    const result = await subirArchivoDrive({ codigo, fecha, filename, data, mime })
    return response.status(200).json({ ok: true, drive: result })
  } catch (error) {
    console.error('archivar-comprobante: falló', error?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo archivar en Drive' })
  }
}
