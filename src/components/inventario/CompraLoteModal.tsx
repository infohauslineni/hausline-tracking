import { Calculator, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { CuentaSelect, type DestinoPago } from '../finanzas/CuentaSelect'
import { obtenerTipoCambio, registrarCompraLibre, registrarEnvioCompras } from '../../services/comercial.service'
import type { Inversion, Producto } from '../../types/domain'
import { tallasDeTexto } from '../../utils/compraPago'
import { MODOS_REPARTO, TIPOS_PRODUCTO, nuevoLote, repartir, tipoDeProducto, type ModoReparto, type TipoProducto } from '../../utils/repartoCompra'

// COMPRA EN CONJUNTO: varios productos pagados en UN solo pago (con la comisión de PayPal
// incluida). Se escribe el total pagado y se reparte entre los productos: igual para todos o
// según el precio de cada uno. El envío a Nicaragua del paquete se reparte igual (por peso: los
// zapatos cargan más que las camisas). Se crea una compra por par/unidad, marcadas como un lote.
// El costo repartido NO se guarda en el catálogo: cambia de una compra a otra.

type Linea = { key: string; codigo: string; producto_id: string; producto: string; marca: string; tallas: string; cantidad: string; tipo: TipoProducto; lb: string; precioLista: string; precioVenta: string; imagen: string | null }
type Pago = 'ahora' | 'antes' | 'pendiente'
type Donde = 'en_inventario' | 'en_preparacion' | 'en_transito'

const nuevaLinea = (): Linea => ({ key: Math.random().toString(36).slice(2), codigo: '', producto_id: '', producto: '', marca: '', tallas: '', cantidad: '1', tipo: 'zapatos', lb: String(TIPOS_PRODUCTO.zapatos.lb), precioLista: '', precioVenta: '', imagen: null })
const usd = (n: number) => `$${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const hoy = () => new Date().toISOString().slice(0, 10)
// La comisión que se usó la última vez (por defecto 5 %: total = subtotal × 1.05).
const COMISION_KEY = 'hausline_comision_paypal'
const leerComision = () => { try { return localStorage.getItem(COMISION_KEY) ?? '5' } catch { return '5' } }

// Unidades de una línea: una por talla escrita (39, 40, 41) o la cantidad, lo que sea mayor.
const unidadesDe = (l: Linea) => { const t = tallasDeTexto(l.tallas); return { n: Math.max(1, t.length || Number(l.cantidad) || 1), tallas: t } }

export function CompraLoteModal({ open, products, onClose, onSaved }: { open: boolean; products: Producto[]; onClose: () => void; onSaved: (items: Inversion[]) => void }) {
  const [fecha, setFecha] = useState(hoy())
  const [metodo, setMetodo] = useState('PayPal')
  const [lineas, setLineas] = useState<Linea[]>([nuevaLinea()])
  const [total, setTotal] = useState('')
  const [modoCosto, setModoCosto] = useState<ModoReparto>('igual')
  const [calc, setCalc] = useState(false)
  const [subtotal, setSubtotal] = useState('')
  const [comision, setComision] = useState(leerComision)
  const [envio, setEnvio] = useState('')
  const [modoEnvio, setModoEnvio] = useState<ModoReparto>('peso')
  const [pago, setPago] = useState<Pago>('ahora')
  const [donde, setDonde] = useState<Donde>('en_preparacion')
  const [destino, setDestino] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [destinoEnvio, setDestinoEnvio] = useState<DestinoPago>({ cuentaId: null, montoCuenta: 0 })
  const [tipoCambio, setTipoCambio] = useState(37)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setFecha(hoy()); setMetodo('PayPal'); setLineas([nuevaLinea()]); setTotal(''); setModoCosto('igual'); setCalc(false); setSubtotal(''); setEnvio(''); setModoEnvio('peso'); setPago('ahora'); setDonde('en_preparacion')
    setDestino({ cuentaId: null, montoCuenta: 0 }); setDestinoEnvio({ cuentaId: null, montoCuenta: 0 })
    void obtenerTipoCambio().then(setTipoCambio).catch(() => undefined)
  }, [open])

  const cambiar = (key: string, cambios: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambios } : l)))
  // Al escribir el código se completa con el catálogo (nombre, marca, precio de venta, foto y tipo).
  const aplicarCodigo = (key: string, codigo: string) => {
    const buscado = codigo.trim().toLowerCase()
    const p = buscado ? products.find((x) => x.codigo?.trim().toLowerCase() === buscado) : undefined
    if (!p) return cambiar(key, { codigo, producto_id: '' })
    const tipo = tipoDeProducto(`${p.categoria ?? ''} ${p.nombre}`)
    cambiar(key, { codigo, producto_id: p.id, producto: p.nombre, marca: p.marca ?? '', precioVenta: String(p.precio_venta ?? ''), imagen: p.imagen ?? null, tipo, lb: String(TIPOS_PRODUCTO[tipo].lb) })
  }

  // Cada unidad (par) con su línea: el reparto se hace por unidad.
  const unidades = useMemo(() => lineas.flatMap((l) => { const { n, tallas } = unidadesDe(l); return Array.from({ length: n }, (_, i) => ({ linea: l, talla: tallas.length === n ? tallas[i] : (tallas[0] ?? '') })) }), [lineas])
  const totalNum = Number(total) || 0
  const envioNum = Number(envio) || 0
  const costos = useMemo(() => repartir(totalNum, unidades.map((u) => (modoCosto === 'igual' ? 1 : Number(u.linea.precioLista) || Number(u.linea.precioVenta) || 0))), [unidades, totalNum, modoCosto])
  const envios = useMemo(() => repartir(envioNum, unidades.map((u) => (modoEnvio === 'igual' ? 1 : modoEnvio === 'peso' ? Number(u.linea.lb) || 0 : Number(u.linea.precioLista) || Number(u.linea.precioVenta) || 0))), [unidades, envioNum, modoEnvio])
  // Resumen por línea (lo que se ve en la tabla): costo por unidad, envío por unidad, ganancia.
  const resumen = useMemo(() => {
    const cantidades = lineas.map((l) => unidadesDe(l).n)
    const inicios = cantidades.map((_, k) => cantidades.slice(0, k).reduce((s, x) => s + x, 0))
    return lineas.map((l, k) => {
      const n = cantidades[k], i = inicios[k]
      const c = costos.slice(i, i + n), e = envios.slice(i, i + n)
      const costoU = n ? c.reduce((s, x) => s + x, 0) / n : 0
      const envioU = n ? e.reduce((s, x) => s + x, 0) / n : 0
      const venta = Number(l.precioVenta) || 0
      return { key: l.key, n, costoU, envioU, totalU: costoU + envioU, ganU: venta - costoU - envioU }
    })
  }, [lineas, costos, envios])
  const ventaTotal = unidades.reduce((s, u) => s + (Number(u.linea.precioVenta) || 0), 0)
  const ganancia = ventaTotal - totalNum - envioNum
  const calculado = Math.round((Number(subtotal) || 0) * (1 + (Number(comision) || 0) / 100) * 100) / 100

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const faltan = lineas.filter((l) => !l.producto.trim() || !(Number(l.precioVenta) > 0))
    if (faltan.length) return toast.error('A cada producto ponele nombre (o código) y precio de venta.')
    if (totalNum <= 0) return toast.error('Escribí cuánto pagaste en total (con la comisión).')
    if (pago === 'ahora' && !destino.cuentaId && !window.confirm('No elegiste de qué cuenta salió el pago. ¿Registrarla sin descontar de ninguna cuenta?')) return
    setSaving(true)
    try {
      const lote = nuevoLote()
      const nota = `[LOTE:${lote}] Compra en conjunto · ${unidades.length} ${unidades.length === 1 ? 'unidad' : 'unidades'} · pagado US$ ${totalNum.toFixed(2)}`
      const estado: Inversion['estado'] = donde === 'en_inventario' ? 'en_inventario' : 'en_transito'
      const inputs = unidades.map((u, i) => ({
        fecha, producto_id: u.linea.producto_id || null, codigo: u.linea.codigo.trim() || null, producto: u.linea.producto.trim(), marca: u.linea.marca.trim() || null,
        talla_color: u.talla || null, cantidad: 1, costo_unitario: costos[i], gastos_adicionales: 0, precio_venta_estimado: Number(u.linea.precioVenta) || 0,
        estado, notas: nota, imagen: u.linea.imagen, tracking: null, transportista: null, url_tracking: null, estado_tracking: null, pedido_id: null,
        ...(estado === 'en_transito' ? { etapa: donde === 'en_preparacion' ? 'en_preparacion' : 'transito_internacional' } : {}),
      }))
      const creadas = await registrarCompraLibre(inputs, { modo: pago, metodo, destino })
      if (envioNum > 0) {
        await registrarEnvioCompras(creadas.map((item, i) => ({ item, monto: envios[i] })), { fecha, metodo: 'Transferencia' }, destinoEnvio)
        // El envío queda ligado a cada compra: se refleja en su costo (y en su ganancia).
        creadas.forEach((c, i) => { c.gastos = [...(c.gastos ?? []), { id: `envio-${i}`, monto: envios[i], categoria: 'Envío' }] })
      }
      try { localStorage.setItem(COMISION_KEY, comision) } catch { /* sin almacenamiento */ }
      onSaved(creadas)
      toast.success(`Listo: ${creadas.length} ${creadas.length === 1 ? 'compra registrada' : 'compras registradas'} (una por par), cada una con su costo repartido.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo registrar la compra.') } finally { setSaving(false) }
  }

  const opcion = (activo: boolean) => `rounded-xl border px-3 py-2 text-left text-xs transition ${activo ? 'border-accent bg-accent/[.1] text-white' : 'border-line text-muted hover:border-white/25 hover:text-white'}`
  return <Modal open={open} onClose={onClose} ancho="amplio" title="Compra en conjunto" description="Varios productos en un solo pago: escribí el total que pagaste y el panel reparte el costo, la comisión y el envío entre todos.">
    <form className="space-y-5" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.6fr]">
        <label className="form-field"><span>Fecha de compra</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="form-field"><span>Método de pago</span><input value={metodo} onChange={(e) => setMetodo(e.target.value)} list="metodos-lote" /><datalist id="metodos-lote"><option value="PayPal" /><option value="Transferencia" /><option value="Tarjeta" /><option value="Efectivo" /></datalist></label>
        <fieldset className="form-field"><span>¿Dónde está?</span><div className="grid grid-cols-3 gap-1 [&>button]:py-[.72rem] [&>button]:text-center [&>button]:whitespace-nowrap">{([['en_preparacion', 'Preparando'], ['en_transito', 'En camino'], ['en_inventario', 'Ya lo tengo']] as [Donde, string][]).map(([v, t]) => <button type="button" key={v} className={opcion(donde === v)} onClick={() => setDonde(v)}>{t}</button>)}</div></fieldset>
      </div>

      {/* 1 · Productos */}
      <section className="rounded-2xl border border-line bg-white/[.015]">
        <header className="flex items-center justify-between border-b border-line px-4 py-3"><h3 className="text-sm font-semibold">1 · Productos del paquete <span className="ml-1 text-xs font-normal text-muted">{unidades.length} {unidades.length === 1 ? 'unidad' : 'unidades'}</span></h3><button type="button" className="subtle-button" onClick={() => setLineas((ls) => [...ls, nuevaLinea()])}><Plus size={14} /> Agregar producto</button></header>
        <datalist id="lote-codigos">{products.map((p) => <option value={p.codigo} key={p.id}>{p.nombre}</option>)}</datalist>
        <div className="divide-y divide-line">
          {lineas.map((l, idx) => {
            const r = resumen[idx]
            return <div key={l.key} className="grid gap-2 p-3 sm:grid-cols-12 sm:items-end">
              <label className="form-field sm:col-span-2"><span>Código</span><input list="lote-codigos" value={l.codigo} onChange={(e) => aplicarCodigo(l.key, e.target.value)} placeholder="HS123" /></label>
              <label className="form-field sm:col-span-3"><span>Producto</span><input value={l.producto} onChange={(e) => cambiar(l.key, { producto: e.target.value })} placeholder="Nombre" /></label>
              <label className="form-field sm:col-span-2"><span>Tallas (una por par)</span><input value={l.tallas} onChange={(e) => cambiar(l.key, { tallas: e.target.value })} placeholder="39, 40, 41" /></label>
              <label className="form-field sm:col-span-1"><span>Cant.</span><input type="number" min="1" value={tallasDeTexto(l.tallas).length > 1 ? String(tallasDeTexto(l.tallas).length) : l.cantidad} disabled={tallasDeTexto(l.tallas).length > 1} onChange={(e) => cambiar(l.key, { cantidad: e.target.value })} /></label>
              <label className="form-field sm:col-span-2"><span>Tipo · peso (lb)</span><div className="flex gap-1"><select className="min-w-0 flex-1 px-2!" value={l.tipo} onChange={(e) => { const tipo = e.target.value as TipoProducto; cambiar(l.key, { tipo, lb: String(TIPOS_PRODUCTO[tipo].lb) }) }}>{(Object.keys(TIPOS_PRODUCTO) as TipoProducto[]).map((t) => <option key={t} value={t}>{TIPOS_PRODUCTO[t].label}</option>)}</select><input className="w-16! shrink-0 px-2!" type="number" min="0" step=".1" value={l.lb} onChange={(e) => cambiar(l.key, { lb: e.target.value })} aria-label="Peso en libras" /></div></label>
              <label className="form-field sm:col-span-1"><span>Venta c/u</span><input type="number" min="0" step=".01" value={l.precioVenta} onChange={(e) => cambiar(l.key, { precioVenta: e.target.value })} placeholder="$" /></label>
              <div className="flex items-end justify-end sm:col-span-1"><button type="button" className="table-action table-action-danger" disabled={lineas.length === 1} onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Quitar producto"><Trash2 size={15} /></button></div>
              {modoCosto === 'precio' && <label className="form-field sm:col-span-3"><span>Precio que te cobraron c/u (para repartir)</span><input type="number" min="0" step=".01" value={l.precioLista} onChange={(e) => cambiar(l.key, { precioLista: e.target.value })} placeholder={l.precioVenta ? `Si no, se usa la venta (${l.precioVenta})` : 'Opcional'} /></label>}
              {totalNum > 0 && r && <p className="text-[11px] text-muted sm:col-span-12">Cada unidad: costo <b className="text-white">{usd(r.costoU)}</b>{envioNum > 0 && <> + envío <b className="text-white">{usd(r.envioU)}</b> = <b className="text-white">{usd(r.totalU)}</b></>}{Number(l.precioVenta) > 0 && <> · ganancia <b className={r.ganU >= 0 ? 'text-green-300' : 'text-red-300'}>{usd(r.ganU)}</b></>}</p>}
            </div>
          })}
        </div>
      </section>

      {/* 2 · Pago */}
      <section className="rounded-2xl border border-line bg-white/[.015] p-4">
        <h3 className="text-sm font-semibold">2 · ¿Cuánto pagaste en total?</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="form-field"><span>Total pagado, ya con la comisión (US$)</span><input type="number" min="0" step=".01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Ej. 322.25" /></label>
          <button type="button" className="subtle-button h-[42px]" onClick={() => setCalc((v) => !v)}><Calculator size={15} /> Calcular con comisión</button>
        </div>
        {calc && <div className="mt-3 grid gap-3 rounded-xl border border-line bg-white/[.02] p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="form-field"><span>Precio sin comisión (US$)</span><input type="number" min="0" step=".01" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} /></label>
          <label className="form-field"><span>Comisión PayPal (%)</span><input type="number" min="0" step=".01" value={comision} onChange={(e) => setComision(e.target.value)} /></label>
          <button type="button" className="primary-button min-h-[42px]! px-4" disabled={!calculado} onClick={() => { setTotal(String(calculado)); setCalc(false) }}>Usar {usd(calculado)}</button>
        </div>}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{(['igual', 'precio'] as ModoReparto[]).map((m) => <button type="button" key={m} className={opcion(modoCosto === m)} onClick={() => setModoCosto(m)}><strong className="block text-sm">{MODOS_REPARTO[m].titulo}</strong>{m === 'igual' ? `${usd(unidades.length ? totalNum / unidades.length : 0)} cada unidad` : 'El más caro carga más del total y la comisión'}</button>)}</div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">{([['ahora', 'Pagado ahora', 'Sale de una cuenta'], ['antes', 'Ya estaba pagado', 'No se descuenta otra vez'], ['pendiente', 'Por pagar', 'Lo pagás después']] as [Pago, string, string][]).map(([v, t, a]) => <button type="button" key={v} className={opcion(pago === v)} onClick={() => setPago(v)}><strong className="block text-sm">{t}</strong>{a}</button>)}</div>
        {pago === 'ahora' && <div className="mt-3"><CuentaSelect proposito="comprar" montoUsd={totalNum} tipoCambio={tipoCambio} value={destino} onChange={setDestino} modo="resta" /></div>}
      </section>

      {/* 3 · Envío */}
      <section className="rounded-2xl border border-line bg-white/[.015] p-4">
        <h3 className="text-sm font-semibold">3 · Envío a Nicaragua <span className="ml-1 text-xs font-normal text-muted">opcional · también lo podés repartir cuando llegue</span></h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr] sm:items-end">
          <label className="form-field"><span>Costo del envío del paquete (US$)</span><input type="number" min="0" step=".01" value={envio} onChange={(e) => setEnvio(e.target.value)} placeholder="Ej. 45" /></label>
          <div className="grid grid-cols-3 gap-1">{(['peso', 'igual', 'precio'] as ModoReparto[]).map((m) => <button type="button" key={m} className={opcion(modoEnvio === m)} onClick={() => setModoEnvio(m)}><strong className="block">{MODOS_REPARTO[m].titulo}</strong><span className="hidden sm:inline">{MODOS_REPARTO[m].ayuda}</span></button>)}</div>
        </div>
        {envioNum > 0 && <div className="mt-3"><CuentaSelect proposito="comprar" montoUsd={envioNum} tipoCambio={tipoCambio} value={destinoEnvio} onChange={setDestinoEnvio} modo="resta" label="¿De qué cuenta salió el envío?" /></div>}
      </section>

      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-accent/25 bg-accent/[.05] p-4 text-center sm:grid-cols-4">
        <div><span className="text-[10px] uppercase tracking-wider text-muted">Unidades</span><strong className="mt-1 block text-lg">{unidades.length}</strong></div>
        <div><span className="text-[10px] uppercase tracking-wider text-muted">Costo total</span><strong className="mt-1 block text-lg">{usd(totalNum + envioNum)}</strong></div>
        <div><span className="text-[10px] uppercase tracking-wider text-muted">Venta total</span><strong className="mt-1 block text-lg text-accent">{usd(ventaTotal)}</strong></div>
        <div><span className="text-[10px] uppercase tracking-wider text-muted">Ganancia</span><strong className={`mt-1 block text-lg ${ganancia >= 0 ? 'text-green-300' : 'text-red-300'}`}>{usd(ganancia)}</strong></div>
      </div>
      <p className="text-[11px] text-muted">El costo repartido se guarda solo en estas compras: no cambia el costo del producto en el catálogo (cada compra sale distinta).</p>
      <div className="flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-6" disabled={saving}>{saving ? 'Registrando…' : `Registrar ${unidades.length} ${unidades.length === 1 ? 'unidad' : 'unidades'}`}</button></div>
    </form>
  </Modal>
}
