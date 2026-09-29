import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { personalActivo } from './_auth.js'

// Nombre NEUTRO del producto a partir de su foto, para el panel de productos de la tienda
// (admin.html de hausline-web): al subir la primera foto, el nombre se llena solo.
// Neutro = sin marcas, modelos, logos ni colaboraciones (derechos de marca), con el mismo
// estilo del catálogo: tipo + silueta/estilo + material/detalle + color
// (ej. "Sneaker Low Top Gamuza Negro"). Ver 202609240002_nombres_neutros_productos.sql.
//
// El navegador manda { imageBase64, mime, subcategoria? } con la sesión del proyecto de la
// tienda (login dual del admin) en Authorization: Bearer <token>. Solo personal activo.
//
// Config del entorno (Vercel → Environment Variables):
//   ANTHROPIC_API_KEY   (obligatoria)  clave de console.anthropic.com
export const config = { maxDuration: 60 }

const ORIGENES = ['https://hauslineshopni.es', 'https://www.hauslineshopni.es']
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
// ~3 MB de imagen en base64 (el navegador la achica antes de mandarla).
const MAX_BASE64 = 4_000_000

const SISTEMA = `Ponés nombres de producto para el catálogo de HAUSLINE, una tienda de Nicaragua.
Mirás la foto y devolvés UN nombre corto en español (2 a 7 palabras) que describa el producto.

Regla principal: el nombre es NEUTRO. Nunca pongas marcas, nombres de modelos, líneas,
colaboraciones, diseñadores ni textos o logos que se lean en el producto (por derechos de
marca). Si el producto es muy reconocible, describilo igual por lo que se ve, sin nombrarlo.

Formato: Tipo + silueta o estilo + material o detalle distintivo + color.
- Tipo: Sneaker, Slide, Sandalia, Clog, Bota, Mocasín, Camiseta, Camisa, Hoodie, Suéter,
  Chaqueta, Short, Pantalón, Conjunto, Gorra, Cinturón, Bolso, Mochila, Billetera, Lentes,
  Reloj, Figura, etc.
- Términos que ya usa el catálogo (en inglés cuando así se dicen): Low Top, High Top,
  Oversized, Manga Larga, Sock Knit, Trucker, Spikes, Glitter, Tonal.
- Colores en español con mayúscula inicial; dos colores con barra: "Negro/Blanco".
- Sin comillas, sin punto final, sin emojis.

Ejemplos del catálogo: "Sneaker Low Top Gamuza Negro", "Sneaker High Top Cuero Negro",
"Slide Tachuelas Rojo", "Sneaker Sock Knit Triple Negro", "Clog Suede Herrajes Negro",
"Cinturón Cuero Hebilla Dorada", "Gorra Trucker Parche Negro/Rosa",
"Camiseta Oversized Gráfica Negro", "Camiseta Manga Larga Corazón Negro/Blanco",
"Figura Bear 400% Camuflaje".`

const Respuesta = z.object({
  nombre: z.string().describe('Nombre neutro del producto, sin marcas'),
})

function cors(request, response) {
  const origen = request.headers?.origin ?? ''
  if (ORIGENES.includes(origen)) {
    response.setHeader('Access-Control-Allow-Origin', origen)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.setHeader('Access-Control-Max-Age', '86400')
  }
}

export default async function handler(request, response) {
  cors(request, response)
  if (request.method === 'OPTIONS') return response.status(204).end()
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return response.status(500).json({ ok: false, error: 'Falta ANTHROPIC_API_KEY en Vercel' })
  }

  // --- 1) validar sesión (solo personal activo) --------------------------------
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const authorization = request.headers?.authorization ?? ''
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!(await personalActivo(supabase, token))) return response.status(401).json({ ok: false })

  // --- 2) leer la foto -----------------------------------------------------------
  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const imageBase64 = String(body.imageBase64 ?? '')
  const mime = MIMES.includes(body.mime) ? body.mime : 'image/jpeg'
  const subcategoria = String(body.subcategoria ?? '').slice(0, 40)
  if (!imageBase64) return response.status(400).json({ ok: false, error: 'Falta la foto' })
  if (imageBase64.length > MAX_BASE64) return response.status(413).json({ ok: false, error: 'La foto es muy grande' })

  // --- 3) pedir el nombre a Claude ----------------------------------------------
  const client = new Anthropic()
  try {
    const mensaje = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      // Tarea simple: poco razonamiento alcanza.
      output_config: { effort: 'low', format: betaZodOutputFormat(Respuesta) },
      // Si el modelo declina la foto, la API la reintenta sola con el modelo de respaldo.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SISTEMA,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: imageBase64 } },
          { type: 'text', text: subcategoria ? `Categoría elegida en el panel: ${subcategoria}.` : 'Nombre para este producto.' },
        ],
      }],
    })
    if (mensaje.stop_reason === 'refusal') {
      return response.status(422).json({ ok: false, error: 'La IA no pudo describir esta foto. Escribí el nombre a mano.' })
    }
    const nombre = String(mensaje.parsed_output?.nombre ?? '').replace(/["“”.]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!nombre) return response.status(502).json({ ok: false, error: 'La IA no devolvió un nombre. Probá de nuevo.' })
    return response.status(200).json({ ok: true, nombre })
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return response.status(429).json({ ok: false, error: 'Demasiadas fotos seguidas. Esperá un momento.' })
    }
    if (error instanceof Anthropic.AuthenticationError) {
      console.error('nombre-producto: ANTHROPIC_API_KEY inválida')
      return response.status(500).json({ ok: false, error: 'La clave de la IA no es válida (ANTHROPIC_API_KEY).' })
    }
    if (error instanceof Anthropic.APIError) {
      console.error('nombre-producto: error de la API', error.status, error.message)
      return response.status(502).json({ ok: false, error: 'La IA no respondió. Probá de nuevo.' })
    }
    console.error('nombre-producto:', error)
    return response.status(500).json({ ok: false, error: 'Error inesperado' })
  }
}
