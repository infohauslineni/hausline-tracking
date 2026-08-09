import { createClient } from '@supabase/supabase-js'
import { ESTADO_LABEL, enviarCorreoPedido } from './_correo.js'

// Aviso por correo al CREAR un pedido. Lo llama la propia app (NuevoPedidoPage) justo
// después de guardar el pedido, así el correo "pedido registrado" no depende de que el
// webhook de Supabase esté configurado para el evento INSERT.
//
// Seguridad: se autentica con la sesión (JWT) del administrador que creó el pedido, y el
// correo/nombre del cliente se leen en el servidor con la service role (no viajan desde el
// navegador). Requiere en Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMTP_USER, SMTP_PASS.
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }

  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization')
  const token = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null
  if (!token) return response.status(401).json({ ok: false })

  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Verifica que quien llama sea un usuario autenticado válido (administrador).
  const { data: userData, error: userError } = await client.auth.getUser(token)
  if (userError || !userData?.user) return response.status(401).json({ ok: false })

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const pedidoId = body.pedido_id
  if (!pedidoId) return response.status(400).json({ ok: false, error: 'Falta pedido_id' })

  // Lee el pedido y el correo/nombre del cliente en el servidor (dato sensible, no del navegador).
  const { data: pedido, error: pedidoError } = await client
    .from('pedidos')
    .select('codigo, estado, clientes(nombre, correo)')
    .eq('id', pedidoId)
    .single()
  if (pedidoError || !pedido) return response.status(404).json({ ok: false, error: 'Pedido no encontrado' })

  if (!ESTADO_LABEL[pedido.estado]) return response.status(200).json({ ok: true, skipped: 'estado no notificable' })
  const correo = (pedido.clientes?.correo ?? '').trim()
  const nombre = pedido.clientes?.nombre ?? null
  if (!correo) return response.status(200).json({ ok: true, skipped: 'cliente sin correo' })

  try {
    await enviarCorreoPedido({ correo, nombre, codigo: pedido.codigo, estado: pedido.estado, esNuevo: true })
  } catch (sendError) {
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo' })
  }

  return response.status(200).json({ ok: true, sent: correo })
}
