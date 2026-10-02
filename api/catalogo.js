import { createClient } from '@supabase/supabase-js'
import { obtenerCatalogoMergeado, sincronizarProductos } from './_catalogo.js'

// GET  → la app (comercial.service.ts → sincronizarCatalogo) recibe el catálogo unido de la
//        tienda + feed + panel.
// POST → "sincronizá ya": lo llama Supabase (trigger del proyecto CATÁLOGO, migración
//        admin/sync-catalogo-tracking.sql) cada vez que se guarda un producto en admin.html, para
//        que el precio / foto / nombre nuevo salga al instante en el tracking. No necesita secreto:
//        solo copia el catálogo PÚBLICO a la tabla productos (idempotente); igual se limita a una
//        corrida cada pocos segundos.
export const config = { maxDuration: 60 }
let ultimaCorrida = 0

export default async function handler(request, response) {
  if (request.method === 'POST') return sincronizarAhora(response)
  try {
    const merged = await obtenerCatalogoMergeado()
    if (!merged.length) return response.status(502).json({ error: 'No se pudo leer el catálogo publicado.' })
    response.setHeader('Cache-Control', 'no-store, max-age=0')
    return response.status(200).json(merged)
  } catch {
    return response.status(502).json({ error: 'No se pudo leer el catálogo publicado.' })
  }
}

async function sincronizarAhora(response) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(500).json({ ok: false })
  // Varios guardados seguidos (p. ej. cambios en lote): espera a que se calme y corre UNA vez.
  const espera = 4000 - (Date.now() - ultimaCorrida)
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
  ultimaCorrida = Date.now()
  try {
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const productos = await sincronizarProductos(client)
    return response.status(200).json({ ok: true, productos })
  } catch (error) {
    console.error('catalogo: sincronización instantánea falló', error?.message)
    return response.status(502).json({ ok: false })
  }
}
