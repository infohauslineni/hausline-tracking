import { ArrowRight, ChevronRight, Package, Search, Trash2 } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PortalShell, tonoEstado } from '../../components/public/PortalChrome'
import { buscarPedidoPublico } from '../../services/publicTracking.service'
import type { PublicOrder } from '../../types/publicTracking'
import { olvidarPedido, pedidosGuardados } from '../../utils/pedidosLocales'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'

type Fila = { codigo: string; order: PublicOrder | null; loading: boolean }

export function MisPedidosPage() {
  const navigate = useNavigate()
  const [filas, setFilas] = useState<Fila[]>(() => pedidosGuardados().map((item) => ({ codigo: item.codigo, order: null, loading: true })))
  const [input, setInput] = useState('')

  const cargar = useCallback(async (codigos: string[]) => {
    await Promise.all(codigos.map(async (codigo) => {
      try { const order = await buscarPedidoPublico(codigo); setFilas((prev) => prev.map((f) => f.codigo === codigo ? { ...f, order, loading: false } : f)) }
      catch { setFilas((prev) => prev.map((f) => f.codigo === codigo ? { ...f, loading: false } : f)) }
    }))
  }, [])

  useEffect(() => { void cargar(pedidosGuardados().map((item) => item.codigo)) }, [cargar])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const code = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    if (!/^HS\d{6}$/.test(code)) return
    navigate(`/pedido/${code}`)
  }
  const quitar = (codigo: string) => { olvidarPedido(codigo); setFilas((prev) => prev.filter((f) => f.codigo !== codigo)) }

  return <PortalShell>
    <section className="mx-auto w-full max-w-2xl px-5 pb-8 sm:px-8">
      <p className="hsp-eyebrow hsp-rise">Tu historial</p>
      <h1 className="hsp-display hsp-rise mt-2 text-3xl font-semibold sm:text-4xl" style={{ animationDelay: '40ms' }}>Mis pedidos</h1>
      <p className="hsp-muted hsp-rise mt-2.5 text-sm leading-6" style={{ animationDelay: '80ms' }}>Estos son los pedidos que consultaste en este dispositivo. Agregá otro con su código para tenerlos todos en un solo lugar.</p>

      <form onSubmit={submit} className="hsp-search hsp-rise mt-6" style={{ animationDelay: '120ms' }}>
        <Search size={18} className="hsp-faint shrink-0" />
        <input value={input} onChange={(event) => setInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="Agregar pedido: HS483682" aria-label="Código del pedido" autoCapitalize="characters" />
        <button disabled={input.replace(/[^A-Z0-9]/g, '').length < 8} className="hsp-btn shrink-0 rounded-xl px-4" aria-label="Agregar"><ArrowRight size={18} /></button>
      </form>

      {filas.length === 0
        ? <div className="hsp-card hsp-rise mt-6 p-8 text-center" style={{ animationDelay: '160ms' }}>
            <Package size={26} className="hsp-faint mx-auto" />
            <p className="mt-3 text-sm font-semibold">Todavía no tenés pedidos guardados</p>
            <p className="hsp-muted mx-auto mt-1.5 max-w-sm text-xs leading-5">Consultá un pedido con su código y quedará guardado acá automáticamente.</p>
            <Link to="/pedido" className="hsp-btn hsp-btn--line mt-5 inline-flex">Consultar un pedido</Link>
          </div>
        : <ul className="hsp-rise mt-6 space-y-3" style={{ animationDelay: '160ms' }}>
            {filas.map((fila) => <li key={fila.codigo}><FilaPedido fila={fila} onQuitar={() => quitar(fila.codigo)} /></li>)}
          </ul>}

      <div className="mt-8 rounded-2xl border p-5 text-sm" style={{ borderColor: 'var(--hair)', background: '#fbfbfa' }}>
        <p className="font-semibold">¿Querés acceder a tus pedidos desde cualquier teléfono?</p>
        <p className="hsp-muted mt-1.5 text-xs leading-5">Creá tu cuenta gratis: guardás tu historial, tus direcciones y solicitás el envío cuando tu pedido esté disponible.</p>
        <Link to="/cuenta/ingresar?crear=1" className="hsp-btn mt-3 inline-flex h-10 min-h-0 text-[13px]">Crear mi cuenta</Link>
      </div>
    </section>
  </PortalShell>
}

function FilaPedido({ fila, onQuitar }: { fila: Fila; onQuitar: () => void }) {
  const { codigo, order, loading } = fila
  const producto = order?.productos?.[0]
  const foto = producto ? resolverImagenCatalogo(producto.imagen) : null
  const tono = order ? tonoEstado(order.estado_codigo) : '#a3a29c'
  return <div className="hsp-card flex items-center gap-3.5 p-3.5">
    <Link to={`/pedido/${codigo}`} className="flex min-w-0 flex-1 items-center gap-3.5">
      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: 'var(--chip)', color: 'var(--faint)' }}>{foto ? <img src={foto} alt="" className="size-full object-cover" /> : <Package size={20} />}</span>
      <div className="min-w-0 flex-1">
        <span className="hsp-mono block text-sm font-bold">{codigo}</span>
        {loading
          ? <span className="mt-1 block h-3 w-24 animate-pulse rounded" style={{ background: 'var(--hair)' }} />
          : order
            ? <>
                <span className="hsp-muted block truncate text-xs">{producto?.producto ?? 'Pedido'}</span>
                <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-semibold"><span className="hsp-dot" style={{ ['--tone' as string]: tono, width: '.5rem', height: '.5rem' }} />{order.estado}</span>
              </>
            : <span className="text-xs" style={{ color: '#b91c1c' }}>No encontrado</span>}
      </div>
      <ChevronRight size={16} className="hsp-faint shrink-0" />
    </Link>
    <button type="button" onClick={onQuitar} className="grid size-9 shrink-0 place-items-center rounded-lg border transition-colors hover:bg-black/[0.03]" style={{ borderColor: 'var(--hair)', color: 'var(--faint)' }} aria-label="Quitar de mi lista"><Trash2 size={15} /></button>
  </div>
}
