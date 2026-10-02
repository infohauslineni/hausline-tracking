// AUTOMATIZACIONES que corren en la tarea de cada 15 min (pg_cron → /api/notificar-estado
// {tarea:"recordatorios_encargos"}). Cada una es independiente y best-effort: si una falla,
// las demás siguen. Ninguna manda dos veces lo mismo: el candado es email_eventos (clave única).
//   1. Recordatorio de saldo      → disponible hace 2 días con saldo (mañana empieza bodega)
//   3. Reporte diario al dueño    → 7 a. m. Nicaragua
//   6. Carrito abandonado         → dejó su correo en el checkout y no terminó (2 h después)
//   7. Volver a comprar           → 30 días después de entregado, cupón personal
//   8. Recordatorio de reseña     → 5 días después de entregado, si no dejó reseña
// A los CLIENTES solo se les escribe de 9 a. m. a 8 p. m. (hora de Nicaragua).
import { createClient } from '@supabase/supabase-js'
import { ESTADO_LABEL } from './_correo.js'
import { enviarCorreoCarritoAbandonado, enviarCorreoRecompra, enviarCorreoRecordatorioResena, enviarCorreoRecordatorioSaldo, enviarCorreoReporteDiario } from './_correo-auto.js'
import { cerrarEmail, reservarEmail } from './_email-eventos.js'

const HORA = 3_600_000
const DIA = 24 * HORA
const RECOMPRA_PORCENTAJE = 10   // % del cupón de "volver a comprar"
const RECOMPRA_VIGENCIA_DIAS = 30
const NIC = -6 * HORA             // Nicaragua = UTC-6, sin horario de verano

const ahoraNic = () => new Date(Date.now() + NIC)
const horaNic = () => ahoraNic().getUTCHours()
const fechaNic = (d = ahoraNic()) => d.toISOString().slice(0, 10)
const horarioCliente = () => { const h = horaNic(); return h >= 9 && h < 20 }
const uno = (x) => (Array.isArray(x) ? x[0] : x) ?? null

// Envía UNA vez por clave. Devuelve true si salió.
async function unaVez(clave, tipo, { codigo = null, destinatario = null }, enviar) {
  const reserva = await reservarEmail({ clave, tipo, codigo, destinatario })
  if (reserva.duplicado) return false
  try { await enviar(); await cerrarEmail(reserva.id); return true }
  catch (e) { await cerrarEmail(reserva.id, e?.message || 'error de envío'); console.error(`auto ${tipo}: falló ${clave}`, e?.message); return false }
}

// Primera vez que el pedido entró a un estado (historial).
function desde(historial, estado) {
  const t = (Array.isArray(historial) ? historial : []).filter((h) => h.estado_nuevo === estado).map((h) => new Date(h.created_at).getTime()).filter(Number.isFinite).sort((a, b) => a - b)
  return t[0] ?? null
}

// ---------- 1. Recordatorio de saldo ----------
async function recordatorioSaldo(db) {
  if (!horarioCliente()) return 0
  const { data, error } = await db.from('pedidos')
    .select('codigo, saldo, clientes(nombre, correo), historial_pedidos(estado_nuevo, created_at)')
    .eq('estado', 'disponible_entrega').gt('saldo', 0.01).limit(200)
  if (error) throw new Error(error.message)
  let tc = 37
  const { data: cfg } = await db.from('configuracion').select('valor_json').eq('clave', 'moneda').maybeSingle()
  if (Number(cfg?.valor_json?.tipo_cambio) > 0) tc = Number(cfg.valor_json.tipo_cambio)
  let cuentas = null
  let n = 0
  for (const p of data ?? []) {
    const cli = uno(p.clientes)
    const correo = String(cli?.correo ?? '').trim()
    const inicio = desde(p.historial_pedidos, 'disponible_entrega')
    // Ventana: entre 44 h y 72 h disponible (día 2). Más tarde ya lo cubre el aviso de bodega.
    if (!correo || !inicio || Date.now() - inicio < 44 * HORA || Date.now() - inicio > 72 * HORA) continue
    if (!cuentas) { const { data: c } = await db.rpc('cuentas_pago_publicas'); cuentas = c?.cuentas ?? [] }
    const saldo = Number(p.saldo)
    if (await unaVez(`saldo:${p.codigo}`, 'recordatorio_saldo', { codigo: p.codigo, destinatario: correo }, () =>
      enviarCorreoRecordatorioSaldo({ correo, nombre: cli?.nombre ?? null, codigo: p.codigo, saldo, cordobas: Math.ceil((saldo * tc) / 10) * 10, cuentas }))) n++
  }
  return n
}

// ---------- 7. Volver a comprar · 8. Reseña ----------
async function postEntrega(db) {
  if (!horarioCliente()) return { recompra: 0, resena: 0 }
  const { data: hist, error } = await db.from('historial_pedidos')
    .select('created_at, pedidos!inner(id, codigo, estado, cliente_id, clientes(nombre, correo))')
    .eq('estado_nuevo', 'entregado')
    .gte('created_at', new Date(Date.now() - 40 * DIA).toISOString())
    .lte('created_at', new Date(Date.now() - 5 * DIA).toISOString())
    .limit(500)
  if (error) throw new Error(error.message)
  let recompra = 0, resena = 0
  const vistos = new Set()
  for (const h of hist ?? []) {
    const p = uno(h.pedidos)
    if (!p || p.estado !== 'entregado' || vistos.has(p.codigo)) continue
    vistos.add(p.codigo)
    const cli = uno(p.clientes)
    const correo = String(cli?.correo ?? '').trim()
    if (!correo) continue
    const dias = (Date.now() - new Date(h.created_at).getTime()) / DIA

    // 8. Reseña: días 5 a 12, si no hay ninguna reseña de ese pedido.
    if (dias >= 5 && dias <= 12) {
      const { count } = await db.from('resenas').select('id', { count: 'exact', head: true }).eq('pedido_codigo', p.codigo)
      if (!count && await unaVez(`resena:${p.codigo}`, 'recordatorio_resena', { codigo: p.codigo, destinatario: correo }, () =>
        enviarCorreoRecordatorioResena({ correo, nombre: cli?.nombre ?? null, codigo: p.codigo }))) resena++
    }

    // 7. Volver a comprar: días 30 a 37, si no volvió a comprar desde esa entrega.
    if (dias >= 30 && dias <= 37 && p.cliente_id) {
      const { count: nuevos } = await db.from('pedidos').select('id', { count: 'exact', head: true })
        .eq('cliente_id', p.cliente_id).gt('created_at', h.created_at).neq('estado', 'cancelado')
      if (nuevos) continue
      const vence = fechaNic(new Date(Date.now() + NIC + RECOMPRA_VIGENCIA_DIAS * DIA))
      const codigoCupon = `VUELVE-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
      // El cupón se crea SOLO si el correo todavía no salió (el candado va primero).
      const reserva = await reservarEmail({ clave: `recompra:${p.codigo}`, tipo: 'recompra', codigo: p.codigo, destinatario: correo })
      if (reserva.duplicado) continue
      try {
        const { error: eCupon } = await db.from('cupones').insert({ codigo: codigoCupon, tipo: 'porcentaje', valor: RECOMPRA_PORCENTAJE, cliente_id: p.cliente_id, usos_max: 1, vence_el: vence, nota: `Volver a comprar (automático) · ${p.codigo}`, created_by: null })
        if (eCupon) throw new Error(eCupon.message)
        await enviarCorreoRecompra({ correo, nombre: cli?.nombre ?? null, cupon: codigoCupon, porcentaje: RECOMPRA_PORCENTAJE, vence })
        await cerrarEmail(reserva.id); recompra++
      } catch (e) {
        await cerrarEmail(reserva.id, e?.message || 'error'); console.error('auto recompra: falló', p.codigo, e?.message)
        await db.from('cupones').delete().eq('codigo', codigoCupon)
      }
    }
  }
  return { recompra, resena }
}

// ---------- 6. Carrito abandonado ----------
async function carritosAbandonados(db) {
  if (!horarioCliente()) return 0
  const { data, error } = await db.from('carritos_abandonados')
    .select('id, correo, nombre, items, total, actualizado_at')
    .is('aviso_at', null).is('recuperado_at', null)
    .lte('actualizado_at', new Date(Date.now() - 2 * HORA).toISOString())
    .gte('actualizado_at', new Date(Date.now() - 3 * DIA).toISOString())
    .limit(100)
  if (error) { if (/carritos_abandonados/.test(error.message)) return 0; throw new Error(error.message) } // migración sin aplicar
  let n = 0
  for (const c of data ?? []) {
    // ¿Terminó su pedido después (o un rato antes) de dejar el carrito? Entonces no es abandono.
    const { count } = await db.from('solicitudes').select('id', { count: 'exact', head: true })
      .ilike('cliente_correo', c.correo).gte('created_at', new Date(new Date(c.actualizado_at).getTime() - 2 * HORA).toISOString())
    if (count) { await db.from('carritos_abandonados').update({ recuperado_at: new Date().toISOString() }).eq('id', c.id); continue }
    if (!Array.isArray(c.items) || !c.items.length) continue
    const ok = await unaVez(`carrito:${c.correo}:${String(c.actualizado_at).slice(0, 16)}`, 'carrito_abandonado', { destinatario: c.correo }, () =>
      enviarCorreoCarritoAbandonado({ correo: c.correo, nombre: c.nombre, items: c.items, total: c.total }))
    if (ok) { await db.from('carritos_abandonados').update({ aviso_at: new Date().toISOString() }).eq('id', c.id); n++ }
  }
  return n
}

// ---------- 3. Reporte diario ----------
async function reporteDiario(db) {
  if (horaNic() !== 7) return false
  const to = (process.env.AVISO_ADMIN || process.env.SMTP_USER || '').trim()
  if (!to) return false
  const hoy = fechaNic()
  const finAyer = new Date(`${hoy}T06:00:00Z`)                 // 12 a. m. de hoy en Nicaragua
  const iniAyer = new Date(finAyer.getTime() - DIA)
  const rango = (q, col = 'created_at') => q.gte(col, iniAyer.toISOString()).lt(col, finAyer.toISOString())

  const [pagos, nuevos, encargos, activos, cuentas, eventos] = await Promise.all([
    rango(db.from('pagos').select('monto, tipo')),
    rango(db.from('pedidos').select('total, estado')),
    rango(db.from('solicitudes').select('estado')),
    db.from('pedidos').select('codigo, estado, saldo, updated_at, clientes(nombre), historial_pedidos(estado_nuevo, created_at)').not('estado', 'in', '(entregado,cancelado)').neq('activo', false).limit(1000),
    db.from('cuentas_bancarias').select('nombre, moneda, saldo').eq('activo', true).order('orden'),
    rango(db.from('email_eventos').select('tipo').in('tipo', ['recordatorio_saldo', 'recompra', 'recordatorio_resena', 'carrito_abandonado']).not('enviado_at', 'is', null)),
  ])
  const signo = (p) => (p.tipo === 'reembolso' ? -1 : 1) * Number(p.monto || 0)
  const ped = (nuevos.data ?? []).filter((p) => p.estado !== 'cancelado')
  const act = activos.data ?? []
  const conSaldo = act.filter((p) => Number(p.saldo) > 0.01)
  const TRANSITO = new Set(['etiqueta_creada', 'despachado', 'transito_internacional', 'recibido_estados_unidos', 'transito_nicaragua'])
  const ultimo = (p) => Math.max(...(p.historial_pedidos ?? []).map((h) => new Date(h.created_at).getTime()), new Date(p.updated_at).getTime() || 0)
  const nombreCli = (p) => uno(p.clientes)?.nombre ?? 'Cliente'
  const conteo = {}
  for (const e of eventos.data ?? []) conteo[e.tipo] = (conteo[e.tipo] ?? 0) + 1
  const NOMBRE = { recordatorio_saldo: 'saldo', recompra: 'volver a comprar', recordatorio_resena: 'reseña', carrito_abandonado: 'carrito abandonado' }

  const r = {
    fechaTxt: new Intl.DateTimeFormat('es-NI', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(iniAyer.getTime() + 12 * HORA)),
    cobrado: (pagos.data ?? []).reduce((s, p) => s + signo(p), 0),
    pagos: (pagos.data ?? []).filter((p) => p.tipo !== 'reembolso').length,
    pedidosNuevos: ped.length,
    vendido: ped.reduce((s, p) => s + Number(p.total || 0), 0),
    encargos: (encargos.data ?? []).length,
    encargosPendientes: (encargos.data ?? []).filter((s) => s.estado === 'pendiente').length,
    porCobrar: conSaldo.reduce((s, p) => s + Number(p.saldo || 0), 0),
    conSaldo: conSaldo.length,
    disponibles: act.filter((p) => p.estado === 'disponible_entrega' && Number(p.saldo) > 0.01)
      .map((p) => ({ codigo: p.codigo, cliente: nombreCli(p), saldo: Number(p.saldo), dias: Math.floor((Date.now() - (desde(p.historial_pedidos, 'disponible_entrega') ?? Date.now())) / DIA) }))
      .sort((a, b) => b.dias - a.dias).slice(0, 15),
    trabados: act.filter((p) => !TRANSITO.has(p.estado) && p.estado !== 'disponible_entrega')
      .map((p) => ({ codigo: p.codigo, cliente: nombreCli(p), estado: ESTADO_LABEL[p.estado] ?? p.estado, dias: Math.floor((Date.now() - ultimo(p)) / DIA) }))
      .filter((p) => p.dias >= 7).sort((a, b) => b.dias - a.dias).slice(0, 15),
    cuentas: cuentas.data ?? [],
    automatico: Object.entries(conteo).map(([k, v]) => `${v} de ${NOMBRE[k] ?? k}`).join(' · '),
  }
  return unaVez(`reporte:${hoy}`, 'reporte_diario', { destinatario: to }, () => enviarCorreoReporteDiario({ to, r }))
}

export async function automatizaciones() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SMTP_USER) return null
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const res = {}
  const paso = async (nombre, fn) => { try { res[nombre] = await fn(db) } catch (e) { res[nombre] = 'error'; console.error(`auto ${nombre}:`, e?.message) } }
  await paso('reporte', reporteDiario)
  await paso('saldo', recordatorioSaldo)
  await paso('carritos', carritosAbandonados)
  await paso('post_entrega', postEntrega)
  return res
}
