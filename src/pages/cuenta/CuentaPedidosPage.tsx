import { ChevronRight, Plus, Search } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CuentaShell, Hoja } from '../../components/cuenta/CuentaShell'
import { EstadoPedidoTag, FotoProducto } from '../../components/cuenta/piezas'
import { etapaCliente, formatoFecha, listarMisPedidos, vincularPedido, type EtapaCliente, type PedidoCuenta } from '../../services/cuentaCliente.service'
import { pedidosGuardados } from '../../utils/pedidosLocales'

const FILTROS: { id: 'todos' | EtapaCliente; texto: string }[] = [
  { id: 'todos', texto: 'Todos' }, { id: 'proceso', texto: 'En proceso' }, { id: 'enviado', texto: 'Enviados' }, { id: 'entregado', texto: 'Entregados' },
]

export function CuentaPedidosPage() {
  const [pedidos, setPedidos] = useState<PedidoCuenta[] | null>(null)
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['id']>('todos')
  const [agregar, setAgregar] = useState(false)
  const cargar = useCallback(() => listarMisPedidos().then(setPedidos).catch(() => { setPedidos([]); toast.error('No pudimos cargar tus pedidos.') }), [])
  useEffect(() => { void cargar() }, [cargar])

  const visibles = useMemo(() => (pedidos ?? []).filter((p) => filtro === 'todos' || etapaCliente(p.estado_codigo) === filtro), [pedidos, filtro])

  return <CuentaShell titulo="Mis pedidos" volver="/cuenta" accion={<button type="button" onClick={() => setAgregar(true)} className="hsc-iconbtn -mr-2" aria-label="Agregar pedido con código"><Plus size={21} strokeWidth={1.7} /></button>}>
    <div className="hsc-chips mt-2" role="tablist">
      {FILTROS.map((f) => <button key={f.id} type="button" role="tab" aria-selected={filtro === f.id} onClick={() => setFiltro(f.id)} className={`hsc-chip${filtro === f.id ? ' is-on' : ''}`}>{f.texto}</button>)}
    </div>

    <div className="mt-4 space-y-2.5">
      {pedidos === null
        ? [0, 1, 2].map((i) => <div key={i} className="hsp-card h-[104px] animate-pulse" />)
        : visibles.length === 0
          ? <div className="hsp-card p-7 text-center">
              <p className="text-[14px] font-semibold">{filtro === 'todos' ? 'Todavía no hay pedidos en tu cuenta' : 'No hay pedidos en esta etapa'}</p>
              {filtro === 'todos' && <>
                <p className="hsp-muted mx-auto mt-1.5 max-w-xs text-[12px] leading-5">Los pedidos hechos con tu correo aparecen solos. Si compraste por WhatsApp, agregalo con el código que te enviamos (empieza con HS).</p>
                <button type="button" onClick={() => setAgregar(true)} className="hsp-btn mt-4 h-11 min-h-0 text-[13px]"><Plus size={15} /> Agregar pedido con código</button>
              </>}
            </div>
          : visibles.map((p, i) => <Link key={p.codigo} to={`/cuenta/pedidos/${p.codigo}`} className="hsp-card hsc-press hsp-rise block p-3.5" style={{ animationDelay: `${i * 35}ms` }}>
              <div className="flex items-center gap-3.5">
                <FotoProducto src={p.imagen} tam={80} />
                <div className="min-w-0 flex-1">
                  <strong className="block text-[14px]">Pedido #{p.codigo}</strong>
                  <span className="hsp-muted block text-[12px]">{formatoFecha(p.fecha_pedido)}</span>
                  <span className="hsp-ink-soft mt-0.5 block truncate text-[12px]">{[p.marca, p.producto].filter(Boolean).join(' · ') || 'Pedido'}{p.items > 1 ? ` · +${p.items - 1}` : ''}</span>
                  <div className="mt-1.5"><EstadoPedidoTag estado={p.estado_codigo} /></div>
                </div>
                <ChevronRight size={17} className="hsp-faint shrink-0" />
              </div>
              <div className="mt-1 flex justify-end"><span className="hsp-muted inline-flex items-center gap-0.5 text-[11px]">Ver detalles <ChevronRight size={12} /></span></div>
            </Link>)}
    </div>

    <AgregarPedido abierta={agregar} onCerrar={() => setAgregar(false)} onAgregado={() => { setAgregar(false); void cargar() }} />
  </CuentaShell>
}

function AgregarPedido({ abierta, onCerrar, onAgregado }: { abierta: boolean; onCerrar: () => void; onAgregado: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [guardando, setGuardando] = useState(false)
  // Sugerimos los códigos que el cliente ya consultó en este teléfono (historial local).
  const sugeridos = useMemo(() => abierta ? pedidosGuardados().slice(0, 4).map((p) => p.codigo) : [], [abierta])
  const enviar = async (event?: FormEvent, valor = codigo) => {
    event?.preventDefault()
    setGuardando(true)
    try {
      const ok = await vincularPedido(valor)
      if (!ok) { toast.error('No encontramos ese código. Revisalo e intentá de nuevo.'); return }
      toast.success('Pedido agregado a tu cuenta.')
      setCodigo('')
      onAgregado()
    } catch { toast.error('No se pudo agregar el pedido.') } finally { setGuardando(false) }
  }
  return <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Agregar pedido">
    <p className="hsp-muted -mt-1 mb-3 text-[13px] leading-5">Escribí el código que recibiste por WhatsApp o correo al confirmar tu compra.</p>
    <form onSubmit={enviar} className="hsp-search">
      <Search size={18} className="hsp-faint shrink-0" />
      <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="HS483682" aria-label="Código del pedido" autoCapitalize="characters" autoFocus />
      <button disabled={guardando || !/^HS\d{6}$/.test(codigo)} className="hsp-btn shrink-0 rounded-xl px-4 text-[13px]">{guardando ? 'Agregando…' : 'Agregar'}</button>
    </form>
    {sugeridos.length > 0 && <div className="mt-4">
      <p className="hsp-eyebrow mb-2">Consultados en este teléfono</p>
      <div className="flex flex-wrap gap-2">{sugeridos.map((c) => <button key={c} type="button" disabled={guardando} onClick={() => void enviar(undefined, c)} className="hsp-chip">{c} <Plus size={12} className="ml-1" /></button>)}</div>
    </div>}
  </Hoja>
}
