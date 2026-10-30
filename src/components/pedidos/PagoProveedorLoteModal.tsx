import { Check, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { esLineaEnvio, pagarProveedorLote, type LineaPagoLote } from '../../services/pedidos.service'
import { obtenerTipoCambio } from '../../services/comercial.service'
import type { Pedido, PedidoItem } from '../../types/domain'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { repartir } from '../../utils/repartoCompra'
import { CuentaSelect, type DestinoPago } from '../finanzas/CuentaSelect'
import { Modal } from '../ui/Modal'

// PAGAR AL PROVEEDOR VARIOS PRODUCTOS DE UNA VEZ (un solo envío por PayPal). Se eligen los
// productos, se pone el precio de cada uno y cuánto se manda en total; la comisión se reparte
// según el precio (el que cuesta más carga más) y a cada producto de cada pedido le queda su
// costo real. Ej.: productos por $460 y se mandan $483 → cada uno sale a su precio × 1.05.

type Fila = { clave: string; itemId: string; pedido: Pedido; item: PedidoItem }
const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => `$${n.toFixed(2)}`

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

  const filas = useMemo<Fila[]>(() => pedidos
    .filter((p) => p.estado === 'pedido_confirmado' || (verPreparacion && p.estado === 'en_preparacion'))
    .sort((a, b) => String(a.fecha_pedido).localeCompare(String(b.fecha_pedido)))
    .flatMap((p) => (p.pedido_items ?? []).filter((it) => it.id && !esLineaEnvio(it)).map((it) => ({ clave: it.id!, itemId: it.id!, pedido: p, item: it }))), [pedidos, verPreparacion])

  // Al abrir: limpia y propone el precio de cada producto (el que ya tenía, o el del catálogo).
  useEffect(() => {
    if (!open) return
    setElegidos(new Set()); setTotal(''); setBusqueda(''); setMetodo('PayPal'); setDestino({ cuentaId: null, montoCuenta: 0 }); setPasar(true)
    if (isSupabaseConfigured) void obtenerTipoCambio().then((t) => { if (t) setTipoCambio(t) }).catch(() => undefined)
    const base: Record<string, string> = {}
    for (const f of filas) if (Number(f.item.precio_compra || 0) > 0) base[f.clave] = String(r2(Number(f.item.precio_compra) * Number(f.item.cantidad || 1)))
    setPrecios(base)
    const codigos = [...new Set(filas.filter((f) => !base[f.clave]).map((f) => (f.item.codigo_producto ?? '').trim().toUpperCase()).filter(Boolean))]
    if (!codigos.length || !supabase) return
    void supabase.from('productos').select('codigo, precio_compra').in('codigo', codigos).then(({ data }) => {
      const mapa = new Map((data ?? []).map((p: { codigo: string | null; precio_compra: number | null }) => [(p.codigo ?? '').trim().toUpperCase(), Number(p.precio_compra || 0)]))
      setPrecios((act) => {
        const sig = { ...act }
        for (const f of filas) { const c = mapa.get((f.item.codigo_producto ?? '').trim().toUpperCase()); if (!sig[f.clave] && c && c > 0) sig[f.clave] = String(r2(c * Number(f.item.cantidad || 1))) }
        return sig
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const term = busqueda.trim().toLowerCase()
  const visibles = term ? filas.filter((f) => `${f.pedido.codigo} ${f.pedido.clientes?.nombre ?? ''} ${f.item.producto} ${f.item.codigo_producto ?? ''}`.toLowerCase().includes(term)) : filas
  const seleccion = filas.filter((f) => elegidos.has(f.clave))
  const precioDe = (f: Fila) => Math.max(0, Number(String(precios[f.clave] ?? '').replace(',', '.')) || 0)
  const suma = r2(seleccion.reduce((s, f) => s + precioDe(f), 0))
  const totalUsd = Math.max(0, Number(total.replace(',', '.')) || 0)
  const comision = r2(totalUsd - suma)
  const partes = totalUsd > 0 && suma > 0 ? repartir(totalUsd, seleccion.map(precioDe)) : []
  const costoDe = new Map(seleccion.map((f, i) => [f.clave, partes[i] ?? precioDe(f)]))
  const sinPrecio = seleccion.filter((f) => precioDe(f) <= 0)

  const alternar = (clave: string) => setElegidos((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n })
  const todos = visibles.length > 0 && visibles.every((f) => elegidos.has(f.clave))
  const alternarTodos = () => setElegidos((s) => { const n = new Set(s); for (const f of visibles) { if (todos) n.delete(f.clave); else n.add(f.clave) } return n })

  const guardar = async () => {
    if (!seleccion.length) return toast.error('Elegí los productos que vas a pagar.')
    if (sinPrecio.length) return toast.error(`Falta el precio de: ${sinPrecio.map((f) => f.item.producto).join(', ')}`)
    if (totalUsd <= 0) return toast.error('Escribí cuánto vas a mandar en total (con la comisión).')
    if (totalUsd < suma) return toast.error('El total que mandás es menor que la suma de los productos. Revisá los precios.')
    if (!destino.cuentaId) return toast.error('Elegí de qué cuenta sale el pago.')
    setGuardando(true)
    try {
      const lineas: LineaPagoLote[] = seleccion.map((f) => ({ itemId: f.itemId, pedidoId: f.pedido.id, cantidad: Number(f.item.cantidad || 1), costoTotal: costoDe.get(f.clave) ?? 0 }))
      const codigos = isSupabaseConfigured ? await pagarProveedorLote(lineas, pedidos, { cuentaId: destino.cuentaId, montoCuentaTotal: destino.montoCuenta, totalUsd, metodo, pasarAPreparacion: pasar }) : []
      toast.success(`Pago registrado: ${seleccion.length} ${seleccion.length === 1 ? 'producto' : 'productos'} en ${codigos.length || new Set(lineas.map((l) => l.pedidoId)).size} ${codigos.length === 1 ? 'pedido' : 'pedidos'}. Cada uno ya tiene su costo con la comisión.`)
      onPagado(); onClose()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo registrar el pago.') }
    finally { setGuardando(false) }
  }

  return <Modal open={open} onClose={onClose} ancho="amplio" title="Pagar al proveedor" description="Elegí los productos que vas a pagar juntos, poné el precio de cada uno y cuánto mandás en total por PayPal. La comisión se reparte según el precio y a cada producto le queda su costo real.">
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="search-input w-full pl-9" placeholder="Buscar pedido, cliente o producto" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={verPreparacion} onChange={(e) => setVerPreparacion(e.target.checked)} /> Ver también los que están En preparación</label>
      </div>

      {filas.length === 0 ? <p className="rounded-xl border border-line p-4 text-sm text-muted">No hay pedidos en Orden confirmada esperando pago al proveedor.</p> : <div className="rounded-xl border border-line">
        <button type="button" className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left text-xs font-semibold text-muted" onClick={alternarTodos}><span className={`grid size-5 place-items-center rounded border ${todos ? 'border-accent bg-accent text-black' : 'border-line'}`}>{todos && <Check size={13} />}</span>{todos ? 'Quitar todos' : `Elegir todos (${visibles.length})`}</button>
        <div className="max-h-[46vh] divide-y divide-line overflow-y-auto">
          {visibles.map((f) => {
            const on = elegidos.has(f.clave)
            const img = resolverImagenCatalogo(f.item.imagen)
            const costo = costoDe.get(f.clave)
            return <div key={f.clave} className={`flex flex-wrap items-center gap-3 px-3 py-3 ${on ? 'bg-accent/[0.06]' : ''}`}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => alternar(f.clave)} aria-pressed={on}>
                <span className={`grid size-5 shrink-0 place-items-center rounded border ${on ? 'border-accent bg-accent text-black' : 'border-line'}`}>{on && <Check size={13} />}</span>
                {img ? <img src={img} alt="" className="size-11 shrink-0 rounded-lg border border-line object-cover" loading="lazy" /> : <span className="size-11 shrink-0 rounded-lg border border-line bg-white/[0.03]" />}
                <span className="min-w-0"><strong className="block truncate text-sm">{f.item.producto}</strong><span className="block truncate text-xs text-muted">{f.pedido.codigo} · {f.pedido.clientes?.nombre ?? 'Cliente'}{f.item.talla ? ` · Talla ${f.item.talla}` : ''}{Number(f.item.cantidad) > 1 ? ` · ${f.item.cantidad}×` : ''}{f.pedido.estado === 'en_preparacion' ? ' · En preparación' : ''}</span></span>
              </button>
              <div className="flex w-full items-center justify-end gap-3 pl-8 sm:w-auto sm:pl-0">
                <label className="flex items-center gap-1.5 text-xs text-muted">Precio <input inputMode="decimal" className="simple-input w-24 text-right" placeholder="0.00" value={precios[f.clave] ?? ''} onChange={(e) => { setPrecios((p) => ({ ...p, [f.clave]: e.target.value })); if (!on) alternar(f.clave) }} /></label>
                <span className="w-24 text-right text-xs">{on && costo != null && totalUsd > 0 ? <><span className="block text-[10px] uppercase tracking-wide text-muted">Costo real</span><b className="font-mono text-sm">{usd(costo)}</b></> : null}</span>
              </div>
            </div>
          })}
        </div>
      </div>}

      <div className="grid gap-3 rounded-xl border border-line bg-white/[0.02] p-4 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          <p className="flex justify-between"><span className="text-muted">Productos elegidos</span><b>{seleccion.length}</b></p>
          <p className="flex justify-between"><span className="text-muted">Suma de los precios</span><b className="font-mono">{usd(suma)}</b></p>
          {totalUsd > 0 && suma > 0 && <p className="flex justify-between"><span className="text-muted">Comisión repartida</span><b className={`font-mono ${comision < 0 ? 'text-red-400' : ''}`}>{usd(comision)} ({((totalUsd / suma - 1) * 100).toFixed(1)} %)</b></p>}
        </div>
        <div className="space-y-2">
          <label className="form-field"><span>Total que mandás por PayPal (con la comisión)</span><input inputMode="decimal" placeholder={suma > 0 ? r2(suma * 1.05).toFixed(2) : '0.00'} value={total} onChange={(e) => setTotal(e.target.value)} /></label>
          {suma > 0 && <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setTotal(r2(suma * 1.05).toFixed(2))}>Usar {usd(r2(suma * 1.05))} (precio + 5 % de PayPal)</button>}
        </div>
      </div>

      <div className="form-grid">
        <label className="form-field"><span>Método</span><input value={metodo} onChange={(e) => setMetodo(e.target.value)} /></label>
        <CuentaSelect requerido montoUsd={totalUsd} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" proposito="comprar" />
        <label className="col-span-full flex items-center gap-2 text-sm"><input type="checkbox" checked={pasar} onChange={(e) => setPasar(e.target.checked)} /> Pasar esos pedidos a <b>En preparación</b></label>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <button type="button" className="subtle-button" disabled={guardando} onClick={onClose}>Cancelar</button>
        <button type="button" className="primary-button px-5" disabled={guardando || !seleccion.length} onClick={() => void guardar()}>{guardando ? 'Registrando…' : `Registrar pago${totalUsd > 0 ? ` de ${usd(totalUsd)}` : ''}`}</button>
      </div>
    </div>
  </Modal>
}
