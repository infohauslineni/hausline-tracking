import { Check, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { ESTADOS_PEDIDO } from '../../constants/orders'
import { aprenderCostoDeCodigo, esLineaEnvio, pagarProveedorLote, type LineaPagoLote } from '../../services/pedidos.service'
import { abonarInversion, actualizarInversion, listarInversiones, obtenerTipoCambio, pagarVariasCompras } from '../../services/comercial.service'
import { listarSaldosProveedor, marcarAdelantoPedido, pagarSaldoProveedor, type SaldoProveedor } from '../../services/saldoProveedor.service'
import type { EstadoPedido, Inversion, Pedido, PedidoItem } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { pagadoInversion, porPagarInversion } from '../../utils/compraPago'
import { repartir } from '../../utils/repartoCompra'
import { CuentaSelect, type DestinoPago } from '../finanzas/CuentaSelect'
import { Modal } from '../ui/Modal'
import { mensajeError } from '../../utils/mensajeError'

// PAGAR AL PROVEEDOR VARIOS PRODUCTOS DE UNA VEZ (un solo envío por PayPal). Se eligen los
// productos, se pone el precio de cada uno y cuánto se manda en total; la comisión se reparte
// según el precio (el que cuesta más carga más) y a cada producto le queda su costo real.
// Ej.: productos por $460 y se mandan $483 → cada uno sale a su precio × 1.05.
// Entran los productos de pedidos y también las Compras libres que están "por pagar": a esas
// la comisión se les suma en gastos adicionales y quedan pagadas.
// PAGO EN PARTES: si el proveedor pide un adelanto (p. ej. 50 % ahora y el resto cuando el paquete
// está listo), se elige cuánto se paga ahora. A cada producto le queda anotado lo que falta: los
// pedidos vuelven a salir en "Saldos por pagar" y las compras libres siguen "por pagar" con su abono.

type Fila =
  | { tipo: 'pedido'; clave: string; itemId: string; pedido: Pedido; item: PedidoItem }
  | { tipo: 'libre'; clave: string; compra: Inversion; falta: number }
  | { tipo: 'saldo'; clave: string; pedido: Pedido; saldo: SaldoProveedor }
const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => `$${n.toFixed(2)}`
const costoCompra = (x: Inversion) => Number(x.costo_unitario) * Number(x.cantidad) + Number(x.gastos_adicionales)
const hoy = () => new Date().toISOString().slice(0, 10)

// QUÉ ENTRA EN LA LISTA: productos que todavía NO están ligados a ningún pago al proveedor,
// tengan o no costo cargado. El costo no sirve para decidirlo (se copia del catálogo al crear
// el pedido); lo que cuenta es el pago.
// • Pedidos: todo pago al proveedor (al crear el pedido, en su ficha, al pasar a En preparación
//   o en este lote) queda como un gasto "Proveedor" del pedido. Sin ese gasto, no está pagado.
//   Los pedidos que salieron de una Compra libre se pagan por la compra (van en su sección).
// • Estados: todos los activos antes de la entrega; "En preparación" solo con la casilla marcada.
const ESTADOS_FUERA = new Set<EstadoPedido>(['entregado', 'cancelado'])
const tienePagoProveedor = (p: Pedido) => (p.gastos ?? []).some((g) => /proveedor/i.test(g.categoria ?? '') && Number(g.monto) > 0)
const etiquetaEstado = (e: EstadoPedido) => ESTADOS_PEDIDO.find((x) => x.value === e)?.label ?? e.replace(/_/g, ' ')
const costoItem = (it: PedidoItem) => Number(it.precio_compra || 0)

const productosDe = (p: Pedido) => (p.pedido_items ?? []).filter((it) => !esLineaEnvio(it))
const nombreDe = (f: Fila) => f.tipo === 'pedido' ? f.item.producto : f.tipo === 'saldo' ? productosDe(f.pedido).map((it) => `${it.producto}${it.talla ? ` (${it.talla})` : ''}`).join(', ') || f.pedido.codigo : f.compra.producto
const imagenDe = (f: Fila) => resolverImagenCatalogo(f.tipo === 'pedido' ? f.item.imagen : f.tipo === 'saldo' ? productosDe(f.pedido)[0]?.imagen : f.compra.imagen)
const detalleDe = (f: Fila) => f.tipo === 'saldo'
  ? `${f.pedido.codigo} · ${f.pedido.clientes?.nombre ?? 'Cliente'} · ya diste un adelanto, falta ${usd(f.saldo.saldo)}`
  : f.tipo === 'pedido'
  ? `${f.pedido.codigo} · ${f.pedido.clientes?.nombre ?? 'Cliente'}${f.item.talla ? ` · Talla ${f.item.talla}` : ''}${Number(f.item.cantidad) > 1 ? ` · ${f.item.cantidad}×` : ''}${f.pedido.estado !== 'pedido_confirmado' ? ` · ${etiquetaEstado(f.pedido.estado)}` : ''}${costoItem(f.item) > 0 ? '' : ' · sin costo, escribí el precio'}`
  : `Compra libre${f.compra.codigo ? ` · ${f.compra.codigo}` : ''}${f.compra.talla_color ? ` · ${f.compra.talla_color}` : ''}${Number(f.compra.cantidad) > 1 ? ` · ${f.compra.cantidad}×` : ''} · ${f.falta > 0.005 ? `debe ${usd(f.falta)}${pagadoInversion(f.compra, costoCompra(f.compra)) > 0.005 ? ' (ya diste un adelanto)' : ''}` : 'sin costo, escribí el precio'}`
const textoBusqueda = (f: Fila) => (f.tipo === 'saldo' ? `saldo ${f.pedido.codigo} ${f.pedido.clientes?.nombre ?? ''} ${nombreDe(f)}` : f.tipo === 'pedido'
  ? `${f.pedido.codigo} ${f.pedido.clientes?.nombre ?? ''} ${f.item.producto} ${f.item.codigo_producto ?? ''}`
  : `compra libre ${f.compra.codigo ?? ''} ${f.compra.producto} ${f.compra.talla_color ?? ''}`).toLowerCase()

export function PagoProveedorLoteModal({ open, pedidos, onClose, onPagado }: { open: boolean; pedidos: Pedido[]; onClose: () => void; onPagado: () => void }) {
  const [verPreparacion, setVerPreparacion] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [precios, setPrecios] = useState<Record<string, string>>({})
  const [total, setTotal] = useState('')
  const [metodo, setMetodo] = useState('PayPal')
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [pasar, setPasar] = useState(true)
  const [tipoCambio, setTipoCambio] = useState(36.6)
  const [guardando, setGuardando] = useState(false)
  const [libres, setLibres] = useState<Inversion[]>([])
  // Pedidos que salieron de una Compra libre: su pago al proveedor va por la compra.
  const [pedidosDeCompra, setPedidosDeCompra] = useState<Set<string>>(new Set())
  // Pedidos con un adelanto ya dado (falta el resto) y cuánto se paga ahora (100 = todo).
  const [saldos, setSaldos] = useState<SaldoProveedor[]>([])
  const [pct, setPct] = useState('100')

  const filasPedidos = useMemo<Fila[]>(() => pedidos
    .filter((p) => !ESTADOS_FUERA.has(p.estado) && (p.estado !== 'en_preparacion' || verPreparacion) && !tienePagoProveedor(p) && !pedidosDeCompra.has(p.id))
    .sort((a, b) => String(a.fecha_pedido).localeCompare(String(b.fecha_pedido)))
    .flatMap((p) => (p.pedido_items ?? []).filter((it) => it.id && !esLineaEnvio(it)).map((it) => ({ tipo: 'pedido' as const, clave: it.id!, itemId: it.id!, pedido: p, item: it }))), [pedidos, verPreparacion, pedidosDeCompra])
  // Compras libres marcadas "Por pagar" (el mismo criterio que la tarjeta en Compras libres), las
  // más viejas primero. Entran aunque el saldo dé $0 (p. ej. registrada sin costo): ahí se escribe el precio.
  const filasLibres = useMemo<Fila[]>(() => libres
    .map((c) => ({ tipo: 'libre' as const, clave: `libre:${c.id}`, compra: c, falta: porPagarInversion(c, costoCompra(c)) }))
    .sort((a, b) => a.compra.fecha.localeCompare(b.compra.fecha)), [libres])
  const filasSaldos = useMemo<Fila[]>(() => saldos.flatMap((s) => { const pedido = pedidos.find((p) => p.id === s.pedidoId); return pedido ? [{ tipo: 'saldo' as const, clave: `saldo:${s.gastoId}`, pedido, saldo: s }] : [] }), [saldos, pedidos])
  const filas = useMemo(() => [...filasPedidos, ...filasSaldos, ...filasLibres], [filasPedidos, filasSaldos, filasLibres])

  // Al abrir: limpia todo y carga las Compras libres por pagar. En las compras libres el precio
  // propuesto es lo que falta pagar (si no tienen costo, queda vacío para escribirlo).
  useEffect(() => {
    if (!open) return
    setElegidos(new Set()); setTotal(''); setBusqueda(''); setMetodo('PayPal'); setDestino({ cuentaId: null, montoCuenta: 0 }); setPasar(true); setLibres([]); setPrecios({}); setSaldos([]); setPct('100')
    if (isSupabaseConfigured) void listarSaldosProveedor().then((lista) => {
      setSaldos(lista)
      setPrecios((act) => { const sig = { ...act }; for (const s of lista) if (!sig[`saldo:${s.gastoId}`]) sig[`saldo:${s.gastoId}`] = String(s.saldo); return sig })
    }).catch(() => undefined)
    if (isSupabaseConfigured) void obtenerTipoCambio().then((t) => { if (t) setTipoCambio(t) }).catch(() => undefined)
    if (isSupabaseConfigured) void listarInversiones().then((lista) => {
      setPedidosDeCompra(new Set(lista.flatMap((c) => (c.pedido_id ? [c.pedido_id] : []))))
      const deben = lista.filter((c) => c.pagado === false && c.estado !== 'descartado')
      setLibres(deben)
      setPrecios((act) => {
        const sig = { ...act }
        for (const c of deben) { const falta = porPagarInversion(c, costoCompra(c)); if (falta > 0.005 && !sig[`libre:${c.id}`]) sig[`libre:${c.id}`] = String(falta) }
        return sig
      })
    }).catch(() => toast.error('No se pudieron cargar las Compras libres por pagar.'))
  }, [open])
  const term = busqueda.trim().toLowerCase()
  const visibles = term ? filas.filter((f) => textoBusqueda(f).includes(term)) : filas
  const seleccion = filas.filter((f) => elegidos.has(f.clave))
  // Precio de cada producto: lo escrito; si todavía no se tocó, el costo de proveedor que ya
  // tiene (como antes). Con costo 0 o sin costo queda VACÍO para escribirlo a mano.
  const valorPrecio = (f: Fila) => (f.clave in precios ? precios[f.clave] : f.tipo === 'pedido' && costoItem(f.item) > 0 ? String(r2(costoItem(f.item) * Number(f.item.cantidad || 1))) : '')
  const precioDe = (f: Fila) => Math.max(0, Number(String(valorPrecio(f)).replace(',', '.')) || 0)
  const suma = r2(seleccion.reduce((s, f) => s + precioDe(f), 0))
  // Pago en partes: de cada producto se paga ahora ese % de su precio; lo demás queda debiendo.
  const pctNum = Math.min(100, Math.max(1, Number(pct.replace(',', '.')) || 100)) / 100
  const parcial = pctNum < 0.9999
  const ahoraDe = (f: Fila) => r2(precioDe(f) * pctNum)
  const quedaDe = (f: Fila) => r2(precioDe(f) - ahoraDe(f))
  const sumaAhora = r2(seleccion.reduce((s, f) => s + ahoraDe(f), 0))
  const sumaQueda = r2(suma - sumaAhora)
  const totalUsd = Math.max(0, Number(total.replace(',', '.')) || 0)
  const comision = r2(totalUsd - sumaAhora)
  // Lo que se manda por cada producto (su parte + su comisión) y su costo: lo mandado + lo que falta.
  const partes = totalUsd > 0 && sumaAhora > 0 ? repartir(totalUsd, seleccion.map(ahoraDe)) : []
  const enviadoDe = new Map(seleccion.map((f, i) => [f.clave, partes[i] ?? ahoraDe(f)]))
  const costoDe = new Map(seleccion.map((f) => [f.clave, r2((enviadoDe.get(f.clave) ?? 0) + quedaDe(f))]))
  const sinPrecio = seleccion.filter((f) => precioDe(f) <= 0)
  const hayPedidos = seleccion.some((f) => f.tipo === 'pedido')
  // Lo que ya le debés al proveedor: saldos de pedidos con adelanto + compras libres por pagar.
  const deudaSaldos = r2(saldos.reduce((s, x) => s + x.saldo, 0))
  const deudaLibres = r2(filasLibres.reduce((s, f) => s + (f.tipo === 'libre' ? f.falta : 0), 0))
  const deuda = r2(deudaSaldos + deudaLibres)
  const pagoTotalAhora = totalUsd > 0 ? totalUsd : sumaAhora

  const alternar = (clave: string) => setElegidos((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n })
  const todos = visibles.length > 0 && visibles.every((f) => elegidos.has(f.clave))
  const alternarTodos = () => setElegidos((s) => { const n = new Set(s); for (const f of visibles) { if (todos) n.delete(f.clave); else n.add(f.clave) } return n })

  const guardar = async () => {
    if (!seleccion.length) return toast.error('Elegí los productos que vas a pagar.')
    if (sinPrecio.length) return toast.error(`Falta el precio de: ${sinPrecio.map(nombreDe).join(', ')}`)
    if (totalUsd <= 0) return toast.error('Escribí cuánto vas a mandar en total (con la comisión).')
    if (totalUsd < sumaAhora) return toast.error(parcial ? `El total que mandás es menor que el ${Math.round(pctNum * 100)} % de los productos. Revisá los precios.` : 'El total que mandás es menor que la suma de los productos. Revisá los precios.')
    if (!destino.cuentaId) return toast.error('Elegí de qué cuenta sale el pago.')
    setGuardando(true)
    // Cada pedido y cada compra libre se registra por separado: si uno falla, los demás quedan
    // pagados y el que falló sigue en la lista con el motivo (no se pierde todo el pago).
    const hechas = new Set<string>()
    const fallas: string[] = []
    try {
      const dePedidos = seleccion.flatMap((f) => f.tipo === 'pedido' ? [f] : [])
      const deLibres = seleccion.flatMap((f) => f.tipo === 'libre' ? [f] : [])
      const deSaldos = seleccion.flatMap((f) => f.tipo === 'saldo' ? [f] : [])
      // Lo que sale de la cuenta (puede estar en C$) se reparte entre todos según lo que se manda por cada uno.
      const cuentaDe = new Map<string, number>()
      { let ac = 0; seleccion.forEach((f, i) => { const v = i === seleccion.length - 1 ? r2(destino.montoCuenta - ac) : r2(destino.montoCuenta * (enviadoDe.get(f.clave) ?? 0) / totalUsd); ac = r2(ac + v); cuentaDe.set(f.clave, v) }) }
      const suma = (fs: Fila[], m: Map<string, number>) => r2(fs.reduce((s, f) => s + (m.get(f.clave) ?? 0), 0))
      let pedidosPagados = 0

      // 1) Pedidos (los productos de un mismo pedido van juntos).
      const grupos = new Map<string, Fila[]>()
      for (const f of dePedidos) if (f.tipo === 'pedido') grupos.set(f.pedido.id, [...(grupos.get(f.pedido.id) ?? []), f])
      for (const [pedidoId, fs] of grupos) {
        const pedido = fs[0].tipo === 'pedido' ? fs[0].pedido : null
        try {
          if (isSupabaseConfigured) {
            const lineas: LineaPagoLote[] = fs.flatMap((f) => f.tipo === 'pedido' ? [{ itemId: f.itemId, pedidoId, cantidad: Number(f.item.cantidad || 1), costoTotal: costoDe.get(f.clave) ?? 0 }] : [])
            await pagarProveedorLote(lineas, pedidos, { cuentaId: destino.cuentaId, montoCuentaTotal: suma(fs, cuentaDe), totalUsd: suma(fs, costoDe), metodo, pasarAPreparacion: pasar })
            // Pago en partes: al pedido le queda anotado lo que falta de sus productos.
            const falta = r2(fs.reduce((s, f) => s + quedaDe(f), 0))
            if (parcial && falta > 0.005) await marcarAdelantoPedido(pedidoId, falta)
          }
          fs.forEach((f) => hechas.add(f.clave)); pedidosPagados++
        } catch (e) { fallas.push(`${pedido?.codigo ?? 'Pedido'}: ${mensajeError(e)}`) }
      }

      // 2) Saldos de pedidos que ya tenían un adelanto.
      for (const f of deSaldos) {
        if (f.tipo !== 'saldo') continue
        try {
          if (isSupabaseConfigured) await pagarSaldoProveedor(f.saldo.gastoId, { pago: ahoraDe(f), comision: r2((enviadoDe.get(f.clave) ?? 0) - ahoraDe(f)), cuentaId: destino.cuentaId, montoCuenta: cuentaDe.get(f.clave) ?? 0, metodo })
          hechas.add(f.clave)
        } catch (e) { fallas.push(`Saldo ${f.pedido.codigo}: ${mensajeError(e)}`) }
      }

      // 3) Compras libres: la comisión (y la diferencia con lo que debía) sube su costo; se paga
      //    todo o, si es un adelanto, lo mandado queda como abono y sigue "por pagar" con lo que falta.
      for (const f of deLibres) {
        if (f.tipo !== 'libre') continue
        try {
          if (isSupabaseConfigured) {
            let compra = f.compra
            let debia = f.falta
            // Compra registrada sin costo: el precio que se escribió pasa a ser su costo (no "otros gastos").
            if (Number(compra.costo_unitario || 0) <= 0 && f.falta <= 0.005) {
              const cant = Math.max(1, Number(compra.cantidad) || 1)
              compra = await actualizarInversion(compra.id, { costo_unitario: r2(precioDe(f) / cant) })
              debia = r2(r2(precioDe(f) / cant) * cant)
            }
            const extra = r2((costoDe.get(f.clave) ?? debia) - debia)
            if (!parcial) await pagarVariasCompras([compra], [extra], { fecha: hoy(), metodo }, { cuentaId: destino.cuentaId, montoCuenta: cuentaDe.get(f.clave) ?? 0 })
            else {
              const actual = Math.abs(extra) > 0.004 ? await actualizarInversion(compra.id, { gastos_adicionales: r2(Number(compra.gastos_adicionales || 0) + extra) }) : compra
              await abonarInversion(actual, enviadoDe.get(f.clave) ?? 0, { fecha: hoy(), metodo }, { cuentaId: destino.cuentaId, montoCuenta: cuentaDe.get(f.clave) ?? 0 })
            }
            // Costo del producto en el catálogo: se pone si no tiene; si tiene, solo sube cuando este pago salió más caro.
            await aprenderCostoDeCodigo(compra.codigo, r2((costoDe.get(f.clave) ?? 0) / Math.max(1, Number(compra.cantidad) || 1)))
          }
          hechas.add(f.clave)
        } catch (e) { fallas.push(`${f.compra.producto}${f.compra.talla_color ? ` (${f.compra.talla_color})` : ''}: ${mensajeError(e)}`) }
      }

      const nLibres = deLibres.filter((f) => hechas.has(f.clave)).length
      const nSaldos = deSaldos.filter((f) => hechas.has(f.clave)).length
      const partesTexto = [
        pedidosPagados ? `${pedidosPagados} ${pedidosPagados === 1 ? 'pedido' : 'pedidos'}` : '',
        nSaldos ? `${nSaldos} ${nSaldos === 1 ? 'saldo' : 'saldos'} de pedidos` : '',
        nLibres ? `${nLibres} ${nLibres === 1 ? 'compra libre' : 'compras libres'}` : '',
      ].filter(Boolean).join(' y ')
      if (hechas.size) onPagado()
      if (!fallas.length) {
        toast.success(parcial
          ? `Adelanto registrado (${Math.round(pctNum * 100)} %): ${partesTexto}. Queda debiendo ${usd(sumaQueda)} al proveedor; lo pagás desde aquí cuando esté listo.`
          : `Pago completo registrado: ${partesTexto}. Cada uno ya tiene su costo con la comisión.`)
        onClose()
      } else {
        // Lo que sí se pagó sale de la selección; lo que falló queda elegido para reintentar.
        setElegidos((s) => { const n = new Set(s); hechas.forEach((c) => n.delete(c)); return n })
        setLibres((l) => l.filter((c) => !hechas.has(`libre:${c.id}`))); setSaldos((l) => l.filter((x) => !hechas.has(`saldo:${x.gastoId}`)))
        setTotal('')
        toast.error(`${hechas.size ? `Se registró: ${partesTexto}. ` : ''}No se pudo pagar: ${fallas.join(' · ')}`, { duration: 20000 })
      }
    } catch (error) { toast.error(`No se pudo registrar el pago: ${mensajeError(error)}`, { duration: 20000 }) }
    finally { setGuardando(false) }
  }

  return <Modal open={open} onClose={onClose} ancho="amplio" title="Pagar al proveedor" description="Elegí los productos que vas a pagar juntos (de pedidos y de Compras libres por pagar), poné el precio de cada uno y cuánto mandás en total por PayPal. Si el proveedor pide un adelanto, elegí cuánto pagás ahora (50 %, por ejemplo) y el resto queda pendiente.">
    <div className="space-y-4">
      {deuda > 0.005 && <div className="rounded-xl border border-amber-400/40 bg-amber-400/[0.07] p-3">
        <p className="flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold">Le debés al proveedor</span><b className="font-mono text-base text-amber-300">{usd(deuda)}</b></p>
        <p className="mt-0.5 text-xs text-muted">{[deudaSaldos > 0.005 ? `${usd(deudaSaldos)} de pedidos con adelanto (${saldos.length})` : '', deudaLibres > 0.005 ? `${usd(deudaLibres)} de compras libres por pagar (${filasLibres.length})` : ''].filter(Boolean).join(' · ')}. Están abajo en la lista: elegilos para pagarlos.</p>
      </div>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="search-input w-full pl-9" placeholder="Buscar pedido, cliente o producto" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={verPreparacion} onChange={(e) => setVerPreparacion(e.target.checked)} /> Ver también los que están En preparación</label>
      </div>

      {filas.length === 0 ? <p className="rounded-xl border border-line p-4 text-sm text-muted">No hay productos sin pago al proveedor: ni pedidos activos{verPreparacion ? '' : ' (sin contar los En preparación)'} ni Compras libres por pagar.</p> : <div className="rounded-xl border border-line">
        <button type="button" className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left text-xs font-semibold text-muted" onClick={alternarTodos}><span className={`grid size-5 place-items-center rounded border ${todos ? 'border-accent bg-accent text-black' : 'border-line'}`}>{todos && <Check size={13} />}</span>{todos ? 'Quitar todos' : `Elegir todos (${visibles.length})`}</button>
        <div className="max-h-[46vh] divide-y divide-line overflow-y-auto">
          {visibles.map((f, i) => {
            const on = elegidos.has(f.clave)
            const img = imagenDe(f)
            const costo = costoDe.get(f.clave)
            const primeraLibre = f.tipo === 'libre' && visibles[i - 1]?.tipo !== 'libre'
            const primerSaldo = f.tipo === 'saldo' && visibles[i - 1]?.tipo !== 'saldo'
            const enviadoFila = enviadoDe.get(f.clave)
            return <div key={f.clave}>
              {primerSaldo && <p className="bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Saldos por pagar (pedidos con adelanto)</p>}
              {primeraLibre && <p className="bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Compras libres por pagar</p>}
              <div className={`flex flex-wrap items-center gap-3 px-3 py-3 ${on ? 'bg-accent/[0.06]' : ''}`}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => alternar(f.clave)} aria-pressed={on}>
                  <span className={`grid size-5 shrink-0 place-items-center rounded border ${on ? 'border-accent bg-accent text-black' : 'border-line'}`}>{on && <Check size={13} />}</span>
                  {img ? <img src={img} alt="" className="size-11 shrink-0 rounded-lg border border-line object-cover" loading="lazy" /> : <span className="size-11 shrink-0 rounded-lg border border-line bg-white/[0.03]" />}
                  <span className="min-w-0"><strong className="block truncate text-sm">{nombreDe(f)}</strong><span className="block truncate text-xs text-muted">{detalleDe(f)}</span></span>
                </button>
                <div className="flex w-full items-center justify-end gap-3 pl-8 sm:w-auto sm:pl-0">
                  <label className="flex items-center gap-1.5 text-xs text-muted">Precio <input inputMode="decimal" className="simple-input w-24 text-right" placeholder="0.00" value={valorPrecio(f)} onChange={(e) => { setPrecios((p) => ({ ...p, [f.clave]: e.target.value })); if (!on) alternar(f.clave) }} /></label>
                  <span className="w-24 text-right text-xs">{on && parcial ? <><span className="block text-[10px] uppercase tracking-wide text-muted">Ahora</span><b className="font-mono text-sm">{usd(totalUsd > 0 && enviadoFila != null ? enviadoFila : ahoraDe(f))}</b><span className="block text-[10px] text-amber-300">queda {usd(quedaDe(f))}</span></> : on && costo != null && totalUsd > 0 ? <><span className="block text-[10px] uppercase tracking-wide text-muted">Costo real</span><b className="font-mono text-sm">{usd(costo)}</b></> : null}</span>
                </div>
              </div>
            </div>
          })}
        </div>
      </div>}

      <div className="rounded-xl border border-line bg-white/[0.02] p-4">
        <p className="text-sm font-semibold">¿Pagás completo o quedás debiendo?</p>
        <p className="mt-0.5 text-xs text-muted">Si el proveedor pide un adelanto y el resto cuando el paquete esté listo. Lo que falta queda anotado en cada producto.</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([['100', 'Completo'], ['50', '50 %']] as [string, string][]).map(([v, t]) => <button type="button" key={v} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${pct === v ? 'border-accent bg-accent/10 text-white' : 'border-line text-muted'}`} onClick={() => { setPct(v); setTotal('') }}>{t}</button>)}
          <label className={`flex items-center gap-1 rounded-xl border px-3 text-sm ${pct !== '100' && pct !== '50' ? 'border-accent bg-accent/10' : 'border-line'}`}><input inputMode="decimal" aria-label="Otro porcentaje" className="w-full min-w-0 bg-transparent py-2.5 text-center font-semibold outline-none" placeholder="Otro" value={pct === '100' || pct === '50' ? '' : pct} onChange={(e) => { setPct(e.target.value.replace(/[^\d.,]/g, '') || '100'); setTotal('') }} /><span className="text-muted">%</span></label>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-line bg-white/[0.02] p-4 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          <p className="flex justify-between"><span className="text-muted">Productos elegidos</span><b>{seleccion.length}</b></p>
          <p className="flex justify-between"><span className="text-muted">Suma de los precios</span><b className="font-mono">{usd(suma)}</b></p>
          {seleccion.length > 0 && <p className="flex justify-between"><span className="text-muted">Pagás ahora{parcial ? ` (${Math.round(pctNum * 100)} %)` : ''}{totalUsd > 0 ? ', con comisión' : ''}</span><b className="font-mono text-emerald-400">{usd(pagoTotalAhora)}</b></p>}
          {seleccion.length > 0 && <p className="flex justify-between"><span className="text-muted">Te queda debiendo de esto</span><b className={`font-mono ${sumaQueda > 0.005 ? 'text-amber-300' : 'text-muted'}`}>{usd(sumaQueda)}</b></p>}
          {totalUsd > 0 && sumaAhora > 0 && <p className="flex justify-between"><span className="text-muted">Comisión repartida</span><b className={`font-mono ${comision < 0 ? 'text-red-400' : ''}`}>{usd(comision)} ({((totalUsd / sumaAhora - 1) * 100).toFixed(1)} %)</b></p>}
        </div>
        <div className="space-y-2">
          <label className="form-field"><span>{parcial ? 'Lo que mandás AHORA por PayPal (con la comisión)' : 'Total que mandás por PayPal (con la comisión)'}</span><input inputMode="decimal" placeholder={sumaAhora > 0 ? r2(sumaAhora * 1.05).toFixed(2) : '0.00'} value={total} onChange={(e) => setTotal(e.target.value)} /></label>
          {sumaAhora > 0 && <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setTotal(r2(sumaAhora * 1.05).toFixed(2))}>Usar {usd(r2(sumaAhora * 1.05))} ({parcial ? `${Math.round(pctNum * 100)} % del precio` : 'precio'} + 5 % de PayPal)</button>}
        </div>
      </div>

      <div className="form-grid">
        <label className="form-field"><span>Método</span><input value={metodo} onChange={(e) => setMetodo(e.target.value)} /></label>
        <CuentaSelect requerido montoUsd={totalUsd} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" proposito="comprar" />
        {(hayPedidos || !seleccion.length) && <label className="col-span-full flex items-center gap-2 text-sm"><input type="checkbox" checked={pasar} onChange={(e) => setPasar(e.target.checked)} /> Pasar esos pedidos a <b>En preparación</b></label>}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <button type="button" className="subtle-button" disabled={guardando} onClick={onClose}>Cancelar</button>
        <button type="button" className="primary-button px-5" disabled={guardando || !seleccion.length} onClick={() => void guardar()}>{guardando ? 'Registrando…' : `Registrar ${parcial ? 'adelanto' : 'pago'}${totalUsd > 0 ? ` de ${usd(totalUsd)}` : ''}`}</button>
      </div>
    </div>
  </Modal>
}
