import { Check, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured } from '../../lib/supabase'
import { esLineaEnvio, repartirEnvioPedidos, type LineaEnvioLote } from '../../services/pedidos.service'
import { obtenerTipoCambio } from '../../services/comercial.service'
import type { Pedido, PedidoItem } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { MODOS_REPARTO, TIPOS_PRODUCTO, repartir, tipoDeProducto, type ModoReparto, type TipoProducto } from '../../utils/repartoCompra'
import { CuentaSelect, type DestinoPago } from '../finanzas/CuentaSelect'
import { Modal } from '../ui/Modal'

// REPARTIR EL ENVÍO DE UN PAQUETE entre los productos de los pedidos (encargos de clientes).
// Llega una caja con zapatos y camisas de varios pedidos y se paga un solo envío: se eligen los
// productos que venían, cada uno con su peso (ya propone 3 lb por par y 0.7 lb por prenda), y a
// cada pedido le queda su parte como gasto "Envío internacional" + el costo de cada producto.

type Fila = { clave: string; pedido: Pedido; item: PedidoItem }
const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`
const hoy = () => new Date().toISOString().slice(0, 10)
const num = (s: string | undefined) => Math.max(0, Number(String(s ?? '').replace(',', '.')) || 0)
const ACTIVOS: Pedido['estado'][] = ['en_preparacion', 'control_calidad', 'etiqueta_creada', 'despachado', 'transito_internacional', 'recibido_estados_unidos', 'transito_nicaragua', 'llego_nicaragua', 'disponible_entrega', 'pagado', 'empaquetado', 'incidencia']
const opcion = (activo: boolean) => `rounded-xl border px-3 py-2 text-left text-xs transition ${activo ? 'border-accent bg-accent/[.1]' : 'border-line text-muted hover:border-accent/50'}`

export function RepartirEnvioPedidosModal({ open, pedidos, onClose, onListo }: { open: boolean; pedidos: Pedido[]; onClose: () => void; onListo: () => void }) {
  const [verTodos, setVerTodos] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [tipos, setTipos] = useState<Record<string, TipoProducto>>({})
  const [libras, setLibras] = useState<Record<string, string>>({})
  const [modo, setModo] = useState<ModoReparto>('peso')
  const [total, setTotal] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [metodo, setMetodo] = useState('Transferencia')
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(36.6)
  const [guardando, setGuardando] = useState(false)

  const filas = useMemo<Fila[]>(() => pedidos
    .filter((p) => ACTIVOS.includes(p.estado) || (verTodos && p.estado !== 'cancelado'))
    .sort((a, b) => String(b.fecha_pedido).localeCompare(String(a.fecha_pedido)))
    .flatMap((p) => (p.pedido_items ?? []).filter((it) => it.id && !esLineaEnvio(it)).map((it) => ({ clave: it.id!, pedido: p, item: it }))), [pedidos, verTodos])

  // Al abrir: limpia y propone el tipo/peso de cada producto según su nombre.
  useEffect(() => {
    if (!open) return
    setElegidos(new Set()); setTotal(''); setBusqueda(''); setModo('peso'); setFecha(hoy()); setMetodo('Transferencia'); setDestino({ cuentaId: null, montoCuenta: 0 })
    if (isSupabaseConfigured) void obtenerTipoCambio().then((t) => { if (t) setTipoCambio(t) }).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => {
    if (!open) return
    setTipos((act) => { const sig = { ...act }; for (const f of filas) if (!sig[f.clave]) sig[f.clave] = tipoDeProducto(`${f.item.producto} ${f.item.categoria ?? ''}`); return sig })
    setLibras((act) => { const sig = { ...act }; for (const f of filas) if (sig[f.clave] == null) sig[f.clave] = String(r2(TIPOS_PRODUCTO[tipoDeProducto(`${f.item.producto} ${f.item.categoria ?? ''}`)].lb * Number(f.item.cantidad || 1))); return sig })
  }, [open, filas])

  const term = busqueda.trim().toLowerCase()
  const visibles = term ? filas.filter((f) => `${f.pedido.codigo} ${f.pedido.clientes?.nombre ?? ''} ${f.item.producto} ${f.item.codigo_producto ?? ''}`.toLowerCase().includes(term)) : filas
  const seleccion = filas.filter((f) => elegidos.has(f.clave))
  const totalUsd = num(total)
  const pesoTotal = r2(seleccion.reduce((s, f) => s + num(libras[f.clave]), 0))
  const pesos = seleccion.map((f) => (modo === 'igual' ? Number(f.item.cantidad || 1) : modo === 'peso' ? num(libras[f.clave]) : Number(f.item.precio_unitario || 0) * Number(f.item.cantidad || 1)))
  const partes = totalUsd > 0 ? repartir(totalUsd, pesos) : []
  const parteDe = new Map(seleccion.map((f, i) => [f.clave, partes[i] ?? 0]))
  const pedidosN = new Set(seleccion.map((f) => f.pedido.id)).size

  const alternar = (clave: string) => setElegidos((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n })
  const todos = visibles.length > 0 && visibles.every((f) => elegidos.has(f.clave))
  const alternarTodos = () => setElegidos((s) => { const n = new Set(s); for (const f of visibles) { if (todos) n.delete(f.clave); else n.add(f.clave) } return n })

  const guardar = async () => {
    if (!seleccion.length) return toast.error('Elegí los productos que venían en el paquete.')
    if (totalUsd <= 0) return toast.error('Escribí cuánto costó el envío del paquete.')
    if (modo === 'peso' && pesoTotal <= 0) return toast.error('Poné el peso de los productos (o elegí "Igual para todos").')
    if (!destino.cuentaId) return toast.error('Elegí de qué cuenta salió el pago del envío.')
    setGuardando(true)
    try {
      const lineas: LineaEnvioLote[] = seleccion.map((f) => ({ itemId: f.clave, pedidoId: f.pedido.id, cantidad: Number(f.item.cantidad || 1), monto: parteDe.get(f.clave) ?? 0, nombre: `${f.item.producto}${f.item.talla ? ` (${f.item.talla})` : ''}`, envioActual: Number(f.item.envio_internacional || 0) }))
      const codigos = isSupabaseConfigured ? await repartirEnvioPedidos(lineas, pedidos, { fecha, metodo, cuentaId: destino.cuentaId, montoCuentaTotal: destino.montoCuenta, totalUsd }) : []
      toast.success(`Envío de ${usd(totalUsd)} repartido entre ${seleccion.length} ${seleccion.length === 1 ? 'producto' : 'productos'} de ${codigos.length || pedidosN} ${(codigos.length || pedidosN) === 1 ? 'pedido' : 'pedidos'}.`)
      onListo(); onClose()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo repartir el envío.') }
    finally { setGuardando(false) }
  }

  return <Modal open={open} onClose={onClose} ancho="amplio" title="Repartir envío del paquete" description="Elegí los productos que vinieron en la misma caja y cuánto pagaste por traerla. Cada producto carga su parte según su peso y queda en el costo de su pedido.">
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="search-input w-full pl-9" placeholder="Buscar pedido, cliente o producto" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Ver también confirmados y entregados</label>
      </div>

      {filas.length === 0 ? <p className="rounded-xl border border-line p-4 text-sm text-muted">No hay pedidos en camino.</p> : <div className="rounded-xl border border-line">
        <button type="button" className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left text-xs font-semibold text-muted" onClick={alternarTodos}><span className={`grid size-5 place-items-center rounded border ${todos ? 'border-accent bg-accent text-black' : 'border-line'}`}>{todos && <Check size={13} />}</span>{todos ? 'Quitar todos' : `Elegir todos (${visibles.length})`}</button>
        <div className="max-h-[42vh] divide-y divide-line overflow-y-auto">
          {visibles.map((f) => {
            const on = elegidos.has(f.clave)
            const img = resolverImagenCatalogo(f.item.imagen)
            const yaTiene = Number(f.item.envio_internacional || 0)
            return <div key={f.clave} className={`flex flex-wrap items-center gap-3 px-3 py-3 ${on ? 'bg-accent/[0.06]' : ''}`}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => alternar(f.clave)} aria-pressed={on}>
                <span className={`grid size-5 shrink-0 place-items-center rounded border ${on ? 'border-accent bg-accent text-black' : 'border-line'}`}>{on && <Check size={13} />}</span>
                {img ? <img src={img} alt="" className="size-11 shrink-0 rounded-lg border border-line object-cover" loading="lazy" /> : <span className="size-11 shrink-0 rounded-lg border border-line bg-white/[0.03]" />}
                <span className="min-w-0"><strong className="block truncate text-sm">{f.item.producto}</strong>
                  <span className="block truncate text-xs text-muted">{f.pedido.codigo} · {f.pedido.clientes?.nombre ?? 'Cliente'}{f.item.talla ? ` · Talla ${f.item.talla}` : ''}{Number(f.item.cantidad) > 1 ? ` · ${f.item.cantidad}×` : ''}</span>
                  {yaTiene > 0 && <span className="block text-[11px] text-amber-500">Ya tiene {usd(yaTiene * Number(f.item.cantidad || 1))} de envío: esto se suma</span>}</span>
              </button>
              <div className="flex w-full items-center justify-end gap-2 pl-8 sm:w-auto sm:pl-0">
                {modo === 'peso' && <>
                  <select className="simple-input w-28! px-2!" value={tipos[f.clave] ?? 'zapatos'} aria-label="Tipo de producto" onChange={(e) => { const t = e.target.value as TipoProducto; setTipos((x) => ({ ...x, [f.clave]: t })); setLibras((x) => ({ ...x, [f.clave]: String(r2(TIPOS_PRODUCTO[t].lb * Number(f.item.cantidad || 1))) })); if (!on) alternar(f.clave) }}>
                    {(Object.keys(TIPOS_PRODUCTO) as TipoProducto[]).map((t) => <option key={t} value={t}>{TIPOS_PRODUCTO[t].label}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-muted"><input inputMode="decimal" className="simple-input w-16! text-right" value={libras[f.clave] ?? ''} aria-label="Peso en libras" onChange={(e) => { setLibras((x) => ({ ...x, [f.clave]: e.target.value })); if (!on) alternar(f.clave) }} />lb</label>
                </>}
                <span className="w-20 text-right text-xs">{on && totalUsd > 0 ? <><span className="block text-[10px] uppercase tracking-wide text-muted">Le toca</span><b className="font-mono text-sm">{usd(parteDe.get(f.clave) ?? 0)}</b></> : null}</span>
              </div>
            </div>
          })}
        </div>
      </div>}

      <div className="grid grid-cols-3 gap-2">{(['peso', 'igual', 'precio'] as ModoReparto[]).map((m) => <button type="button" key={m} className={opcion(modo === m)} onClick={() => setModo(m)}><strong className="block text-sm">{MODOS_REPARTO[m].titulo}</strong><span className="hidden sm:inline">{m === 'precio' ? 'El que se vende más caro carga más' : MODOS_REPARTO[m].ayuda}</span></button>)}</div>

      <div className="grid gap-3 rounded-xl border border-line bg-white/[0.02] p-4 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          <p className="flex justify-between"><span className="text-muted">Productos elegidos</span><b>{seleccion.length}{pedidosN > 0 ? ` · ${pedidosN} ${pedidosN === 1 ? 'pedido' : 'pedidos'}` : ''}</b></p>
          {modo === 'peso' && <p className="flex justify-between"><span className="text-muted">Peso total</span><b className="font-mono">{pesoTotal} lb</b></p>}
          {modo === 'peso' && totalUsd > 0 && pesoTotal > 0 && <p className="flex justify-between"><span className="text-muted">Sale a</span><b className="font-mono">{usd(totalUsd / pesoTotal)} por libra</b></p>}
        </div>
        <label className="form-field"><span>Costo del envío del paquete (US$)</span><input inputMode="decimal" placeholder="Ej. 40" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
      </div>

      <div className="form-grid">
        <label className="form-field"><span>Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="form-field"><span>Método</span><input value={metodo} onChange={(e) => setMetodo(e.target.value)} /></label>
        <CuentaSelect requerido montoUsd={totalUsd} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" proposito="comprar" label="¿De qué cuenta salió el envío?" />
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <button type="button" className="subtle-button" disabled={guardando} onClick={onClose}>Cancelar</button>
        <button type="button" className="primary-button px-5" disabled={guardando || !seleccion.length} onClick={() => void guardar()}>{guardando ? 'Guardando…' : `Repartir envío${totalUsd > 0 ? ` de ${usd(totalUsd)}` : ''}`}</button>
      </div>
    </div>
  </Modal>
}
