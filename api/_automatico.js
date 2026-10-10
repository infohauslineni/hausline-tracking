// AUTOMATIZACIONES que corren en la tarea de cada 15 min (pg_cron → /api/notificar-estado
// {tarea:"recordatorios_encargos"}). Cada una es independiente y best-effort: si una falla,
// las demás siguen. Ninguna manda dos veces lo mismo: el candado es email_eventos (clave única).
//   1. Recordatorio de saldo      → disponible hace 2 días con saldo (mañana empieza bodega)
//   3. Reporte diario al dueño    → 7 a. m. Nicaragua
//   6. Carrito abandonado         → dejó su correo en el checkout y no terminó (2 h después)
//   7. Volver a comprar           → 30 días después de entregado, cupón personal
//   8. Recordatorio de reseña     → 5 días después de entregado, si no dejó reseña
//   · Bajó de precio              → favorito de Mi cuenta que ahora cuesta menos
//   · Respaldo semanal            → lunes 5 a. m., Excel completo en Drive (api/_respaldo.js)
// A los CLIENTES solo se les escribe de 9 a. m. a 8 p. m. (hora de Nicaragua).
import { createClient } from '@supabase/supabase-js'
import { ESTADO_LABEL } from './_correo.js'
import { enviarCorreoBajaPrecio, enviarCorreoCarritoAbandonado, enviarCorreoAvisoGastosFijos, enviarCorreoNovedades, enviarCorreoRedes, enviarCorreoRecompra, enviarCorreoRecordatorioResena, enviarCorreoRecordatorioSaldo, enviarCorreoReporteDiario } from './_correo-auto.js'
import { cerrarEmail, reservarEmail } from './_email-eventos.js'
import { hacerRespaldo } from './_respaldo.js'
import { gastosFijosDeManana } from './_fondo.js'
import { obtenerCatalogoMergeado } from './_catalogo.js'

const HORA = 3_600_000
const DIA = 24 * HORA
// "Volver a comprar" VARIADO (pedido del dueño): no a todos los clientes, 5% o 10%, 7 o 15 días.
// Se decide con el código del pedido (siempre lo mismo para ese pedido, aunque la tarea corra
// varias veces), así no hay dos cupones distintos para la misma compra.
const RECOMPRA_PROBABILIDAD = 60          // % de clientes que reciben el cupón
const RECOMPRA_PORCENTAJES = [5, 10]
const RECOMPRA_VIGENCIAS = [7, 15]        // días: corto a propósito, que vuelvan a comprar pronto
function sorteoRecompra(codigo) {
  let h = 2166136261
  for (const ch of String(codigo)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return {
    recibe: h % 100 < RECOMPRA_PROBABILIDAD,
    porcentaje: RECOMPRA_PORCENTAJES[(h >>> 8) % RECOMPRA_PORCENTAJES.length],
    dias: RECOMPRA_VIGENCIAS[(h >>> 16) % RECOMPRA_VIGENCIAS.length],
  }
}
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
    .select('codigo, saldo, notas_internas, clientes(nombre, correo), historial_pedidos(estado_nuevo, created_at)')
    .eq('estado', 'disponible_entrega').gt('saldo', 0.01).limit(200)
  if (error) throw new Error(error.message)
  let tc = 37
  const { data: cfg } = await db.from('configuracion').select('valor_json').eq('clave', 'moneda').maybeSingle()
  if (Number(cfg?.valor_json?.tipo_cambio) > 0) tc = Number(cfg.valor_json.tipo_cambio)
  let cuentas = null
  let n = 0
  for (const p of data ?? []) {
    // "Paga al recibir" (marca del panel): ya confirmó que paga al entregar, sin recordatorio.
    if (String(p.notas_internas ?? '').includes('[PAGA_AL_RECIBIR]')) continue
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
      const sorteo = sorteoRecompra(p.codigo)
      if (!sorteo.recibe) continue
      const vence = fechaNic(new Date(Date.now() + NIC + sorteo.dias * DIA))
      // Código con formato de la marca: HAUS10-7K4QX / HAUS5-7K4QX (porcentaje + 5 caracteres sin 0/O/1/I).
      const codigoCupon = `HAUS${sorteo.porcentaje}-${Array.from({ length: 5 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("")}`
      // El cupón se crea SOLO si el correo todavía no salió (el candado va primero).
      const reserva = await reservarEmail({ clave: `recompra:${p.codigo}`, tipo: 'recompra', codigo: p.codigo, destinatario: correo })
      if (reserva.duplicado) continue
      try {
        const { error: eCupon } = await db.from('cupones').insert({ codigo: codigoCupon, tipo: 'porcentaje', valor: sorteo.porcentaje, cliente_id: p.cliente_id, usos_max: 1, vence_el: vence, nota: `Volver a comprar (automático) · ${p.codigo}`, created_by: null })
        if (eCupon) throw new Error(eCupon.message)
        await enviarCorreoRecompra({ correo, nombre: cli?.nombre ?? null, cupon: codigoCupon, porcentaje: sorteo.porcentaje, vence })
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

// ---------- Respaldo semanal (lunes 5 a. m.) ----------
async function respaldoSemanal(db) {
  if (ahoraNic().getUTCDay() !== 1 || horaNic() !== 5) return false
  return unaVez(`respaldo:${fechaNic()}`, 'respaldo', {}, async () => { const r = await hacerRespaldo(db); console.log('respaldo semanal:', JSON.stringify(r)) })
}

// ---------- Bajó de precio (favoritos de Mi cuenta) ----------
// Cada favorito guarda el precio que tenía cuando el cliente lo marcó. Si hoy se vende más
// barato (oferta o rebaja) se le avisa. Una vez por producto y precio: si vuelve a bajar, otro aviso.
async function bajaPrecioFavoritos(db) {
  if (!horarioCliente()) return 0
  const { data: favs, error } = await db.from('favoritos_cliente').select('user_id, codigo, nombre, precio, imagen').gt('precio', 0).limit(5000)
  if (error) throw new Error(error.message)
  if (!favs?.length) return 0
  const codigos = [...new Set(favs.map((f) => f.codigo))]
  const precios = new Map()
  for (let i = 0; i < codigos.length; i += 200) {
    const { data } = await db.from('productos').select('codigo, nombre, precio_venta, imagen').in('codigo', codigos.slice(i, i + 200))
    for (const p of data ?? []) precios.set(p.codigo, p)
  }
  // Por cliente, los favoritos que bajaron al menos US$1 y 3 %.
  const porUsuario = new Map()
  for (const f of favs) {
    const p = precios.get(f.codigo)
    const antes = Number(f.precio), ahora = Number(p?.precio_venta)
    // (Una baja de más del 70 % suele ser un precio mal escrito: no se avisa.)
    if (!(ahora > 0) || antes - ahora < 1 || ahora > antes * 0.97 || ahora < antes * 0.3) continue
    porUsuario.set(f.user_id, [...(porUsuario.get(f.user_id) ?? []), { codigo: f.codigo, nombre: p.nombre || f.nombre, imagen: p.imagen || f.imagen, antes, ahora }])
  }
  if (!porUsuario.size) return 0
  const { data: cuentas } = await db.from('cuentas_cliente').select('user_id, nombre, correo').in('user_id', [...porUsuario.keys()])
  const cuentaDe = new Map((cuentas ?? []).map((c) => [c.user_id, c]))
  let n = 0
  for (const [userId, items] of porUsuario) {
    const c = cuentaDe.get(userId)
    const correo = String(c?.correo ?? '').trim()
    if (!correo) continue
    // Candado por producto y precio: solo entran al correo los que todavía no se avisaron.
    const nuevos = []
    for (const it of items) {
      const r = await reservarEmail({ clave: `baja:${userId}:${it.codigo}:${it.ahora.toFixed(2)}`, tipo: 'baja_precio', codigo: it.codigo, destinatario: correo })
      if (!r.duplicado) nuevos.push({ ...it, reserva: r.id })
    }
    if (!nuevos.length) continue
    try {
      await enviarCorreoBajaPrecio({ correo, nombre: c?.nombre ?? null, items: nuevos })
      for (const it of nuevos) await cerrarEmail(it.reserva)
      n++
    } catch (e) {
      for (const it of nuevos) await cerrarEmail(it.reserva, e?.message || 'error de envío')
      console.error('auto baja de precio: falló', userId, e?.message)
    }
  }
  return n
}

// ---------- Novedades a suscriptores ----------
// LUNES y VIERNES desde las 9 a. m. se arma una "edición" con los PRIMEROS 4 productos nuevos que
// todavía no se anunciaron (una cola por fecha de subida: los más viejos primero). Lo que se suba
// después queda para el próximo lunes o viernes (no tiene que salir la misma semana). Hacen falta
// al menos 2 en la cola; si en casi un mes no hubo novedades → "Lo más pedido". Se manda en tandas de
// 25 por vuelta (cada 15 min) hasta completar la lista. Solo a suscriptores que aceptaron
// promociones (tabla suscriptores), con enlace para darse de baja.
const NOV_POR_VUELTA = 25
const NOV_POR_EDICION = 4
const NOV_MINIMO = 2
async function novedades(db) {
  if (!horarioCliente()) return 0
  const { data: cfg } = await db.from('configuracion').select('valor_json').eq('clave', 'novedades').maybeSingle()
  const guardado = cfg?.valor_json ?? {}
  let ed = guardado.id ? guardado : null
  const ahora = Date.now()
  const dia = ahoraNic().getUTCDay()
  if ((!ed || ed.completa) && (dia === 1 || dia === 5) && (!ed || ed.id !== fechaNic())) {
    const enWeb = new Set((await obtenerCatalogoMergeado())
      .filter((c) => !c.ventaLibre && !/^LIB\d/i.test(String(c.codigo || ''))).map((c) => String(c.codigo || '').toUpperCase()))
    // Cola: productos subidos desde que empezó este sistema (o las últimas 2 semanas) que todavía
    // no salieron en ninguna edición.
    const anunciados = new Set((Array.isArray(guardado.anunciados) ? guardado.anunciados : []).map((c) => String(c).toUpperCase()))
    const colaDesde = guardado.cola_desde ?? new Date(ahora - 14 * DIA).toISOString()
    const { data: recientes } = await db.from('productos').select('codigo, nombre, precio_venta, imagen')
      .eq('activo', true).gt('precio_venta', 0).not('imagen', 'is', null).gt('created_at', colaDesde).order('created_at', { ascending: true }).limit(300)
    const cola = (recientes ?? []).filter((p) => enWeb.has(String(p.codigo).toUpperCase()) && !anunciados.has(String(p.codigo).toUpperCase()))
    let tipo = cola.length >= NOV_MINIMO ? 'nuevos' : null
    let lista = cola.slice(0, NOV_POR_EDICION)
    if (!tipo && (!ed || ahora - Date.parse(ed.creada) >= 27 * DIA)) {
      tipo = 'destacados'
      const { data: items } = await db.from('pedido_items').select('codigo_producto').gte('created_at', new Date(ahora - 60 * DIA).toISOString()).limit(5000)
      const veces = new Map()
      for (const it of items ?? []) { const c = String(it.codigo_producto || '').toUpperCase(); if (c && enWeb.has(c)) veces.set(c, (veces.get(c) ?? 0) + 1) }
      const top = [...veces.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c)
      const { data: prods } = top.length ? await db.from('productos').select('codigo, nombre, precio_venta, imagen').in('codigo', top).eq('activo', true).gt('precio_venta', 0) : { data: [] }
      const orden = new Map(top.map((c, i) => [c, i]))
      lista = [...(prods ?? []).filter((p) => p.imagen).sort((a, b) => orden.get(String(a.codigo).toUpperCase()) - orden.get(String(b.codigo).toUpperCase())), ...lista]
    }
    if (!tipo || !lista.length) return 0 // hoy no hay nada que mandar
    const vistos = new Set()
    const elegidos = lista.filter((p) => !vistos.has(p.codigo) && vistos.add(p.codigo)).slice(0, NOV_POR_EDICION)
    ed = {
      id: fechaNic(), tipo, creada: new Date().toISOString(), completa: false,
      productos: elegidos.map((p) => ({ codigo: p.codigo, nombre: p.nombre, precio: Number(p.precio_venta), imagen: p.imagen })),
      // Los anunciados ya no vuelven a la cola (se guardan los últimos 3000).
      anunciados: [...anunciados, ...(tipo === 'nuevos' ? elegidos.map((p) => String(p.codigo).toUpperCase()) : [])].slice(-3000),
      cola_desde: colaDesde,
      en_cola: Math.max(0, cola.length - (tipo === 'nuevos' ? elegidos.length : 0)),
    }
    const { error } = await db.from('configuracion').upsert({ clave: 'novedades', valor_json: ed }, { onConflict: 'clave' })
    if (error) throw new Error(error.message)
  }
  if (!ed || ed.completa) return 0

  const { data: subs, error } = await db.from('suscriptores').select('correo, nombre').eq('activo', true).eq('consentimiento', true).limit(5000)
  if (error) throw new Error(error.message)
  const base = (process.env.CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')
  let enviados = 0, quedan = false
  for (const s of subs ?? []) {
    const correo = String(s.correo ?? '').trim().toLowerCase()
    if (!correo) continue
    if (enviados >= NOV_POR_VUELTA) { quedan = true; break }
    const reserva = await reservarEmail({ clave: `novedades:${ed.id}:${correo}`, tipo: 'novedades', destinatario: correo })
    if (reserva.duplicado) continue
    try {
      const { data: tok, error: eTok } = await db.rpc('token_baja_suscriptor', { p_correo: correo })
      if (eTok || !tok) throw new Error(eTok?.message || 'sin código de baja') // sin enlace de baja no se manda
      await enviarCorreoNovedades({ correo, nombre: s.nombre, tipo: ed.tipo, productos: ed.productos, urlBaja: `${base}/baja/?e=${encodeURIComponent(correo)}&t=${tok}` })
      await cerrarEmail(reserva.id); enviados++
    } catch (e) { await cerrarEmail(reserva.id, e?.message || 'error'); console.error('auto novedades: falló', correo, e?.message); quedan = true; break }
  }
  if (!quedan) await db.from('configuracion').upsert({ clave: 'novedades', valor_json: { ...ed, completa: true, completada: new Date().toISOString() } }, { onConflict: 'clave' })
  return enviados
}

// CAMPAÑA DE REDES: cuando el dueño la lanza desde el panel (configuracion.campana_redes.activa),
// se manda a los suscriptores con consentimiento, de a 25 por vuelta y solo en horario de cliente.
// Un correo por persona y campaña (candado en email_eventos); al terminar se marca completa.
async function campanaRedes(db) {
  if (!horarioCliente()) return 0
  const { data: cfg } = await db.from('configuracion').select('valor_json').eq('clave', 'campana_redes').maybeSingle()
  let c = cfg?.valor_json ?? null
  // AUTOMÁTICO: los días 15 y 30 de cada mes (el último día si el mes tiene menos de 30) se lanza
  // sola una edición nueva, salvo que el dueño lo haya apagado en Configuración (automatico:false).
  const hoy = fechaNic()
  const dia = Number(hoy.slice(8, 10))
  const ultimoDia = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 0)).getUTCDate()
  const toca = dia === 15 || dia === Math.min(30, ultimoDia)
  if (toca && c?.automatico !== false && !(c?.activa && !c.completa) && c?.id !== `redes-${hoy}`) {
    c = { ...(c ?? {}), id: `redes-${hoy}`, activa: true, completa: false, creada: new Date().toISOString(), completada: null, enviados: 0, total: null, origen: 'automatico' }
    const { error: eNueva } = await db.from('configuracion').upsert({ clave: 'campana_redes', valor_json: c }, { onConflict: 'clave' })
    if (eNueva) throw new Error(eNueva.message)
  }
  if (!c?.id || !c.activa || c.completa) return 0
  const { data: subs, error } = await db.from('suscriptores').select('correo, nombre').eq('activo', true).eq('consentimiento', true).limit(5000)
  if (error) throw new Error(error.message)
  const base = (process.env.CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')
  let enviados = 0, quedan = false
  for (const s of subs ?? []) {
    const correo = String(s.correo ?? '').trim().toLowerCase()
    if (!correo) continue
    if (enviados >= NOV_POR_VUELTA) { quedan = true; break }
    const reserva = await reservarEmail({ clave: `campana:${c.id}:${correo}`, tipo: 'campana_redes', destinatario: correo })
    if (reserva.duplicado) continue
    try {
      const { data: tok, error: eTok } = await db.rpc('token_baja_suscriptor', { p_correo: correo })
      if (eTok || !tok) throw new Error(eTok?.message || 'sin código de baja') // sin enlace de baja no se manda
      await enviarCorreoRedes({ correo, nombre: s.nombre, urlBaja: `${base}/baja/?e=${encodeURIComponent(correo)}&t=${tok}` })
      await cerrarEmail(reserva.id); enviados++
    } catch (e) { await cerrarEmail(reserva.id, e?.message || 'error'); console.error('auto campaña redes: falló', correo, e?.message); quedan = true; break }
  }
  const total = Number(c.enviados || 0) + enviados
  await db.from('configuracion').upsert({ clave: 'campana_redes', valor_json: quedan ? { ...c, enviados: total } : { ...c, enviados: total, activa: false, completa: true, completada: new Date().toISOString() } }, { onConflict: 'clave' })
  return enviados
}

// AVISO DE GASTOS FIJOS: un día antes de cada gasto fijo (en horario de 9 a 20 h) le llega al
// dueño un correo con lo que se paga mañana y si el fondo está completo o cuánto falta. Uno por día.
async function avisoGastosFijos(db) {
  if (!horarioCliente()) return 0
  const to = (process.env.AVISO_ADMIN || process.env.SMTP_USER || '').trim()
  if (!to) return 0
  const { fecha, items } = await gastosFijosDeManana(db)
  if (!items.length) return 0
  const ok = await unaVez(`fijo-aviso:${fecha}`, 'aviso_gasto_fijo', { destinatario: to }, () => enviarCorreoAvisoGastosFijos({ to, fecha, items }))
  return ok ? items.length : 0
}

// Productos de la tienda que se ven mal: sin foto, o de ropa/calzado sin tallas. Para el reporte.
async function productosIncompletos() {
  try {
    const lista = (await obtenerCatalogoMergeado()).filter((p) => !/^LIB\d/i.test(String(p.codigo || '')))
    return lista.map((p) => {
      const faltas = []
      if (!String(p.imagen || '').trim()) faltas.push('sin foto')
      if (!(p.tallas ?? []).length && !/accesor|decora/i.test(String(p.categoria || ''))) faltas.push('sin tallas')
      return faltas.length ? { codigo: p.codigo, nombre: p.nombre, faltas: faltas.join(' y ') } : null
    }).filter(Boolean)
  } catch { return [] }
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
    rango(db.from('email_eventos').select('tipo').in('tipo', ['recordatorio_saldo', 'recompra', 'recordatorio_resena', 'carrito_abandonado', 'baja_precio', 'respaldo', 'novedades']).not('enviado_at', 'is', null)),
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
  const NOMBRE = { recordatorio_saldo: 'saldo', recompra: 'volver a comprar', recordatorio_resena: 'reseña', carrito_abandonado: 'carrito abandonado', baja_precio: 'bajó de precio', respaldo: 'respaldo semanal guardado', novedades: 'novedades a suscriptores' }

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
    incompletos: await productosIncompletos(),
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
  await paso('baja_precio', bajaPrecioFavoritos)
  await paso('respaldo', respaldoSemanal)
  await paso('novedades', novedades)
  await paso('campana_redes', campanaRedes)
  await paso('aviso_gastos_fijos', avisoGastosFijos)
  return res
}
