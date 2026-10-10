// FONDO DE GASTOS FIJOS, del lado del servidor: para avisarle al dueño UN DÍA ANTES de cada gasto
// fijo si el dinero ya está completo o cuánto falta. ESPEJO de la lógica del panel:
//   src/services/miGanancia.service.ts (ganancia del dueño / parte del negocio / fondo),
//   src/utils/reparto.ts + src/utils/pedidoCosto.ts (ganancia de cada pedido entregado),
//   src/services/gastosFijos.service.ts (fechas de los gastos fijos).
// Si se cambia una regla allá, hay que cambiarla aquí. (El guion bajo evita que Vercel lo
// publique como función.)

const NIC = -6 * 3_600_000
const MARCA_GANANCIA = '[DE_MI_GANANCIA]'
const dos = (n) => String(n).padStart(2, '0')
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100
const entre = (v, min, max) => Math.min(max, Math.max(min, v))
const uno = (v) => (Array.isArray(v) ? v[0] : v) ?? null
const hoyNic = () => new Date(Date.now() + NIC).toISOString().slice(0, 10)
const diaNic = (v) => { const s = String(v ?? ''); if (s.length <= 10) return s; const t = new Date(s).getTime(); return Number.isNaN(t) ? s.slice(0, 10) : new Date(t + NIC).toISOString().slice(0, 10) }
const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// Día en que cae un gasto fijo en un mes: el 31 en abril es el 30, en febrero el 28 o 29.
export function diaEnMes(dia, mes) {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Math.min(Math.max(1, Math.round(Number(dia)) || 1), ultimo)
}

const ENVIO_CLIENTE = ['Envío / delivery', 'Delivery cobrado al cliente']
// Parte del negocio y del dueño que YA entró de un pedido entregado (por lo cobrado).
function repartoPedido(p, pct) {
  const items = Array.isArray(p.pedido_items) ? p.pedido_items : []
  const gastos = Array.isArray(p.gastos) ? p.gastos : []
  const costoItem = (it) => { const c = uno(it.pedido_item_costos) ?? {}; return Number(c.precio_compra || 0) + Number(c.envio_internacional || 0) + Number(c.costo_delivery || 0) + Number(c.otros_gastos || 0) }
  const gastosTotal = gastos.reduce((s, g) => s + Number(g.monto || 0), 0)
  const itemsTotal = items.reduce((s, it) => s + Number(it.cantidad || 1) * costoItem(it), 0)
  const conProveedor = gastos.some((g) => String(g.categoria ?? '').toLowerCase().includes('proveedor'))
  const costo = conProveedor ? gastosTotal : itemsTotal + gastosTotal
  const hayCosto = gastos.some((g) => Number(g.monto || 0) > 0) || items.some((it) => costoItem(it) > 0)
  if (!hayCosto) return null // sin costo registrado no se puede calcular
  const envio = items.filter((it) => ENVIO_CLIENTE.includes(String(it.producto ?? '').trim())).reduce((s, it) => s + Number(it.cantidad || 1) * Number(it.precio_unitario || 0), 0)
  const total = Number(p.total || 0)
  const base = Math.max(0, r2(total - envio - costo))
  const cobrado = entre(Number(p.abono || 0), 0, total)
  const realizada = r2(entre(cobrado - costo - envio, 0, base))
  const negocio = r2((realizada * pct) / 100)
  return { negocio, dueno: r2(realizada - negocio) }
}

// Cuánto hay de verdad en cada "bolsa" (negocio / dueño) desde la fecha de arranque.
async function bolsas(db) {
  const { data: cfg } = await db.from('configuracion').select('clave, valor_json').in('clave', ['finanzas', 'gastos_fijos', 'moneda'])
  const de = (clave) => (cfg ?? []).find((c) => c.clave === clave)?.valor_json
  const fin = de('finanzas') ?? {}
  const desde = fin.ganancia_desde || '2026-10-10'
  const pct = Number(fin.porcentaje_reserva_negocio ?? 60)
  const tc = Number(de('moneda')?.tipo_cambio) > 0 ? Number(de('moneda').tipo_cambio) : 37
  const fijos = Array.isArray(de('gastos_fijos')) ? de('gastos_fijos') : []
  const corte = `${desde}T06:00:00Z` // 12 a. m. de ese día en Nicaragua

  const [pedidos, ventas, gastos, retiros] = await Promise.all([
    db.from('pedidos').select('id, total, abono, estado, fecha_entrega, updated_at, pedido_items(producto, cantidad, precio_unitario, pedido_item_costos(precio_compra, envio_internacional, costo_delivery, otros_gastos)), gastos(monto, categoria)')
      .eq('activo', true).eq('estado', 'entregado').gte('updated_at', corte).limit(3000),
    db.from('movimientos_cuenta').select('fecha, monto, inversiones(costo_unitario, cantidad, gastos_adicionales)').eq('tipo', 'ingreso').not('inversion_id', 'is', null).gte('fecha', corte).limit(3000),
    db.from('gastos').select('fecha, monto, pedido_id, inversion_id, observaciones').gte('fecha', desde).limit(5000),
    db.from('movimientos_cuenta').select('fecha, monto').eq('tipo', 'retiro').gte('fecha', corte).limit(3000),
  ])
  for (const r of [pedidos, ventas, gastos, retiros]) if (r.error) throw new Error(r.error.message)

  let negocio = 0, dueno = 0
  for (const p of pedidos.data ?? []) {
    if (diaNic(p.fecha_entrega ?? p.updated_at) < desde) continue
    const r = repartoPedido(p, pct)
    if (r) { negocio += r.negocio; dueno += r.dueno }
  }
  for (const v of ventas.data ?? []) {
    if (diaNic(v.fecha) < desde) continue
    const inv = uno(v.inversiones)
    const costo = inv ? Number(inv.costo_unitario || 0) * Number(inv.cantidad || 0) + Number(inv.gastos_adicionales || 0) : 0
    const g = Math.max(0, Number(v.monto || 0) - costo)
    const parte = r2((g * pct) / 100)
    negocio += parte; dueno += g - parte
  }
  let gastado = 0, negocioGastado = 0
  for (const g of gastos.data ?? []) {
    if (diaNic(g.fecha) < desde) continue
    const deGanancia = String(g.observaciones ?? '').includes(MARCA_GANANCIA)
    if (deGanancia) gastado += Number(g.monto || 0)
    else if (!g.pedido_id && !g.inversion_id) negocioGastado += Number(g.monto || 0)
  }
  const retirado = (retiros.data ?? []).filter((m) => diaNic(m.fecha) >= desde).reduce((s, m) => s + Number(m.monto || 0), 0)
  return { fijos, tc, negocioNeto: r2(negocio - negocioGastado), duenoNeto: r2(dueno - gastado - retirado) }
}

// Gastos fijos que se pagan MAÑANA (hora de Nicaragua), con cuánto de cada uno ya está guardado.
// El dinero de cada bolsa se reparte entre los fijos pendientes del mes en orden de fecha.
export async function gastosFijosDeManana(db) {
  const manana = sumarDias(hoyNic(), 1)
  const mes = manana.slice(0, 7)
  const diaM = Number(manana.slice(8, 10))
  const { fijos, tc, negocioNeto, duenoNeto } = await bolsas(db)
  const pendientes = fijos
    .filter((g) => g && g.activo && String(g.desde ?? '') <= mes && !(g.ultimo && g.ultimo >= mes))
    .map((g) => ({ g, dia: diaEnMes(g.dia, mes), usd: r2(g.moneda === 'NIO' ? Number(g.monto || 0) / tc : Number(g.monto || 0)) }))
    .sort((a, b) => a.dia - b.dia)
  if (!pendientes.some((p) => p.dia === diaM)) return { fecha: manana, items: [] }
  const { data: cuentas } = await db.from('cuentas_bancarias').select('id, nombre, moneda, saldo')
  let bolsaNegocio = Math.max(0, negocioNeto), bolsaDueno = Math.max(0, duenoNeto)
  const items = []
  for (const p of pendientes) {
    const disponible = p.g.deGanancia ? bolsaDueno : bolsaNegocio
    const cubierto = r2(Math.min(p.usd, disponible))
    if (p.g.deGanancia) bolsaDueno -= cubierto; else bolsaNegocio -= cubierto
    if (p.dia !== diaM) continue
    const cuenta = (cuentas ?? []).find((c) => c.id === p.g.cuentaId) ?? null
    // Lo que sale de la cuenta va en la moneda de ESA cuenta (igual que al registrarlo).
    const enCuenta = !cuenta ? null : cuenta.moneda === p.g.moneda ? Number(p.g.monto) : cuenta.moneda === 'NIO' ? Math.round(p.usd * tc) : p.usd
    items.push({
      descripcion: p.g.descripcion, categoria: p.g.categoria, deGanancia: Boolean(p.g.deGanancia), usd: p.usd, monto: Number(p.g.monto), moneda: p.g.moneda,
      cubierto, falta: r2(p.usd - cubierto),
      cuenta: cuenta ? { nombre: cuenta.nombre, moneda: cuenta.moneda, saldo: Number(cuenta.saldo || 0), necesita: enCuenta, alcanza: Number(cuenta.saldo || 0) + 0.005 >= enCuenta } : null,
    })
  }
  return { fecha: manana, items }
}
