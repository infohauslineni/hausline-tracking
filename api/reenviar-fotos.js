import { createClient } from '@supabase/supabase-js'
import { ESTADO_LABEL, enviarCorreoPedido } from './_correo.js'
import { obtenerFotosCalidad } from './notificar-estado.js'

// Reenvía al cliente el correo con las fotos de una etapa (recibido en HAUSLINE / empaque /
// control de calidad) SIN depender del cambio de estado. Sirve cuando el pedido YA pasó esa
// etapa (el correo automático por transición ya no dispara) pero se subieron o se quieren
// reenviar las fotos. Lo llama el panel con el JWT del usuario; solo un admin/operador activo
// puede usarlo. Reutiliza las mismas fotos (con su marca) y el mismo correo que el flujo normal.
export const config = { maxDuration: 30 }

// Cada tipo de foto corresponde a la etapa/correo que la lleva.
const TIPO_A_ESTADO = {
  recibido_hausline: 'disponible_entrega',
  empaque: 'empaquetado',
  control_calidad: 'control_calidad',
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({ ok: false, error: 'Missing server configuration' })
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return response.status(500).json({ ok: false, error: 'Missing SMTP configuration' })
  }
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1) Autenticación: el JWT del que llama (mismo patrón que crear-usuario).
  const authorization = request.headers?.authorization ?? request.headers?.get?.('authorization') ?? ''
  const token = String(authorization).replace(/^Bearer\s+/i, '').trim()
  if (!token) return response.status(401).json({ ok: false })
  const { data: userData } = await admin.auth.getUser(token).catch(() => ({ data: { user: null } }))
  const solicitante = userData?.user
  if (!solicitante) return response.status(401).json({ ok: false })

  // 2) Autorización: admin u operador activo (los operadores suben las fotos del pedido).
  const { data: perfil } = await admin.from('perfiles').select('rol, activo').eq('id', solicitante.id).maybeSingle()
  if (!perfil || !perfil.activo || (perfil.rol !== 'admin' && perfil.rol !== 'operador')) {
    return response.status(403).json({ ok: false, error: 'No autorizado.' })
  }

  // 3) Datos: código del pedido y tipo de foto.
  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})
  const codigo = String(body.codigo ?? '').trim()
  const tipo = String(body.tipo ?? '').trim()
  const estado = TIPO_A_ESTADO[tipo]
  if (!codigo || !estado) return response.status(400).json({ ok: false, error: 'Datos inválidos.' })

  // 4) Correo y nombre del cliente del pedido.
  const { data: pedido, error: pedidoError } = await admin
    .from('pedidos')
    .select('codigo, clientes(correo, nombre)')
    .eq('codigo', codigo)
    .maybeSingle()
  if (pedidoError) return response.status(502).json({ ok: false, error: 'No se pudo leer el pedido.' })
  const cli = Array.isArray(pedido?.clientes) ? pedido.clientes[0] : pedido?.clientes
  const correo = (cli?.correo ?? '').trim()
  const nombre = cli?.nombre ?? null
  if (!correo) return response.status(200).json({ ok: false, error: 'El cliente no tiene correo.' })

  // 5) Fotos de esa etapa (visibles al cliente, ya con su marca grabada al subirlas).
  const { fotos } = await obtenerFotosCalidad(codigo, tipo)
  if (!fotos.length) return response.status(200).json({ ok: false, error: 'No hay fotos para enviar en esta etapa.' })

  // 6) Envía el MISMO correo de esa etapa, ahora con las fotos.
  try {
    await enviarCorreoPedido({ correo, nombre, codigo, estado, esNuevo: false, factura: null, fotos, pedirResena: false })
  } catch (sendError) {
    console.error('reenviar-fotos: no se pudo enviar', sendError?.message)
    return response.status(502).json({ ok: false, error: 'No se pudo enviar el correo.' })
  }
  if (!ESTADO_LABEL[estado]) console.warn('reenviar-fotos: estado sin label', estado)
  return response.status(200).json({ ok: true, sent: correo, fotos: fotos.length })
}
