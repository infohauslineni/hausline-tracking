import { createClient } from '@supabase/supabase-js'

// Borra la marca del proveedor (p. ej. "WAN YI" escrito con marcador sobre el brazo)
// de una foto de control de calidad, usando un modelo de inpainting en Replicate (LaMa).
//
// El navegador manda dos imágenes en base64:
//   - imageBase64: la foto original del proveedor (con la marca).
//   - maskBase64:  una máscara PNG del MISMO tamaño, BLANCA donde hay que borrar
//                  (lo que el empleado pintó / auto-detectó) y NEGRA en el resto.
// LaMa borra la zona blanca y reconstruye la textura de atrás (la piel).
//
// Autorización: la sesión del empleado (JWT) en Authorization: Bearer <token>,
// validada contra Supabase con la llave de servicio — mismo patrón que
// api/archivar-comprobante.js. Así nadie llama la IA sin estar logueado.
//
// Config del entorno (Vercel → Environment Variables):
//   REPLICATE_API_TOKEN   (obligatoria)  token de replicate.com/account/api-tokens
//   REPLICATE_MODEL       (opcional)     "owner/nombre" del modelo LaMa a usar;
//                                         se confirma el slug exacto al conectar.
export const config = { maxDuration: 60 }

// Modelo por defecto. Se confirma/ajusta contra Replicate al momento de conectar el
// token (por eso es override-able con REPLICATE_MODEL sin tocar el código).
const DEFAULT_MODEL = 'allenhooo/lama'

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }
  if (!process.env.REPLICATE_API_TOKEN) {
    return response.status(500).json({ ok: false, error: 'Falta REPLICATE_API_TOKEN' })
  }

  // --- 1) validar sesión ---------------------------------------------------
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization') ?? ''
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await client.auth.getUser(token).catch(() => ({ data: { user: null } }))
  if (!userData?.user) return response.status(401).json({ ok: false })

  // --- 2) leer entradas ----------------------------------------------------
  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const imageBase64 = String(body.imageBase64 ?? '')
  const maskBase64 = String(body.maskBase64 ?? '')
  const imageMime = String(body.imageMime ?? 'image/webp')
  if (!imageBase64 || !maskBase64) {
    return response.status(400).json({ ok: false, error: 'Falta la foto o la zona marcada' })
  }
  const imageUri = `data:${imageMime};base64,${imageBase64}`
  const maskUri = `data:image/png;base64,${maskBase64}`

  // --- 3) llamar a Replicate (LaMa) ---------------------------------------
  const model = process.env.REPLICATE_MODEL || DEFAULT_MODEL
  try {
    // Endpoint por nombre de modelo + "Prefer: wait": Replicate espera a que
    // termine y devuelve el resultado en la misma llamada (sin fijar un hash de
    // versión). Si igual regresa "processing", hacemos polling como respaldo.
    let prediction = await replicateFetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: { Prefer: 'wait' },
      body: JSON.stringify({ input: { image: imageUri, mask: maskUri } }),
    })

    // Respaldo: si no vino terminado, consultamos hasta que esté listo.
    const deadline = Date.now() + 55_000
    while (prediction && ['starting', 'processing'].includes(prediction.status) && Date.now() < deadline) {
      await sleep(1500)
      prediction = await replicateFetch(prediction.urls?.get, { method: 'GET' })
    }

    if (!prediction || prediction.status !== 'succeeded') {
      console.error('quitar-marca: predicción no exitosa', prediction?.status, prediction?.error)
      return response.status(502).json({ ok: false, error: 'La IA no pudo borrar la marca. Probá de nuevo.' })
    }

    // El output de LaMa suele ser una URL (o un arreglo con una URL).
    const outUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
    if (!outUrl) return response.status(502).json({ ok: false, error: 'La IA no devolvió imagen.' })

    // Devolvemos la imagen limpia en base64 para que el navegador la muestre
    // directo en el canvas (antes/después) sin problemas de CORS.
    const imgRes = await fetch(outUrl)
    const buf = Buffer.from(await imgRes.arrayBuffer())
    const outMime = imgRes.headers.get('content-type') || 'image/png'
    return response.status(200).json({
      ok: true,
      imageBase64: buf.toString('base64'),
      imageMime: outMime,
      url: outUrl,
    })
  } catch (error) {
    console.error('quitar-marca: falló', error?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo procesar la imagen.' })
  }
}

async function replicateFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (!res.ok && res.status !== 201) {
    const text = await res.text().catch(() => '')
    throw new Error(`Replicate ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
